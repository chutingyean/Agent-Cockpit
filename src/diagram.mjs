// md² 架構圖格式的驗證。規則對照 md² 的 shared/diagram_data.mjs 自己實作（不複製它的 AGPL 程式碼），
// 所以 agent 寫的圖 md² 桌面版也打得開；paths 把圖上的節點對應到真實檔案，白板才能疊上熱度與證據鏈。
import { existsSync } from 'node:fs';
import path from 'node:path';
import { inside } from './repo.mjs';

export const DIAGRAM_TYPES = ['architecture', 'dependency', 'sequence', 'flow', 'entity', 'mindmap'];
export const ROLES = ['focal', 'backend', 'store', 'external', 'input', 'optional', 'boundary'];
export const NODE_KINDS = ['component', 'participant', 'step', 'decision', 'start', 'end', 'state', 'entity', 'root', 'topic'];
export const EDGE_KINDS = ['connection', 'data', 'dependency', 'cycle', 'call', 'return', 'async', 'success', 'flow', 'transition', 'relationship'];

export function validateDiagram(d, paths = {}, root){
  if (!d || typeof d !== 'object') return ['diagram 要是物件（meta / nodes / groups / edges）'];
  const p = [], m = d.meta || {}, ids = new Set();
  if (m.version !== 1) p.push('meta.version 要是 1');
  if (!DIAGRAM_TYPES.includes(m.type)) p.push(`meta.type 只能是 ${DIAGRAM_TYPES.join('、')}`);
  if (!m.title) p.push('meta.title 必填');
  if (!m.description) p.push('meta.description 必填');
  if (!Array.isArray(d.nodes) || !d.nodes.length) p.push('nodes 至少要一個');
  (d.nodes || []).forEach((n, i) => {
    if (!n.id) p.push(`nodes[${i}].id 必填`);
    else if (ids.has(n.id)) p.push(`節點 id「${n.id}」重複`);
    ids.add(n.id);
    if (!n.label) p.push(`節點「${n.id}」的 label 必填`);
    if (!ROLES.includes(n.role)) p.push(`節點「${n.id}」的 role 只能是 ${ROLES.join('、')}`);
    if (n.kind !== undefined && !NODE_KINDS.includes(n.kind)) p.push(`節點「${n.id}」的 kind 只能是 ${NODE_KINDS.join('、')}`);
  });
  (d.groups || []).forEach((g, i) => {
    if (!g.id || !g.label) p.push(`groups[${i}] 要有 id 與 label`);
    (g.nodeIds || []).forEach(id => ids.has(id) || p.push(`群組「${g.id}」裡的「${id}」不是圖上的節點`));
  });
  (d.edges || []).forEach((e, i) => {
    if (!ids.has(e.from) || !ids.has(e.to)) p.push(`edges[${i}] 的兩端必須是圖上的節點`);
    if (!EDGE_KINDS.includes(e.kind)) p.push(`edges[${i}] 的 kind 只能是 ${EDGE_KINDS.join('、')}`);
  });
  for (const [nid, list] of Object.entries(paths)) {
    if (!ids.has(nid)) p.push(`paths 裡的「${nid}」不是圖上的節點`);
    for (const x of list) { const r = inside(root, x); if (!r || !existsSync(path.join(root, r))) p.push(`paths.${nid} 的「${x}」不存在於專案裡`); }
  }
  return p;
}
