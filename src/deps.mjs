// 檔案之間的依賴：有 graphify 的 graph.json 就用它（AST、跨 40 種語言）；沒有就用內建的輕量版（graph.mjs，Python / JS）。
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { listFiles } from './repo.mjs';
import { buildGraph } from './graph.mjs';

// graphify 的連線種類裡，代表「用到」的那些（對齊它 affected.py 的 DEFAULT_AFFECTED_RELATIONS）
const DEP_RELATIONS = new Set(['calls', 'indirect_call', 'references', 'imports', 'imports_from', 'dynamic_import', 're_exports',
  'inherits', 'extends', 'implements', 'uses', 'mixes_in', 'embeds']);

export function fromGraphify(root, g, source = 'graphify'){
  const fileOf = new Map(), adj = new Map();
  const norm = f => f && path.relative(root, path.resolve(root, f)).split(path.sep).join('/');
  for (const n of g.nodes || []) if (n.source_file) fileOf.set(n.id, norm(n.source_file));
  for (const l of g.links || g.edges || []) {
    if (!DEP_RELATIONS.has(l.relation)) continue;
    const a = fileOf.get(l.source ?? l._src), b = fileOf.get(l.target ?? l._tgt);
    if (a && b && a !== b) (adj.get(a) || adj.set(a, new Set()).get(a)).add(b);
  }
  return { source, adj, graph:g };
}

// 快取的鍵是程式檔的 mtime：同一個檔案改第二次，git status 不會變，所以不能只看 status
let cache = null;
export function depGraph(root){
  const gpath = path.join(root, 'graphify-out', 'graph.json'), files = listFiles(root);
  // ponytail: 每次都 stat 全部檔案，幾千個檔案以內夠快；更大的 repo 改用 fs.watch
  const mt = f => { try { return statSync(path.join(root, f)).mtimeMs; } catch { return 0; } };
  const sig = ['graphify-out/graph.json', ...files].map(f => `${f}:${mt(f)}`).join('|');
  if (cache?.root === root && cache.sig === sig) return cache.dep;
  let dep = null;
  if (existsSync(gpath)) { try { dep = fromGraphify(root, JSON.parse(readFileSync(gpath, 'utf8'))); } catch {} }
  if (!dep) { const b = buildGraph(root, files); dep = { ...fromGraphify(root, b.graph, '內建程式碼圖'), report:b.report }; }
  cache = { root, sig, dep };
  return dep;
}

// 遞移閉包：腳本直接或間接用到的所有檔案（不含自己）
export function closure(dep, file){
  const out = new Set(), stack = [file];
  while (stack.length) for (const n of dep.adj.get(stack.pop()) || []) if (!out.has(n) && n !== file) { out.add(n); stack.push(n); }
  return [...out].sort();
}
