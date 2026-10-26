// 各個零件：程式碼圖（graphify / 內建輕量版）、內建審查、事件庫與畫布投影、md² 驗證、簡報、審查結果
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fromGraphify, closure } from '../src/deps.mjs';
import { buildGraph, affected } from '../src/graph.mjs';
import { review, reviewFile } from '../src/review.mjs';
import { listFiles } from '../src/repo.mjs';
import { openStore } from '../src/store.mjs';
import { validateDiagram } from '../src/diagram.mjs';
import { normalizeFindings, renderBrief } from '../src/adapters.mjs';
import { briefMarkdown } from '../src/engine.mjs';
import { tempRepo, withClaim, loosenJudge, restoreJudge } from './helpers.mjs';

test('內建程式碼圖：抽出函式與跨檔呼叫，輸出 graphify 格式；收斂成檔案依賴後閉包正確', () => {
  const root = tempRepo(), { graph, report } = buildGraph(root, listFiles(root));
  const calls = graph.links.filter(l => l.relation === 'calls').map(l => `${l.source} -> ${l.target}`);
  assert.ok(calls.includes('eval/run.py::run_arm -> eval/judge.py::score'));
  assert.ok(calls.includes('eval/judge.py::score -> eval/judge.py::parse_answer'));
  assert.equal(new Set(calls).size, calls.length, '同一條呼叫只記一次');
  const dep = fromGraphify(root, graph);
  assert.deepEqual(closure(dep, 'eval/run.py'), ['eval/infer.py', 'eval/judge.py', 'eval/stats.py']);
  assert.deepEqual(closure(dep, 'train/ablate_templates.py'), ['train/prompt.py', 'train/sft.py']);
  assert.equal(report.god[0].label, 'main()');
  assert.ok(report.communities.length >= 2);
});

test('影響範圍：改 parse_answer() 往上找到 score()、run_arm()、main()', () => {
  const root = tempRepo(), { graph } = buildGraph(root, listFiles(root));
  const hit = affected(graph, 'eval/judge.py', ['parse_answer()']).map(x => x.label);
  for (const f of ['score()', 'run_arm()', 'main()']) assert.ok(hit.includes(f), f);
});

test('內建審查：預設只看改到的行；抓得到評分比對變鬆、訓練讀測試資料、沒固定亂數種子', () => {
  const root = tempRepo();
  assert.deepEqual(review(root, { all:true }), [], '示範專案原本是乾淨的');
  loosenJudge(root);
  writeFileSync(path.join(root, 'train', 'leak.py'), 'import random\n\ndef pick(xs=[]):\n    d = open("data/test.jsonl").read()\n    return random.choice(xs)\n');
  const f = review(root), rules = f.map(x => `${x.path}:${x.line}:${x.rule}:${x.severity}`);
  assert.ok(rules.includes('eval/judge.py:10:loose-match:high'));
  assert.ok(rules.includes('train/leak.py:4:test-leak:high'));
  assert.ok(rules.includes('train/leak.py:5:unseeded:medium'));
  assert.ok(rules.includes('train/leak.py:3:mutable-default:medium'));
  assert.ok(!f.some(x => x.path === 'eval/judge.py' && x.line !== 10), '沒改到的行不審');
  writeFileSync(path.join(root, 'tool.json'), '{ "command": "/Users/me/bin/node" }\n');
  assert.deepEqual(reviewFile(root, 'tool.json'), [], '設定檔不審');
});

test('偵測到變更就自動審查：發現跟著變更走，寫進自動裁決與結論的疑慮；改回去就消失', () => {
  const { root, ck } = withClaim();
  loosenJudge(root); ck.syncFiles();
  let D = ck.view().D;
  const d = D.decisions.find(x => x.id === 'AUTO:eval/judge.py');
  assert.match(d.reason, /往上影響 .*score\(\)/);
  assert.match(d.reason, /審查（第 10 行）/);
  assert.equal(D.claims.find(c => c.id === 'C1').doubt[0].rule, 'loose-match');
  restoreJudge(root); ck.syncFiles();
  D = ck.view().D;
  assert.equal(D.findings.length, 0);
});

