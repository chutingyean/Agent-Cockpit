// 把事件庫、專案事實、寫入咽喉、引擎串起來。MCP、網頁 server、CLI 都透過這裡讀寫。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { openStore } from './store.mjs';
import { dirty, hashFile, changedFuncs, diffstat, docSummary, jsonKeyHashes } from './repo.mjs';
import { depGraph } from './deps.mjs';
import { reduce, derive } from './engine.mjs';
import { check } from './gate.mjs';
import { layout } from './layout.mjs';

// Understand-Anything 的知識圖（有跑過 /understand 才有）
export function loadUA(root){
  for (const p of ['.ua/knowledge-graph.json', '.understand-anything/knowledge-graph.json']) {
    try { if (existsSync(path.join(root, p))) return JSON.parse(readFileSync(path.join(root, p), 'utf8')); } catch {}
  }
  return null;
}

export function openCockpit(root){
  root = path.resolve(root);
  const store = openStore(root);
  const summaries = new Map();
  const facts = () => {
    const keys = new Map();
    return { dirty:new Set(dirty(root)), dep:depGraph(root), ua:loadUA(root),
      summaryOf:p => summaries.has(p) ? summaries.get(p) : summaries.set(p, docSummary(root, p)).get(p),
      keysNow:p => keys.has(p) ? keys.get(p) : keys.set(p, jsonKeyHashes(root, p)).get(p) };
  };
  const state = (until = Infinity) => reduce(store.events(until));

  // 對照雜湊找出被改過的檔案，記成 file_changed。不管 agent 有沒有回報，真實的變更一定會被記下來。
  // ponytail: 兩個 process 同時偵測到同一個變更會各記一筆（雜湊相同，結果不變）；要去重再加交易鎖
  function syncFiles(){
    const st = state(), now = new Set(dirty(root));
    const candidates = new Set([...now, ...st.known.keys(), ...[...st.premises.values()].flatMap(p => p.grounds || [])]);
    const added = [];
    for (const p of candidates) {
      if (p.startsWith('.cockpit/')) continue;
      const h = hashFile(root, p), last = st.known.get(p);
      if (last === undefined ? !now.has(p) : h === last) continue;
      added.push(store.append('file_changed', { path:p, hash:h, funcs:h ? changedFuncs(root, p) : [], ...diffstat(root, p), deleted:h === null }, 'git'));
    }
    return added;
  }

  function write(type, payload, agent, { sync = true } = {}){
    if (sync) syncFiles();
    check(type, payload, { root, st:state(), facts:facts() });
    return store.append(type, payload, agent);
  }

  function view(until){
    const st = state(until), D = derive(st, facts());
    const board = layout(D, path.basename(root));
    if (until === undefined) store.materialize(board.canvas);
    return { D, board, ua:facts().ua };
  }

  return { root, store, state, facts, syncFiles, write, view, close:store.close };
}
