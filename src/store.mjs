// 事件庫：events 表是唯一的真相來源（只追加）；canvas_* 是給其他工具讀的投影（boards／nodes／edges）。
// .cockpit/events.jsonl 是文字鏡像：進 git、當 AI 協作紀錄，資料庫壞了也能從它重建。
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SCHEMA = `
create table if not exists events(id integer primary key autoincrement, ts text not null, agent text not null, type text not null, payload text not null);
create table if not exists canvas_boards(id text primary key, workspace_id text not null, title text not null, created_at integer not null, updated_at integer not null);
create table if not exists canvas_nodes(id text primary key, board_id text not null references canvas_boards(id) on delete cascade, kind text not null,
  x real not null default 0, y real not null default 0, width real, height real, title text, body text not null default '', ref_id text, meta_json text,
  created_at integer not null, updated_at integer not null);
create table if not exists canvas_edges(id text primary key, board_id text not null references canvas_boards(id) on delete cascade, kind text not null,
  from_node text not null, to_node text not null, label text, style_json text, created_at integer not null);`;

export function openStore(root){
  const dir = path.join(root, '.cockpit'), jsonl = path.join(dir, 'events.jsonl');
  mkdirSync(dir, { recursive:true });
  const db = new DatabaseSync(path.join(dir, 'cockpit.db'));
  db.exec('pragma journal_mode=wal; pragma busy_timeout=5000;' + SCHEMA);
  const ins = db.prepare('insert into events(ts, agent, type, payload) values(?, ?, ?, ?)');
  const parse = r => ({ id:r.id, ts:r.ts, agent:r.agent, type:r.type, ...JSON.parse(r.payload) });

  // 資料庫是空的但有鏡像（例如 clone 下來的 repo）→ 從鏡像重建
  if (!db.prepare('select count(*) n from events').get().n && existsSync(jsonl)) {
    db.exec('begin');
    for (const line of readFileSync(jsonl, 'utf8').split('\n').filter(Boolean)) {
      const { id, ts, agent, type, ...p } = JSON.parse(line);
      db.prepare('insert into events(id, ts, agent, type, payload) values(?, ?, ?, ?, ?)').run(id, ts, agent, type, JSON.stringify(p));
    }
    db.exec('commit');
  }

  return {
    root, db,
    events:(until = Infinity) => db.prepare('select * from events where id <= ? order by id').all(Number.isFinite(until) ? until : Number.MAX_SAFE_INTEGER).map(parse),
    last:() => db.prepare('select max(id) id from events').get().id || 0,
    version:() => db.prepare('pragma data_version').get().data_version,
    append(type, payload, agent = 'unknown'){
      const ts = new Date().toISOString();
      const { lastInsertRowid } = ins.run(ts, agent, type, JSON.stringify(payload));
      const e = { id:Number(lastInsertRowid), ts, agent, type, ...payload };
      appendFileSync(jsonl, JSON.stringify(e) + '\n');
      return e;
    },
    // 把白板投影寫成 canvas_* 列。ponytail: 每次整板重寫，卡片上千張時改成只寫有變的列
    materialize(board){
      const now = Math.floor(Date.now() / 1000);
      db.exec('begin');
      db.prepare('delete from canvas_edges where board_id = ?').run(board.id);
      db.prepare('delete from canvas_nodes where board_id = ?').run(board.id);
      db.prepare('insert or replace into canvas_boards values(?, ?, ?, coalesce((select created_at from canvas_boards where id = ?), ?), ?)')
        .run(board.id, 'agent-cockpit', board.title, board.id, now, now);
      const n = db.prepare('insert into canvas_nodes values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const x of board.nodes) n.run(x.id, board.id, x.kind, x.x, x.y, x.w, x.h, x.title ?? null, x.body ?? '', x.ref ?? null, x.meta ? JSON.stringify(x.meta) : null, now, now);
      const e = db.prepare('insert into canvas_edges values(?, ?, ?, ?, ?, ?, ?, ?)');
      board.edges.forEach((x, i) => e.run(`${board.id}:e${i}`, board.id, x.kind, x.from, x.to, x.label ?? null, null, now));
      db.exec('commit');
    },
    close:() => db.close(),
  };
}
