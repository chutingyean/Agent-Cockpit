<p align="center"><img src="docs/assets/banner.png" alt="Agent Cockpit: every research claim, traceable to the code that produced it" width="100%"></p>

<p align="center">
  <a href="https://github.com/chutingyean/Agent-Cockpit/actions/workflows/test.yml"><img src="https://github.com/chutingyean/Agent-Cockpit/actions/workflows/test.yml/badge.svg" alt="tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue" alt="license: AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.13-339933" alt="node >= 22.13">
  <img src="https://img.shields.io/badge/MCP-any%20agent-7c4dcc" alt="MCP: any agent">
</p>

<p align="center"><b>English</b> · <a href="README.zh-TW.md">繁體中文</a></p>

**Agent Cockpit** is a local whiteboard plus an MCP server for AI agents that do research. Any agent that speaks MCP (Claude Code, Codex, Cursor, Gemini CLI, …) draws its work onto the same board: the plan, the tasks, every experiment run, every claim, and the code each run depended on. A deterministic engine keeps checking the whole evidence chain. When any link changes, the cards that depend on it turn red. You can tell which results still hold, and why, without reading the code.

<p align="center"><img src="docs/assets/replay.gif" alt="Replaying a real session: two agents complete a study, an unreported change breaks one claim, a human decides, an agent restores it" width="100%"></p>
<p align="center"><sub>Replay of a real session: Claude Code and Codex complete a small study from an empty repo. An unreported edit breaks one claim, and the cockpit raises a decision and writes a brief. A human picks "restore", and an agent carries it out.</sub></p>

## Why

After a few days of research with AI agents, the same things keep going wrong:

- **Claims lose their footing silently.** An agent edits the grader, the data pipeline or a statistics helper, and results that were "verified" no longer hold. Nobody notices.
- **Changes go unreported.** Files change and no agent says so, or an agent says it changed something it didn't.
- **Decisions pile up, assumptions harden, loops spin.** Questions meant for a human wait unanswered, untested premises become foundations, and an agent keeps tweaking hyperparameters "one more time".
- **The code grows faster than you can read it.**

Agent Cockpit turns these into rules a machine can check, and shows the result on one board.

## Features

