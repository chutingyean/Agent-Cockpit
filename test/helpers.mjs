// 測試用：把示範研究專案複製到暫存資料夾，建成 git repo。每個測試各用一份，互不干擾。
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCockpit } from '../src/cockpit.mjs';
import { recordRun } from '../src/run.mjs';
import { JUDGE_STRICT, JUDGE_LOOSE } from '../src/demo.mjs';

const TEMPLATE = fileURLToPath(new URL('../demo/template', import.meta.url));

export function tempRepo(){
  const dir = mkdtempSync(path.join(tmpdir(), 'cockpit-test-'));
  cpSync(TEMPLATE, dir, { recursive:true });
  const g = (...a) => execFileSync('git', a, { cwd:dir, stdio:'ignore' });
  g('init', '-q', '-b', 'main'); g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init');
  return dir;
}

// 開好駕駛艙、跑一次組合臂評估、登記 C1
export function withClaim(){
  const root = tempRepo(), ck = openCockpit(root);
  const { run } = recordRun(ck, 'python3 eval/run.py --arm combo --seeds 1,2', { agent:'test', capture:true });
  ck.write('claim_recorded', { claim:{ id:'C1', text:'組合臂準確率超過九成', hypothesis:'H-M01', evidence:[{ run:run.id, path:'results/數據總表.json', key:'combo.acc' }] } }, 'test');
  return { root, ck, run };
}

const judge = root => path.join(root, 'eval', 'judge.py');
export const loosenJudge = root => writeFileSync(judge(root), readFileSync(judge(root), 'utf8').replace(JUDGE_STRICT, JUDGE_LOOSE));
export const restoreJudge = root => writeFileSync(judge(root), readFileSync(judge(root), 'utf8').replace(JUDGE_LOOSE, JUDGE_STRICT));
export const claim = (ck, id) => ck.view().D.claims.find(c => c.id === id);
