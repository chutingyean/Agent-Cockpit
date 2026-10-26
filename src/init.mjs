// cockpit init：替研究專案寫好所有 agent 的設定。只寫在專案資料夾裡；既有設定檔用合併的，不覆蓋。
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { openCockpit } from './cockpit.mjs';
import { git } from './repo.mjs';
import { RULES } from './mcp.mjs';

const BIN = fileURLToPath(new URL('../bin/cockpit.mjs', import.meta.url));
const START = '<!-- agent-cockpit:start -->', END = '<!-- agent-cockpit:end -->';

const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } };
const writeJson = (f, v) => { mkdirSync(path.dirname(f), { recursive:true }); writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
const q = s => `"${s.replace(/"/g, '\\"')}"`;

export function init(root){
  root = path.resolve(root);
  if (!git(root, 'rev-parse', '--git-dir').trim()) throw new Error(`${root} 不是 git repo，請先 git init`);
  openStore(root).close();
  const node = process.execPath, args = [BIN, 'mcp', '--repo', root], server = { command:node, args };
  const written = [];
  const merge = (rel, fn) => { const f = path.join(root, rel), v = readJson(f); fn(v); writeJson(f, v); written.push(rel); };

  merge('.mcp.json', v => { v.mcpServers = { ...v.mcpServers, cockpit:server }; });                                   // Claude Code
  merge('.cursor/mcp.json', v => { v.mcpServers = { ...v.mcpServers, cockpit:server }; });                            // Cursor
  merge('.vscode/mcp.json', v => { v.servers = { ...v.servers, cockpit:{ type:'stdio', ...server } }; });             // VS Code Copilot
  merge('.gemini/settings.json', v => {                                                                                // Gemini CLI
    v.mcpServers = { ...v.mcpServers, cockpit:server };
    const names = new Set([].concat(v.context?.fileName || ['GEMINI.md'], 'AGENTS.md'));
    v.context = { ...v.context, fileName:[...names] };
  });
  // Claude Code 的 Stop hook：有沒回報的變更就擋住它結束回合
  merge('.claude/settings.json', v => {
    const cmd = `${q(node)} ${q(BIN)} check --hook claude --repo ${q(root)}`;
    const stop = (v.hooks?.Stop || []).filter(h => !JSON.stringify(h).includes('agent-cockpit') && !JSON.stringify(h).includes('cockpit.mjs'));
    v.hooks = { ...v.hooks, Stop:[...stop, { hooks:[{ type:'command', command:cmd }] }] };
  });

  // 規則檔：AGENTS.md 是 Codex、Cursor、Copilot、Gemini 共通的；CLAUDE.md 用 @ 匯入它
  const block = `${START}\n## Agent Cockpit\n\n${RULES}\n\n終端機跑實驗：\`${node} ${BIN} run -- <命令>\`\n白板：\`${node} ${BIN} serve --repo ${root}\`\n${END}`;
  const agents = path.join(root, 'AGENTS.md'), old = existsSync(agents) ? readFileSync(agents, 'utf8') : '';
  writeFileSync(agents, old.includes(START) ? old.replace(new RegExp(`${START}[\\s\\S]*?${END}`), () => block) : `${old}${old ? '\n\n' : ''}${block}\n`);
  written.push('AGENTS.md');
  const claude = path.join(root, 'CLAUDE.md'), cOld = existsSync(claude) ? readFileSync(claude, 'utf8') : '';
  if (!cOld.includes('@AGENTS.md')) { writeFileSync(claude, `${cOld}${cOld ? '\n' : ''}@AGENTS.md\n`); written.push('CLAUDE.md'); }

  // git pre-commit：有沒回報的變更就擋下 commit（跟用哪個 agent 無關）
  const hook = path.join(root, git(root, 'rev-parse', '--git-path', 'hooks').trim(), 'pre-commit');
  mkdirSync(path.dirname(hook), { recursive:true });
  const line = `${q(node)} ${q(BIN)} check --hook git --repo "$(git rev-parse --show-toplevel)" || exit 1`;
  const hOld = existsSync(hook) ? readFileSync(hook, 'utf8') : '#!/bin/sh\n';
  if (!hOld.includes('cockpit.mjs')) writeFileSync(hook, `${hOld.trimEnd()}\n# agent-cockpit\n${line}\n`);
  chmodSync(hook, 0o755);
  written.push('.git/hooks/pre-commit');

  const gi = path.join(root, '.gitignore'), gOld = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const ignore = ['.cockpit/cockpit.db*', '.cockpit/.am/', '.cockpit/briefs/', '.cockpit/runs/'].filter(x => !gOld.includes(x));
  if (ignore.length) { writeFileSync(gi, `${gOld.trimEnd()}${gOld ? '\n' : ''}# agent-cockpit（events.jsonl 要進 git）\n${ignore.join('\n')}\n`); written.push('.gitignore'); }

  // init 自己寫的設定檔由 cockpit 回報，不算未回報（否則第一次 commit 就被自己的 pre-commit 擋下）
  const ck = openCockpit(root);
  ck.syncFiles();
  ck.write('progress_reported', { files:written.filter(f => !f.startsWith('.git/')), summary:'cockpit init 寫入 agent 設定、規則檔與 hook', why:'讓所有 agent 都接上駕駛艙的 MCP 與研究規範' }, 'cockpit');
  ck.close();

  // Codex 的 MCP 設定在家目錄；不想改全域設定，可以每次用 -c 臨時指定。headless（codex exec）要放行 MCP 工具才能呼叫
  return { root, written, codex:`codex mcp add cockpit -- ${q(node)} ${q(BIN)} mcp --repo ${q(root)}
  （codex exec 要能呼叫 cockpit 的工具，請在 ~/.codex/config.toml 的 [mcp_servers.cockpit] 加上 default_tools_approval_mode = "approve"；
   或不改全域設定，每次執行加：-c 'mcp_servers.cockpit.command="${node}"' -c 'mcp_servers.cockpit.args=["${BIN}","mcp","--repo","${root}"]' -c 'mcp_servers.cockpit.default_tools_approval_mode="approve"'）` };
}
