# 小模型格式遵從研究（示範專案）

Agent Cockpit 用來示範與整合測試的玩具研究專案：模擬小模型回答 60 道題，看它能不能照「答案：<答案>」的格式作答。
只用 Python 3.9 標準庫，每支程式不到 2 秒，同樣輸入的輸出逐位元相同（隨機性全部來自 sha256）。

## 結構

- `data/test.jsonl`：60 題（default 40 題、hard 20 題）
- `eval/infer.py` 模擬模型輸出；`eval/judge.py` 嚴格評分；`eval/stats.py` 配對符號檢定；`eval/run.py` 主程式
- `eval/parser.py`、`eval/parse_bench.py`：json／yaml／表格解析基準
- `train/`：假的 LoRA 訓練與樣板數量消融
- `configs/combo.yaml`、`notes/研究地圖.md`、`reports/p3.md`

## 指令（在專案根目錄執行）

```
python3 eval/run.py --arm combo --seeds 1,2       # combo.acc、combo.by_seed、combo.vs_module.p
python3 eval/run.py --arm module --seeds 1,2      # module.acc、module.by_seed、module_vs_base
python3 eval/run.py --suite hard --seeds 1,2,3    # hard.delta_by_seed、hard.band
python3 eval/run.py --sampling pass@k --seeds 1,2 # sampling.pass1
python3 eval/parse_bench.py                       # results/parse_bench.json
python3 train/ablate_templates.py                 # results/ablation.json
```

`run.py` 會把結果合併寫進 `results/數據總表.json`（只更新自己的 key）。

## 示範：偷改評分器

把 `eval/judge.py` 裡 `parse_answer` 的這一行：

```python
    m = re.search(r"^答案：(\S+)$", text, re.MULTILINE)
```

改成寬鬆版：

```python
    m = re.search(r"答案[是為：:]?\s*(\S+?)[。.]?\s*$", text)
```

寬鬆版也接受「我認為答案是 B。」「答案: B 」「答案：B。」這類寫法。
重跑 `python3 eval/run.py --arm combo --seeds 1,2`，`combo.acc` 會從 0.9125 升到 0.975，對 module 的 p 值也從 0.0414 變成 0.4531。
模型完全沒變，只是評分器變鬆了。
