"""結構化輸出解析基準：產生 60 段 json/yaml/表格文字，統計 parser 解析失敗的數量。"""
import hashlib
import json
import os

import parser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "test.jsonl")
OUT = os.path.join(ROOT, "results", "parse_bench.json")


def render(rec, fmt, broken):
    # 依格式把 dict 寫成文字；broken 時故意弄壞一處
    if fmt == "json":
        text = json.dumps(rec, ensure_ascii=False)
        return text[:-1] if broken else text
    if fmt == "yaml":
        text = "\n".join("%s: %s" % kv for kv in rec.items())
        return text.replace(": ", "=", 1) if broken else text
    head = "| " + " | ".join(rec) + " |"
    row = "| " + " | ".join(rec.values()) + " |"
    if broken:
        row = row.rsplit("|", 2)[0] + "|"
    return "\n".join([head, "|" + "---|" * len(rec), row])


def main():
    with open(DATA, encoding="utf-8") as f:
        items = [json.loads(line) for line in f if line.strip()]
    failures = 0
    for it in items:
        rec = {"id": it["id"], "answer": it["answer"]}
        # 約八分之一的片段故意壞掉（由雜湊決定）
        broken = hashlib.sha256(it["id"].encode("utf-8")).digest()[0] < 32
        if parser.parse_struct(render(rec, it["fmt"], broken), it["fmt"]) != rec:
            failures += 1
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    res = {"e2e_cost": 0.0, "items": len(items), "failures": failures}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(json.dumps(res, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print("解析基準：%d 段中有 %d 段解析失敗" % (len(items), failures))


if __name__ == "__main__":
    main()
