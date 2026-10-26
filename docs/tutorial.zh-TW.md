# Agent Cockpit 教學

[English](tutorial.md) · **繁體中文**

這份教學先用示範專案帶你看懂白板，再把 Agent Cockpit 接到自己的研究專案，讓 Claude Code、Codex 等 agent 在規範下工作。最後一節是一次真實的工作紀錄：兩個 agent 從空專案做完一個小研究。

- [1. 安裝](#1-安裝)
- [2. 五分鐘看懂白板](#2-五分鐘看懂白板)
- [3. 接到自己的研究專案](#3-接到自己的研究專案)
- [4. 讓 agent 照規範工作](#4-讓-agent-照規範工作)
- [5. 內建的程式碼圖與審查](#5-內建的程式碼圖與審查)
- [6. 裁決、簡報與重播](#6-裁決簡報與重播)
- [7. 常見問題](#7-常見問題)
- [8. 實例：兩個 agent、一個空專案](#8-實例兩個-agent一個空專案)

---

## 1. 安裝

| 軟體 | 版本 | 用途 |
|---|---|---|
| Node.js | 22.13 以上（建議 24） | Agent Cockpit 本身（用內建的 `node:sqlite`） |
| git | 任何版本 | 偵測檔案變更、pre-commit 檢查 |
| python3 | 3.9 以上 | 只有示範專案需要 |
| 任一個支援 MCP 的 agent | Claude Code、Codex、Cursor、Gemini CLI… | 做研究的 agent |

不需要另外安裝 graphify 或 open-code-review：Agent Cockpit 內建了它們的輕量版，有裝真的工具時會自動改用。

```bash
git clone https://github.com/chutingyean/Agent-Cockpit.git
cd Agent-Cockpit
npm install
npm test        # 約 4 秒
npm link        # 選用：之後在任何地方都能直接打 cockpit
```

以下都寫 `cockpit`；沒有 `npm link` 的話，改成 `node /path/to/Agent-Cockpit/bin/cockpit.mjs`。

## 2. 五分鐘看懂白板

```bash
npm run demo                              # 產生 demo/research：真的跑 6 次實驗、登記 6 個結論
cockpit serve --repo demo/research        # 打開 http://127.0.0.1:4180
```

白板從左到右讀，就是一條證據鏈：

| 區域 | 內容 | 怎麼看 |
|---|---|---|
| 研究路徑 | 階段卡、任務卡 | agent 自己建、自己更新；卡片上有「為什麼」與「下一步」 |
| 結論 | 每個結論與它的數字 | 綠色 ✓ 有效；紅色 ⛓ 待重驗 |
| 執行 | 每次 `cockpit run` | 命令、commit、寫出的檔案；用到的東西被改過就標「過期」 |
| 程式碼架構 | 執行用到的程式檔，依架構分層 | 「核心」是連線最多的檔案；點開看函式、影響範圍、審查結果 |
| 簡報 | 最近一次斷鏈的一頁證據簡報 | 哪裡斷了、影響哪些結論、建議怎麼做 |
| 筆記與文獻 | agent 建的一般卡片 | |

右側是**駕駛艙**：要你裁決的事、還沒站穩的前提、沒人回報的變更、每個 agent 在做什麼、簡報紀錄與時間軸。

上方三個按鈕切換說明的深淺：**總覽**（給不寫程式的人）、**學習**（多一點解釋）、**深入**（實際數值、雜湊、函式名稱）。

### 試著弄壞它

另開一個終端機：

```bash
cockpit demo --break --repo demo/research      # 偷偷把評分器的比對改鬆，沒有任何 agent 回報
```

大約 1.5 秒內白板會變成這樣：

1. `eval/judge.py` 標紅，卡片寫著改到 `parse_answer()`。
2. 紅線從 `judge.py` 一路連到所有用過它的執行（R1–R4）和結論（C1–C4），結論變成「待重驗」。
3. 內建審查自動看了改到的那一行，標出 **high**：比對樣式沒錨在行首又允許可選字元，分數會虛高。
4. 程式碼圖算出影響範圍：`parse_answer()` → `score()` → `run_arm()` → `main()`。
5. 駕駛艙送出一個自動裁決：「judge.py 被改了，沒有 agent 回報；4 個結論的證據鏈失效。還原，還是接受並重跑？」簡報把這件事排成一頁。

```bash
cockpit demo --restore --repo demo/research    # 改回來：雜湊對上，所有結論恢復有效
```

> 重新產生示範專案（`npm run demo -- --fresh`）前，先停掉正在跑的 `serve`。

## 3. 接到自己的研究專案

### 3.1 初始化

```bash
cd /path/to/your-research          # 必須是 git repo
cockpit init
```

`init` 只會寫在研究專案資料夾裡：

| 檔案 | 給誰 |
|---|---|
| `.mcp.json` | Claude Code |
| `.cursor/mcp.json` | Cursor |
| `.vscode/mcp.json` | VS Code（Copilot） |
| `.gemini/settings.json` | Gemini CLI |
| `AGENTS.md`、`CLAUDE.md` | 所有 agent 會讀的規範 |
| `.claude/settings.json` | Claude Code 的 Stop hook：沒回報變更不能結束回合 |
| `.git/hooks/pre-commit` | 沒回報的變更不能 commit |

Codex 的設定在家目錄，`init` 不會幫你改，只印出指令（見 4.2）。

### 3.2 開白板

```bash
cockpit serve                      # http://127.0.0.1:4180
```

白板只綁在 127.0.0.1，其他電腦連不到。

### 3.3 實驗一律透過 cockpit 跑

```bash
cockpit run -- python3 experiments/train.py --lr 0.001
```

`cockpit run` 會記下：

- 命令與當下的 commit；
- 腳本與它直接或間接 import 的每個檔案的雜湊；
- Python 依賴檔裡每個函式的雜湊，以及這次執行碰得到哪些函式；
- 設定檔的雜湊；
- 寫出了哪些檔案，以及 JSON 結果裡每個欄位的雜湊。

之後用到的東西有任何一個變了，這次執行就「過期」，引用它的結論就「待重驗」；只改到這次執行碰不到的函式則不算。沒經過 `cockpit run` 的數字，不能被登記成結論。

## 4. 讓 agent 照規範工作

### 4.1 Claude Code

在研究專案資料夾開 Claude Code，它會讀到 `.mcp.json` 與 `CLAUDE.md`，第一次會問你要不要啟用 `cockpit` 這個 MCP server。

不想互動、要用腳本跑（headless）：

```bash
claude -p "照 AGENTS.md 的規範工作。任務：……" \
  --mcp-config .mcp.json --strict-mcp-config \
  --allowedTools "mcp__cockpit,Read,Write,Edit" --max-turns 40
```

這裡刻意不給 Bash：agent 只能用 `cockpit_run` 跑程式，每次執行都會被記錄。

### 4.2 Codex

```bash
codex mcp add cockpit -- node /path/to/Agent-Cockpit/bin/cockpit.mjs mcp --repo "$PWD"
```

`codex exec`（headless）預設不允許呼叫 MCP 工具。不想改全域設定，可以每次用 `-c` 臨時指定：

```bash
codex exec \
  -c 'mcp_servers.cockpit.command="node"' \
  -c "mcp_servers.cockpit.args=[\"/path/to/Agent-Cockpit/bin/cockpit.mjs\",\"mcp\",\"--repo\",\"$PWD\"]" \
  -c 'mcp_servers.cockpit.default_tools_approval_mode="approve"' \
  --sandbox workspace-write "照 AGENTS.md 的規範工作。任務：……"
```

### 4.3 Cursor、Gemini CLI、VS Code

`init` 已經寫好設定檔，打開專案即可。Gemini CLI 會透過 `.gemini/settings.json` 讀 `AGENTS.md`。

### 4.4 agent 會被要求做什麼

`AGENTS.md` 裡的七條規範，由寫入咽喉強制檢查：

1. 開工先 `cockpit_overview`。
2. 用 `cockpit_task` 建任務卡，每一輪更新（做了什麼、為什麼、下一步）。
3. 實驗一律用 `cockpit_run`。
4. 結論用 `cockpit_claim` 登記，證據必須指向某次執行寫出的檔案與欄位；執行已過期就拒收。
5. 改了檔案用 `cockpit_report` 回報；沒回報 → 白板標紅、commit 被擋、Claude Code 不能結束回合。
6. 要人決定的事用 `cockpit_decide`，回來用 `cockpit_decisions` 拿結果。
7. 還沒驗證的前提用 `cockpit_premise` 登記。

不合規的呼叫會被拒收並告訴 agent 原因（例如「evidence 指向的 results/x.json 不是 R3 寫出的檔案」），agent 通常會自己改正後重送。白板會顯示每個 agent 被拒收幾次。

## 5. 內建的程式碼圖與審查

### 5.1 程式碼圖（輕量版 graphify）

```bash
cockpit graph
```

- 抽出 Python 與 JS／TS 的函式、類別、import 與呼叫關係，輸出跟 graphify 相同格式的 `.cockpit/graph/graph.json`。
- `.cockpit/graph/GRAPH_REPORT.md` 列出核心節點（連線最多的函式）、社群（常一起呼叫的一群函式）、意外連結（跨社群又跨檔案的呼叫）與建議問題。
- `cockpit run` 的依賴閉包、白板上的分層都來自這張圖。
- 有檔案被改時，白板與自動裁決會寫出**影響範圍**：哪些函式直接或間接呼叫了被改的函式。agent 也可以問：`canvas_structure({ file: "src/estimate.py", funcs: ["estimate_pi()"] })`。
- 有 `graphify-out/graph.json`（真的 graphify 產生的，tree-sitter、40 種語言）時改用它。

### 5.2 程式碼審查（輕量版 open-code-review）

```bash
cockpit review          # 只看這次改到的行（跟 ocr 審 diff 一樣）
cockpit review --all    # 看整個專案
```

規則偏研究程式會出事的地方：

| 規則 | 嚴重度 | 為什麼影響結論 |
|---|---|---|
| 評分比對變鬆（沒錨行首又允許可選字元） | 評分程式裡是 high | 分數虛高，和之前的結果不可比 |
| 訓練程式讀了測試資料 | high | 資料洩漏 |
| 用了亂數但沒固定種子 | medium | 結果不能重現 |
| 例外被吞掉（`except: pass`） | medium | 失敗樣本被靜靜跳過，分母變了 |
| 可變的預設參數 | medium | 前一次的結果漏進下一次 |
| `eval`／`exec`、`shell=True`、SQL 字串拼接、`pickle` | high／medium | 安全問題 |
| 寫死絕對路徑、TODO | low | 換機器跑不起來、沒做完 |

審查結果會沿證據鏈傳播：用到有問題檔案的結論會標「⚑ 有疑慮」。另外，每偵測到一次檔案變更，cockpit 都會自動審查改到的行（0 token）；檔案改回去，發現就消失。

裝了 open-code-review（`ocr`）時，`cockpit review` 與 `cockpit_review` 會改用它；agent 也可以自己審查後用 `cockpit_review({ findings: [...] })` 回報。

## 6. 裁決、簡報與重播

- **裁決**：agent 用 `cockpit_decide` 發的問題會出現在駕駛艙，附選項與建議。點選項（可以留言），agent 用 `cockpit_decisions` 拿到答案。任務還有沒裁決的 blocking 問題時不能結束。
- **自動裁決**：沒回報的改動讓結論失效時，駕駛艙會自己送出裁決（「還原，還是接受並重跑」）；同一支腳本連續 3 次以上只改設定、程式沒變（原地打轉）時也會。
- **簡報**：每一次斷鏈都有一頁簡報：斷掉的證據鏈圖、每個結論的狀態、過期的執行、審查發現與要你決定的事。內容由引擎從證據圖組出來，answer-me-with-html 負責排版，不需要 LLM 寫。
- **重播**：按右上角的「⏪ 重播」。拖滑桿可以倒回任何一個事件；按「▶ 播放」則從頭一步一步看研究怎麼走到現在（慢／正常／快），播放列會寫出每個事件是誰做了什麼。播到斷鏈的那一刻，簡報框會自己出現在畫面裡，播完自動回到現在。重播時的狀態全部從事件推出來，所以早就修好的斷鏈，倒回去仍和當時一模一樣。
- **簡報紀錄**：駕駛艙列出證據鏈斷過的每一次。「看簡報」打開當時的簡報，「▶ 從這裡播放」重看那一段。

## 7. 常見問題

**白板上的結論變紅了，怎麼辦？** 點結論卡看原因（例如「src/estimate.py 在 R1 之後被改」）。如果改動是對的，重跑那次實驗、重新登記結論；如果是誤改，還原檔案，雜湊對上就自動恢復。

**我自己手動改了檔案，也要回報嗎？** 要。請 agent 呼叫 `cockpit_report`，或在白板上回覆自動裁決。否則 `git commit` 會被 pre-commit 擋下。

**事件存在哪？** `.cockpit/events.jsonl`（文字檔，請 commit，就是完整的工作紀錄）與 `.cockpit/cockpit.db`（SQLite，不進 git，刪掉會從 jsonl 重建）。

**會把資料送到網路上嗎？** 不會。白板只綁 127.0.0.1，所有判斷都是本機的確定性規則，不呼叫任何 LLM。

**支援哪些語言？** 內建程式碼圖支援 Python 與 JS／TS，函式層級的過期判斷支援 Python；其他語言以整個檔案的雜湊判斷，或裝 graphify（40 種語言）。

## 8. 實例：兩個 agent、一個空專案

這一節是真實跑出來的紀錄，不是預先灌好的示範資料。完整事件在 [live-run/events.jsonl](live-run/events.jsonl)，agent 寫的程式在 [live-run/project/](live-run/project/)，agent 的輸出在 `live-run/*.log`。

### 8.1 起點

一個只有 `README.md`（研究問題）的 git repo，跑過 `cockpit init`：

> 用均勻亂數撒點估計 π，誤差是不是隨樣本數 n 以 n^(-1/2) 下降？換成低差異序列（Halton）會不會更快？只用 Python 標準庫，實驗要能重現。

### 8.2 Claude Code 做第一部分（00:32–00:33）

用 headless 模式執行，只給 cockpit 的 MCP 工具和 Read／Write／Edit，**不給 Bash**，所以它只能用 `cockpit_run` 跑程式。它自己：

1. 規劃三個階段、建任務卡 T1，之後每一步都更新卡片。
2. 寫出 `src/sampler.py`、`src/estimate.py`、`experiments/scaling.py`。
3. 用 `cockpit_run` 跑出 R1：偽亂數的平均絕對誤差 0.122 → 0.0233 → 0.00978 → 0.00326，log-log 斜率 **−0.5095**。
4. 登記結論 C1（證據：R1 寫出的 `results/scaling.json` 的 `pseudo.slope`）、跑內建審查（0 筆）、結束三個階段。

中途它第一次 `cockpit_report` 被寫入咽喉退回（「為什麼」寫太短），它自己補長後重送。

### 8.3 Codex 做第二部分，被擋下後請人裁決（00:35–00:37）

Codex 在 `src/sampler.py` 加了 `halton_points()`、寫了 `experiments/halton.py`，跑出 R2：Halton 斜率 **−0.7216**。

接著它要登記「Halton 比偽亂數快」，證據引用 R1 的 `pseudo.slope`，**被寫入咽喉拒收**：`src/sampler.py` 在 R1 之後被改過，R1 過期了。Codex 沒有硬闖，而是把任務標成「卡住」，用 `cockpit_decide` 送出裁決 J1：「是否允許重跑偽亂數、更新 C1？」

![Codex 被擋下後請人裁決](screenshots/live-2-codex-asks-human.png)

### 8.4 從這次學到的事：函式層級的過期判斷

Codex 只是**新增**了一個函式，`uniform_points()` 完全沒動，R1 的數字其實還是對的。「依賴檔一變就過期」在這裡太保守。

於是讓程式碼圖接進證據鏈：`cockpit run` 記下 Python 依賴檔裡每個函式的雜湊，以及這次執行（從腳本沿呼叫關係往下走）碰得到哪些函式。之後的改動如果只碰到碰不到的函式、模組層程式碼也沒變，就不算過期；改到碰得到的函式、import 或最外層程式碼一律算過期，寧可多報、不可漏報。

### 8.5 人裁決，agent 照做（00:41–00:42）

在白板上把 J1 裁決為「允許重跑」。Codex 再次上工：讀 `cockpit_decisions` → 重跑偽亂數（R3）→ 更新 C1 → 登記 C2（證據：R2 的 `halton.slope` 與 R3 的 `pseudo.slope`）→ 任務完成。兩個結論都有效。

![兩個 agent 都完成：2/2 有效](screenshots/live-3-all-valid.png)

### 8.6 沒回報的改動（00:47）

模擬一個 agent 偷偷「優化」：在 `halton_points()` 裡加一點隨機擾動，沒有回報。白板 1.5 秒內：

- **只有 C2 變成待重驗**，C1 維持有效。同一個檔案被改，但 R3（C1 的證據）碰不到 `halton_points()`，這就是 8.4 的函式層級判斷。
- 內建審查標出：**第 25 行用了亂數但沒固定種子，結果無法重現**。
- 自動裁決寫出影響範圍（「改到 `halton_points()`，往上影響 `halton.py` 的 `main()`」），建議還原。

![沒回報的改動：只有 C2 失效](screenshots/live-4-unreported-change.png)

| 執行 R3：sampler.py 有變更，但改的函式它沒用到 | sampler.py：審查發現、函式清單、影響範圍 |
|---|---|
| ![](screenshots/live-5-run-r3-detail.png) | ![](screenshots/live-6-sampler-detail.png) |

### 8.7 人選擇還原，Claude Code 執行（00:50）

在白板上選「還原 sampler.py」。Claude Code 讀裁決 → 用 Edit 拿掉那段擾動（還原後與原檔逐位元組相同）→ 回報。雜湊對上，C2 恢復有效，回報率回到 100%。

### 8.8 再看一次

做完之後按「⏪ 重播」→「▶ 播放」，可以從第一個事件開始看兩個 agent 怎麼一步步完成；播到 00:47 那一刻，C2 變紅、簡報框出現。

![重播到斷鏈那一刻：簡報框出現在畫面裡](screenshots/live-8-replay-brief.png)

這次實測暴露、還沒修的一個問題：裁決沒有「已執行」狀態。Claude Code 最後問「J1 要我現在重跑嗎？」，其實 Codex 在 8.5 已經做完了。
