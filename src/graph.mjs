// 輕量版 graphify：不用 tree-sitter，靠縮排與正規表示式抽出 Python / JS 的函式、類別、import 與呼叫，
// 輸出跟 graphify 相同的 NetworkX node-link 格式（graph.json），再算社群、核心節點、意外連結、建議問題與影響範圍。
// 確定性、0 token。裝了真的 graphify（graphify-out/graph.json）時，deps.mjs 會優先用它。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const KEYWORDS = new Set(['if', 'for', 'while', 'return', 'def', 'class', 'with', 'elif', 'not', 'and', 'or', 'in', 'lambda', 'print', 'len', 'range',
  'int', 'float', 'str', 'list', 'dict', 'set', 'tuple', 'sorted', 'sum', 'min', 'max', 'abs', 'round', 'open', 'isinstance', 'super', 'enumerate', 'zip',
  'map', 'filter', 'any', 'all', 'function', 'switch', 'catch', 'typeof', 'new', 'await', 'async', 'yield', 'assert', 'except', 'raise', 'import', 'from', 'require']);
const CODE = /\.(py|m?js|cjs|ts)$/;

function resolveModule(set, dir, mod, js){
  const p = js ? path.posix.normalize(dir + mod) : mod.replace(/\./g, '/');
  const cands = js ? [p, `${p}.js`, `${p}.mjs`, `${p}.ts`, `${p}/index.js`] : [`${dir}${p}.py`, `${p}.py`, `${dir}${p}/__init__.py`, `${p}/__init__.py`];
  return cands.find(c => set.has(c)) || null;
}

