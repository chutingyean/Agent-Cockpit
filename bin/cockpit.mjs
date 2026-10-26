#!/usr/bin/env node
// Agent Cockpit 的命令列：init / serve / mcp / run / graph / review / check / status / demo
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCockpit } from '../src/cockpit.mjs';
import { recordRun } from '../src/run.mjs';
import { init } from '../src/init.mjs';
import { createServer } from '../src/server.mjs';
import { serveStdio, overviewText } from '../src/mcp.mjs';
import { git } from '../src/repo.mjs';
import { runGraphify, runOcr } from '../src/adapters.mjs';
import { seedDemo, JUDGE_STRICT, JUDGE_LOOSE } from '../src/demo.mjs';

const argv = process.argv.slice(2), dash = argv.indexOf('--');
const [cmd, ...opts] = dash < 0 ? argv : argv.slice(0, dash);
const rest = dash < 0 ? [] : argv.slice(dash + 1);
const opt = (name, def) => { const i = opts.indexOf(`--${name}`); return i < 0 ? def : opts[i + 1]; };
const flag = name => opts.includes(`--${name}`);
const repo = path.resolve(opt('repo', process.env.COCKPIT_REPO || process.cwd()));
const HERE = path.dirname(fileURLToPath(import.meta.url));

const HELP = `用法：cockpit <命令> [--repo 研究專案路徑]
  init                  替研究專案寫好 MCP 設定、規則檔、Stop hook、pre-commit
  serve [--port 4180]   開白板（http://127.0.0.1:4180）
  mcp                   MCP stdio server（由 agent 啟動）
  run -- <命令>          執行實驗並記錄（命令、commit、程式碼雜湊、輸出檔）
  graph                 重建程式碼圖（有 graphify 用 graphify，沒有用內建的輕量版）
  review [--all]        程式碼審查（有 ocr 用 ocr，沒有用內建規則；預設只看改到的行）
  check [--hook git|claude]  檢查未回報的變更（hook 用）
  status                印出駕駛艙摘要
  demo [--break|--restore]   產生示範研究專案；--break 偷改評分器、--restore 改回來`;

async function main(){
  switch (cmd) {
    case 'init': {
      const r = init(repo);
      console.log(`✓ 已設定 ${r.root}\n  ${r.written.join('\n  ')}\nCodex 的 MCP 設定在家目錄，要用請自己執行：\n  ${r.codex}`);
      return;
    }
    case 'serve': {
      const port = Number(opt('port', 4180)), s = createServer(repo, { port });
      await s.listen();
      console.log(`白板：http://127.0.0.1:${port}  （研究專案：${repo}）`);
      return;
    }
    case 'mcp': return serveStdio(repo);
    case 'run': {
      if (!rest.length) throw new Error('用法：cockpit run -- <命令>');
      const { run } = recordRun(openCockpit(repo), rest.join(' '), { agent:process.env.COCKPIT_AGENT || 'cli' });
      console.error(`\n[cockpit] 執行 ${run.id} 已記錄：用到 ${Object.keys(run.hashes).length} 個程式檔，寫出 ${Object.keys(run.outputs).join('、') || '沒有檔案'}`);
      process.exitCode = run.exit;
      return;
    }
    case 'graph': {
      const r = runGraphify(repo);
      console.log(r.message);
      if (r.report) console.log(readFileSync(path.join(repo, '.cockpit', 'graph', 'GRAPH_REPORT.md'), 'utf8'));
      process.exitCode = r.ok ? 0 : 1;
      return;
    }
    case 'review': {
      const r = runOcr(repo, { all:flag('all') });
      if (!r.ok) { console.error(r.message); process.exitCode = 1; return; }
      openCockpit(repo).write('review_recorded', { findings:r.findings, tool:r.tool }, 'cli');
      console.log(`${r.tool}：${r.findings.length} 筆發現（已記到白板）\n${r.findings.map(f => `  ${f.severity.padEnd(6)} ${f.path}:${f.line ?? '-'}  ${f.message}`).join('\n')}`);
      return;
    }
    case 'check': return check(opt('hook'));
    case 'status': { const ck = openCockpit(repo); ck.syncFiles(); console.log(overviewText(ck.view().D)); return; }
    case 'demo': return demo();
    default: console.log(HELP);
  }
}

function check(hook){
  const ck = openCockpit(repo);
  ck.syncFiles();
  const { D } = ck.view(), list = u => u.map(c => `  - ${c.path}${c.funcs?.length ? `（${c.funcs.join('、')}）` : ''}`).join('\n');
  if (hook === 'git') {
    const staged = new Set(git(repo, 'diff', '--cached', '--name-only').split('\n').filter(Boolean));
    const bad = D.unreported.filter(c => staged.has(c.path));
    if (bad.length) { console.error(`[agent-cockpit] 擋下 commit：這些變更沒有 agent 回報\n${list(bad)}\n請用 cockpit_report 回報（files 列出這些檔案）後再 commit。`); process.exitCode = 1; }
    return;
  }
  if (hook === 'claude') {
    let input = {};
    try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {}
    if (D.unreported.length && !input.stop_hook_active) {
      console.error(`[agent-cockpit] 結束前請先回報：這些檔案改了但沒有回報\n${list(D.unreported)}\n請呼叫 cockpit_report（files 列出它們，說明做了什麼、為什麼）。`);
      process.exitCode = 2;
    }
    return;
  }
  console.log(D.unreported.length ? `未回報的變更：\n${list(D.unreported)}` : '✓ 所有變更都有回報');
  process.exitCode = D.unreported.length ? 1 : 0;
}

function demo(){
  const target = path.join(HERE, '..', 'demo', 'research'), judge = path.join(target, 'eval', 'judge.py');
  if (flag('break') || flag('restore')) {
    const src = readFileSync(judge, 'utf8'), [from, to] = flag('break') ? [JUDGE_STRICT, JUDGE_LOOSE] : [JUDGE_LOOSE, JUDGE_STRICT];
    if (!src.includes(from)) return console.log(flag('break') ? '評分器已經是寬鬆版了' : '評分器已經是原本的嚴格版');
    writeFileSync(judge, src.replace(from, to));
    return console.log(flag('break') ? '已偷改 eval/judge.py（寬鬆比對、沒有回報）。看白板：4 個結論會變待重驗。' : '已把 eval/judge.py 改回嚴格比對。結論會恢復有效。');
  }
  if (existsSync(target) && !flag('fresh')) return console.log(`示範專案已存在：${target}\n重新產生請加 --fresh；開白板：node bin/cockpit.mjs serve --repo demo/research`);
  if (existsSync(target)) execFileSync('rm', ['-rf', target]);
  cpSync(path.join(HERE, '..', 'demo', 'template'), target, { recursive:true });
  const g = (...a) => execFileSync('git', a, { cwd:target, stdio:'ignore' });
  g('init', '-q', '-b', 'main'); g('add', '-A'); g('-c', 'user.name=demo', '-c', 'user.email=demo@example.com', 'commit', '-qm', '研究專案初始版本');
  init(target);
  g('add', '-A'); g('-c', 'user.name=demo', '-c', 'user.email=demo@example.com', 'commit', '-qm', '加入 Agent Cockpit 設定');   // 也順便走過一次 pre-commit hook
  seedDemo(openCockpit(target));
  console.log(`✓ 示範研究專案：${target}
開白板：node bin/cockpit.mjs serve --repo demo/research
偷改評分器：node bin/cockpit.mjs demo --break    改回來：node bin/cockpit.mjs demo --restore`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
