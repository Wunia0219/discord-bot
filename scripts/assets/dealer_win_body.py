"""Geometry and timing for the painted-source host win renderer.

The source body field and intact arm keep the same spatial contract. R6
calibrates only the timing and gesture amplitude against the retained idle:
one continuous, eased arc with a delayed hand, no reverse preparation or hold.
This helper does not draw artwork or establish visual/runtime acceptance.
"""
import math

SOURCE_SIZE = (1024, 1536)
PIVOT = (920.0, 650.0)
CONTACT_CORE_RADIUS = 200.0
CONTACT_OUTER_RADIUS = 370.0
LOWER_START = 420.0
LOWER_END = 1280.0
FREE_SHOULDER = (450.0, 410.0)
FPS = 30
FRAMES = 108
DURATION = FRAMES / FPS
BODY_PEAK_DEGREES = .95
FREE_ARM_PEAK_DEGREES = 6.5
END_POSE_TIME = (FRAMES - 1) / FPS


def smooth(value):
    value = max(0., min(1., value))
    return value ** 3 * (value * (value * 6. - 15.) + 10.)


def smooth_derivative(value):
    return 30. * value ** 2 * (1. - value) ** 2 if 0. < value < 1. else 0.


def body_weight_and_gradient(point):
    x, y = point
    dx, dy = x - PIVOT[0], y - PIVOT[1]
    radius = math.hypot(dx, dy)
    band = (radius - CONTACT_CORE_RADIUS) / (CONTACT_OUTER_RADIUS - CONTACT_CORE_RADIUS)
    contact = smooth(band)
    slope = smooth_derivative(band) / (CONTACT_OUTER_RADIUS - CONTACT_CORE_RADIUS)
    cx = slope * dx / radius if radius else 0.
    cy = slope * dy / radius if radius else 0.
    lower_band = (y - LOWER_START) / (LOWER_END - LOWER_START)
    lower = 1. - smooth(lower_band)
    lower_y = -smooth_derivative(lower_band) / (LOWER_END - LOWER_START)
    return contact * lower, (cx * lower, cy * lower + contact * lower_y)


def body_weight(point):
    return body_weight_and_gradient(point)[0]


def rigid(point, rad):
    dx, dy = point[0] - PIVOT[0], point[1] - PIVOT[1]
    c, s = math.cos(rad), math.sin(rad)
    return PIVOT[0] + c * dx - s * dy, PIVOT[1] + s * dx + c * dy


def forward(point, rad):
    weight = body_weight(point)
    target = rigid(point, rad)
    return tuple(point[axis] + weight * (target[axis] - point[axis]) for axis in (0, 1))


def jacobian(point, rad):
    weight, gradient = body_weight_and_gradient(point)
    c, s = math.cos(rad), math.sin(rad)
    delta = ((c - 1., -s), (s, c - 1.))
    target = rigid(point, rad)
    displacement = (target[0] - point[0], target[1] - point[1])
    return tuple(tuple((1. if row == column else 0.) + weight * delta[row][column]
                       + displacement[row] * gradient[column] for column in (0, 1))
                 for row in (0, 1))


def inverse(point, rad):
    if body_weight(point) == 0.:
        return point
    core = rigid(point, -rad)
    if body_weight(core) == 1.:
        return core
    current = point
    for _ in range(12):
        target = forward(current, rad)
        current = tuple(point[axis] - (target[axis] - current[axis]) for axis in (0, 1))
    return current


def free_arm_point(point, body_rad, gesture_rad):
    """Measure one intact arm pose; this function does not composite a plate."""
    target = forward(FREE_SHOULDER, body_rad)
    dx, dy = point[0] - FREE_SHOULDER[0], point[1] - FREE_SHOULDER[1]
    c, s = math.cos(body_rad + gesture_rad), math.sin(body_rad + gesture_rad)
    return target[0] + c * dx - s * dy, target[1] + s * dx + c * dy


def ramp(time, begin, end):
    return smooth((time - begin) / (end - begin))


def gesture_arc(time, rise_power, fall_power):
    """C2 at the neutral endpoints; one rounded peak, no flat hold interval.

    A shorter rise and longer release reads as one relaxed gesture. Different
    body/arm peak times provide follow-through without a second arm reversal.
    """
    u = time / END_POSE_TIME
    if not 0. < u < 1.:
        return 0.
    peak = rise_power / (rise_power + fall_power)
    normalizer = peak ** rise_power * (1. - peak) ** fall_power
    return u ** rise_power * (1. - u) ** fall_power / normalizer


def motion(time):
    # Body peaks at 1.338s, hand at 1.529s. The hand continues through the
    # turnaround instead of freezing at extension or repeating a rehab lift.
    body = gesture_arc(time, 3, 5)
    arm = gesture_arc(time, 3, 4)
    return {'bodyRad': math.radians(BODY_PEAK_DEGREES * body),
            'gestureRad': math.radians(FREE_ARM_PEAK_DEGREES * arm)}
