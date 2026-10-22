"""Single-source continuous body sampling; no overlapping character plates.

Only the source coordinate map changes. Face/neck/collars share a rigid
transform, supported joints/feet stay fixed and clothing absorbs the small
continuous transition. This is geometry/resampling, not painted anatomy.
"""
import math
from PIL import Image

PIVOT = (620.0, 425.0)
GRID = 8


def smooth(value):
    value = max(0.0, min(1.0, value))
    return value**3 * (value * (value * 6.0 - 15.0) + 10.0)


def body_weight(point):
    x, y = point
    if y <= 240.0:
        return 1.0
    if y >= 650.0:
        return 0.0
    # All of the neck and both collars remain inside the rigid moving core.
    # No RGBA crossfade, pin or ownership line passes through that structure.
    start = 720.0 - 70.0 * smooth((y - 260.0) / 80.0)
    fixed_side = smooth((x - start) / (749.0 - start)) * smooth((y - 240.0) / 120.0)
    waist = 1.0 - smooth((y - 450.0) / 200.0)
    return (1.0 - fixed_side) * waist


def rigid(point, rad):
    x, y = point
    dx, dy = x - PIVOT[0], y - PIVOT[1]
    c, s = math.cos(rad), math.sin(rad)
    return PIVOT[0] + c * dx - s * dy, PIVOT[1] + s * dx + c * dy


def forward(point, rad):
    target = rigid(point, rad)
    weight = body_weight(point)
    return tuple(point[a] + weight * (target[a] - point[a]) for a in (0, 1))


def inverse(point, rad):
    if body_weight(point) == 0.0:
        return point
    core = rigid(point, -rad)
    if body_weight(core) == 1.0:
        return core
    x, y = point
    for _ in range(8):
        mapped = forward((x, y), rad)
        x, y = point[0] - (mapped[0] - x), point[1] - (mapped[1] - y)
    return x, y


def sample_body(source, rad, grid=GRID):
    """A common inverse map samples the source once with premultiplied alpha.

    Shared mesh vertices have identical source coordinates. The 8px sampling
    grid approximates the smooth analytic map, rather than joining images or
    warping last frame. Outside the small motion region coordinates are exact.
    """
    if abs(rad) < 1e-14:
        return source.convert('RGBa').convert('RGBA')
    width, height = source.size
    xs, ys = list(range(0, width, grid)), list(range(0, height, grid))
    xs.append(width); ys.append(height)
    vertices = {(x, y): inverse((x, y), rad) for y in ys for x in xs}
    cells = []
    for top, bottom in zip(ys, ys[1:]):
        for left, right in zip(xs, xs[1:]):
            quad = sum((vertices[p] for p in ((left, top), (left, bottom), (right, bottom), (right, top))), ())
            cells.append(((left, top, right, bottom), quad))
    return source.convert('RGBa').transform(source.size, Image.Transform.MESH, cells,
        resample=Image.Resampling.BICUBIC).convert('RGBA')


def sample_rigid(source, source_pivot, target_pivot, rad):
    c, s = math.cos(rad), math.sin(rad)
    sx, sy = source_pivot; tx, ty = target_pivot
    inverse_matrix = (c, s, sx-c*tx-s*ty, -s, c, sy+s*tx-c*ty)
    return source.convert('RGBa').transform(source.size, Image.Transform.AFFINE,
        inverse_matrix, resample=Image.Resampling.BICUBIC).convert('RGBA')
