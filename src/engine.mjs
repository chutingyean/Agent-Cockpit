// 確定性引擎：事件 → 研究狀態（reduce），研究狀態 + 專案事實 → 證據鏈健康度（derive）。0 token，可重播。
// 判斷「過期」靠內容雜湊：執行記下它用到的每個檔案的雜湊，之後任何一個不一樣就過期；改回原樣，雜湊對上就恢復。

import { topKey } from './repo.mjs';

export const short = p => String(p).split('/').pop();
export const STATUS = ['verified', 'optimized', 'refuted', 'open', 'pending', 'info'];   // research-cockpit 的固定詞表
export const TOOL_EVENT = { cockpit_run:'run_recorded', cockpit_claim:'claim_recorded', cockpit_report:'progress_reported', cockpit_decide:'decision_requested', cockpit_task:'task_upserted' };
const SYSTEM_AGENTS = new Set(['git', 'human', 'cockpit', 'cli']);

export function reduce(events){
  const st = { stages:[], stageAt:0, tasks:new Map(), runs:new Map(), claims:new Map(), hyps:new Map(), premises:new Map(), decisions:new Map(),
    notes:new Map(), links:[], moves:new Map(), known:new Map(), changes:new Map(), agents:new Map(), diagram:null, findings:[], tools:[], lastId:0, events };
  for (const e of events) {
    st.lastId = e.id;
    if (!SYSTEM_AGENTS.has(e.agent)) {
      const a = st.agents.get(e.agent) || { name:e.agent, runs:0, reports:0, claims:0 };
      a.last = e.ts;
      if (e.type === 'run_recorded') a.runs++;
      if (e.type === 'progress_reported') a.reports++;
      if (e.type === 'claim_recorded') a.claims++;
      st.agents.set(e.agent, a);
    }
    st.tools.push({ id:e.id, type:e.type });
    switch (e.type) {
      case 'stages_planned': st.stages = e.stages.map(s => ({ status:'todo', needs:[], ...s })); st.stageAt = e.id; break;
      case 'stage_updated': { const s = st.stages.find(x => x.id === e.id_); if (s) s.status = e.status; break; }
      case 'task_upserted': st.tasks.set(e.task.id, { ...st.tasks.get(e.task.id), ...e.task, agent:e.agent, updated:e.ts }); break;
      case 'run_recorded':
        st.runs.set(e.run.id, { ...e.run, agent:e.agent, ts:e.ts, eventId:e.id });
        for (const [p, h] of Object.entries(e.run.hashes || {})) if (!st.known.has(p)) st.known.set(p, h);
        for (const [p, h] of Object.entries(e.run.outputs || {})) {
          st.known.set(p, h);
          const c = st.changes.get(p);   // 執行寫出的檔案由那次執行負責，不算未回報
          if (c && c.hash === h) Object.assign(c, { reportedAt:e.id, reportedBy:e.run.id });
        }
        break;
      case 'file_changed': st.known.set(e.path, e.hash); st.changes.set(e.path, { ...e, reportedAt:null }); break;
      case 'progress_reported':
        for (const f of e.files || []) { const c = st.changes.get(f); if (c) { c.reportedAt = e.id; c.reportedBy = e.agent; } }
        if (e.task && st.tasks.has(e.task)) Object.assign(st.tasks.get(e.task), { summary:e.summary, why:e.why, next:e.next, updated:e.ts });
        break;
      case 'claim_recorded': st.claims.set(e.claim.id, { ...e.claim, agent:e.agent, ts:e.ts, eventId:e.id }); break;
      case 'hypothesis_upserted': st.hyps.set(e.hypothesis.id, { ...st.hyps.get(e.hypothesis.id), ...e.hypothesis, agent:e.agent }); break;
      case 'premise_recorded': st.premises.set(e.premise.id, { ...e.premise, status:'open', agent:e.agent }); break;
      case 'premise_resolved': { const p = st.premises.get(e.premiseId); if (p) p.status = e.verdict; break; }
      case 'decision_requested': st.decisions.set(e.decision.id, { ...e.decision, answer:null, agent:e.agent, eventId:e.id }); break;
      case 'decision_answered': {
        const d = st.decisions.get(e.decisionId) || { id:e.decisionId, auto:true };
        st.decisions.set(e.decisionId, { ...d, answer:e.answer, comment:e.comment || '', answeredAt:e.id });
        break;
      }
      case 'node_created': st.notes.set(e.node.id, { ...e.node, agent:e.agent }); break;
      case 'edge_created': st.links.push(e.edge); break;
      case 'node_moved': st.moves.set(e.nodeId, { x:e.x, y:e.y }); break;
      case 'diagram_updated': st.diagram = { diagram:e.diagram, paths:e.paths || {}, eventId:e.id }; break;
      case 'review_recorded': st.findings = e.findings; break;
    }
  }
  return st;
}

