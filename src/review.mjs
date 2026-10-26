// 輕量版 open-code-review：確定性的規則審查，0 token。預設只看「這次改到的行」（跟 ocr 審 diff 一樣），--all 看整個檔案。
// 規則偏研究程式會出事的地方：評分比對變鬆、亂數沒固定種子、訓練讀到測試資料、例外被吞掉，加上常見的安全問題。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { git, dirty, listFiles } from './repo.mjs';

const CODE = /\.(py|m?js|cjs|ts)$/;
const SCORING = /(judge|score|metric|grade|eval)/i;

// 每條規則：哪一行、多嚴重、為什麼會影響結論
const LINE_RULES = [
  { id:'loose-match', re:/re\.(?:search|match|findall|fullmatch)\(\s*r?(["'])((?:(?!\1).)*)\1/, test:m => !m[2].startsWith('^') && /[\])]\?/.test(m[2]),
    severity:f => SCORING.test(f) ? 'high' : 'medium',
    message:'比對樣式沒錨在行首又允許可選字元：輸出裡任何像答案的片段都會被算對，分數會虛高，和之前的結果不可比' },
  { id:'bare-except', re:/^\s*except\s*:/, severity:'medium', message:'except: 會吞掉所有例外，算錯了也看不出來；請只抓預期的例外' },
  { id:'swallow', re:/^\s*except\s+[^:\s][^:]*:\s*(pass)?\s*$/, next:/^\s*pass\s*$/, severity:'medium', message:'抓到例外什麼都不做：失敗的樣本會被靜靜跳過，分母變了數字卻照常寫出' },
  { id:'eval-exec', re:/(?<![\w.])(eval|exec)\s*\(|new Function\(/, severity:'high', message:'eval / exec 會執行任意字串，輸入來源不可信時等於遠端執行' },
  { id:'shell-true', re:/shell\s*=\s*True/, severity:'high', message:'subprocess 用 shell=True，參數裡有外部字串時可以被注入指令' },
  { id:'pickle', re:/pickle\.loads?\(|torch\.load\((?![^)]*weights_only\s*=\s*True)/, severity:'medium', message:'pickle 載入的檔案可以執行任意程式碼，只載入自己產生的檔案' },
  { id:'mutable-default', re:/def\s+\w+\([^)]*=\s*(\[\]|\{\}|set\(\))/, severity:'medium', message:'預設參數是可變物件，會在多次呼叫之間共用，前一次的結果會漏進下一次' },
  { id:'sql-format', re:/\.execute\(\s*(f["']|["'][^"']*["']\s*(%|\.format|\+))/, severity:'high', message:'SQL 用字串拼接，請改用參數化查詢' },
  { id:'inner-html', re:/\.innerHTML\s*[+]?=\s*[^;]*(\$\{|\+\s*\w)/, severity:'medium', message:'把變數直接塞進 innerHTML 可能被注入 HTML／腳本，請先跳脫' },
  { id:'abs-path', re:/["'](\/Users\/|\/home\/|[A-Za-z]:\\\\)/, severity:'low', message:'寫死了本機的絕對路徑，換一台機器就跑不起來' },
  { id:'todo', re:/(#|\/\/)\s*(TODO|FIXME|XXX)\b/, severity:'low', message:'還有沒做完的 TODO／FIXME' },
];

// 整個檔案才看得出來的規則
const FILE_RULES = [
  { id:'unseeded', severity:'medium', message:'用了亂數但整個檔案沒有固定種子：每次跑結果不同，結論無法重現',
    find:src => /\bseed\s*\(|default_rng\s*\(\s*\d|manual_seed\s*\(/.test(src) ? -1 : src.split('\n').findIndex(l => /\b(random\.(random|choice|shuffle|randint|sample|uniform|gauss)|np\.random\.(rand|randn|choice|shuffle|randint|permutation))\s*\(/.test(l)) },
  { id:'test-leak', severity:'high', message:'訓練程式讀了測試資料：評估分數會虛高（資料洩漏）', when:f => /(^|\/)train/i.test(f),
    find:src => src.split('\n').findIndex(l => /(open|load|read_\w+|load_dataset)\s*\([^)]*\btest\b/i.test(l)) },
];

// 這次加進來或改過的行號；新檔案（還沒進 git）回傳 null，代表整個檔案都算
function addedLines(root, rel){
  if (!git(root, 'ls-files', '--', rel).trim()) return null;
  const out = git(root, 'diff', '-U0', 'HEAD', '--', rel), set = new Set();
  for (const m of out.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) for (let i = 0; i < Number(m[2] ?? 1); i++) set.add(Number(m[1]) + i);
  return set;
}

export function reviewFile(root, rel, { all = false } = {}){
  if (!CODE.test(rel)) return [];   // 設定檔（例如 .mcp.json 裡本來就要寫 node 的絕對路徑）不審
  let src;
  try { src = readFileSync(path.join(root, rel), 'utf8'); } catch { return []; }
  const lines = src.split('\n'), only = all ? null : addedLines(root, rel), out = [];
  const keep = no => !only || only.has(no);
  const push = (rule, no) => keep(no) && out.push({ path:rel, line:no, severity:typeof rule.severity === 'function' ? rule.severity(rel) : rule.severity, message:rule.message, rule:rule.id });
  lines.forEach((line, i) => {
    if (/^\s*(#|\/\/)/.test(line) && !/TODO|FIXME|XXX/.test(line)) return;
    for (const r of LINE_RULES) {
      const m = line.match(r.re);
      if (!m || (r.test && !r.test(m))) continue;
      if (r.next && !m[1] && !r.next.test(lines[i + 1] || '')) continue;
      push(r, i + 1);
    }
  });
  for (const r of FILE_RULES) {
    if (r.when && !r.when(rel)) continue;
    const i = r.find(src);
    if (i >= 0) push(r, i + 1);
  }
  return out;
}

// 預設審查有變動的程式檔；沒有變動就審全部
export function review(root, { files, all = false } = {}){
  let list = files || dirty(root).filter(f => CODE.test(f));
  if (!list.length) { list = listFiles(root).filter(f => CODE.test(f)); all = true; }
  return list.filter(f => CODE.test(f)).flatMap(f => reviewFile(root, f, { all }));
}