// 一個檔案 → 定義（函式、類別、方法）與「誰在哪一行呼叫了什麼名字」
function parseFile(src, file, set){
  const js = !file.endsWith('.py'), dir = path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file) + '/';
  const defs = [], calls = [], imports = { names:new Map(), modules:new Map(), files:new Set() }, stack = [];
  src.split('\n').forEach((line, i) => {
    const indent = line.match(/^\s*/)[0].length, no = i + 1;
    if (!line.trim() || /^\s*(#|\/\/)/.test(line)) return;
    while (stack.length && indent <= stack.at(-1).indent && !js) stack.pop();
    let m;
    if ((m = line.match(/^\s*from\s+([\w.]+)\s+import\s+(.+)/)) && !js) {
      const f = resolveModule(set, dir, m[1], false);
      if (f) { imports.files.add(f); m[2].split(',').forEach(n => { const [name, alias] = n.trim().split(/\s+as\s+/); if (/^\w+$/.test(name)) imports.names.set(alias || name, [f, name]); }); }
    } else if ((m = line.match(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/)) && !js) {
      m[1].split(',').forEach(n => { const mod = n.trim(), f = resolveModule(set, dir, mod, false); if (f) { imports.files.add(f); imports.modules.set(mod.split('.').pop(), f); } });
    } else if (js && (m = line.match(/import\s+(?:\{([^}]*)\}|(\w+))?.*from\s+['"](\.[^'"]+)['"]/) || js && (m = line.match(/require\(\s*['"](\.[^'"]+)['"]/)))) {
      const spec = m[3] || m[1], f = spec && resolveModule(set, dir, spec, true);
      if (f) { imports.files.add(f); (m[1] && m[3] ? m[1].split(',') : []).forEach(n => { const [name, alias] = n.trim().split(/\s+as\s+/); if (name) imports.names.set(alias || name, [f, name]); }); if (m[2]) imports.modules.set(m[2], f); }
    }
    const def = js ? line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(|^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>|\w+\s*=>)|^\s*(?:export\s+)?class\s+(\w+)/)
      : line.match(/^\s*(?:async\s+)?def\s+(\w+)\s*\(|^\s*class\s+(\w+)/);
    if (def) {
      const name = def[1] || def[2] || def[3], kind = /class\s/.test(line) ? 'class' : 'function';
      const parent = stack.at(-1), q = parent ? `${parent.q}.${name}` : name;
      const d = { id:`${file}::${q}`, label:kind === 'class' ? name : `${name}()`, name, q, kind, line:no, parent:parent?.id || null, cls:parent?.kind === 'class' ? parent.name : null };
      defs.push(d);
      if (!js) stack.push({ indent, q, id:d.id, kind, name });
      return;
    }
    const owner = stack.at(-1)?.id || null;
    for (const c of line.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""').matchAll(/(?<![\w.])((?:self\.|this\.)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*\(/g)) {
      if (!KEYWORDS.has(c[1].split('.').pop())) calls.push({ owner, name:c[1], line:no });
    }
  });
  return { defs, calls, imports };
}

// 社群：在呼叫關係上做標籤傳播（排序固定，所以每次結果一樣）
function communities(ids, adj){
  const label = new Map(ids.map(id => [id, id]));
  for (let round = 0; round < 20; round++) {
    let changed = false;
    for (const id of ids) {
      const count = new Map();
      for (const n of adj.get(id) || []) count.set(label.get(n), (count.get(label.get(n)) || 0) + 1);
      if (!count.size) continue;
      const best = [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
      if (best !== label.get(id)) { label.set(id, best); changed = true; }
    }
    if (!changed) break;
  }
  const groups = new Map();
  for (const [id, l] of label) (groups.get(l) || groups.set(l, []).get(l)).push(id);
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
  return new Map(ordered.flatMap((g, i) => g.map(id => [id, i])));
}

export function buildGraph(root, files){
  const code = files.filter(f => CODE.test(f)), set = new Set(code), parsed = new Map();
  for (const f of code) { try { parsed.set(f, parseFile(readFileSync(path.join(root, f), 'utf8'), f, set)); } catch {} }
  const nodes = [], links = [], byId = new Map(), seen = new Map();
  const add = (s, t, relation, confidence, file, line) => {
    const k = `${s}>${t}>${relation}`;
    if (seen.has(k)) return void seen.get(k).weight++;
    const l = { source:s, target:t, relation, confidence, source_file:file, source_location:`L${line}`, weight:1 };
    seen.set(k, l); links.push(l);
  };
  for (const [f, p] of parsed) {
    nodes.push({ id:f, label:path.posix.basename(f), file_type:'code', kind:'file', source_file:f, source_location:'L1' });
    for (const d of p.defs) { const n = { id:d.id, label:d.label, file_type:'code', kind:d.kind, source_file:f, source_location:`L${d.line}` }; nodes.push(n); byId.set(d.id, d); add(d.parent || f, d.id, d.parent ? 'method' : 'contains', 'EXTRACTED', f, d.line); }
    for (const t of p.imports.files) { add(f, t, 'imports', 'EXTRACTED', f, 1); if ([...p.imports.modules.values()].includes(t)) seen.get(`${f}>${t}>imports`).how = 'module'; }
  }
  for (const [f, p] of parsed) for (const [, [mf, name]] of p.imports.names) {
    const d = parsed.get(mf)?.defs.find(x => x.name === name && !x.parent);
    if (d) add(f, d.id, 'imports_from', 'EXTRACTED', f, 1);
  }
  const defsIn = f => parsed.get(f)?.defs || [], globalByName = new Map();
  for (const [, p] of parsed) for (const d of p.defs) (globalByName.get(d.name) || globalByName.set(d.name, []).get(d.name)).push(d);
  for (const [f, p] of parsed) for (const c of p.calls) {
    const parts = c.name.split('.'), last = parts.at(-1), from = c.owner || f;
    let target = null, conf = 'EXTRACTED';
    if (parts[0] === 'self' || parts[0] === 'this') { const cls = byId.get(c.owner)?.cls; target = defsIn(f).find(d => d.name === last && d.cls === cls); }
    else if (parts.length === 2 && p.imports.modules.has(parts[0])) target = defsIn(p.imports.modules.get(parts[0])).find(d => d.name === last && !d.cls);
    else if (parts.length === 1 && p.imports.names.has(last)) { const [mf, orig] = p.imports.names.get(last); target = defsIn(mf).find(d => d.name === orig && !d.cls); }
    else if (parts.length === 1) target = defsIn(f).find(d => d.name === last && !d.cls) || defsIn(f).find(d => d.name === last && d.kind === 'class');
    if (!target && parts.length === 1) { const g = globalByName.get(last) || []; if (g.length === 1) { target = g[0]; conf = 'INFERRED'; } }
    if (target && target.id !== from) add(from, target.id, 'calls', conf, f, c.line);
  }
  // 社群與核心節點只看函式之間的呼叫
  const fnIds = nodes.filter(n => n.kind !== 'file').map(n => n.id).sort(), adj = new Map(), deg = new Map();
  for (const l of links.filter(l => l.relation === 'calls' && byId.has(l.source))) {
    (adj.get(l.source) || adj.set(l.source, new Set()).get(l.source)).add(l.target);
    (adj.get(l.target) || adj.set(l.target, new Set()).get(l.target)).add(l.source);
  }
  for (const id of fnIds) deg.set(id, adj.get(id)?.size || 0);
  // 腳本最外層的呼叫（沒有包在函式裡）也算被呼叫的函式的連線
  for (const l of links) if (l.relation === 'calls' && !byId.has(l.source) && deg.has(l.target)) deg.set(l.target, deg.get(l.target) + 1);
  const comm = communities(fnIds, adj);
  nodes.forEach(n => { if (comm.has(n.id)) n.community = comm.get(n.id); });
  const graph = { directed:true, multigraph:false, graph:{ generator:'agent-cockpit mini-graphify' }, nodes, links };
  return { graph, report:graphReport(graph, deg, comm) };
}

function graphReport(graph, deg, comm){
  const node = id => graph.nodes.find(n => n.id === id);
  const god = [...deg].filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([id, d]) => ({ id, label:node(id).label, file:node(id).source_file, degree:d }));
  const groups = new Map();
  for (const [id, c] of comm) (groups.get(c) || groups.set(c, []).get(c)).push(id);
  const commList = [...groups].filter(([, ids]) => ids.length > 1).map(([c, ids]) => {
    const files = [...new Set(ids.map(id => node(id).source_file))];
    const top = ids.sort((a, b) => deg.get(b) - deg.get(a))[0];
    return { id:c, size:ids.length, files, label:`${node(top).label}（${node(top).source_file}）一帶`, members:ids.map(id => node(id).label).slice(0, 6) };
  });
  // 意外連結：跨社群、而且跨檔案的呼叫；跨資料夾的排前面
  const surprises = graph.links.filter(l => l.relation === 'calls' && comm.has(l.source) && comm.has(l.target) && comm.get(l.source) !== comm.get(l.target)
      && node(l.source).source_file !== node(l.target).source_file)
    .map(l => ({ from:node(l.source).label, to:node(l.target).label, fromFile:node(l.source).source_file, toFile:node(l.target).source_file, confidence:l.confidence,
      bridges:`社群 ${comm.get(l.source)} → 社群 ${comm.get(l.target)}` }))
    .sort((a, b) => (a.fromFile.split('/')[0] === a.toFile.split('/')[0]) - (b.fromFile.split('/')[0] === b.toFile.split('/')[0])).slice(0, 5);
  const bridges = new Map();
  for (const l of graph.links.filter(l => l.relation === 'calls' && comm.has(l.source) && comm.has(l.target))) {
    for (const [a, b] of [[l.source, l.target], [l.target, l.source]]) if (comm.get(a) !== comm.get(b)) (bridges.get(a) || bridges.set(a, new Set()).get(a)).add(comm.get(b));
  }
  const questions = [...bridges].sort((a, b) => b[1].size - a[1].size).slice(0, 3)
    .map(([id, cs]) => `為什麼 ${node(id).label} 同時連到社群 ${comm.get(id)} 和 ${[...cs].join('、')}？`);
  const fns = graph.nodes.filter(n => n.kind !== 'file').length, calls = graph.links.filter(l => l.relation === 'calls');
  return { files:graph.nodes.filter(n => n.kind === 'file').length, functions:fns, calls:calls.length,
    inferred:calls.filter(l => l.confidence === 'INFERRED').length, god, communities:commList, surprises, questions };
}

// 影響範圍（graphify affected）：改了哪些函式 → 往上找所有直接或間接呼叫它們的函式與檔案
export function affected(graph, file, funcs = []){
  const callers = new Map();
  for (const l of graph.links) if (l.relation === 'calls') (callers.get(l.target) || callers.set(l.target, []).get(l.target)).push(l.source);
  const names = new Set(funcs.map(f => f.replace(/\(\)$/, '')));
  const start = graph.nodes.filter(n => n.source_file === file && n.kind !== 'file' && (!names.size || names.has(n.label.replace(/\(\)$/, '')))).map(n => n.id);
  const seen = new Set(start), stack = [...start];
  while (stack.length) for (const c of callers.get(stack.pop()) || []) if (!seen.has(c)) { seen.add(c); stack.push(c); }
  start.forEach(s => seen.delete(s));
  const node = id => graph.nodes.find(n => n.id === id);
  return [...seen].map(id => ({ id, label:node(id)?.label || id, file:node(id)?.source_file || id })).sort((a, b) => a.file.localeCompare(b.file));
}

export function writeReport(root, { graph, report }){
  const dir = path.join(root, '.cockpit', 'graph');
  mkdirSync(dir, { recursive:true });
  writeFileSync(path.join(dir, 'graph.json'), JSON.stringify(graph, null, 1));
  writeFileSync(path.join(dir, 'GRAPH_REPORT.md'), [
    '# 程式碼圖報告（agent-cockpit 內建的輕量版 graphify）', '',
    `- ${report.files} 個檔案 · ${report.functions} 個函式／類別 · ${report.calls} 條呼叫（其中 ${report.inferred} 條是推斷的）`, '',
    '## 核心節點（連線最多）', ...report.god.map((g, i) => `${i + 1}. \`${g.label}\`（${g.file}）— ${g.degree} 條連線`), '',
    '## 社群', ...report.communities.map(c => `- 社群 ${c.id}「${c.label}」：${c.size} 個節點，${c.files.join('、')}`), '',
    '## 意外連結（跨社群的呼叫）', ...report.surprises.map(s => `- \`${s.from}\` → \`${s.to}\`（${s.fromFile} → ${s.toFile}，${s.confidence}）`), '',
    '## 建議問題', ...report.questions.map(q => `- ${q}`), '',
  ].join('\n'));
}

// —— 函式層級的過期判斷 ——
// Python 檔切成「最外層的每個 def／class」加上「其餘的模組層程式碼」，各自算雜湊。JS 回傳 null（退回整個檔案比對）。
export function symbolHashes(src, file){
  if (!file.endsWith('.py')) return null;
  const h = t => createHash('sha1').update(t).digest('hex').slice(0, 12);
  const blocks = { '<module>':[] }, lines = src.split('\n');
  let cur = null, deco = [];
  for (const line of lines) {
    if (!line.trim()) continue;   // 空行不影響雜湊
    const top = /^\S/.test(line), m = line.match(/^(?:async\s+)?(?:def|class)\s+(\w+)/);
    if (top && /^@/.test(line)) { deco.push(line); continue; }
    if (m) { cur = m[1]; blocks[cur] = [...deco, line]; deco = []; continue; }
    if (top && !/^\s*#/.test(line)) cur = null;
    if (deco.length) { blocks['<module>'].push(...deco); deco = []; }
    (cur ? blocks[cur] : blocks['<module>']).push(line.trimEnd());
  }
  return Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, h(v.join('\n'))]));
}

