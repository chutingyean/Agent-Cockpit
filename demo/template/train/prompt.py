"""依樣板編號把一道題目組成訓練用的提示文字。"""

TEMPLATES = [
    "問題：{q}\n請只輸出一行「答案：<答案>」。",
    "{q}\n回答格式：答案：<答案>",
    "請回答下列問題，最後一行寫「答案：<答案>」。\n{q}",
    "題目：{q}\n不要解釋，直接給「答案：<答案>」。",
    "以下是一道測驗題。\n{q}\n輸出格式固定為「答案：<答案>」。",
]


def build_prompt(item, template_id):
    return TEMPLATES[template_id % len(TEMPLATES)].format(q=item["question"])
