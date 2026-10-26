"""假的 LoRA 微調：不真的訓練，只依樣板數量算出一個固定的最終 loss。"""
import hashlib
import math


def train_lora(templates, steps=50):
    # 步數越多 loss 越低；樣板越多樣，loss 再低一點；加一點由雜湊決定的小抖動
    jitter = hashlib.sha256("\n".join(templates).encode("utf-8")).digest()[0] / 255 * 0.004
    loss = 2.0 / (1 + steps / 25) - 0.03 * math.log(1 + len(set(templates))) + jitter
    return round(loss, 4)