// 一筆證據還成不成立。有指定 JSON 欄位就只比那一格（別的實驗寫了其他欄位不影響），否則比整個檔案。
// ctx：{ cur(path) 最新已知的檔案雜湊, keysNow(path) 現在各欄位的雜湊, runs }
export function evidenceState(r, ev, ctx){
  const rk = r.outputKeys?.[ev.path];
  if (ev.key && rk) {
    const k = topKey(rk, ev.key), now = ctx.keysNow(ev.path)?.[k];
    if (now === rk[k]) return { ok:true };
    const later = ctx.runs.find(x => x.eventId > r.eventId && x.outputKeys?.[ev.path]?.[k] === now);
    return { ok:false, why:later ? `${ev.key} 已被 ${later.id} 覆寫` : `${ev.path} 的 ${ev.key} 在執行之外被改過（手改數據）` };
  }
  if (ctx.cur(ev.path) === r.outputs?.[ev.path]) return { ok:true };
  const later = ctx.runs.find(x => x.eventId > r.eventId && x.outputs?.[ev.path] === ctx.cur(ev.path));
  return { ok:false, why:later ? `${ev.path} 已被 ${later.id} 覆寫` : `${ev.path} 在執行之外被改過（手改數據）` };
}

// facts：{ dirty:Set, dep:{source, adj}, ua, summaryOf(path), keysNow(path) }
export function derive(st, facts){
  const cur = p => st.known.get(p);
  const runs = new Map();
  for (const r of st.runs.values()) {
    const files = [r.script, ...Object.keys(r.hashes || {}).filter(f => f !== r.script)].filter(Boolean);
    const hits = files.filter(f => cur(f) !== undefined && cur(f) !== r.hashes[f]);
    runs.set(r.id, { ...r, files, hits, stale:hits.length > 0 });
  }
  const ectx = { cur, keysNow:facts.keysNow || (() => null), runs:[...runs.values()] };
  const findings = st.findings || [];
  const claims = [...st.claims.values()].map(c => {
    const reasons = [], used = new Set();
    for (const ev of c.evidence || []) {
      const r = runs.get(ev.run);
      if (!r) { reasons.push(`找不到執行 ${ev.run}`); continue; }
      used.add(r.id);
      if (r.stale) reasons.push(`${r.hits.join('、')} 在 ${r.id} 之後被改`);
      const o = evidenceState(r, ev, ectx);
      if (!o.ok) reasons.push(o.why);
    }
    const files = [...used].flatMap(id => runs.get(id).files);
    return { ...c, runs:[...used], files:[...new Set(files)], health:!(c.evidence || []).length ? 'none' : reasons.length ? 'recheck' : 'valid', reasons,
      doubt:findings.filter(f => files.includes(f.path) && f.severity !== 'low') };
  });
  const bad = claims.filter(c => c.health === 'recheck');

  const broken = new Set();
  for (const r of runs.values()) if (r.stale) {
    broken.add(`${r.id}>file:${r.script}`);
    r.hits.filter(h => h !== r.script).forEach(h => broken.add(`file:${r.script}>file:${h}`));
  }
  bad.forEach(c => c.runs.forEach(r => broken.add(`${c.id}>${r}`)));

  // 程式碼檔：所有執行用到的檔案 + 現在有變動的程式檔
  const codeFiles = new Set([...runs.values()].flatMap(r => r.files));
  for (const p of facts.dirty) if (/\.(py|m?js|ts|r|jl|sh)$/i.test(p)) codeFiles.add(p);
  const degree = new Map();
  for (const [a, bs] of facts.dep.adj) for (const b of bs) { degree.set(a, (degree.get(a) || 0) + 1); degree.set(b, (degree.get(b) || 0) + 1); }
  const maxDeg = Math.max(0, ...[...codeFiles].map(f => degree.get(f) || 0));
  const uaNode = p => facts.ua?.nodes?.find(n => n.id === `file:${p}` || n.filePath === p);
  const unreported = [...st.changes.values()].filter(c => !c.reportedAt && facts.dirty.has(c.path));
  const files = [...codeFiles].sort().map(p => {
    const u = uaNode(p), ch = st.changes.get(p);
    return { path:p, summary:u?.summary || facts.summaryOf(p) || '', lesson:u?.languageNotes || '', complexity:u?.complexity || '', tags:u?.tags || [],
      fromUA:!!u, change:ch && facts.dirty.has(p) ? ch : null, unreported:unreported.some(c => c.path === p),
      finding:findings.find(f => f.path === p) || null, core:maxDeg >= 3 && (degree.get(p) || 0) === maxDeg };
  });

  // 分層：Understand-Anything 的 layers > md² 架構圖的 groups > 依資料夾自動分
  let layers;
  if (facts.ua?.layers?.length) layers = facts.ua.layers.map(L => ({ id:L.id, name:L.name, description:L.description, source:'Understand-Anything', paths:L.nodeIds.map(id => id.replace(/^file:/, '')) }));
  else if (st.diagram) {
    const d = st.diagram.diagram, P = st.diagram.paths;
    layers = (d.groups || []).map(g => ({ id:`layer:${g.id}`, name:g.label, description:d.meta?.description || '', source:'md² 架構圖', paths:g.nodeIds.flatMap(n => P[n] || []) }));
  } else {
    const dirs = new Map();
    for (const f of files) { const top = f.path.includes('/') ? f.path.split('/')[0] : '（根目錄）'; (dirs.get(top) || dirs.set(top, []).get(top)).push(f.path); }
    layers = [...dirs].map(([dir, paths]) => ({ id:`layer:${dir}`, name:`${dir}/`, description:`資料夾 ${dir}/`, source:'資料夾', paths }));
  }
  for (const L of layers) {
    L.paths = L.paths.filter(p => codeFiles.has(p) || files.some(f => f.path.startsWith(p)));
    L.claims = claims.filter(c => c.files.some(f => L.paths.some(p => f === p || f.startsWith(p.endsWith('/') ? p : p + '/'))));
    L.bad = L.claims.filter(c => c.health === 'recheck').map(c => c.id);
    L.claims = L.claims.map(c => c.id);
  }
  const covered = new Set(layers.flatMap(L => L.paths));
  const loose = files.filter(f => !covered.has(f.path)).map(f => f.path);
  if (loose.length) layers.push({ id:'layer:other', name:'其他', description:'不在任何分層裡的檔案', source:'資料夾', paths:loose, claims:[], bad:[] });

  // 假設：寫著 verified，但撐著它的結論有待重驗的，畫面上降回 pending
  const hyps = [...st.hyps.values()].map(h => {
    const support = claims.filter(c => c.hypothesis === h.id), weak = support.some(c => c.health === 'recheck');
    return { ...h, support:support.map(c => c.id), shown:weak && ['verified', 'optimized'].includes(h.status) ? 'pending' : h.status, weak };
  });

  const premises = [...st.premises.values()].map(p => {
    const moved = Object.entries(p.groundHashes || {}).filter(([f, h]) => cur(f) !== undefined && cur(f) !== h).map(([f]) => f);
    const flagged = findings.filter(f => (p.grounds || []).includes(f.path));
    return { ...p, moved, risk:moved.length || flagged.length ? '高' : p.risk };
  });

  const usedAfter = type => st.tools.some(t => t.id > st.stageAt && t.type === type);
  const stages = st.stages.map(s => ({ ...s, needs:(s.needs || []).map(t => [t, usedAfter(TOOL_EVENT[t] || t)]) }));

  // 裁決：agent 送的 + cockpit 自動送的（未回報的變更讓結論失效時）
  const decisions = [];
  for (const c of unreported) {
    const hit = bad.filter(x => x.files.includes(c.path));
    if (!hit.length) continue;
    const id = `AUTO:${c.path}`, prev = st.decisions.get(id), stale = [...runs.values()].filter(r => r.hits.includes(c.path));
    const f = findings.find(x => x.path === c.path);
    decisions.push({ id, auto:'證據鏈失效', chain:true, path:c.path, grounds:hit.map(x => x.id),
      question:`${c.path} 被改了，沒有 agent 回報；${hit.length} 個結論的證據鏈失效。怎麼處理？`,
      options:[`還原 ${short(c.path)}`, `接受並重跑 ${stale.length} 次執行`], rec:0,
      reason:`改到 ${(c.funcs || []).join('、') || '這個檔案'}${f ? `；審查：${f.message}` : ''}。`, answer:prev?.answer ?? null, runs:stale.map(r => r.id) });
  }
  for (const d of st.decisions.values()) if (!d.auto) decisions.push({ ...d, rec:d.rec ?? 0 });

  const tasks = [...st.tasks.values()];
  const agents = [...st.agents.values()].map(a => ({ ...a, task:tasks.find(t => t.agent === a.name && t.state === 'doing')?.id || null }));
  const changesAll = [...st.changes.values()].filter(c => c.agent !== 'cockpit');
  return {
    lastId:st.lastId, stages, tasks, runs:[...runs.values()], claims, bad:bad.map(c => c.id), hyps, premises, decisions, files, layers,
    unreported, broken:[...broken], findings, agents, notes:[...st.notes.values()], links:st.links, moves:Object.fromEntries(st.moves), depSource:facts.dep.source,
    reportRate:changesAll.length ? Math.round(changesAll.filter(c => c.reportedAt).length / changesAll.length * 100) : 100,
  };
}

