// 網頁 server：白板資料（/api/state）、SSE 即時推送、人在白板上的裁決與拖卡、證據簡報（answer-me-with-html）。
// 只綁 127.0.0.1；寫入要 JSON 且 Origin 必須是自己，避免別的網站跨站送出裁決。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openCockpit } from './cockpit.mjs';
import { chainTour, briefMarkdown, short } from './engine.mjs';
import { renderBrief } from './adapters.mjs';
import { GateError } from './gate.mjs';

const BOARD = fileURLToPath(new URL('../web/board.html', import.meta.url));

export function describe(e){
  switch (e.type) {
    case 'stages_planned': return `建立研究路徑：${e.stages.map(s => s.title).join(' → ')}`;
    case 'stage_updated': return `階段 ${e.id_} → ${e.status}`;
    case 'task_upserted': return `任務 ${e.task.id}「${e.task.title}」${{ doing:'進行中', blocked:'卡住', done:'完成' }[e.task.state]}：${e.task.summary}`;
    case 'run_recorded': return `執行 ${e.run.id}：${e.run.cmd}（exit ${e.run.exit}）`;
    case 'claim_recorded': return `登記結論 ${e.claim.id}：${e.claim.text}`;
    case 'file_changed': return `${e.path} ${e.deleted ? '被刪除' : '有變更'}${e.funcs?.length ? `（${e.funcs.join('、')}）` : ''}${e.findings?.length ? `；內建審查 ${e.findings.length} 筆` : ''}`;
    case 'progress_reported': return `回報 ${e.files.length} 個檔案：${e.summary}`;
    case 'decision_requested': return `請求裁決 ${e.decision.id}：${e.decision.question}`;
    case 'decision_answered': return `裁決 ${e.decisionId} → 選項 ${e.answer + 1}${e.comment ? `（${e.comment}）` : ''}`;
    case 'premise_recorded': return `登記前提 ${e.premise.id}：${e.premise.text}`;
    case 'premise_resolved': return `前提 ${e.premiseId} → ${e.verdict === 'verified' ? '已驗證' : '推翻'}`;
    case 'hypothesis_upserted': return `假設 ${e.hypothesis.id} → ${e.hypothesis.status}`;
    case 'gate_rejected': return `${e.tool} 被拒收：${e.message}`;
    case 'review_recorded': return `程式碼審查（${e.tool || '回報'}）：${e.findings.length} 筆發現`;
    case 'diagram_updated': return `更新架構圖：${e.diagram.meta?.title || ''}`;
    case 'node_created': return `新增卡片 ${e.node.id}：${e.node.title}`;
    case 'edge_created': return `連線 ${e.edge.from} → ${e.edge.to}`;
    case 'node_moved': return `移動卡片 ${e.nodeId}`;
    default: return e.type;
  }
}