export function fileSymbols(root, rel){
  try { return symbolHashes(readFileSync(path.join(root, rel), 'utf8'), rel); } catch { return null; }
}

// 一次執行「碰得到」哪些最外層的函式／類別：腳本本身全部 + 被 import 的檔案的模組層程式碼，
// 再沿 calls、from-import、類別的方法往下走；整個模組被 import（import x）的檔案保守地算全部碰得到。
export function reach(graph, script, files){
  const out = new Map(), seen = new Set(), stack = [];
  const top = id => { const n = graph.nodes.find(x => x.id === id); if (!n || n.kind === 'file') return null; return [n.source_file, id.split('::')[1].split('.')[0]]; };
  const push = id => { if (!seen.has(id)) { seen.add(id); stack.push(id); } };
  const mark = id => { const t = top(id); if (t) (out.get(t[0]) || out.set(t[0], new Set()).get(t[0])).add(t[1]); };
  for (const f of files) push(f);
  graph.nodes.filter(n => n.source_file === script && n.kind !== 'file').forEach(n => push(n.id));
  while (stack.length) {
    const id = stack.pop(); mark(id);
    for (const l of graph.links) {
      if (l.source !== id) continue;
      if (['calls', 'imports_from', 'method'].includes(l.relation)) push(l.target);
      else if (l.relation === 'imports' && l.how === 'module') graph.nodes.filter(n => n.source_file === l.target && n.kind !== 'file').forEach(n => push(n.id));
      else if (l.relation === 'contains' && graph.nodes.find(n => n.id === l.target)?.kind === 'class' && seen.has(l.target)) push(l.target);
    }
    // 碰到類別就算碰到它所有的方法（obj.method() 這種呼叫解析不出來）
    graph.links.filter(l => l.relation === 'method' && l.source === id).forEach(l => push(l.target));
  }
  return Object.fromEntries([...out].map(([f, names]) => [f, [...names].sort()]));
}
