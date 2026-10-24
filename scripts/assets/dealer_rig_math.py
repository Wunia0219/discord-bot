"""Geometry and compositing helpers for supplied character layers.

This module does not read/write source files, generate drawings, construct body
parts, repaint clothing, or provide a CLI. Its only image geometry operation is
rigid rotation plus translation. Callers supply the actual artwork and masks.

Coordinates use the image's continuous coordinate space: x points right and y
points down. Positive angles therefore look clockwise on the screen. Angles
are radians throughout. Pixel centers are at (x + 0.5, y + 0.5).
"""

import math

from PIL import Image, ImageChops


_TOLERANCE = 1e-6


def _point(value, name):
    try:
        x, y = value
        x, y = float(x), float(y)
    except (TypeError, ValueError) as error:
        raise ValueError(f'{name} must contain exactly two finite coordinates') from error
    if not math.isfinite(x) or not math.isfinite(y):
        raise ValueError(f'{name} must contain exactly two finite coordinates')
    return x, y


def _size(value):
    try:
        width, height = value
    except (TypeError, ValueError) as error:
        raise ValueError('Image size must contain two positive integers') from error
    if (not isinstance(width, int) or not isinstance(height, int)
            or isinstance(width, bool) or isinstance(height, bool)
            or width <= 0 or height <= 0):
        raise ValueError('Image size must contain two positive integers')
    return width, height


def distance(a, b):
    """Euclidean distance between two finite 2D points."""
    ax, ay = _point(a, 'a')
    bx, by = _point(b, 'b')
    return math.hypot(bx - ax, by - ay)


def angle(a, b):
    """Direction from a to b, in radians; coincident points have no direction."""
    ax, ay = _point(a, 'a')
    bx, by = _point(b, 'b')
    if ax == bx and ay == by:
        raise ValueError('Cannot determine angle between coincident points')
    return math.atan2(by - ay, bx - ax)


def rotate(point, pivot, rad):
    """Rotate one point rigidly around pivot without scaling its distance."""
    x, y = _point(point, 'point')
    px, py = _point(pivot, 'pivot')
    rad = float(rad)
    if not math.isfinite(rad):
        raise ValueError('Rotation must be finite radians')
    cosine, sine = math.cos(rad), math.sin(rad)
    dx, dy = x - px, y - py
    return px + cosine * dx - sine * dy, py + sine * dx + cosine * dy


def solve_ik(hip, ankle, length1, length2, hintKnee):
    """Return the fixed-length two-bone knee nearest the supplied branch hint.

    Hip and ankle remain supplied target points. Unreachable extension or
    folding raises ValueError; lengths are never stretched. A 1e-6 absolute
    tolerance accommodates floating-point error at the reach limits.

    The two circle intersections are selected by proximity to hintKnee, which
    is equivalent to selecting its side of the hip->ankle axis. A collinear
    hint is ambiguous and deterministically picks the positive perpendicular
    branch. For coincident equal-length endpoints the hint supplies direction.
    """
    hx, hy = _point(hip, 'hip')
    ax, ay = _point(ankle, 'ankle')
    kx, ky = _point(hintKnee, 'hintKnee')
    length1, length2 = float(length1), float(length2)
    if not all(math.isfinite(length) and length > 0 for length in (length1, length2)):
        raise ValueError('Bone lengths must be finite and greater than zero')
    dx, dy = ax - hx, ay - hy
    separation = math.hypot(dx, dy)
    lower, upper = abs(length1 - length2), length1 + length2
    if separation < lower - _TOLERANCE or separation > upper + _TOLERANCE:
        raise ValueError(f'Unreachable ankle: separation {separation} outside [{lower}, {upper}]; bones cannot stretch')
    if separation <= _TOLERANCE:
        hint_distance = math.hypot(kx - hx, ky - hy)
        if hint_distance <= _TOLERANCE:
            raise ValueError('Coincident endpoints require a noncoincident knee hint')
        knee = (hx + length1 * (kx - hx) / hint_distance,
                hy + length1 * (ky - hy) / hint_distance)
    else:
        ux, uy = dx / separation, dy / separation
        along = (length1 * length1 - length2 * length2 + separation * separation) / (2 * separation)
        # Only rounding at an accepted reach boundary may place the projection
        # a few ulps outside the first circle. This does not resize either bone.
        along = max(-length1, min(length1, along))
        height = math.sqrt(max(0.0, length1 * length1 - along * along))
        base = (hx + ux * along, hy + uy * along)
        positive = (base[0] - uy * height, base[1] + ux * height)
        negative = (base[0] + uy * height, base[1] - ux * height)
        positive_distance = math.hypot(positive[0] - kx, positive[1] - ky)
        negative_distance = math.hypot(negative[0] - kx, negative[1] - ky)
        knee = positive if positive_distance <= negative_distance else negative
    if (abs(math.hypot(knee[0] - hx, knee[1] - hy) - length1) > _TOLERANCE
            or abs(math.hypot(knee[0] - ax, knee[1] - ay) - length2) > _TOLERANCE):
        raise ValueError('No fixed-length IK solution within numerical tolerance')
    return knee


