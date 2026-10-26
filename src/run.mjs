// cockpit run：執行一個實驗命令，記下「只有程式量得到的事實」——命令、當下 commit、腳本與依賴的雜湊、寫出了哪些檔案。
// 這是證據鏈裡執行層唯一的來源：結論只能引用這裡記到的輸出檔。
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { head, dirty, hashFile, snapshot, inside, jsonKeyHashes } from './repo.mjs';
import { depGraph, closure } from './deps.mjs';

const SCRIPT_EXT = /\.(py|m?js|cjs|ts|sh|r|jl)$/i;

// 命令裡第一個指向 repo 內程式檔的字（python eval/run.py --arm combo → eval/run.py）
export function detectScript(root, cmd){
  for (const tok of cmd.split(/\s+/)) {
    const rel = SCRIPT_EXT.test(tok) && inside(root, tok);
    if (rel && existsSync(path.join(root, rel))) return rel;
  }
  return null;
}

export function recordRun(cockpit, cmd, { agent = 'cli', capture = false } = {}){
  const { root } = cockpit;
  cockpit.syncFiles();
  const script = detectScript(root, cmd);
  const dep = depGraph(root);
  const files = script ? [script, ...closure(dep, script)] : [];
  const hashes = Object.fromEntries(files.map(f => [f, hashFile(root, f)]));
  const before = snapshot(root), commit = head(root), dirtyBefore = dirty(root), t0 = Date.now();

  const res = spawnSync(process.env.SHELL || '/bin/sh', ['-c', cmd], { cwd:root, encoding:'utf8', stdio:capture ? 'pipe' : 'inherit', maxBuffer:32 << 20 });
  const after = snapshot(root);
  // 執行完才編號：兩個 agent 同時跑實驗也不會撞號
  const id = `R${cockpit.state().runs.size + 1}`;
  const outputs = {};
  const outputKeys = {};
  for (const [p, sig] of after) if (before.get(p) !== sig && !files.includes(p)) {
    outputs[p] = hashFile(root, p);
    const keys = jsonKeyHashes(root, p);
    if (keys) outputKeys[p] = keys;
  }

  const log = [res.stdout, res.stderr].filter(Boolean).join('\n').slice(-20000);
  if (capture) { mkdirSync(path.join(root, '.cockpit', 'runs'), { recursive:true }); writeFileSync(path.join(root, '.cockpit', 'runs', `${id}.log`), log); }
  const run = { id, cmd, commit, dirty:dirtyBefore.filter(p => files.includes(p)), script, hashes, outputs, outputKeys, exit:res.status ?? -1, ms:Date.now() - t0, deps:dep.source };
  const event = cockpit.write('run_recorded', { run }, agent, { sync:false });
  return { run, event, log };
}