export function createServer(root, { port = 4180 } = {}){
  const ck = openCockpit(root), clients = new Set(), briefs = new Map();
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  let mark = `${ck.store.version()}:${ck.store.last()}`;
  const timer = setInterval(() => {
    try {
      const added = ck.syncFiles(), now = `${ck.store.version()}:${ck.store.last()}`;
      if (added.length || now !== mark) { mark = now; for (const res of clients) res.write('event: change\ndata: {}\n\n'); }
    } catch {}
  }, 1500);

  function state(until){
    const { D, board, ua } = ck.view(until);
    return {
      project:path.basename(ck.root), D, board, lastId:ck.store.last(), until:until ?? null,
      tours:{ ua:ua?.tour?.length ? { title:'架構導覽', source:'UA 知識圖的 tour', steps:ua.tour } : null,
        chains:Object.fromEntries(D.claims.map(c => [c.id, chainTour(D, c.id)])) },
      timeline:ck.store.events(until).slice(-80).reverse().map(e => ({ id:e.id, ts:e.ts, agent:e.agent, type:e.type, text:describe(e) })),
      moments:moments(),
    };
  }

  // 證據鏈斷過的時刻：之後修好了，簡報也找得回來。只在有檔案變更的事件上檢查；事件只會追加，所以結果依事件編號快取
  // ponytail: 每個新的 file_changed 要重算一次整段 reduce，事件上萬筆時改成增量 reduce
  const seenAt = new Map();
  const chainAt = id => {
    if (!seenAt.has(id)) seenAt.set(id, id < 1 ? [] : ck.view(id).D.decisions.filter(d => d.chain).map(d => ({ id:d.id, question:d.question, grounds:d.grounds })));
    return seenAt.get(id);
  };
  function moments(){
    const out = [];
    for (const e of ck.store.events()) {
      if (e.type !== 'file_changed') continue;
      const before = new Set(chainAt(e.id - 1).map(d => d.id));   // 跟前一個事件比：中間的回報、重跑也可能讓斷鏈消失
      for (const d of chainAt(e.id)) if (!before.has(d.id)) out.push({ ...d, at:e.id, ts:e.ts });
    }
    return out.reverse();
  }

  function brief(id, until){
    const D = ck.view(until).D, md = briefMarkdown(D, id);
    if (!md) return null;
    const sig = createHash('sha1').update(md).digest('hex'), key = `${id}@${until ?? 'now'}`;
    if (briefs.get(key)?.sig !== sig) {
      const r = renderBrief(ck.root, `brief-${short(id).replace(/[^\w.-]/g, '_')}-${sig.slice(0, 8)}`, md);
      briefs.set(key, { sig, ...r });
    }
    return briefs.get(key);
  }

  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type':type, 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const readJson = req => new Promise((ok, no) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 65536) { no(new GateError('內容太大')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { no(new GateError('不是 JSON')); } });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
      if (req.method === 'GET') {
        if (url.pathname === '/') return send(res, 200, await readFile(BOARD, 'utf8'), 'text/html; charset=utf-8');
        if (url.pathname === '/api/state') { const u = Number(url.searchParams.get('until')); return send(res, 200, state(u > 0 ? u : undefined)); }
        if (url.pathname.startsWith('/api/brief/')) {
          const u = Number(url.searchParams.get('until')), b = brief(decodeURIComponent(url.pathname.slice(11)), u > 0 ? u : undefined);
          if (!b) return send(res, 404, '目前沒有這份簡報', 'text/plain; charset=utf-8');
          return b.ok ? send(res, 200, b.html, 'text/html; charset=utf-8') : send(res, 500, `簡報產生失敗：${b.message}`, 'text/plain; charset=utf-8');
        }
        if (url.pathname === '/events') {
          res.writeHead(200, { 'content-type':'text/event-stream', 'cache-control':'no-cache' });
          res.write(': connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res));
          return;
        }
        return send(res, 404, { error:'not found' });
      }
      if (req.method === 'POST') {
        if (!origins.has(req.headers.origin) || !String(req.headers['content-type']).startsWith('application/json')) return send(res, 403, { error:'只接受本機白板送出的請求' });
        const b = await readJson(req);
        if (url.pathname === '/api/decide') ck.write('decision_answered', { decisionId:String(b.id), answer:Number(b.answer), comment:String(b.comment || '').slice(0, 500) }, 'human');
        else if (url.pathname === '/api/move') ck.write('node_moved', { nodeId:String(b.id), x:Number(b.x), y:Number(b.y) }, 'human', { sync:false });
        else if (url.pathname === '/api/premise') ck.write('premise_resolved', { premiseId:String(b.id), verdict:String(b.verdict) }, 'human');
        else return send(res, 404, { error:'not found' });
        return send(res, 200, { ok:true });
      }
      send(res, 405, { error:'method not allowed' });
    } catch (e) {
      send(res, e instanceof GateError ? 400 : 500, { error:e.message });
    }
  });
  server.on('close', () => { clearInterval(timer); ck.close(); });
  return { server, listen:() => new Promise(ok => server.listen(port, '127.0.0.1', () => ok(server))), cockpit:ck };
}
