// 證據鏈的傳播規則（AC1、AC3、AC4、AC6、AC9、AC10）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { recordRun } from '../src/run.mjs';
import { withClaim, loosenJudge, restoreJudge, claim } from './helpers.mjs';

test('cockpit run 記下腳本、依賴閉包與輸出；引用它的結論有效，並讀出實際數值', () => {
  const { ck, run } = withClaim();
  assert.equal(run.script, 'eval/run.py');
  assert.deepEqual(Object.keys(run.hashes).sort(), ['eval/infer.py', 'eval/judge.py', 'eval/run.py', 'eval/stats.py']);
  assert.ok('results/數據總表.json' in run.outputs);
  const c = claim(ck, 'C1');
  assert.equal(c.health, 'valid');
  assert.equal(typeof c.evidence[0].value, 'number');
});

test('改了依賴閉包裡的檔案（不是腳本本身）→ 結論待重驗，原因寫明檔案；未回報的變更列出改到的函式並自動送出裁決', () => {
  const { root, ck } = withClaim();
  loosenJudge(root);
  ck.syncFiles();
  const { D } = ck.view(), c = D.claims.find(x => x.id === 'C1');
  assert.equal(c.health, 'recheck');
  assert.match(c.reasons.join(), /eval\/judge\.py/);
  const u = D.unreported.find(x => x.path === 'eval/judge.py');
  assert.deepEqual(u.funcs, ['parse_answer()']);
  assert.ok(D.decisions.some(d => d.id === 'AUTO:eval/judge.py' && d.grounds.includes('C1')));
  assert.ok(D.broken.includes('C1>R1') && D.broken.includes('file:eval/run.py>file:eval/judge.py'));
});

test('改回原樣 → 雜湊對上，結論恢復有效、自動裁決消失', () => {
  const { root, ck } = withClaim();
  loosenJudge(root); ck.syncFiles();
  restoreJudge(root); ck.syncFiles();
  const { D } = ck.view();
  assert.equal(D.claims[0].health, 'valid');
  assert.equal(D.broken.length, 0);
  assert.ok(!D.decisions.some(d => d.auto));
});

test('函式層級：依賴檔只加了這次執行碰不到的函式 → 不算過期；改到模組層程式碼 → 過期', () => {
  const { root, ck } = withClaim();
  const f = path.join(root, 'eval', 'judge.py'), orig = readFileSync(f, 'utf8');
  writeFileSync(f, orig + '\n\ndef strict_rate(items):\n    return sum(1 for i in items if i) / len(items)\n');
  ck.syncFiles();
  let D = ck.view().D;
  assert.equal(D.claims.find(c => c.id === 'C1').health, 'valid');
  assert.deepEqual(D.runs[0].skipped, [{ path:'eval/judge.py', funcs:['strict_rate()'] }]);
  writeFileSync(f, 'import os\n' + orig);
  ck.syncFiles();
  D = ck.view().D;
  assert.equal(D.claims.find(c => c.id === 'C1').health, 'recheck');
});

test('多次執行寫進同一個數據總表：證據只看自己那一格；手改那一格才失效', () => {
  const { root, ck } = withClaim();
  recordRun(ck, 'python3 eval/run.py --arm module --seeds 1,2', { agent:'test', capture:true });   // 寫其他欄位
  assert.equal(claim(ck, 'C1').health, 'valid');
  const f = path.join(root, 'results', '數據總表.json'), data = JSON.parse(readFileSync(f, 'utf8'));
  writeFileSync(f, JSON.stringify({ ...data, 'combo.acc':0.99 }, null, 2));
  ck.syncFiles();
  const c = claim(ck, 'C1');
  assert.equal(c.health, 'recheck');
  assert.match(c.reasons.join(), /手改數據/);
});

test('重播：投影到改動之前的事件，結論仍是有效', () => {
  const { root, ck } = withClaim();
  const before = ck.store.last();
  loosenJudge(root); ck.syncFiles();
  assert.equal(claim(ck, 'C1').health, 'recheck');
  assert.equal(ck.view(before).D.claims[0].health, 'valid');
});

test('原地打轉：同一支腳本連續 3 次只改設定、程式沒變 → 自動送出裁決', () => {
  const { root, ck } = withClaim();
  const cfg = path.join(root, 'configs', 'combo.yaml'), run = () => recordRun(ck, 'python3 eval/run.py --arm combo --seeds 1,2', { agent:'test', capture:true });
  for (const lr of ['0.0005', '0.0008']) { writeFileSync(cfg, readFileSync(cfg, 'utf8').replace(/lr:.*/, `lr: ${lr}`)); run(); }
  const D = ck.view().D;
  assert.deepEqual(D.loops.map(l => [l.script, l.runs]), [['eval/run.py', ['R1', 'R2', 'R3']]]);
  assert.ok(D.decisions.some(d => d.id === 'LOOP:eval/run.py' && d.auto === '原地打轉' && d.grounds.includes('C1')));
});

test('假設寫著 verified，但撐它的結論待重驗 → 畫面上降回 pending', () => {
  const { root, ck } = withClaim();
  ck.write('hypothesis_upserted', { hypothesis:{ id:'H-M01', label:'組合範式', status:'verified' } }, 'test');
  loosenJudge(root); ck.syncFiles();
  const h = ck.view().D.hyps.find(x => x.id === 'H-M01');
  assert.equal(h.status, 'verified');
  assert.equal(h.shown, 'pending');
});