// 證據鏈 → Understand-Anything 的導覽格式（TourStep：order / title / description / nodeIds）
export function chainTour(D, claimId){
  const c = D.claims.find(x => x.id === claimId);
  if (!c) return null;
  const steps = [{ title:`結論 ${c.id}`, description:`目前相信：${c.text}。` + (c.reasons.length ? `但是 ${c.reasons.join('；')}。` : '證據鏈完整。'), nodeIds:[c.id] }];
  for (const id of c.runs) {
    const r = D.runs.find(x => x.id === id), ev = c.evidence.find(e => e.run === id);
    steps.push({ title:`數字來自執行 ${r.id}`, description:`${r.cmd}。它把 ${ev.key || ev.path} 寫進 ${ev.path}，當時的 commit 是 ${r.commit || '（未 commit）'}。`, nodeIds:[r.id] });
    r.files.forEach((f, i) => {
      const file = D.files.find(x => x.path === f), hit = r.hits.includes(f);
      steps.push({ title:i ? `它用到 ${short(f)}` : `執行的程式是 ${short(f)}`, nodeIds:[`file:${f}`],
        description:(file?.summary || f) + (hit ? ` 這個檔案在 ${r.id} 之後被改了${file?.change?.funcs?.length ? `（${file.change.funcs.join('、')}）` : ''}，所以 ${r.id} 過期。` : '') });
    });
    const L = D.layers.find(L => L.paths.includes(r.script));
    if (L) steps.push({ title:`屬於「${L.name}」`, description:`${L.description}。這一層支撐 ${L.claims.length} 個結論，${L.bad.length} 個待重驗。`, nodeIds:[L.id] });
  }
  return { title:`為什麼${c.health === 'recheck' ? ` ${c.id} 要重驗` : `相信 ${c.id}`}？`, source:'證據鏈 → UA 導覽格式', steps:steps.map((s, i) => ({ order:i + 1, ...s })) };
}

