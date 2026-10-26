// 寫入咽喉：MCP、cockpit run、網頁上的操作，全部經過這裡驗證後才寫進事件庫。
// 把 research-cockpit 的自檢紀律（每個事實要有出處、狀態改變要有證據）變成硬規則；不合格就丟錯，訊息要告訴 agent 怎麼改。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inside, hashFile, jsonKeyHashes } from './repo.mjs';
import { STATUS, TOOL_EVENT, derive, evidenceState } from './engine.mjs';

export class GateError extends Error {}
const fail = msg => { throw new GateError(msg); };
const need = (cond, msg) => { if (!cond) fail(msg); };
const text = (v, name, min = 1) => need(typeof v === 'string' && [...v.trim()].length >= min, `${name} 至少要 ${min} 個字`);

// 研究類卡片只能從研究工具建立，canvas_createNode 不能繞過
export const RESERVED_KINDS = new Set(['analysis', 'run', 'stage', 'agentTask', 'code', 'frame']);
export const NOTE_KINDS = new Set(['note', 'paper', 'web', 'document', 'table', 'svg']);
export const EDGE_KINDS = new Set(['branch', 'reference', 'cites', 'similarity', 'flow', 'owns', 'uses', 'link']);

export function readKey(root, rel, key){
  let data;
  try { data = JSON.parse(readFileSync(path.join(root, rel), 'utf8')); } catch { return { ok:false, why:`${rel} 不是 JSON，不能用 key 指定欄位` }; }
  if (key in data) return { ok:true, value:data[key] };
  let v = data;
  for (const k of key.split('.')) { if (v && typeof v === 'object' && k in v) v = v[k]; else return { ok:false, why:`${rel} 裡沒有欄位 ${key}` }; }
  return { ok:true, value:v };
}

