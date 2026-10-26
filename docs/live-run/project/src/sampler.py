import random


def uniform_points(n, seed):
    rng = random.Random(seed)
    return [(rng.random(), rng.random()) for _ in range(n)]


def halton_points(n, skip=0):
    """Return n base-2/base-3 Halton points, skipping from index 1."""
    if n < 0 or skip < 0:
        raise ValueError("n and skip must be non-negative")

    def radical_inverse(index, base):
        value = 0.0
        place = 1.0
        while index:
            index, digit = divmod(index, base)
            place /= base
            value += digit * place
        return value

    return [
        (radical_inverse(i, 2), radical_inverse(i, 3))
        for i in range(skip + 1, skip + n + 1)
    ]
