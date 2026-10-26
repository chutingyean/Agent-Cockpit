"""模擬小模型的原始輸出文字，答對與否和格式是否嚴格都由雜湊決定。

所有隨機性都來自 sha256(arm, seed, id, sampling)，同樣輸入一定得到同樣輸出。
"""
import hashlib

# (答對率, 嚴格格式率)，依 arm 與題組設定
RATES = {
    ("base", "default"): (0.86, 0.58),
    ("module", "default"): (0.96, 0.81),
    ("combo", "default"): (0.97, 0.90),
    ("base", "hard"): (0.45, 0.70),
    ("module", "hard"): (0.62, 0.86),
    ("combo", "hard"): (0.62, 0.86),
}

# 取樣（pass@k）溫度較高，格式稍微比較不守規矩
FMT_PENALTY = {"greedy": 0.0, "pass@k": 0.02}

PREFIX = ["", "讓我想一想。\n", "根據題意推算。\n"]
# 不嚴格的寫法：前四種寬鬆評分器抓得到，後兩種抓不到
SLOPPY = ["我認為答案是 {}。", "答案: {} ", "答案：{}。", "答案是{}", "{}", "應該是 {} 吧"]


def _u(arm, seed, item_id, sampling, tag):
    # 把雜湊轉成 [0, 1) 的均勻數
    key = "|".join([arm, str(seed), item_id, sampling, tag])
    return int(hashlib.sha256(key.encode("utf-8")).hexdigest()[:12], 16) / 16 ** 12


def _wrong(ans, u):
    # 產生一個一定不等於正解的錯誤答案
    if ans.isdigit():
        return str(int(ans) + 1 + int(u * 3))
    if ans in ("A", "B", "C"):
        return [c for c in "ABC" if c != ans][int(u * 2)]
    pool = [w for w in ("台中", "大阪", "不知道", "西") if w != ans]
    return pool[int(u * len(pool))]


def generate(arm, seed, item, sampling="greedy"):
    p_ok, p_strict = RATES[(arm, item["suite"])]
    p_strict -= FMT_PENALTY[sampling]

    def u(tag):
        return _u(arm, seed, item["id"], sampling, tag)

    ans = item["answer"] if u("ok") < p_ok else _wrong(item["answer"], u("wrong"))
    if u("fmt") < p_strict:
        line = "答案：" + ans
    else:
        line = SLOPPY[int(u("style") * len(SLOPPY))].format(ans)
    return PREFIX[int(u("prefix") * len(PREFIX))] + line
