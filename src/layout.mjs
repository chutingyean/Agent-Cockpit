// 白板排版：把證據圖排進五個框架。人拖過的卡（node_moved）保留原位，自動排版不再動它。
// 卡片種類：stage / agentTask / analysis / run / code / frame / html，同時投影成 canvas_* 列給其他工具讀。

const W = { stage:[300, 112], agentTask:[330, 126], analysis:[360, 116], run:[380, 116], code:[330, 104], html:[960, 570], note:[300, 140] };

export function layout(D, title){
  const nodes = [], frames = [], regions = [];
  const put = n => { const m = D.moves[n.id]; if (m) Object.assign(n, { x:m.x, y:m.y, userPlaced:true }); [n.w, n.h] = W[n.kind] || W.note; nodes.push(n); return n; };

  // A 研究路徑：階段一列，任務排在下面
  const aw = Math.max(2000, 60 + D.stages.length * 500), perRow = Math.max(1, Math.floor((aw - 60) / 370));
  D.stages.forEach((s, i) => put({ id:s.id, kind:'stage', x:60 + i * 500, y:70 }));
  D.tasks.forEach((t, i) => put({ id:t.id, kind:'agentTask', x:60 + (i % perRow) * 370, y:232 + Math.floor(i / perRow) * 150 }));
  const ah = Math.max(390, 232 + Math.ceil(D.tasks.length / perRow) * 150 + 30);
  frames.push({ id:'A', title:'研究路徑', x:0, y:0, w:aw, h:ah });
  const top = ah + 60;

  // B 結論、C 執行：同一列對齊，引用線才會是水平的
  const runRow = new Map();
  D.claims.forEach((c, i) => { put({ id:c.id, kind:'analysis', x:30, y:top + 70 + i * 140 }); c.runs.forEach(r => runRow.has(r) || runRow.set(r, i)); });
  let extra = D.claims.length;
  for (const r of D.runs) if (!runRow.has(r.id)) runRow.set(r.id, extra++);
  const usedRows = new Set();
  for (const r of D.runs) { let row = runRow.get(r.id); while (usedRows.has(row)) row++; usedRows.add(row); put({ id:r.id, kind:'run', x:610, y:top + 70 + row * 140 }); }
  const rows = Math.max(D.claims.length, ...[...usedRows].map(r => r + 1), 1);

  // D 程式碼：每一層一個區塊，檔案兩欄
  let ly = top + 70;
  for (const L of D.layers) {
    const files = L.paths.filter(p => D.files.some(f => f.path === p));
    const h = 80 + Math.ceil(Math.max(files.length, 1) / 2) * 124;
    regions.push({ ...L, x:1210, y:ly, w:760, h });
    files.forEach((p, i) => put({ id:`file:${p}`, kind:'code', x:1240 + (i % 2) * 370, y:ly + 76 + Math.floor(i / 2) * 124 }));
    ly += h + 30;
  }
  const colH = Math.max(rows * 140 + 110, ly - top + 10, 400);
  frames.push({ id:'B', title:'結論', x:0, y:top, w:420, h:colH }, { id:'C', title:'執行', x:580, y:top, w:440, h:colH },
    { id:'D', title:'程式碼架構', x:1180, y:top, w:820, h:colH });
  let bottom = top + colH + 60;

  // E 簡報：最新一張由證據鏈自動產生的裁決
  const brief = [...D.decisions].reverse().find(d => d.chain);
  if (brief) {
    frames.push({ id:'E', title:'簡報', x:0, y:bottom, w:1020, h:660 });
    put({ id:`BRIEF:${brief.id}`, kind:'html', x:30, y:bottom + 60, decision:brief.id });
  }

  // F 筆記與文獻：canvas_createNode 建的一般卡片
  if (D.notes.length) {
    const fx = brief ? 1180 : 0, fh = 90 + Math.ceil(D.notes.length / 2) * 170;
    frames.push({ id:'F', title:'筆記與文獻', x:fx, y:bottom, w:820, h:fh });
    D.notes.forEach((n, i) => put({ id:n.id, kind:n.kind, x:fx + 40 + (i % 2) * 380, y:bottom + 70 + Math.floor(i / 2) * 170 }));
  }

  const ids = new Set(nodes.map(n => n.id)), seen = new Set(), edges = [];
  const link = (from, to, kind, label) => { const k = `${from}>${to}`; if (ids.has(from) && ids.has(to) && !seen.has(k)) { seen.add(k); edges.push({ from, to, kind, label }); } };
  D.stages.slice(1).forEach((s, i) => link(D.stages[i].id, s.id, 'flow'));
  D.tasks.forEach(t => t.stage && link(t.stage, t.id, 'link'));
  D.claims.forEach(c => c.evidence.forEach(e => link(c.id, e.run, 'reference', e.key || e.path.split('/').pop())));
  D.runs.forEach(r => { if (r.script) link(r.id, `file:${r.script}`, 'uses'); r.files.slice(1).forEach(f => link(`file:${r.script}`, `file:${f}`, 'uses')); });
  D.links.forEach(e => link(e.from, e.to, e.kind, e.label));

  const maxX = Math.max(2000, ...frames.map(f => f.x + f.w)), maxY = Math.max(...frames.map(f => f.y + f.h));
  const titleOf = n => ({ stage:D.stages.find(s => s.id === n.id)?.title, agentTask:D.tasks.find(t => t.id === n.id)?.title,
    analysis:D.claims.find(c => c.id === n.id)?.text, run:D.runs.find(r => r.id === n.id)?.cmd, code:n.id.slice(5), html:'證據簡報' })[n.kind] ?? D.notes.find(x => x.id === n.id)?.title;
  return {
    frames, regions, nodes, edges, bounds:{ x:0, y:0, w:maxX, h:maxY },
    canvas:{ id:'agent-cockpit', title, edges, nodes:[...frames.map(f => ({ id:`frame:${f.id}`, kind:'frame', x:f.x, y:f.y, w:f.w, h:f.h, title:f.title })),
      ...nodes.map(n => ({ id:n.id, kind:n.kind, x:n.x, y:n.y, w:n.w, h:n.h, title:titleOf(n), meta:{ source:'agent-cockpit' } }))] },
  };
}
