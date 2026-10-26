"""把 json、類 yaml 或管線表格文字解析回 dict，失敗時回傳 None。"""
import json


def parse_struct(text, fmt):
    if fmt == "json":
        try:
            obj = json.loads(text)
        except ValueError:
            return None
        return obj if isinstance(obj, dict) else None
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    if fmt == "yaml":
        # 每行都要是「key: value」
        out = {}
        for ln in lines:
            if ": " not in ln:
                return None
            k, v = ln.split(": ", 1)
            out[k.strip()] = v.strip()
        return out
    if fmt == "table":
        # 第一行表頭、第二行分隔線、第三行資料
        if len(lines) != 3:
            return None
        head, row = (
            [c.strip() for c in ln.strip("|").split("|")] for ln in (lines[0], lines[2])
        )
        return dict(zip(head, row)) if len(head) == len(row) else None
    return None


if __name__ == "__main__":
    assert parse_struct('{"a": "1"}', "json") == {"a": "1"}
    assert parse_struct("a: 1\nb: x", "yaml") == {"a": "1", "b": "x"}
    assert parse_struct("| a | b |\n|---|---|\n| 1 | x |", "table") == {"a": "1", "b": "x"}
    assert parse_struct("| a | b |\n|---|---|\n| 1 |", "table") is None
    print("parser 自我檢查通過")
