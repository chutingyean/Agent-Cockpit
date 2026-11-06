---
name: agent-cockpit
description: Work under Agent Cockpit, the evidence-chain whiteboard and MCP server for research repos. Use when a repo has a `.cockpit/` folder, an "Agent Cockpit" section in AGENTS.md, or `cockpit_*` MCP tools; or when the user asks to set up Agent Cockpit, track experiments, register results as claims, or check which results still hold.
---

# Agent Cockpit

Agent Cockpit records every experiment run, every claim and the code each run depended on, and keeps checking the chain. If anything a run used changes later, the run goes stale and the claims built on it need recheck. A human follows along on a local board. Your job is to keep that record honest.

The cockpit's own messages (rejections, overview, board text) are in Traditional Chinese. Read them carefully; they tell you exactly what to fix.

## 1. Set up (only if the repo is not set up yet)

Check whether the `cockpit_overview` tool is available and the repo has a `.cockpit/` folder. If not, and the user wants Agent Cockpit:

```bash
npx -y @chutingyean/agent-cockpit init      # run in the repo root; it must be a git repo
```

`init` writes the MCP config for Claude Code, Cursor, VS Code and Gemini CLI, adds the rules to `AGENTS.md`, a Claude Code Stop hook and a git pre-commit hook. It prints the command for Codex. Tell the user to restart the agent session so the `cockpit` MCP server loads, and to open the board:

```bash
npx -y @chutingyean/agent-cockpit serve     # http://127.0.0.1:4180
```

## 2. Start of every session

1. Call `cockpit_overview` first. It lists decisions waiting for a human, decisions already answered, claims that need recheck and why, unreported changes, and unmet stage requirements.
2. For answered decisions, call `cockpit_decisions` and act on the answer. Before acting, check the overview and the board: if the work the decision asked for was already done (for example the re-run exists after the answer), do not do it again.
3. Create or update your task card with `cockpit_task` (`state`, `step`, `summary`, `why`, `next`). Update the same card every round; pass its `id`.

## 3. Run experiments only through the cockpit

- Use `cockpit_run` (or `cockpit run -- <command>` in a terminal). A number that did not come from a recorded run cannot be registered as a claim.
- Write results to JSON files with stable top-level keys, so a claim can cite one field and other runs can write other fields to the same file.
- Do not hand-edit result files. The cockpit notices and flags the claim.

## 4. Register claims

```
cockpit_claim({ text, hypothesis, evidence: [{ run: "R3", path: "results/metrics.json", key: "combo.acc" }] })
```

- `path` must be a file that run wrote; `key` names the field. The cockpit reads the actual value.
- If the run is stale (something it used has changed since), the claim is rejected. Re-run, then claim again with the new run. To update an existing claim, pass its `id`.
- Set a hypothesis to `verified` or `refuted` with `cockpit_hypothesis` only after a valid claim supports it.

## 5. Report every file you change

Call `cockpit_report({ files, summary, why, next })` after editing files (an empty `files` array if you changed nothing). Unreported changes turn red on the board, block `git commit`, and stop Claude Code from ending its turn.

## 6. Ask the human

- Use `cockpit_decide` for choices a human should make: give options and a recommendation, and set it blocking when you must wait. Mark your task `blocked`, stop, and tell the user to answer on the board.
- Use `cockpit_premise` for an assumption you are relying on but have not verified.

## 7. Code graph and review

- `canvas_structure` rebuilds the code graph. With `{ file, funcs }` it returns every function affected by changing those functions.
- `cockpit_review` reviews the changed lines (open-code-review if installed, otherwise built-in rules). Fix high-severity findings, report, re-run and re-claim.
- `canvas_diagram` accepts an architecture diagram in md² format; `canvas_createNode` and `canvas_link` add notes and papers. Do not use them to create claims, runs or tasks.

## When a call is rejected

The reason says what to fix. Common ones:

| Rejection | Fix |
|---|---|
| The evidence file was not written by that run | Cite the run that wrote it, or re-run |
| The run is stale | A dependency changed after the run. Re-run and cite the new run |
| A field is too short (`summary`, `why`, `next`) | Write a real sentence: what you did and why |
| A blocking decision is pending | Wait for the human; read it with `cockpit_decisions` |
| A stage cannot close | Call the tools the stage requires first |
| The path is outside the repo | Use a path inside the repo |

## Never

- Run experiments outside `cockpit_run`.
- Edit anything under `.cockpit/`.
- Claim a number you did not get from a recorded run.
- Leave a turn with unreported file changes.