test('graphify 的 graph.json：函式層級的 calls 收斂成檔案依賴，contains 不算', () => {
  const root = '/r', g = { nodes:[{ id:'a', source_file:'eval/run.py' }, { id:'b', source_file:'eval/judge.py' }, { id:'c', source_file:'eval/run.py' }],
    links:[{ source:'a', target:'b', relation:'calls' }, { source:'a', target:'c', relation:'contains' }] };
  const dep = fromGraphify(root, g);
  assert.equal(dep.source, 'graphify');
  assert.deepEqual(closure(dep, 'eval/run.py'), ['eval/judge.py']);
});

test('事件庫：寫入同時鏡像到 events.jsonl；資料庫不見了能從鏡像重建；畫布投影的欄位固定', () => {
  const { root, ck } = withClaim();
  ck.view();   // 寫投影
  const cols = t => ck.store.db.prepare(`pragma table_info(${t})`).all().map(c => c.name);
  assert.deepEqual(cols('canvas_nodes'), ['id', 'board_id', 'kind', 'x', 'y', 'width', 'height', 'title', 'body', 'ref_id', 'meta_json', 'created_at', 'updated_at']);
  assert.deepEqual(cols('canvas_edges'), ['id', 'board_id', 'kind', 'from_node', 'to_node', 'label', 'style_json', 'created_at']);
  assert.ok(ck.store.db.prepare("select count(*) n from canvas_nodes where kind = 'analysis'").get().n >= 1);
  const n = ck.store.events().length;
  ck.close();
  for (const f of ['cockpit.db', 'cockpit.db-wal', 'cockpit.db-shm']) rmSync(path.join(root, '.cockpit', f), { force:true });
  const again = openStore(root);
  assert.equal(again.events().length, n);
  assert.equal(readFileSync(path.join(root, '.cockpit', 'events.jsonl'), 'utf8').trim().split('\n').length, n);
});

test('md² 架構圖驗證：抓得到不合格的 role、連線、路徑', () => {
  const root = tempRepo();
  const d = { meta:{ version:1, type:'architecture', title:'t', description:'d' }, nodes:[{ id:'a', label:'A', role:'focal' }], edges:[{ from:'a', to:'x', kind:'data' }] };
  assert.deepEqual(validateDiagram({ ...d, edges:[] }, { a:['eval/run.py'] }, root), []);
  const p = validateDiagram({ ...d, nodes:[{ id:'a', label:'A', role:'boss' }] }, { a:['nope.py'] }, root).join('\n');
  assert.match(p, /role 只能是/); assert.match(p, /兩端必須是圖上的節點/); assert.match(p, /不存在於專案裡/);
});

test('審查結果：不同欄位名稱都整理成 { path, line, severity, message }', () => {
  const f = normalizeFindings({ comments:[{ file:'eval/judge.py', startLine:88, level:'HIGH', comment:'寬鬆比對讓分數不可比' }] });
  assert.deepEqual(f, [{ path:'eval/judge.py', line:88, severity:'high', message:'寬鬆比對讓分數不可比' }]);
});

test('證據簡報：引擎組出草稿，answer-me-with-html 的 am CLI 排成一頁 HTML', () => {
  const { root, ck } = withClaim();
  loosenJudge(root); ck.syncFiles();
  const D = ck.view().D, md = briefMarkdown(D, 'AUTO:eval/judge.py');
  assert.match(md, /```flow LR/); assert.match(md, /```ask/); assert.match(md, /C1 .* no 待重驗/);
  const r = renderBrief(root, 'test', md);
  assert.ok(r.ok, r.message);
  assert.match(r.html, /<!doctype html>/i);
  assert.match(r.html, /個結論要重驗/);
});
