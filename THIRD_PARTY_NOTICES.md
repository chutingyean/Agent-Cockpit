# Third-Party Notices

Agent Cockpit is licensed under the GNU Affero General Public License v3.0 or later (see [LICENSE](LICENSE)).
This file lists the third-party work it includes or builds on. All bundled components use licenses (MIT, Apache-2.0, SIL OFL 1.1) that are compatible with AGPL-3.0.

## 1. Bundled in this repository

### answer-me-with-html (MIT)

- Files: [`vendor/answer-me-with-html/am.mjs`](vendor/answer-me-with-html/am.mjs) (the upstream prebuilt CLI, unmodified) and its license, [`vendor/answer-me-with-html/LICENSE`](vendor/answer-me-with-html/LICENSE)
- Source: https://github.com/QingYunA/answer-me-with-html
- Copyright (c) 2026 Answer me with HTML contributors
- Used to render evidence briefs (Markdown generated from the evidence chain) into a single HTML page.

The prebuilt `am.mjs` itself bundles the following components:

| Component | License | Copyright |
|---|---|---|
| [marked](https://github.com/markedjs/marked) | MIT | Copyright (c) 2018+, MarkedJS; Copyright (c) 2011-2018, Christopher Jeffrey |
| [@dagrejs/dagre](https://github.com/dagrejs/dagre) | MIT | Copyright (c) 2012-2014 Chris Pettitt |
| [Temml](https://github.com/ronkok/Temml) | MIT | Copyright (c) 2020 Ron Kok |
| Temml's mhchem port | Apache-2.0 | Copyright (c) 2011-2015 The MathJax Consortium, (c) 2015-2018 Martin Hensel |
| Temml's hyphenate/escape helpers (adapted from React) | Apache-2.0 | Copyright (c) Meta Platforms, Inc. and affiliates |
| [Bangers](https://github.com/googlefonts/bangers) font (embedded as a data URI) | SIL Open Font License 1.1 | Copyright 2010 The Bangers Project Authors |

The full texts of these licenses are available at https://opensource.org/license/mit, https://www.apache.org/licenses/LICENSE-2.0 and https://openfontlicense.org.

## 2. npm dependencies (installed, not bundled)

| Package | License |
|---|---|
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT |
| [zod](https://github.com/colinhacks/zod) | MIT |

## 3. Projects whose formats or ideas Agent Cockpit builds on

No source code from the following projects is included in this repository. Agent Cockpit reads or writes their data formats, can call their tools when they are installed, and reimplements some of their ideas independently.

| Project | License | How Agent Cockpit uses it |
|---|---|---|
| [research-cockpit](https://github.com/sanngotall/research-cockpit) | MIT | The claim layer: claims, hypotheses, premises and decisions, its fixed status vocabulary (`verified`, `optimized`, `refuted`, `open`, `pending`, `info`), and the "dead-end loop" idea, enforced here as machine-checked rules. |
| [graphify](https://github.com/Graphify-Labs/graphify) | Apache-2.0 | If `graphify-out/graph.json` exists, Agent Cockpit uses it for code dependencies. The built-in code graph (`src/graph.mjs`) writes the same NetworkX node-link format, and the relation names treated as dependencies follow graphify's list of affected relations. |
| [open-code-review](https://github.com/alibaba/open-code-review) | Apache-2.0 | If the `ocr` CLI is installed, `cockpit review` runs it and normalizes its JSON findings. The built-in rule-based reviewer (`src/review.mjs`) is an independent implementation that, like ocr, reviews changed lines by default. |
| [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) | MIT | The board reads `.ua/knowledge-graph.json` (summaries, layers, tours) and exports evidence chains in its tour format. The reader modes (overview / learning / deep) follow its personas. The demo project's sample knowledge graph was written by hand in its schema. |
| [md²](https://github.com/jan-bogaerts/md2) | AGPL-3.0 | `canvas_diagram` accepts architecture diagrams in md²'s JSON diagram format. Validation was implemented independently; no md² code is included. |

## Trademarks

Project and product names (including Claude Code, Codex, Cursor, Gemini CLI and the projects listed above) belong to their respective owners. Agent Cockpit is not affiliated with or endorsed by them.
