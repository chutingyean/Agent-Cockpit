// MCP server：任何支援 MCP 的 agent（Claude Code、Codex、Cursor、Gemini CLI…）都透過這些工具把研究畫到白板上。
// 通用的畫布工具用 canvas_* 命名；研究紀律在 cockpit_* 工具與寫入咽喉裡強制。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { openCockpit } from './cockpit.mjs';
import { recordRun } from './run.mjs';
import { GateError } from './gate.mjs';
import { validateDiagram } from './diagram.mjs';
import { runGraphify, runOcr } from './adapters.mjs';
import { depGraph } from './deps.mjs';
import { affected } from './graph.mjs';

export const RULES = `Agent Cockpit 規範（研究證據鏈）：
1. 每個 session 開工先呼叫 cockpit_overview，看要你處理的事、待重驗的結論、未回報的變更。
2. 開始一件工作就用 cockpit_task 建任務卡，之後每一輪更新同一張（state、step、summary、why、next）。
3. 所有實驗都用 cockpit_run 跑（終端機可用 cockpit run -- 命令）。沒經過它的執行不會有紀錄，數字也不能被結論引用。
4. 得到結論就用 cockpit_claim 登記；evidence 必須指向某次執行寫出的檔案與欄位。
5. 改了任何檔案就用 cockpit_report 回報（files 列出改了哪些）。沒回報的變更會在白板上標紅，git commit 也會被擋下。
6. 需要人決定的事用 cockpit_decide；blocking 的要停下來請使用者到駕駛艙裁決，回來用 cockpit_decisions 拿結果。
7. 還沒驗證就拿來當前提的假設，用 cockpit_premise 登記。`;

const nextId = (prefix, used) => { let i = used.size + 1; while (used.has(`${prefix}${i}`)) i++; return `${prefix}${i}`; };
const ok = (text, data) => ({ content:[{ type:'text', text:data ? `${text}\n${JSON.stringify(data, null, 1)}` : text }] });
const bad = msg => ({ isError:true, content:[{ type:'text', text:`被拒收：${msg}` }] });

export function overviewText(D){
  const L = [];
  const pend = D.decisions.filter(d => d.answer == null), done = D.decisions.filter(d => d.answer != null);
  L.push(`結論：${D.claims.filter(c => c.health === 'valid').length}/${D.claims.length} 有效${D.bad.length ? `；待重驗 ${D.bad.join('、')}` : ''}`);
  for (const c of D.claims.filter(c => c.health === 'recheck')) L.push(`  ⛓ ${c.id}「${c.text}」：${c.reasons.join('；')}`);
  if (pend.length) { L.push(`要人決定（${pend.length}）：`); pend.forEach(d => L.push(`  ⏳ ${d.id}${d.auto ? '（cockpit 自動）' : ''} ${d.question} 選項：${d.options.join(' / ')}`)); }
  if (done.length) { L.push('已裁決：'); done.forEach(d => L.push(`  ✔ ${d.id} → ${d.options[d.answer]}${d.comment ? `（留言：${d.comment}）` : ''}`)); }
  if (D.unreported.length) L.push(`未回報變更（請用 cockpit_report 補報）：${D.unreported.map(c => c.path).join('、')}`);
  const unmet = D.stages.filter(s => s.status !== 'done' && s.needs.some(([, okk]) => !okk));
  if (unmet.length) L.push(`階段條件未滿足：${unmet.map(s => `${s.id} ${s.title}（還沒叫：${s.needs.filter(([, okk]) => !okk).map(([t]) => t).join('、')}）`).join('；')}`);
  const risky = D.premises.filter(p => p.status === 'open' && p.risk === '高');
  if (risky.length) L.push(`高風險前提：${risky.map(p => `${p.id} ${p.text}`).join('；')}`);
  const doing = D.tasks.filter(t => t.state !== 'done');
  if (doing.length) L.push(`進行中的任務：${doing.map(t => `${t.id} ${t.title}（${t.agent}，${t.state}）`).join('；')}`);
  if (D.findings.some(f => f.severity === 'high')) L.push(`審查發現（high）：${D.findings.filter(f => f.severity === 'high').map(f => `${f.path}:${f.line} ${f.message}`).join('；')}`);
  L.push(`依賴來源：${D.depSource}${D.graph?.god.length ? `（核心：${D.graph.god.slice(0, 3).map(g => g.label).join('、')}）` : ''}；執行 ${D.runs.length} 次；回報率 ${D.reportRate}%`);
  return L.join('\n');
}

