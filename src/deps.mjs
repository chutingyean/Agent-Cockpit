// 檔案之間的依賴：有 graphify 的 graph.json 就用它（AST、跨 40 種語言）；沒有就退回內建的 import 掃描（Python / JS）。
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { listFiles, git } from './repo.mjs';

// graphify 的連線種類裡，代表「用到」的那些（對齊它 affected.py 的 DEFAULT_AFFECTED_RELATIONS）
const DEP_RELATIONS = new Set(['calls', 'indirect_call', 'references', 'imports', 'imports_from', 'dynamic_import', 're_exports',
  'inherits', 'extends', 'implements', 'uses', 'mixes_in', 'embeds']);

export function fromGraphify(root, g){
  const fileOf = new Map(), adj = new Map();
  const norm = f => f && path.relative(root, path.resolve(root, f)).split(path.sep).join('/');
  for (const n of g.nodes || []) if (n.source_file) fileOf.set(n.id, norm(n.source_file));
  for (const l of g.links || g.edges || []) {
    if (!DEP_RELATIONS.has(l.relation)) continue;
    const a = fileOf.get(l.source ?? l._src), b = fileOf.get(l.target ?? l._tgt);
    if (a && b && a !== b) (adj.get(a) || adj.set(a, new Set()).get(a)).add(b);
  }
  return { source:'graphify', adj };
}

// Python：import x / from x import y；JS：import … from './x' / require('./x')。只解析得到 repo 內檔案的
export function scanImports(root, files){
  const set = new Set(files), adj = new Map();
  const add = (a, b) => { if (b && b !== a) (adj.get(a) || adj.set(a, new Set()).get(a)).add(b); };
  const pick = (...cands) => cands.find(c => set.has(c));
  for (const f of files) {
    let src = '';
    if (!/\.(py|m?js|cjs|ts)$/.test(f)) continue;
    try { src = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    const dir = path.posix.dirname(f) === '.' ? '' : path.posix.dirname(f) + '/';
    if (f.endsWith('.py')) {
      const mods = [];
      for (const m of src.matchAll(/^\s*from\s+([\w.]+)\s+import/gm)) mods.push(m[1]);
      for (const m of src.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) mods.push(...m[1].split(',').map(s => s.trim()));
      for (const mod of mods) {
        const p = mod.replace(/\./g, '/');
        add(f, pick(`${dir}${p}.py`, `${p}.py`, `${dir}${p}/__init__.py`, `${p}/__init__.py`));
      }
    } else {
      for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
        const p = path.posix.normalize(dir + m[1]);
        add(f, pick(p, `${p}.js`, `${p}.mjs`, `${p}.ts`, `${p}/index.js`));
      }
    }
  }
  return { source:'import 掃描', adj };
}

let cache = null;
export function depGraph(root){
  const gpath = path.join(root, 'graphify-out', 'graph.json');
  const sig = (existsSync(gpath) ? statSync(gpath).mtimeMs : 0) + ':' + git(root, 'status', '--porcelain') + git(root, 'rev-parse', 'HEAD');
  if (cache?.root === root && cache.sig === sig) return cache.dep;
  let dep = null;
  if (existsSync(gpath)) { try { dep = fromGraphify(root, JSON.parse(readFileSync(gpath, 'utf8'))); } catch {} }
  dep ||= scanImports(root, listFiles(root));
  cache = { root, sig, dep };
  return dep;
}

// 遞移閉包：腳本直接或間接用到的所有檔案（不含自己）
export function closure(dep, file){
  const out = new Set(), stack = [file];
  while (stack.length) for (const n of dep.adj.get(stack.pop()) || []) if (!out.has(n) && n !== file) { out.add(n); stack.push(n); }
  return [...out].sort();
}
