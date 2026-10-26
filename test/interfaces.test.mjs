// 對外介面：MCP、網頁 server、hook 用的 check、cockpit init（AC5、AC8、AC11、AC12、AC14）
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openCockpit } from '../src/cockpit.mjs';
import { createMcpServer } from '../src/mcp.mjs';
import { createServer } from '../src/server.mjs';
import { init } from '../src/init.mjs';
import { tempRepo, withClaim, loosenJudge } from './helpers.mjs';

const BIN = fileURLToPath(new URL('../bin/cockpit.mjs', import.meta.url));

async function mcpClient(root, name){
  const [ct, stt] = InMemoryTransport.createLinkedPair();
  await createMcpServer(openCockpit(root)).connect(stt);
  const client = new Client({ name, version:'test' });
  await client.connect(ct);
  return { client, call:(tool, args = {}) => client.callTool({ name:tool, arguments:args }) };
}

test('MCP：研究流程走得通；不合規的呼叫回傳 isError 與原因；agent 身分來自 clientInfo', async () => {
  const root = tempRepo(), { client, call } = await mcpClient(root, 'claude-code');
  const { tools } = await client.listTools();
  for (const t of ['cockpit_overview', 'cockpit_run', 'cockpit_claim', 'cockpit_decide', 'cockpit_decisions', 'cockpit_report', 'canvas_createNode', 'canvas_diagram']) assert.ok(tools.some(x => x.name === t), t);
  assert.ok(!(await call('cockpit_run', { command:'python3 eval/run.py --arm combo --seeds 1,2' })).isError);
  const okClaim = await call('cockpit_claim', { text:'組合臂準確率超過九成', hypothesis:'H-M01', evidence:[{ run:'R1', path:'results/數據總表.json', key:'combo.acc' }] });
  assert.ok(!okClaim.isError);
  const badClaim = await call('cockpit_claim', { text:'沒有執行撐著的結論', hypothesis:'H', evidence:[{ run:'R9', path:'results/數據總表.json' }] });
  assert.ok(badClaim.isError);
  assert.match(badClaim.content[0].text, /沒有執行 R9/);
  const events = openCockpit(root).store.events();
  assert.ok(events.some(e => e.type === 'claim_recorded' && e.agent === 'claude-code'));
  assert.ok(events.some(e => e.type === 'gate_rejected' && e.tool === 'cockpit_claim' && e.agent === 'claude-code'), '被拒收的呼叫也留紀錄');
});

test('MCP：兩個 agent 同時寫入，各自的任務卡都在，事件沒有遺失', async () => {
  const root = tempRepo(), a = await mcpClient(root, 'claude-code'), b = await mcpClient(root, 'gemini-cli');
  const task = (title) => ({ title, state:'doing', summary:'開始處理這件研究工作', why:'需要這部分的證據才能裁決', next:'接著跑實驗' });
  await Promise.all([a.call('cockpit_task', task('組合臂評估')), b.call('cockpit_task', task('困難檔評估'))]);
  const D = openCockpit(root).view().D;
  assert.deepEqual(D.tasks.map(t => t.agent).sort(), ['claude-code', 'gemini-cli']);
  assert.equal(new Set(D.tasks.map(t => t.id)).size, 2);
});

test('MCP：md² 架構圖要過驗證；圖上的節點要對應到真實檔案', async () => {
  const root = tempRepo(), { call } = await mcpClient(root, 'claude-code');
  const diagram = { meta:{ version:1, type:'architecture', title:'評估流程', description:'評估怎麼跑' },
    nodes:[{ id:'run', label:'執行器', role:'focal' }, { id:'judge', label:'評分器', role:'backend' }], groups:[{ id:'g', label:'eval/', nodeIds:['run', 'judge'] }],
    edges:[{ id:'e1', from:'run', to:'judge', kind:'call', label:'呼叫' }] };
  assert.ok(!(await call('canvas_diagram', { diagram, paths:{ run:['eval/run.py'], judge:['eval/judge.py'] } })).isError);
  const bad = await call('canvas_diagram', { diagram:{ ...diagram, nodes:[{ id:'run', label:'執行器', role:'boss' }] }, paths:{ run:['nope.py'] } });
  assert.ok(bad.isError);
  assert.match(bad.content[0].text, /role 只能是[\s\S]*不存在於專案裡/);
});