export function createMcpServer(cockpit){
  const server = new McpServer({ name:'agent-cockpit', version:'0.1.0' }, { instructions:RULES });
  const agent = () => server.server.getClientVersion()?.name || 'unknown-agent';
  const tool = (name, description, inputSchema, fn) => server.registerTool(name, { description, inputSchema }, async args => {
    try { return await fn(args); }
    catch (e) {
      if (!(e instanceof GateError)) throw e;
      cockpit.store.append('gate_rejected', { tool:name, message:e.message }, agent());   // 被擋下的也留紀錄：協作紀錄看得到 agent 怎麼被糾正
      return bad(e.message);
    }
  });
  const st = () => cockpit.state();

  tool('cockpit_overview', '開工先呼叫：要你處理的事、待重驗的結論與原因、裁決結果、未回報的變更、階段條件。', {}, async () => {
    cockpit.syncFiles();
    return ok(overviewText(cockpit.view().D));
  });

  tool('cockpit_plan', '建立研究路徑（白板上的階段卡）。階段是資料不是提示詞：needs 列出這一關非叫不可的工具，human 表示要人看過才能結束。', {
    stages:z.array(z.object({ id:z.string().optional(), title:z.string(), out:z.string().describe('這一關要產出什麼'),
      needs:z.array(z.enum(['cockpit_run', 'cockpit_claim', 'cockpit_report', 'cockpit_decide', 'cockpit_task'])).optional(), human:z.boolean().optional() })),
  }, async ({ stages }) => {
    stages = stages.map((s, i) => ({ ...s, id:s.id || `P${i + 1}` }));
    cockpit.write('stages_planned', { stages }, agent());
    return ok(`已建立 ${stages.length} 個階段：${stages.map(s => `${s.id} ${s.title}`).join('、')}`);
  });

  tool('cockpit_stage', '更新階段狀態（todo / active / done）。done 會檢查這一關的 needs 是否都被呼叫過。', {
    id:z.string(), status:z.enum(['todo', 'active', 'done']),
  }, async ({ id, status }) => { cockpit.write('stage_updated', { id_:id, status }, agent()); return ok(`階段 ${id} → ${status}`); });

  tool('cockpit_task', '建立或更新你的任務卡（一件工作一張卡，每一輪更新同一張）。', {
    id:z.string().optional().describe('更新既有任務時帶上；新任務不用給'), stage:z.string().optional(), title:z.string(),
    state:z.enum(['doing', 'blocked', 'done']), step:z.string().optional().describe('例如「第 2/4 步」'), progress:z.number().min(0).max(100).optional(),
    summary:z.string().describe('這一輪做了什麼'), why:z.string().describe('為什麼這樣做'), next:z.string().describe('下一步'), where:z.string().optional().describe('分支或 worktree'),
  }, async args => {
    const id = args.id || nextId('T', new Set(st().tasks.keys()));
    cockpit.write('task_upserted', { task:{ ...args, id } }, agent());
    return ok(`任務 ${id} 已更新`);
  });

  tool('cockpit_run', '執行實驗並記錄（命令、commit、用到的程式碼雜湊、寫出的檔案）。結論只能引用這裡記到的輸出。', {
    command:z.string().describe('在專案根目錄執行的命令，例如 python3 eval/run.py --arm combo'),
  }, async ({ command }) => {
    const { run, log } = recordRun(cockpit, command, { agent:agent(), capture:true });
    return ok(`${run.exit === 0 ? '✓' : '✗ 失敗'} 執行 ${run.id}（exit ${run.exit}，${run.ms} ms）
用到的程式：${Object.keys(run.hashes).join('、') || '（沒有偵測到腳本）'}
寫出的檔案：${Object.keys(run.outputs).join('、') || '沒有'}
--- 輸出（最後 1500 字）---
${log.slice(-1500)}`);
  });

  tool('cockpit_claim', '登記一個結論。evidence 必須是 cockpit_run 寫出的檔案；JSON 檔可用 key 指定欄位（會讀出實際數值）。', {
    id:z.string().optional(), text:z.string(), hypothesis:z.string().describe('這個結論支撐哪個假設，例如 H-M01'),
    evidence:z.array(z.object({ run:z.string(), path:z.string(), key:z.string().optional() })),
  }, async args => {
    const id = args.id || nextId('C', new Set(st().claims.keys()));
    const claim = { ...args, id };
    cockpit.write('claim_recorded', { claim }, agent());
    return ok(`結論 ${id} 已登記，證據：${claim.evidence.map(e => `${e.run} ${e.path}${e.key ? ` ${e.key}=${JSON.stringify(e.value)}` : ''}`).join('；')}`);
  });

  tool('cockpit_hypothesis', '建立或更新假設（方案空間）。改成 verified／refuted 前，必須先有證據鏈完整的結論撐著。', {
    id:z.string(), label:z.string(), status:z.enum(['verified', 'optimized', 'refuted', 'open', 'pending', 'info']),
    group:z.string().optional(), value:z.enum(['高', '中', '低']).optional(), one:z.string().optional().describe('一句話說明'),
  }, async args => { cockpit.write('hypothesis_upserted', { hypothesis:args }, agent()); return ok(`假設 ${args.id} → ${args.status}`); });

  tool('cockpit_premise', '登記一個還沒驗證、卻被拿來當地基的前提。grounds 是它所依據的檔案，檔案一改風險自動升高。', {
    text:z.string(), used_by:z.string().describe('哪些結論或推理用到它'), risk:z.enum(['高', '中', '低']), grounds:z.array(z.string()).optional(),
  }, async ({ text, used_by, risk, grounds }) => {
    const id = nextId('PR', new Set(st().premises.keys()));
    cockpit.write('premise_recorded', { premise:{ id, text, used:used_by, risk, grounds:grounds || [] } }, agent());
    return ok(`前提 ${id} 已登記`);
  });

  tool('cockpit_decide', '請人裁決。blocking=true 時請停下來，告訴使用者到駕駛艙裁決，回來再呼叫 cockpit_decisions。', {
    question:z.string(), options:z.array(z.string()).min(2).max(5), recommendation:z.number().int().describe('建議選項的索引（從 0 開始）'),
    reason:z.string(), grounds:z.array(z.string()).optional().describe('依據的結論 id'), blocking:z.boolean().optional(), task:z.string().optional(),
  }, async ({ question, options, recommendation, reason, grounds, blocking, task }) => {
    const id = nextId('J', new Set(st().decisions.keys()));
    cockpit.write('decision_requested', { decision:{ id, question, options, rec:recommendation, reason, grounds:grounds || [], blocking:!!blocking, task } }, agent());
    return ok(`已送出裁決 ${id}。${blocking ? '這是 blocking 的：請停下來，請使用者到駕駛艙裁決。' : ''}`);
  });

  tool('cockpit_decisions', '取回人類在駕駛艙的裁決與留言（含 cockpit 自動送出的）。', {}, async () => {
    const D = cockpit.view().D;
    return ok('裁決：', D.decisions.map(d => ({ id:d.id, question:d.question, answer:d.answer == null ? null : d.options[d.answer], comment:d.comment || '' })));
  });

  tool('cockpit_report', '回報這一輪改了哪些檔案（沒改就給空陣列）。沒回報的變更會標紅並擋下 commit。', {
    files:z.array(z.string()), summary:z.string(), why:z.string(), next:z.string().optional(), task:z.string().optional(),
  }, async args => { cockpit.write('progress_reported', args, agent()); return ok(`已回報 ${args.files.length} 個檔案`); });

  tool('cockpit_review', '程式碼審查。不給 findings：裝了 open-code-review 就跑 ocr review，沒裝就用內建的規則審查（預設只看改到的行，all=true 看全部）；給 findings：Delegation mode，由你審查後回報。審查結果會沿證據鏈標出受威脅的結論。', {
    findings:z.array(z.object({ path:z.string(), line:z.number().int().optional(), severity:z.enum(['high', 'medium', 'low']), message:z.string() })).optional(),
    all:z.boolean().optional(),
  }, async ({ findings, all }) => {
    let by = agent();
    if (!findings) {
      const r = runOcr(cockpit.root, { all });
      if (!r.ok) return bad(r.message);
      findings = r.findings; by = r.tool;
    }
    cockpit.write('review_recorded', { findings, tool:by }, agent());
    const D = cockpit.view().D;
    return ok(`已記錄 ${findings.length} 筆審查結果（${by}）；受影響的結論：${D.claims.filter(c => c.doubt.length).map(c => c.id).join('、') || '沒有'}`,
      findings.map(f => `${f.severity} ${f.path}:${f.line ?? '-'} ${f.message}`));
  });

  // —— 通用畫布工具 ——
  tool('canvas_list', '列出畫布（這個專案的研究白板）與各種卡片的數量。', {}, async () => {
    const { board } = cockpit.view(), count = {};
    board.nodes.forEach(n => { count[n.kind] = (count[n.kind] || 0) + 1; });
    return ok('畫布：', [{ id:'agent-cockpit', title:board.canvas.title, cards:board.nodes.length, edges:board.edges.length, kinds:count }]);
  });

  tool('canvas_read', '讀一張卡片的內容（給 id），或整張白板的摘要（不給 id）。', { id:z.string().optional() }, async ({ id }) => {
    const { D, board } = cockpit.view();
    if (!id) return ok(overviewText(D));
    const pick = [D.claims, D.runs, D.tasks, D.stages, D.notes, D.files.map(f => ({ ...f, id:`file:${f.path}` }))].flat().find(x => x.id === id);
    if (!pick) return bad(`白板上沒有 ${id}`);
    return ok(`卡片 ${id}：`, { ...pick, edges:board.edges.filter(e => e.from === id || e.to === id) });
  });

  tool('canvas_search', '在白板上搜尋卡片（標題、內文）。', { query:z.string() }, async ({ query }) => {
    const { D } = cockpit.view(), q = query.toLowerCase();
    const hits = [...D.claims.map(c => [c.id, c.text]), ...D.tasks.map(t => [t.id, `${t.title} ${t.summary || ''}`]), ...D.notes.map(n => [n.id, `${n.title} ${n.body || ''}`]),
      ...D.runs.map(r => [r.id, r.cmd]), ...D.files.map(f => [`file:${f.path}`, `${f.path} ${f.summary}`])].filter(([, t]) => t.toLowerCase().includes(q));
    return ok(`找到 ${hits.length} 張：`, hits.map(([id, t]) => ({ id, text:t.slice(0, 120) })));
  });

  tool('canvas_createNode', '建一般卡片（筆記、論文、網頁、文件、資料表）。結論、任務、執行等研究卡片請用 cockpit_* 工具。', {
    kind:z.string(), title:z.string(), body:z.string().optional(), ref:z.string().optional(),
  }, async args => {
    const id = nextId('N', new Set(st().notes.keys()));
    cockpit.write('node_created', { node:{ ...args, id } }, agent());
    return ok(`卡片 ${id} 已建立`);
  });

  tool('canvas_link', '連兩張卡片。kind：branch / reference / cites / similarity / flow / owns / uses / link。', {
    from:z.string(), to:z.string(), kind:z.string(), label:z.string().optional(),
  }, async edge => { cockpit.write('edge_created', { edge }, agent()); return ok(`已連線 ${edge.from} → ${edge.to}`); });

  tool('canvas_diagram', '用 md² 架構圖格式（meta / nodes / groups / edges）描述專案結構；paths 把圖的節點對應到真實路徑。', {
    diagram:z.record(z.string(), z.any()), paths:z.record(z.string(), z.array(z.string())).optional(),
  }, async ({ diagram, paths }) => {
    const problems = validateDiagram(diagram, paths || {}, cockpit.root);
    if (problems.length) return bad(`架構圖不合格：\n${problems.join('\n')}`);
    cockpit.write('diagram_updated', { diagram, paths:paths || {} }, agent());
    return ok(`架構圖已更新：${diagram.groups?.length || 0} 個群組、${diagram.nodes.length} 個節點`);
  });

  tool('canvas_structure', '重建程式碼圖：裝了 graphify 就跑 graphify update .，沒裝就用內建的輕量版。回傳核心節點、社群、意外連結；給 file（與 funcs）就回傳改它會影響到哪些函式。', {
    file:z.string().optional(), funcs:z.array(z.string()).optional(),
  }, async ({ file, funcs }) => {
    if (file) {
      const g = depGraph(cockpit.root).graph;
      if (!g) return bad('還沒有程式碼圖');
      const hit = affected(g, file, funcs || []);
      return ok(`改 ${file}${funcs?.length ? ` 的 ${funcs.join('、')}` : ''} 會影響 ${hit.length} 個函式／檔案：`, hit.map(x => `${x.file} ${x.label}`));
    }
    const r = runGraphify(cockpit.root);
    if (!r.ok) return bad(r.message);
    return ok(r.message, r.report && { 核心節點:r.report.god.map(g => `${g.label}（${g.file}，${g.degree}）`), 社群:r.report.communities.map(c => `${c.label}：${c.files.join('、')}`),
      意外連結:r.report.surprises.map(x => `${x.from} → ${x.to}（${x.fromFile} → ${x.toFile}）`), 建議問題:r.report.questions });
  });

  return server;
}

export async function serveStdio(root){
  const cockpit = openCockpit(root);
  await createMcpServer(cockpit).connect(new StdioServerTransport());
}
