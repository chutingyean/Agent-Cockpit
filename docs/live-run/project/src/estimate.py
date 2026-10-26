def estimate_pi(points):
    inside = sum(1 for x, y in points if x * x + y * y < 1.0)
    return 4.0 * inside / len(points)
