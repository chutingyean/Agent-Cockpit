"""評測主程式：跑指定的 arm／題組／取樣方式，把結果合併寫進 results/數據總表.json。"""
import argparse
import json
import os

import infer
import judge
import stats

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "test.jsonl")
TABLE = os.path.join(ROOT, "results", "數據總表.json")


def load_items(suite):
    with open(DATA, encoding="utf-8") as f:
        items = [json.loads(line) for line in f if line.strip()]
    return [it for it in items if it["suite"] == suite]


def run_arm(arm, seeds, items, sampling):
    # 回傳 {seed: [每題 0/1 分數]}
    return {s: [judge.score(it, infer.generate(arm, s, it, sampling)) for it in items] for s in seeds}


def acc(lst):
    return round(sum(lst) / len(lst), 4)


def flat(by_seed):
    return [x for s in sorted(by_seed) for x in by_seed[s]]


def merge(updates):
    # 讀舊表、更新 key、寫回（固定格式，方便比對）
    table = {}
    if os.path.exists(TABLE):
        with open(TABLE, encoding="utf-8") as f:
            table = json.load(f)
    table.update(updates)
    os.makedirs(os.path.dirname(TABLE), exist_ok=True)
    with open(TABLE, "w", encoding="utf-8") as f:
        f.write(json.dumps(table, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


def main():
    ap = argparse.ArgumentParser(description="小模型格式遵從評測")
    ap.add_argument("--arm", choices=["base", "module", "combo"], default="module")
    ap.add_argument("--seeds", default="1,2")
    ap.add_argument("--suite", choices=["default", "hard"], default="default")
    ap.add_argument("--sampling", choices=["greedy", "pass@k"], default="greedy")
    args = ap.parse_args()
    seeds = [int(s) for s in args.seeds.split(",")]
    items = load_items(args.suite)
    n = len(items)

    if args.suite == "hard":
        # hard 題組：每個 seed 的 combo − module（百分點）
        c = run_arm("combo", seeds, items, args.sampling)
        m = run_arm("module", seeds, items, args.sampling)
        delta = [round(100 * (sum(c[s]) - sum(m[s])) / n, 1) for s in seeds]
        band = stats.seed_band(delta)
        merge({"hard.delta_by_seed": delta, "hard.band": band})
        print("hard 題組 combo−module 各 seed 差距 %s 個百分點，波動幅度 %s" % (delta, band))
    elif args.sampling == "pass@k":
        # 取樣 pass@1 對比 greedy（module arm）
        g = flat(run_arm("module", seeds, items, "greedy"))
        p = flat(run_arm("module", seeds, items, "pass@k"))
        res = {"greedy": acc(g), "pass1": acc(p), "p": stats.paired_test(p, g)}
        merge({"sampling.pass1": res})
        print("module 取樣比較：greedy %.4f、pass@1 %.4f、p=%.4f" % (res["greedy"], res["pass1"], res["p"]))
    else:
        main_runs = run_arm(args.arm, seeds, items, "greedy")
        a = acc(flat(main_runs))
        out = {args.arm + ".acc": a, args.arm + ".by_seed": [acc(main_runs[s]) for s in seeds]}
        extra = ""
        if args.arm == "combo":
            m = flat(run_arm("module", seeds, items, "greedy"))
            out["combo.vs_module.p"] = stats.paired_test(flat(main_runs), m)
            extra = "，對 module 配對檢定 p=%.4f" % out["combo.vs_module.p"]
        elif args.arm == "module":
            b = flat(run_arm("base", seeds, items, "greedy"))
            out["module_vs_base"] = round(100 * (sum(flat(main_runs)) - sum(b)) / len(b), 1)
            extra = "，比 base 高 %.1f 個百分點" % out["module_vs_base"]
        merge(out)
        print("%s 在 %s 題組準確率 %.4f（seed %s）%s" % (args.arm, args.suite, a, args.seeds, extra))


if __name__ == "__main__":
    main()
