import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from src.estimate import estimate_pi
from src.sampler import halton_points

NS = [100, 1000, 10000, 100000]


def main():
    err = {n: abs(estimate_pi(halton_points(n)) - math.pi) for n in NS}

    # Ordinary least squares of log(error) against log(sample count).
    xs = [math.log(n) for n in NS]
    ys = [math.log(err[n]) for n in NS]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum(
        (x - mx) ** 2 for x in xs
    )

    path = ROOT / "results" / "scaling.json"
    data = {}
    if path.exists():
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
    data["halton"] = {"err": {str(n): value for n, value in err.items()}, "slope": slope}
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    print(json.dumps(data["halton"], indent=2))


if __name__ == "__main__":
    main()
