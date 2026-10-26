"""統計小工具：配對符號檢定與 seed 之間的波動幅度。"""
from math import comb


def paired_test(a, b):
    # 雙尾精確符號檢定：只看兩邊結果不同的題目
    win = sum(1 for x, y in zip(a, b) if x > y)
    lose = sum(1 for x, y in zip(a, b) if x < y)
    n = win + lose
    if n == 0:
        return 1.0
    tail = sum(comb(n, i) for i in range(min(win, lose) + 1)) / 2 ** n
    return round(min(1.0, 2 * tail), 4)


def seed_band(values):
    # 不同 seed 結果的最大值減最小值
    return round(max(values) - min(values), 4)


if __name__ == "__main__":
    assert paired_test([1, 1, 1], [0, 0, 0]) == 0.25
    assert paired_test([1, 0], [1, 0]) == 1.0
    assert seed_band([0.0, 5.0, -5.0]) == 10.0
    print("stats 自我檢查通過")
