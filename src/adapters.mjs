// 外部工具的轉接：裝了就用，沒裝就退回內建做法。cockpit 本身不依賴它們。
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { depGraph } from './deps.mjs';

const has = cmd => spawnSync(cmd, ['--version'], { stdio:'ignore' }).status === 0;

// graphify：tree-sitter AST、0 token，產生 graphify-out/graph.json；之後 deps.mjs 就會改用它
export function runGraphify(root){
  if (has('graphify')) {
    const r = spawnSync('graphify', ['update', '.'], { cwd:root, encoding:'utf8' });
    const dep = depGraph(root);
    return { ok:r.status === 0, message:r.status === 0 ? `graphify 已重建 graph.json；依賴來源：${dep.source}，${[...dep.adj.values()].reduce((n, s) => n + s.size, 0)} 條檔案依賴`
      : `graphify 執行失敗：${(r.stderr || '').slice(-500)}` };
  }
  const dep = depGraph(root);
  return { ok:true, message:`沒有安裝 graphify（uv tool install graphifyy），先用內建的 import 掃描：${[...dep.adj.values()].reduce((n, s) => n + s.size, 0)} 條檔案依賴。` };
}

// open-code-review 的結果 → { path, line, severity, message }。欄位名稱寬鬆比對，ocr 的 JSON 格式有變也接得住
export function normalizeFindings(json){
  const out = [], walk = v => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const file = v.path || v.file || v.filePath || v.file_path, msg = v.message || v.comment || v.content || v.description || v.title;
    if (file && msg) out.push({ path:String(file), line:Number(v.line || v.startLine || v.start_line || v.lineNumber) || null,
      severity:String(v.severity || v.level || v.priority || 'medium').toLowerCase(), message:String(msg).slice(0, 500) });
    else Object.values(v).forEach(walk);
  };
  walk(json);
  return out;
}

export function runOcr(root){
  if (!has('ocr')) return { ok:false, message:'沒有安裝 open-code-review（npm i -g @alibaba-group/open-code-review）。也可以用 Delegation mode：由 agent 照 ocr 的規則審查，再用 cockpit_review 回報。' };
  const out = path.join(root, '.cockpit', 'reviews', 'ocr.json');
  mkdirSync(path.dirname(out), { recursive:true });
  const r = spawnSync('ocr', ['review', '--format', 'json', '--output', out], { cwd:root, encoding:'utf8' });
  if (r.status !== 0 || !existsSync(out)) return { ok:false, message:`ocr 執行失敗：${(r.stderr || r.stdout || '').slice(-500)}` };
  return { ok:true, findings:normalizeFindings(JSON.parse(readFileSync(out, 'utf8'))) };
}

// answer-me-with-html：證據鏈組成的 Markdown → 一頁 HTML。用 repo 附的 am CLI；資料夾留在 .cockpit/，不寫到使用者家目錄
const AM = fileURLToPath(new URL('../vendor/answer-me-with-html/am.mjs', import.meta.url));
export function renderBrief(root, name, markdown){
  const dir = path.join(root, '.cockpit', 'briefs');
  mkdirSync(dir, { recursive:true });
  const md = path.join(dir, `${name}.md`), html = path.join(dir, `${name}.html`);
  writeFileSync(md, markdown);
  const r = spawnSync(process.execPath, [AM, 'render', md, '-o', html, '--no-open'], { encoding:'utf8',
    env:{ ...process.env, AM_HOME:path.join(root, '.cockpit', '.am'), AM_NO_UPDATE_CHECK:'1', AM_NO_OPEN:'1' } });
  if (r.status !== 0) { rmSync(html, { force:true }); return { ok:false, message:(r.stdout + r.stderr).slice(-800) }; }
  return { ok:true, html:readFileSync(html, 'utf8'), path:html };
}
