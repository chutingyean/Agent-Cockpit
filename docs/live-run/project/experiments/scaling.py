import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from src.sampler import uniform_points
from src.estimate import estimate_pi

NS = [100, 1000, 10000, 100000]
SEEDS = range(20)

mae = {n: sum(abs(estimate_pi(uniform_points(n, s)) - math.pi) for s in SEEDS) / len(SEEDS) for n in NS}

# log-log least squares slope
xs = [math.log(n) for n in NS]
ys = [math.log(mae[n]) for n in NS]
mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)

path = os.path.join(ROOT, "results", "scaling.json")
data = {}
if os.path.exists(path):
    with open(path) as f:
        data = json.load(f)
data["pseudo"] = {"mae": {str(n): v for n, v in mae.items()}, "slope": slope}
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(data, f, indent=2)
print(mae, slope)
