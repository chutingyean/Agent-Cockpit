"""樣板數量消融：比較 1 個與 5 個提示樣板訓練後的 loss，寫進 results/ablation.json。"""
import json
import os

from prompt import build_prompt
from sft import train_lora

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "test.jsonl")
OUT = os.path.join(ROOT, "results", "ablation.json")


def main():
    with open(DATA, encoding="utf-8") as f:
        item = json.loads(f.readline())
    loss = {n: train_lora([build_prompt(item, t) for t in range(n)]) for n in (1, 5)}
    res = {"templates": {"1": loss[1], "5": loss[5], "better": "5" if loss[5] < loss[1] else "1"}}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(json.dumps(res, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print("樣板消融：1 個樣板 loss %.4f，5 個樣板 loss %.4f" % (loss[1], loss[5]))


if __name__ == "__main__":
    main()