// ctx：{ root, st（reduce 後的狀態）, facts }
export function check(type, p, ctx){
  const { root, st } = ctx;
  const rel = (f, name = '路徑') => { const r = inside(root, f); need(r, `${name}「${f}」不在專案裡`); return r; };
  switch (type) {
    case 'stages_planned':
      need(Array.isArray(p.stages) && p.stages.length, 'stages 至少要一個階段');
      p.stages.forEach((s, i) => {
        text(s.title, `第 ${i + 1} 個階段的 title`); text(s.out, `階段「${s.title}」的 out（這一關要產出什麼）`);
        for (const t of s.needs || []) need(TOOL_EVENT[t], `needs 只能是 ${Object.keys(TOOL_EVENT).join('、')}`);
      });
      return;
    case 'stage_updated': {
      const s = st.stages.find(x => x.id === p.id_);
      need(s, `沒有階段 ${p.id_}`);
      need(['todo', 'active', 'done'].includes(p.status), 'status 只能是 todo、active、done');
      if (p.status === 'done') {
        const missing = (s.needs || []).filter(t => !st.tools.some(x => x.id > st.stageAt && x.type === TOOL_EVENT[t]));
        need(!missing.length, `階段「${s.title}」還不能結束：這一關非叫不可的 ${missing.join('、')} 還沒被呼叫過`);
        need(!s.human || p.human === true, `階段「${s.title}」要人看過才能結束，請用 cockpit_decide 請使用者確認`);
      }
      return;
    }
    case 'task_upserted': {
      const t = p.task;
      text(t.id, 'id'); text(t.title, 'title', 2);
      need(['doing', 'blocked', 'done'].includes(t.state), 'state 只能是 doing、blocked、done');
      text(t.summary, 'summary（做了什麼）', 10); text(t.why, 'why（為什麼）', 10); text(t.next, 'next（下一步）', 4);
      if (t.stage) need(st.stages.some(s => s.id === t.stage), `沒有階段 ${t.stage}，先用 cockpit_plan 建研究路徑`);
      if (t.state === 'done') {
        const pending = [...st.decisions.values()].filter(d => d.blocking && d.answer == null && d.task === t.id);
        need(!pending.length, `任務 ${t.id} 還有沒裁決的 blocking 決策（${pending.map(d => d.id).join('、')}），不能結束`);
      }
      return;
    }
    case 'run_recorded': return;   // 由 cockpit run 自己產生，內容都是量出來的
    case 'claim_recorded': {
      const c = p.claim;
      text(c.text, 'text（結論）', 6); text(c.hypothesis, 'hypothesis');
      need(Array.isArray(c.evidence) && c.evidence.length, 'evidence 至少要一筆：結論必須指向某次 cockpit run 寫出的檔案');
      const D = derive(st, ctx.facts);
      for (const ev of c.evidence) {
        const r = st.runs.get(ev.run);
        need(r, `沒有執行 ${ev.run}。請先用 cockpit_run（或 cockpit run -- 命令）跑實驗`);
        const f = rel(ev.path, 'evidence.path');
        need(f in (r.outputs || {}), `${f} 不是 ${ev.run} 寫出的檔案（它寫出的是：${Object.keys(r.outputs || {}).join('、') || '沒有'}）`);
        need(!D.runs.find(x => x.id === r.id).stale, `${ev.run} 已經過期（用到的程式在執行後被改），請重跑再登記結論`);
        ev.path = f;
        if (ev.key) { const k = readKey(root, f, ev.key); need(k.ok, k.why); ev.value = k.value; }
        const o = evidenceState(r, ev, { cur:p => hashFile(root, p), keysNow:p => jsonKeyHashes(root, p), runs:D.runs });
        need(o.ok, `${o.why}，數字不是 ${ev.run} 寫的；請重跑再登記`);
      }
      return;
    }
    case 'hypothesis_upserted': {
      const h = p.hypothesis;
      text(h.id, 'id'); text(h.label, 'label', 2);
      need(STATUS.includes(h.status), `status 只能是 ${STATUS.join('、')}`);
      if (['verified', 'refuted'].includes(h.status)) {
        const D = derive(st, ctx.facts);
        need(D.claims.some(c => c.hypothesis === h.id && c.health === 'valid'),
          `假設 ${h.id} 要改成 ${h.status}，必須先有一個證據鏈完整的結論（cockpit_claim，hypothesis=${h.id}）撐著`);
      }
      return;
    }
    case 'premise_recorded': {
      const pr = p.premise;
      text(pr.text, 'text', 6); text(pr.used, 'used_by');
      need(['高', '中', '低'].includes(pr.risk), 'risk 只能是 高、中、低');
      pr.grounds = (pr.grounds || []).map(g => rel(g, 'grounds'));
      pr.grounds.forEach(g => need(existsSync(path.join(root, g)), `grounds 的檔案 ${g} 不存在`));
      pr.groundHashes = Object.fromEntries(pr.grounds.map(g => [g, hashFile(root, g)]));
      return;
    }
    case 'premise_resolved':
      need(st.premises.has(p.premiseId), `沒有前提 ${p.premiseId}`);
      need(['verified', 'rejected'].includes(p.verdict), 'verdict 只能是 verified 或 rejected');
      return;
    case 'decision_requested': {
      const d = p.decision;
      text(d.question, 'question', 6); text(d.reason, 'reason', 6);
      need(Array.isArray(d.options) && d.options.length >= 2 && d.options.length <= 5, 'options 要 2 到 5 個');
      need(Number.isInteger(d.rec) && d.rec >= 0 && d.rec < d.options.length, 'recommendation 要是其中一個選項');
      for (const g of d.grounds || []) need(st.claims.has(g), `grounds 裡的 ${g} 不是已登記的結論`);
      return;
    }
    case 'decision_answered': {
      const D = derive(st, ctx.facts), d = D.decisions.find(x => x.id === p.decisionId);
      need(d, `沒有裁決 ${p.decisionId}`);
      need(d.answer == null, `${p.decisionId} 已經裁決過了`);
      need(Number.isInteger(p.answer) && p.answer >= 0 && p.answer < d.options.length, '選項不存在');
      return;
    }
    case 'progress_reported':
      text(p.summary, 'summary（做了什麼）', 10); text(p.why, 'why（為什麼）', 10);
      need(Array.isArray(p.files), 'files 要是陣列（這次改了哪些檔案；沒有改就給空陣列）');
      p.files = p.files.map(f => rel(f, 'files'));
      if (p.task) need(st.tasks.has(p.task), `沒有任務 ${p.task}，先用 cockpit_task 建立`);
      return;
    case 'node_created': {
      const n = p.node;
      need(!RESERVED_KINDS.has(n.kind), `「${n.kind}」卡片只能用研究工具建立（結論用 cockpit_claim、任務用 cockpit_task、執行用 cockpit_run），不能用 canvas_createNode`);
      need(NOTE_KINDS.has(n.kind), `kind 只能是 ${[...NOTE_KINDS].join('、')}`);
      text(n.title, 'title');
      return;
    }
    case 'edge_created': {
      const e = p.edge, ids = new Set([...st.notes.keys(), ...st.claims.keys(), ...st.runs.keys(), ...st.tasks.keys(), ...st.stages.map(s => s.id)]);
      need(EDGE_KINDS.has(e.kind), `kind 只能是 ${[...EDGE_KINDS].join('、')}`);
      need(ids.has(e.from) && ids.has(e.to), '連線兩端都必須是白板上已經存在的卡片');
      return;
    }
    case 'node_moved':
      need(Number.isFinite(p.x) && Number.isFinite(p.y) && typeof p.nodeId === 'string', 'x、y 要是數字');
      return;
    case 'file_changed':
    case 'review_recorded':
    case 'diagram_updated':
      return;
    default: fail(`不認得的事件 ${type}`);
  }
}