test('網頁 server：只接受本機白板送出的 JSON；人在白板上的裁決 agent 拿得到', async () => {
  const { root, ck } = withClaim();
  ck.write('decision_requested', { decision:{ id:'J1', question:'要不要採用這個結論？', options:['採納', '駁回'], rec:0, reason:'證據鏈完整而且數字穩定', grounds:['C1'] } }, 'test');
  const port = 41000 + Math.floor(Math.random() * 2000), s = createServer(root, { port });
  await s.listen();
  try {
    const base = `http://127.0.0.1:${port}`;
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.D.claims[0].health, 'valid');
    assert.ok(state.board.nodes.some(n => n.id === 'C1' && n.kind === 'analysis'));
    const post = (origin, body) => fetch(`${base}/api/decide`, { method:'POST', headers:{ 'content-type':'application/json', ...(origin && { origin }) }, body:JSON.stringify(body) });
    assert.equal((await post(null, { id:'J1', answer:0 })).status, 403);
    assert.equal((await post('https://evil.example', { id:'J1', answer:0 })).status, 403);
    assert.equal((await post(base, { id:'J1', answer:7 })).status, 400);
    assert.equal((await post(base, { id:'J1', answer:0 })).status, 200);
    const { client, call } = await mcpClient(root, 'claude-code');
    assert.match((await call('cockpit_decisions')).content[0].text, /"answer": "採納"/);
    await client.close();
  } finally { s.server.close(); }
});

test('hook：未回報的變更擋下 git commit 與 Claude Code 結束回合；回報之後就放行', () => {
  const { root, ck } = withClaim();
  loosenJudge(root);
  execFileSync('git', ['add', 'eval/judge.py'], { cwd:root });
  const check = (hook, input = '{}') => spawnSync(process.execPath, [BIN, 'check', '--hook', hook, '--repo', root], { input, encoding:'utf8' });
  const g = check('git');
  assert.equal(g.status, 1);
  assert.match(g.stderr, /eval\/judge\.py/);
  assert.equal(check('claude').status, 2);
  assert.equal(check('claude', '{"stop_hook_active":true}').status, 0);   // 已經被擋過一次就放行，避免無窮迴圈
  ck.write('progress_reported', { files:['eval/judge.py'], summary:'把評分器改成寬鬆比對', why:'測試回報之後會不會放行' }, 'test');
  assert.equal(check('git').status, 0);
  assert.equal(check('claude').status, 0);
});

test('cockpit init：寫好四種 agent 的 MCP 設定、規則檔、Stop hook、pre-commit；自己寫的檔案不算未回報', () => {
  const root = tempRepo(), r = init(root);
  for (const f of ['.mcp.json', '.cursor/mcp.json', '.gemini/settings.json', '.vscode/mcp.json', '.claude/settings.json', 'AGENTS.md', 'CLAUDE.md']) assert.ok(existsSync(path.join(root, f)), f);
  assert.equal(JSON.parse(readFileSync(path.join(root, '.mcp.json'), 'utf8')).mcpServers.cockpit.args[1], 'mcp');
  assert.ok(JSON.parse(readFileSync(path.join(root, '.gemini/settings.json'), 'utf8')).context.fileName.includes('AGENTS.md'));
  assert.match(readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), /@AGENTS\.md/);
  assert.match(readFileSync(path.join(root, '.git/hooks/pre-commit'), 'utf8'), /check --hook git/);
  assert.match(r.codex, /^codex mcp add cockpit/);
  init(root);   // 再跑一次不會重複寫入
  assert.equal(readFileSync(path.join(root, 'AGENTS.md'), 'utf8').split('agent-cockpit:start').length, 2);
  assert.equal(openCockpit(root).view().D.unreported.length, 0);
});