- **Evidence chains, down to a JSON field.** A claim must cite a value that a recorded run actually wrote. Each run records the hash of its script, of every file the script depends on, and of each function it reaches. If any of those changes, the run goes stale and every claim built on it is flagged for recheck. Revert the change and the hashes match again, so the claims recover.
- **Works with any MCP agent.** Agent identity comes from the MCP handshake. `cockpit init` writes the config for Claude Code, Cursor, VS Code and Gemini CLI, and prints the command for Codex.
- **One write gate.** Every write from MCP, the CLI or the board passes through the same validator. Non-compliant writes are rejected with a reason the agent can act on. Rejections are logged too.
- **Unreported changes get caught.** Real file changes are detected whether or not an agent reports them. Unreported changes block `git commit`, and Claude Code cannot end its turn until it reports them.
- **Built-in code graph and code review, no extra installs.** A lightweight graphify-style call graph supplies dependency closures, communities, core nodes and impact analysis. A rule-based reviewer looks at the changed lines every time a file changes. Install the real [graphify](https://github.com/Graphify-Labs/graphify) or [open-code-review](https://github.com/alibaba/open-code-review) and they are used automatically.
- **Human decisions in the loop.** Agents ask through `cockpit_decide` and wait. When a change breaks claims, the cockpit raises a decision itself and writes a one-page evidence brief, laid out by [answer-me-with-html](https://github.com/QingYunA/answer-me-with-html).
- **Replay.** Everything is an append-only event, so you can scrub or play the board back to any moment. A brief stays available even after the problem is fixed.
- **Local and deterministic.** The board binds to 127.0.0.1. Every check is a plain rule, with no LLM calls and zero tokens.

## Quick start

Requires Node.js 22.13+ (for the built-in `node:sqlite`), git, and python3 for the demo project.

```bash
git clone https://github.com/chutingyean/Agent-Cockpit.git
cd Agent-Cockpit
npm install
npm run demo                                       # build a demo research repo: 6 real runs, 6 claims
node bin/cockpit.mjs serve --repo demo/research    # open http://127.0.0.1:4180
```

Then, in a second terminal, break something and watch the board:

```bash
node bin/cockpit.mjs demo --break      # quietly loosens the grader's answer matching, unreported
node bin/cockpit.mjs demo --restore    # put it back: hashes match, claims recover
```

<p align="center"><img src="docs/screenshots/2-board-broken-chain.png" alt="The board after the grader was changed: dependent claims turn red, the cockpit raises a decision" width="100%"></p>

## Use it on your own research repo

```bash
cd /path/to/your-research                                  # must be a git repo
node /path/to/Agent-Cockpit/bin/cockpit.mjs init           # MCP configs, AGENTS.md, Stop hook, pre-commit
node /path/to/Agent-Cockpit/bin/cockpit.mjs serve          # the board
node /path/to/Agent-Cockpit/bin/cockpit.mjs run -- python3 train.py --lr 1e-3   # run experiments through the cockpit
```

`init` only writes inside your repo. Open the repo in your agent and it reads `AGENTS.md` and the MCP config. The [tutorial](docs/tutorial.md) walks through every agent step by step.

## How it works

<p align="center"><img src="docs/figures/evidence-graph.png" alt="The evidence graph: claim → run → code → architecture layer, with review, summaries and briefs as annotations" width="100%"></p>

- **Content hashes, not timestamps.** Staleness is decided by comparing hashes, so reverting a file restores validity exactly.
- **Function-level precision.** For Python dependencies, a change to a function the run never reaches does not make the run stale. Changes to reachable functions, imports or module-level code always do.
- **Event sourcing.** `.cockpit/events.jsonl` is the single source of truth, and it doubles as the agents' work log. Commit it. The board is a pure projection (`reduce` → `derive`), which makes replay possible.

<p align="center"><img src="docs/figures/architecture.png" alt="Architecture: agents, CLI and the board all write through one gate into an append-only event store; the engine projects it onto the board" width="100%"></p>

## MCP tools

| Research tools | Purpose |
|---|---|
| `cockpit_overview` | Call first: pending decisions, claims needing recheck and why, unreported changes |
| `cockpit_plan` / `cockpit_stage` | The research path. A stage cannot close until its required tools have been called |
| `cockpit_task` | The agent's own task card, updated every round (what, why, next) |
| `cockpit_run` | Run an experiment and record it |
| `cockpit_claim` | Register a claim. Evidence must be a file and field written by a recorded run |
| `cockpit_hypothesis` / `cockpit_premise` | Hypotheses and not-yet-verified premises |
| `cockpit_decide` / `cockpit_decisions` | Ask a human; read the answers |
| `cockpit_report` | Report which files changed |
| `cockpit_review` | Code review: ocr if installed, otherwise built-in rules; or report your own findings |

Canvas tools: `canvas_list`, `canvas_read`, `canvas_search`, `canvas_createNode`, `canvas_link`, `canvas_diagram` (architecture diagrams in [md²](https://github.com/jan-bogaerts/md2)'s format) and `canvas_structure` (code graph and impact analysis).

## CLI

Run `npm link` once in this repo to get a global `cockpit` command; otherwise use `node bin/cockpit.mjs`.

| Command | Purpose |
|---|---|
| `cockpit init` | Write MCP configs, rules files, the Stop hook and the pre-commit hook |
| `cockpit serve [--port 4180]` | Open the board |
| `cockpit run -- <command>` | Run and record an experiment |
| `cockpit graph` | Rebuild the code graph (graphify if installed) |
| `cockpit review [--all]` | Code review (ocr if installed; changed lines by default) |
| `cockpit status` / `cockpit check` | Print the cockpit summary / list unreported changes |
| `cockpit demo [--break\|--restore\|--fresh]` | The demo project |

Every command accepts `--repo <path>`; the default is the current directory.

## Project layout

```
bin/cockpit.mjs      CLI
src/engine.mjs       reduce and derive: evidence chains, propagation rules, tours, brief drafts
src/gate.mjs         the single write gate
src/store.mjs        event store (node:sqlite) and canvas projection
src/run.mjs          cockpit run
src/graph.mjs        built-in code graph (graphify-compatible output)
src/review.mjs       built-in rule-based code review
src/mcp.mjs          MCP server
src/server.mjs       board server (SSE, decisions, briefs, replay)
web/board.html       the board (no framework, no build step)
demo/template/       demo research project (Python, really runs)
docs/                tutorial, figures, screenshots, a recorded real session
test/                node:test suite (npm test)
```

## Documentation

- [Tutorial](docs/tutorial.md): from the demo to your own project, every agent, replay, and a recorded real session
- [Recorded session](docs/live-run/): the events, the code the agents wrote, and their output

## Acknowledgements

Agent Cockpit fuses ideas from six projects into one evidence graph:
[research-cockpit](https://github.com/sanngotall/research-cockpit) (claims, hypotheses, premises, decisions),
[graphify](https://github.com/Graphify-Labs/graphify) (code graph),
[open-code-review](https://github.com/alibaba/open-code-review) (code review),
[Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) (summaries, layers, tours, personas),
[md²](https://github.com/jan-bogaerts/md2) (architecture diagram format) and
[answer-me-with-html](https://github.com/QingYunA/answer-me-with-html) (one-page briefs).
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for what is bundled and under which license.

## License

Copyright (C) 2026 chutingyean

Agent Cockpit is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. If you modify it and let others use it over a network, you must offer them the source code of your version. Third-party components keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
