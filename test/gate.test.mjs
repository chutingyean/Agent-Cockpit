// 寫入咽喉（AC2、AC3、AC7、AC11 的路徑部分）
import test from 'node:test';
import assert from 'node:assert/strict';
import { GateError } from '../src/gate.mjs';
import { withClaim, loosenJudge } from './helpers.mjs';

const rejects = (fn, re) => assert.throws(fn, e => e instanceof GateError && re.test(e.message));

test('結論的證據不是那次執行寫出的檔案 → 拒收', () => {
  const { ck, run } = withClaim();
  rejects(() => ck.write('claim_recorded', { claim:{ id:'C2', text:'隨便寫的結論', hypothesis:'H', evidence:[{ run:run.id, path:'notes/研究地圖.md' }] } }, 't'), /不是 R1 寫出的檔案/);
  rejects(() => ck.write('claim_recorded', { claim:{ id:'C2', text:'沒有證據的結論', hypothesis:'H', evidence:[] } }, 't'), /evidence 至少要一筆/);
  rejects(() => ck.write('claim_recorded', { claim:{ id:'C2', text:'不存在的欄位', hypothesis:'H', evidence:[{ run:run.id, path:'results/數據總表.json', key:'nope' }] } }, 't'), /沒有欄位 nope/);
});

test('執行已經過期時不能再引用它', () => {
  const { root, ck, run } = withClaim();
  loosenJudge(root);
  rejects(() => ck.write('claim_recorded', { claim:{ id:'C2', text:'過期後才登記', hypothesis:'H', evidence:[{ run:run.id, path:'results/數據總表.json', key:'combo.acc' }] } }, 't'), /已經過期/);
});

test('研究卡片不能用 canvas_createNode 繞過', () => {
  const { ck } = withClaim();
  rejects(() => ck.write('node_created', { node:{ id:'N1', kind:'analysis', title:'偷建結論' } }, 't'), /只能用研究工具建立/);
  ck.write('node_created', { node:{ id:'N1', kind:'note', title:'一般筆記' } }, 't');
});

test('路徑不能跳出專案', () => {
  const { ck } = withClaim();
  rejects(() => ck.write('progress_reported', { files:['../../etc/passwd'], summary:'改了專案外面的一個檔案', why:'測試路徑穿越有沒有被擋' }, 't'), /不在專案裡/);
});

test('假設改成 verified 前必須有證據鏈完整的結論', () => {
  const { ck } = withClaim();
  rejects(() => ck.write('hypothesis_upserted', { hypothesis:{ id:'H-X', label:'沒有證據的假設', status:'verified' } }, 't'), /必須先有一個證據鏈完整的結論/);
  ck.write('hypothesis_upserted', { hypothesis:{ id:'H-M01', label:'組合範式', status:'verified' } }, 't');
});

test('階段的必要工具沒叫過、或要人看過的階段，不能結束', () => {
  const { ck } = withClaim();
  ck.write('stages_planned', { stages:[{ id:'P1', title:'實驗', out:'有證據鏈的結論', needs:['cockpit_run', 'cockpit_claim'] }, { id:'P2', title:'裁決', out:'人拍板', human:true }] }, 't');
  rejects(() => ck.write('stage_updated', { id_:'P1', status:'done' }, 't'), /cockpit_run、cockpit_claim 還沒被呼叫過/);
  rejects(() => ck.write('stage_updated', { id_:'P2', status:'done' }, 't'), /要人看過/);
});

test('裁決：選項不存在、或重複裁決 → 拒收', () => {
  const { ck } = withClaim();
  ck.write('decision_requested', { decision:{ id:'J1', question:'要不要採用這個結論？', options:['採納', '駁回'], rec:0, reason:'證據鏈完整而且數字穩定', grounds:['C1'] } }, 't');
  rejects(() => ck.write('decision_answered', { decisionId:'J1', answer:5 }, 'human'), /選項不存在/);
  ck.write('decision_answered', { decisionId:'J1', answer:0 }, 'human');
  rejects(() => ck.write('decision_answered', { decisionId:'J1', answer:1 }, 'human'), /已經裁決過了/);
});

test('任務還有沒裁決的 blocking 決策時不能結束', () => {
  const { ck } = withClaim();
  const task = state => ({ task:{ id:'T1', title:'評估', state, summary:'跑完組合臂的雙種子評估了', why:'需要組合臂的證據才能裁決', next:'等待裁決結果' } });
  ck.write('task_upserted', task('doing'), 't');
  ck.write('decision_requested', { decision:{ id:'J1', question:'要不要止損？', options:['採納', '駁回'], rec:0, reason:'三個種子都在帶內', blocking:true, task:'T1' } }, 't');
  rejects(() => ck.write('task_upserted', task('done'), 't'), /blocking/);
});
