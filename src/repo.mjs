// 研究專案的「事實」：git 狀態、檔案內容雜湊、改到哪個函式。全部是確定性的讀取，不叫 LLM。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['.git', '.cockpit', 'node_modules', '__pycache__', '.venv', 'venv', '.tools', 'graphify-out', '.ua', '.understand-anything']);

export function git(root, ...args){
  try { return execFileSync('git', args, { cwd:root, encoding:'utf8', stdio:['ignore', 'pipe', 'ignore'], maxBuffer:32 << 20 }); }
  catch { return ''; }
}

export const head = root => git(root, 'rev-parse', '--short', 'HEAD').trim() || null;

// repo 內的相對路徑（統一用 /）；跳出 repo 的路徑回傳 null —— 寫入咽喉靠這個擋路徑穿越
export function inside(root, p){
  if (typeof p !== 'string' || !p) return null;
  const abs = path.resolve(root, p);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return path.relative(root, abs).split(path.sep).join('/');
}

// 內容雜湊；檔案不存在回 null（代表被刪掉）
export function hashFile(root, rel){
  try { return createHash('sha1').update(readFileSync(path.join(root, rel))).digest('hex').slice(0, 12); }
  catch { return null; }
}

// JSON 輸出檔裡每個頂層欄位值的雜湊。很多研究把結果合併寫進同一個「數據總表」，
// 證據要細到欄位：別的實驗寫了其他欄位，不該讓這一格失效。不是 JSON 回 null。
export function jsonKeyHashes(root, rel){
  if (!/\.json$/i.test(rel)) return null;
  try {
    const data = JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12)]));
  } catch { return null; }
}
// 欄位名稱可能本身帶點（"combo.acc"），也可能是巢狀路徑（"sampling.pass1.p"）：先找完整名稱，再退回第一段
export const topKey = (keys, key) => key in keys ? key : key.split('.')[0];

// git status 裡有變動的檔案（不含 .cockpit/）
export function dirty(root){
  return git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0')
    .filter(Boolean).map(l => l.slice(3)).filter(p => p && !p.startsWith('.cockpit/'));
}

export const listFiles = root => git(root, 'ls-files', '-co', '--exclude-standard').split('\n').filter(Boolean);

// 從 diff 的 hunk 標頭抓出改到的函式（Python 頂層 def、JS function）
export function changedFuncs(root, rel){
  const out = git(root, 'diff', '-U0', 'HEAD', '--', rel);
  const names = new Set();
  for (const m of out.matchAll(/^@@[^@]*@@\s*(?:async\s+)?(?:def|function|class)\s+([\w$]+)/gm)) names.add(m[1] + '()');
  for (const m of out.matchAll(/^\+\s*(?:async\s+)?(?:def|function)\s+([\w$]+)/gm)) names.add(m[1] + '()');
  return [...names];
}

export function diffstat(root, rel){
  const [a, d] = git(root, 'diff', '--numstat', 'HEAD', '--', rel).trim().split(/\s+/);
  return { add:Number(a) || 0, del:Number(d) || 0 };
}

// 執行前後比對用：走訪整個 repo（含被 gitignore 的輸出檔，例如 results/），記下 mtime 與大小
export function snapshot(root, limit = 20000){
  const seen = new Map(), stack = [''];
  while (stack.length && seen.size < limit) {
    const dir = stack.pop();
    let entries = [];
    try { entries = readdirSync(path.join(root, dir), { withFileTypes:true }); } catch { continue; }
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(rel); }
      else if (e.isFile()) { try { const s = statSync(path.join(root, rel)); seen.set(rel, `${s.mtimeMs}:${s.size}`); } catch {} }
    }
  }
  return seen;
}

// 檔案開頭的說明（Python docstring 第一行、JS 開頭註解），沒有 Understand-Anything 摘要時拿來當白話說明
export function docSummary(root, rel){
  let src = '';
  try { src = readFileSync(path.join(root, rel), 'utf8').slice(0, 2000); } catch { return ''; }
  const m = src.match(/^\s*(?:#![^\n]*\n)?\s*(?:"""|''')\s*([^\n]+)/) || src.match(/^\s*(?:\/\/|#)\s*([^\n]+)/);
  return m ? m[1].replace(/("""|''')\s*$/, '').trim() : '';
}
