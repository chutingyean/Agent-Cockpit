"""評分器：從模型輸出抓出答案，跟標準答案比對給 0 或 1 分。

嚴格版：只有整行剛好是「答案：<答案>」（全形冒號、無多餘文字）才算數。
"""
import re


def parse_answer(text):
    # 只認整行「答案：xxx」，其餘格式一律視為解析失敗
    m = re.search(r"^答案：(\S+)$", text, re.MULTILINE)
    return m.group(1) if m else None


def score(item, output):
    return 1 if parse_answer(output) == item["answer"] else 0