// 自動裁決 → answer-me-with-html 的 Markdown 草稿；內容全部來自證據圖
export function briefMarkdown(D, decisionId){
  const d = D.decisions.find(x => x.id === decisionId && x.chain);
  if (!d) return null;
  const hit = D.claims.filter(c => d.grounds.includes(c.id)), runs = D.runs.filter(r => d.runs.includes(r.id));
  const f = D.findings.find(x => x.path === d.path), ch = D.unreported.find(c => c.path === d.path);
  const node = s => `[${String(s).replace(/[\[\]]/g, '')}]`;
  return [
    '---', `title: ${hit.length} 個結論要重驗`, `subtitle: ${d.path} 被改了，沒有回報`, 'lang: zh-Hant', 'source: Agent Cockpit 證據鏈（自動產生）', '---',
    `${d.path} 在執行之後被改${ch?.funcs?.length ? `（${ch.funcs.join('、')}）` : ''}。${runs.length} 次執行用到它，所以 ${hit.map(c => c.id).join('、')} 目前沒有有效證據。`, '',
    '## A 斷掉的證據鏈', '```flow LR',
    `*${node(short(d.path) + ' 被改')} -> ${runs.map(r => node(r.id)).join(' & ')}`,
    ...hit.flatMap(c => c.runs.filter(r => d.runs.includes(r)).map(r => `${node(r)} -> ${node(c.id)}`)),
    '```', '',
    '## B 每個結論的狀態', '| 結論 | 證據 | 狀態 |', '|---|---|---|',
    ...D.claims.map(c => `| ${c.id} ${c.text.replace(/\|/g, '/')} | ${c.evidence.map(e => `${e.run} 的 ${e.key || short(e.path)}`).join('、')} | ${c.health === 'recheck' ? 'no 待重驗' : c.health === 'valid' ? 'ok 有效' : 'warn 沒有證據'} |`), '',
    '## C 過期的執行', '| 執行 | 命令 | commit |', '|---|---|---|',
    ...runs.map(r => `| ${r.id} | ${r.cmd.replace(/\|/g, '/')} | ${r.commit || '未 commit'} |`), '',
    ...(f ? ['## D 審查發現', `\`\`\`callout err ${short(f.path)}${f.line ? ` 第 ${f.line} 行` : ''}`, `${f.message}`, '```', ''] : []),
    '## E 要你決定', '```ask', `怎麼處理 ${short(d.path)} 的改動？`, `* ${d.options[0]} | ${hit.length} 個結論恢復有效`, `- ${d.options[1]} | 重跑完以前維持待重驗`, '```',
  ].join('\n');
}