def transform_layer(layer, sourcePivot, targetPivot, angleRad, outputSize=None):
    """Rigidly rotate/translate supplied pixels onto a transparent canvas.

    sourcePivot maps exactly to targetPivot. outputSize changes the receiving
    canvas only; it never changes pixel scale. No auto-expand, auto-crop, shear,
    mesh, or anatomy reconstruction is performed. Callers must keep artwork
    within their chosen output canvas.
    """
    sx, sy = _point(sourcePivot, 'sourcePivot')
    tx, ty = _point(targetPivot, 'targetPivot')
    angleRad = float(angleRad)
    if not math.isfinite(angleRad):
        raise ValueError('Rotation must be finite radians')
    size = _size(layer.size if outputSize is None else outputSize)
    cosine, sine = math.cos(angleRad), math.sin(angleRad)
    # Pillow samples destination -> source, so use the inverse rigid matrix.
    inverse = (cosine, sine, sx - cosine * tx - sine * ty,
               -sine, cosine, sy + sine * tx - cosine * ty)
    return layer.convert('RGBA').transform(
        size, Image.Transform.AFFINE, inverse,
        resample=Image.Resampling.BICUBIC, fillcolor=(0, 0, 0, 0))


def axis_mask(size, joint, axisVector, side, overlapPx):
    """Return an L-mode half-plane coverage mask for supplied layer splitting.

    axisVector is normalized internally. 'lower' (or +1) selects its positive
    direction, and 'upper' (or -1) selects its negative direction. overlapPx is
    the total width shared by the two masks, centered on the joint plane; each
    side extends overlapPx/2 across the joint. It is a geometric mask only and
    does not create a limb, skin, or replacement clothing pixels.
    """
    width, height = _size(size)
    jx, jy = _point(joint, 'joint')
    vx, vy = _point(axisVector, 'axisVector')
    magnitude = math.hypot(vx, vy)
    if magnitude == 0:
        raise ValueError('axisVector must have nonzero length')
    nx, ny = vx / magnitude, vy / magnitude
    if side in ('upper', -1):
        sign = -1
    elif side in ('lower', 1):
        sign = 1
    else:
        raise ValueError("side must be 'upper'/-1 or 'lower'/+1")
    overlapPx = float(overlapPx)
    if not math.isfinite(overlapPx) or overlapPx < 0:
        raise ValueError('overlapPx must be finite and nonnegative')
    threshold = overlapPx / 2
    pixels = bytearray(width * height)
    for y in range(height):
        row_distance = (y + 0.5 - jy) * ny
        for x in range(width):
            signed_distance = (x + 0.5 - jx) * nx + row_distance
            if sign * signed_distance >= -threshold:
                pixels[y * width + x] = 255
    return Image.frombytes('L', (width, height), bytes(pixels))


def masked(layer, mask):
    """Return a copy with coverage multiplied by its existing alpha channel.

    L/1 masks represent coverage directly. RGBA/LA masks use their alpha, not
    their visible RGB/luminance. Original color and input images are untouched.
    """
    if layer.size != mask.size:
        raise ValueError('Layer and mask must have the same canvas size')
    if mask.mode in ('L', '1'):
        coverage = mask.convert('L')
    elif mask.mode in ('RGBA', 'LA'):
        coverage = mask.getchannel('A')
    else:
        raise ValueError('Mask must be L/1 coverage or an RGBA/LA alpha mask')
    result = layer.convert('RGBA').copy()
    result.putalpha(ImageChops.multiply(result.getchannel('A'), coverage))
    return result
