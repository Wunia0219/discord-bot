"""Read-only numerical inspection of every rendered v4 source frame.

Example (run only after all frames and rig reports have been rendered):
  python scripts/assets/check-dealer-v4.py --allow-duplicates

Reads 96 retained idle / 108 new win PNGs and their renderer-produced
rig JSON. Writes one integrity report; it never exports atlases or modifies art,
rig data, placement, or manifests. Metrics cannot certify natural motion or
visual quality. Speed spikes and seam differences are diagnostic review flags.
"""

import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import statistics

from PIL import Image, ImageChops, ImageStat


ROOT = Path(__file__).resolve().parents[2]
EXPECTED = {'idle': 96, 'win': 108}
FPS = 30
TOLERANCE = 1e-6
SURFACE_RELATIVE_LIMIT = .03
SURFACE_MODEL = 'continuous-source-landmarks'
SURFACE_METRIC = 'continuous-surface-landmarks'
SURFACE_LIMBS = frozenset(('leg-a', 'leg-b', 'arm-right'))


def load_exporter():
    path = Path(__file__).with_name('export-dealer-v4.py')
    spec = importlib.util.spec_from_file_location('dealer_v4_export_contract', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def point(value):
    if not isinstance(value, (tuple, list)) or len(value) != 2:
        raise ValueError('Expected a finite 2D coordinate')
    result = tuple(float(v) for v in value)
    if not all(math.isfinite(v) for v in result):
        raise ValueError('Expected a finite 2D coordinate')
    return result


def distance(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def percentile(values, quantile):
    if not values:
        return None
    values = sorted(values)
    position = (len(values) - 1) * quantile
    low, high = math.floor(position), math.ceil(position)
    return values[low] + (values[high] - values[low]) * (position - low)


def scalar_summary(values):
    return {'count': len(values), 'minimum': min(values) if values else None,
            'maximum': max(values) if values else None,
            'median': statistics.median(values) if values else None,
            'p95': percentile(values, .95)}


def spike_limit(values, factor, floor):
    moving = [value for value in values if value > 1e-9]
    return max(floor, factor * statistics.median(moving)) if moving else floor


def series_metrics(samples, factor=8, floor=3):
    """Recompute vector velocities/accelerations without trusting renderer maxima."""
    samples = sorted(samples, key=lambda item: item['frame'])
    steps, accelerations = [], []
    previous_velocity, previous_interval = None, None
    for before, after in zip(samples, samples[1:]):
        frame_gap = after['frame'] - before['frame']
        if frame_gap <= 0:
            raise ValueError('Sample frame indices must increase')
        dt = frame_gap / FPS
        vector = tuple((after['point'][axis] - before['point'][axis]) / dt for axis in (0, 1))
        speed = math.hypot(*vector)
        step = {'fromFrame': before['frame'], 'toFrame': after['frame'],
                'frameGap': frame_gap, 'pxPerSecond': speed,
                'pxPerFrame': speed / FPS, 'velocityPxPerSecond': list(vector)}
        steps.append(step)
        if previous_velocity is not None:
            accelerations.append({'frame': after['frame'],
                                  'pxPerSecondSquared': distance(vector, previous_velocity) / ((previous_interval + dt) / 2)})
        previous_velocity = vector
        previous_interval = dt
    speeds = [step['pxPerFrame'] for step in steps]
    limit = spike_limit(speeds, factor, floor)
    return {'samples': len(samples), 'speedPxPerFrame': scalar_summary(speeds),
            'speedPxPerSecond': scalar_summary([step['pxPerSecond'] for step in steps]),
            'accelerationPxPerSecondSquared': scalar_summary([item['pxPerSecondSquared'] for item in accelerations]),
            'spikeThresholdPxPerFrame': limit,
            'spikes': [step for step in steps if step['pxPerFrame'] > limit],
            'steps': steps, 'accelerations': accelerations,
            'firstLastDistancePx': distance(samples[0]['point'], samples[-1]['point']) if samples else None}


def rendered_index(path, fallback):
    match = re.search(r'(\d+)\.png$', path.name, re.IGNORECASE)
    return int(match.group(1)) if match else fallback


def flattened(image):
    background = Image.new('RGBA', image.size, (24, 17, 27, 255))
    background.alpha_composite(image)
    return background.convert('RGB')


def image_difference(first, second, first_alpha, second_alpha):
    means = ImageStat.Stat(ImageChops.difference(first, second)).mean
    alpha_difference = ImageChops.difference(first_alpha, second_alpha)
    histogram = alpha_difference.histogram()
    return {'rgbMeanAbsoluteDifference0to255': sum(means) / 3,
            'alphaMeanAbsoluteDifference0to255': ImageStat.Stat(alpha_difference).mean[0],
            'fractionPixelsAlphaDifferenceAbove24': sum(histogram[25:]) / (first.width * first.height)}


def pixel_continuity(paths, factor=8):
    steps, first_rgb, first_alpha, previous_rgb, previous_alpha = [], None, None, None, None
    previous_index = None
    for ordinal, path in enumerate(paths):
        index = rendered_index(path, ordinal)
        with Image.open(path) as image:
            rgb, alpha = flattened(image), image.getchannel('A')
        if first_rgb is None:
            first_rgb, first_alpha = rgb.copy(), alpha.copy()
        if previous_rgb is not None:
            difference = image_difference(previous_rgb, rgb, previous_alpha, alpha)
            steps.append({'fromFrame': previous_index, 'toFrame': index,
                          'frameGap': index - previous_index, **difference})
        previous_rgb, previous_alpha, previous_index = rgb, alpha, index
    values = [item['rgbMeanAbsoluteDifference0to255'] for item in steps]
    limit = spike_limit(values, factor, .05)
    seam = image_difference(first_rgb, previous_rgb, first_alpha, previous_alpha) if first_rgb is not None else None
    return {'backgroundRgb': [24, 17, 27], 'nativeResolution': True,
            'adjacentRgbMeanAbsoluteDifference0to255': scalar_summary(values),
            'rgbSpikeThreshold0to255': limit,
            'spikes': [item for item in steps if item['rgbMeanAbsoluteDifference0to255'] > limit],
            'adjacentSteps': steps, 'lastToFirst': seam,
            'note': 'Pixel differences are diagnostics, not a measure of identity, drawing quality or natural motion.'}


def inspect_rig(clip, path, source, args):
    errors, warnings = [], []
    if not path.exists():
        return {'available': False}, [f'{clip}: missing rig report {path}'], [], {}
    data = json.loads(path.read_text(encoding='utf8'))
    expected = EXPECTED[clip]
    if data.get('count') != expected or data.get('fps') != FPS:
        errors.append(f'{clip}: rig report count/fps does not match {expected}/30')
    raw_rows = data.get('frames', [])
    rows = {}
    for row in raw_rows:
        index = row.get('frame')
        if not isinstance(index, int) or index in rows:
            errors.append(f'{clip}: duplicate or invalid rig frame index {index}')
            continue
        rows[index] = row
    missing = sorted(set(range(expected)) - rows.keys())
    extra = sorted(rows.keys() - set(range(expected)))
    if missing or extra:
        errors.append(f'{clip}: rig frame coverage missing={missing}, extra={extra}')
    rest = source.get('restJoints', {})
    if not rest:
        errors.append(f'{clip}: rig source has no restJoints')
    if clip == 'win' and not (SURFACE_LIMBS | {'arm-left'}).issubset(rest):
        errors.append(f'{clip}: rig source must include both leg chains and both arm chains')
    samples, bone_records, support, wrist, contact, branch_history = {}, [], [], [], [], {}
    for index, row in sorted(rows.items()):
        if abs(float(row.get('timeMs', math.inf)) - index / FPS * 1000) > 1e-4:
            errors.append(f'{clip}: frame {index} timeMs differs from 30 fps')
        geometry_model = row.get('geometryModel')
        if clip == 'win' and geometry_model != SURFACE_MODEL:
            errors.append(f'{clip}: frame {index} geometryModel must be {SURFACE_MODEL}')
        try:
            samples.setdefault('root', []).append({'frame': index, 'point': point(row['root'])})
            for limb, rest_points in rest.items():
                segment = row[limb]
                hip, knee, ankle = [point(segment[key]) for key in ('hip', 'knee', 'ankle')]
                original = [point(p) for p in rest_points]
                if len(original) != 3:
                    raise ValueError(f'{limb} requires three source landmarks')
                expected_lengths = [distance(original[0], original[1]), distance(original[1], original[2])]
                actual_lengths = [distance(hip, knee), distance(knee, ankle)]
                if (not all(math.isfinite(value) and value > 0 for value in expected_lengths)
                        or not all(math.isfinite(value) for value in actual_lengths)):
                    raise ValueError(f'{limb} has invalid source or mapped segment lengths')
                error = max(abs(a - b) for a, b in zip(actual_lengths, expected_lengths))
                relative_changes = [abs(a - b) / b for a, b in zip(actual_lengths, expected_lengths)]
                stated_lengths = segment.get('lengths', [])
                stated_error = math.inf
                if isinstance(stated_lengths, (list, tuple)) and len(stated_lengths) == 2:
                    reference_values = [float(value) for value in stated_lengths]
                    if all(math.isfinite(value) for value in reference_values):
                        stated_error = max(abs(a-b) for a, b in zip(reference_values, expected_lengths))
                try:
                    reported_error = float(segment.get('boneError', math.nan))
                except (TypeError, ValueError):
                    reported_error = math.nan
                valid_reported_error = math.isfinite(reported_error) and reported_error >= 0
                reported_error_delta = abs(reported_error-error) if valid_reported_error else None
                error_consistent = valid_reported_error and reported_error_delta <= TOLERANCE
                declared_metric = segment.get('metricType')
                expected_metric = SURFACE_METRIC if limb in SURFACE_LIMBS else 'rigid-limb'
                if clip == 'win' and declared_metric != expected_metric:
                    errors.append(f'{clip}: frame {index} {limb} metricType must be {expected_metric}')
                is_surface = (clip == 'win' and geometry_model == SURFACE_MODEL
                              and limb in SURFACE_LIMBS and declared_metric == SURFACE_METRIC)
                bone_records.append({'frame': index, 'limb': limb, 'recomputedErrorPx': error,
                                     'restLengthsPx': expected_lengths, 'actualLengthsPx': actual_lengths,
                                     'geometryModel': geometry_model, 'rendererDeclaredMetricType': declared_metric,
                                     'enforcedMetricType': SURFACE_METRIC if is_surface else 'rigid-limb',
                                     'relativeSegmentLengthChanges': relative_changes,
                                     'maximumRelativeSegmentLengthChange': max(relative_changes),
                                     'relativeLimitApplied': SURFACE_RELATIVE_LIMIT if is_surface else None,
                                     'rendererReportedErrorPx': reported_error if valid_reported_error else None,
                                     'rendererReportedErrorDifferencePx': reported_error_delta,
                                     'rendererReportedErrorConsistent': error_consistent,
                                     'statedReferenceLengthErrorPx': stated_error if math.isfinite(stated_error) else None})
                if not error_consistent:
                    errors.append(f'{clip}: frame {index} {limb} reported boneError does not match recomputed absolute length difference within 1e-6')
                if stated_error > TOLERANCE:
                    errors.append(f'{clip}: frame {index} {limb} reference lengths differ from source rest lengths')
                if is_surface:
                    if max(relative_changes) > SURFACE_RELATIVE_LIMIT + 1e-12:
                        errors.append(f'{clip}: frame {index} {limb} continuous-surface landmark relative length change exceeds 0.03')
                elif error > TOLERANCE:
                    errors.append(f'{clip}: frame {index} {limb} fixed bone length error exceeds 1e-6')
                for joint, coordinate in zip(('hip', 'knee', 'ankle'), (hip, knee, ankle)):
                    samples.setdefault(f'{limb}.{joint}', []).append({'frame': index, 'point': coordinate})
                cross = (ankle[0] - hip[0]) * (knee[1] - hip[1]) - (ankle[1] - hip[1]) * (knee[0] - hip[0])
                branch_history.setdefault(limb, []).append({'frame': index, 'side': 1 if cross > TOLERANCE else -1 if cross < -TOLERANCE else 0})
                if limb == args.support_limb:
                    support.append({'frame': index, 'displacementPx': distance(ankle, original[2])})
                if limb == args.contact_limb:
                    wrist.append({'frame': index, 'displacementPx': distance(ankle, original[2])})
            value = float(row.get('contactSlipPx', math.nan))
            if not math.isfinite(value) or value < 0:
                errors.append(f'{clip}: frame {index} has invalid reported contactSlipPx')
            else:
                contact.append({'frame': index, 'reportedSlipPx': value})
        except (KeyError, TypeError, ValueError) as error:
            errors.append(f'{clip}: frame {index} invalid/missing rig geometry: {error}')
    branch_flips = {}
    for limb, history in branch_history.items():
        nonzero = [item for item in history if item['side']]
        flips = [{'fromFrame': before['frame'], 'toFrame': after['frame']}
                 for before, after in zip(nonzero, nonzero[1:]) if before['side'] != after['side']]
        if flips:
            branch_flips[limb] = flips
            errors.append(f'{clip}: {limb} landmark branch side changed; see listed transitions')
    max_support = max((item['displacementPx'] for item in support), default=None)
    max_wrist = max((item['displacementPx'] for item in wrist), default=None)
    max_contact = max((item['reportedSlipPx'] for item in contact), default=None)
    if max_support is None:
        errors.append(f'{clip}: support limb {args.support_limb} not measured')
    elif max_support > args.support_tolerance:
        errors.append(f'{clip}: support ankle displacement {max_support}px exceeds tolerance')
    if max_wrist is None:
        errors.append(f'{clip}: contact limb {args.contact_limb} not measured')
    elif max_wrist > args.contact_tolerance:
        errors.append(f'{clip}: fixed contact wrist displacement {max_wrist}px exceeds tolerance')
    if max_contact is not None and max_contact > args.contact_tolerance:
        errors.append(f'{clip}: renderer contact probe slip {max_contact}px exceeds tolerance')
    trajectories = {name: series_metrics(values, args.spike_factor, args.speed_floor)
                    for name, values in samples.items()}
    spike_joints = {name: values['spikes'] for name, values in trajectories.items() if values['spikes']}
    if spike_joints:
        warnings.append(f'{clip}: velocity spikes are numerical review flags; see jointTrajectories')
    endpoints = {name: {'first': values[0], 'last': values[-1]}
                 for name, values in samples.items() if values}
    seam = max((metric['firstLastDistancePx'] for metric in trajectories.values()
                if metric['firstLastDistancePx'] is not None), default=None)
    if seam is not None and seam > args.endpoint_tolerance:
        errors.append(f'{clip}: first/last joint distance {seam}px exceeds endpoint tolerance')
    report = {'available': True, 'sourceReport': str(path), 'renderedRows': len(rows),
              'missingFrames': missing, 'extraFrames': extra,
              'maxRecomputedBoneErrorPx': max((item['recomputedErrorPx'] for item in bone_records), default=None),
              'maxRecomputedRigidLimbErrorPx': max((item['recomputedErrorPx'] for item in bone_records if item['enforcedMetricType'] == 'rigid-limb'), default=None),
              'maxContinuousSurfaceRelativeLengthChange': max((item['maximumRelativeSegmentLengthChange'] for item in bone_records if item['enforcedMetricType'] == SURFACE_METRIC), default=None),
              'maximumReportedErrorDisagreementPx': max((item['rendererReportedErrorDifferencePx'] for item in bone_records if item['rendererReportedErrorDifferencePx'] is not None), default=None),
              'geometryModelsObserved': sorted({str(row.get('geometryModel')) for row in rows.values()}),
              'lengthMetricPolicy': {'idle': 'Every limb retains the absolute fixed-length 1e-6px gate, regardless of declared metric metadata.',
                                     'win': 'Only leg-a, leg-b and arm-right with the exact continuous-source model/metric use per-segment relative length change <=0.03. These are painted-surface landmarks, not a fully rigid skeleton.',
                                     'freeArm': 'The intact arm-left stays rigid at absolute 1e-6px.',
                                     'reportedError': 'Every metric must truthfully report the recomputed maximum absolute difference from source rest segment lengths within 1e-6px.',
                                     'legacyMaximumField': 'maxRecomputedBoneErrorPx aggregates both metric classes; a nonzero surface landmark difference is not described as rigid bone motion.'},
              'boneChecks': bone_records, 'supportLimb': args.support_limb,
              'maxSupportAnkleDisplacementPx': max_support, 'supportAnklePerFrame': support,
              'contactLimb': args.contact_limb, 'maxContactWristDisplacementPx': max_wrist,
              'contactWristPerFrame': wrist, 'maxRendererReportedContactSlipPx': max_contact,
              'rendererContactProbePerFrame': contact, 'branchFlips': branch_flips,
              'jointTrajectories': trajectories, 'firstLastMaximumJointDistancePx': seam,
              'contactLimitations': 'Wrist/support distances are recomputed from joint coordinates. contactSlipPx is the renderer geometric probe, not an independent pixel/surface contact measurement.'}
    return report, errors, warnings, endpoints


def inspect_manifest(path, exporter, require=False):
    if not path.exists():
        return {'available': False}, ([f'Missing required manifest {path}'] if require else []), ['Manifest not yet exported; source/rig checks can still run.']
    errors, warnings = [], []
    manifest = json.loads(path.read_text(encoding='utf8'))
    try:
        exporter.merge_manifest_data(manifest, 'idle')
    except ValueError as error:
        errors.append(str(error))
    if require:
        missing = sorted(set(EXPECTED) - set(manifest.get('clips', {})))
        if missing:
            errors.append(f'Manifest missing required clips: {missing}')
    checks = {}
    for name, clip in manifest.get('clips', {}).items():
        keys, durations, page_checks = [], {}, []
        for page in clip.get('pages', []):
            file = page.get('file', '')
            size = page.get('meta', {}).get('size', {})
            if Path(file).name != file:
                errors.append(f'{name}: atlas filename must be local, got {file}')
                continue
            expected_size = [1152, 1664]
            actual_size = None
            atlas = path.parent / file
            if not atlas.exists():
                errors.append(f'{name}: missing atlas {atlas}')
            else:
                with Image.open(atlas) as image:
                    actual_size = list(image.size)
                if actual_size != expected_size:
                    errors.append(f'{name}: atlas {file} size differs from 2x2 contract')
            if [size.get('w'), size.get('h')] != expected_size:
                errors.append(f'{name}: atlas metadata {file} size differs from 2x2 contract')
            used_cells = set()
            for key, drawing in page.get('frames', {}).items():
                rect = drawing.get('frame', {})
                x, y, width, height = [rect.get(field, -1) for field in ('x', 'y', 'w', 'h')]
                if (width, height) != (576, 832) or x not in (0, 576) or y not in (0, 832):
                    errors.append(f'{name}: invalid atlas rectangle for {key}')
                if (x, y) in used_cells:
                    errors.append(f'{name}: overlapping atlas cell for {key}')
                used_cells.add((x, y))
                if (drawing.get('sourceSize') != {'w': 576, 'h': 832}
                        or drawing.get('spriteSourceSize') != {'x': 0, 'y': 0, 'w': 576, 'h': 832}):
                    errors.append(f'{name}: inconsistent full-canvas texture metadata for {key}')
                value = drawing.get('durationMs')
                if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                    errors.append(f'{name}: invalid durationMs for {key}')
                else:
                    durations[key] = value
                    if abs(value - 1000 / FPS) > 1e-6:
                        errors.append(f'{name}: frame {key} duration differs from fixed 30 fps')
                keys.append(key)
            page_checks.append({'file': file, 'size': actual_size,
                                'estimatedRgbaBytesNoMipmaps': 1152 * 1664 * 4})
        order = clip.get('order', keys)
        if len(keys) != len(set(keys)) or any(key not in durations for key in order):
            errors.append(f'{name}: duplicate drawing keys or invalid playback references')
        expected = EXPECTED.get(name)
        if expected is not None and (clip.get('frames') != expected or len(keys) != expected or len(order) != expected):
            errors.append(f'{name}: manifest source/playback count differs from {expected}')
        total = sum(durations.get(key, 0) for key in order)
        if abs(total - clip.get('durationMs', math.inf)) > 1e-4:
            errors.append(f'{name}: total per-frame timing differs from clip durationMs')
        checks[name] = {'drawings': len(keys), 'playbackFrames': len(order), 'durationMs': total,
                        'pages': page_checks,
                        'estimatedAllPagesRgbaBytesNoMipmaps': len(page_checks) * 1152 * 1664 * 4,
                        'preservedMetadata': {key: clip[key] for key in ('placement', 'source', 'provenance') if key in clip}}
    metadata = {key: manifest[key] for key in ('placement', 'source', 'provenance') if key in manifest}
    for key in ('placement', 'source', 'provenance'):
        if key not in manifest:
            warnings.append(f'Manifest root has no {key}; no value was inferred or written by this checker.')
    return {'available': True, 'path': str(path), 'clips': checks,
            'preservedRootMetadata': metadata}, errors, warnings


def arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--frames-root', type=Path, default=ROOT / 'art/dealer/v4/frames')
    parser.add_argument('--rig-source', type=Path, default=ROOT / 'art/dealer/v4/rig-source.json')
    parser.add_argument('--rig-reports', type=Path, default=ROOT / 'test-results/dealer-v4')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'images/dealer/v4/dealer.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'test-results/dealer-v4/integrity-report.json')
    parser.add_argument('--clips', nargs='+', choices=tuple(EXPECTED), default=list(EXPECTED))
    parser.add_argument('--allow-duplicates', action='store_true', help='Match exporter explicit hold permission; duplicates are always listed')
    parser.add_argument('--require-manifest', action='store_true', help='Require the complete retained-clip atlas manifest and all page files')
    parser.add_argument('--support-limb', default='leg-a')
    parser.add_argument('--contact-limb', default='arm-right')
    parser.add_argument('--support-tolerance', type=float, default=1e-6)
    parser.add_argument('--contact-tolerance', type=float, default=3)
    parser.add_argument('--endpoint-tolerance', type=float, default=3, help='Hard first/last and common-stance joint tolerance in source px')
    parser.add_argument('--spike-factor', type=float, default=8)
    parser.add_argument('--speed-floor', type=float, default=3, help='Minimum joint spike threshold in source px/frame')
    return parser.parse_args()


def main():
    args = arguments()
    if any(not math.isfinite(value) or value < 0 for value in (args.support_tolerance, args.contact_tolerance, args.endpoint_tolerance, args.spike_factor, args.speed_floor)):
        raise ValueError('Tolerances and spike thresholds must be finite and nonnegative')
    exporter = load_exporter()
    errors, warnings = [], []
    source = json.loads(args.rig_source.read_text(encoding='utf8'))
    if source.get('canvas') != [1152, 1664] or source.get('fps') != FPS:
        errors.append('Rig source canvas/fps differs from exporter v4 contract')
    report = {'version': 4, 'expectedFrames': EXPECTED, 'fps': FPS, 'clips': {},
              'rigSource': str(args.rig_source),
              'rigSourceSha256': hashlib.sha256(args.rig_source.read_bytes()).hexdigest(),
              'acceptance': 'NOT A VISUAL PASS. Numerical integrity, rig metadata and pixel-change diagnostics only. Manual full-frame review and actual browser playback remain required.',
              'thresholds': {'boneLengthTolerancePx': TOLERANCE,
                             'rigidBoneLengthTolerancePx': TOLERANCE,
                             'reportedAbsoluteLengthErrorConsistencyPx': TOLERANCE,
                             'winSurfaceRelativeSegmentLengthLimit': SURFACE_RELATIVE_LIMIT,
                             'surfaceLimitScope': 'win continuous-source-landmarks model; leg-a/leg-b/arm-right continuous-surface-landmarks only',
                             'supportTolerancePx': args.support_tolerance,
                             'contactTolerancePx': args.contact_tolerance, 'endpointHardTolerancePx': args.endpoint_tolerance,
                             'speedSpikeFactor': args.spike_factor, 'minimumSpeedSpikePxPerFrame': args.speed_floor}}
    endpoints, frame_paths = {}, {}
    for clip in args.clips:
        directory = args.frames_root / clip
        paths = sorted((path for path in directory.glob('*.png') if path.is_file()), key=exporter.natural_key)
        indices = [rendered_index(path, index) for index, path in enumerate(paths)]
        expected_indices = list(range(EXPECTED[clip]))
        if indices != expected_indices:
            errors.append(f'{clip}: PNG frame sequence is not exactly 0..{EXPECTED[clip] - 1}; present={indices}')
        try:
            integrity = exporter.inspect_sources(paths, clip, 'draft', args.allow_duplicates)
        except (OSError, ValueError) as error:
            integrity = {'frames': [], 'errors': [f'Could not inspect PNG sources: {error}']}
        errors.extend(f'{clip}: {error}' for error in integrity['errors'])
        valid_frames = bool(paths and len(paths) == len(integrity['frames']) and all('sha256DecodedRGBA' in row for row in integrity['frames']))
        pixel_report = pixel_continuity(paths, args.spike_factor) if valid_frames else {'available': False}
        if pixel_report.get('spikes'):
            warnings.append(f'{clip}: adjacent pixel-change spikes require inspection; see pixelContinuity')
        same_end = bool(integrity['frames'] and integrity['frames'][0].get('sha256DecodedRGBA') == integrity['frames'][-1].get('sha256DecodedRGBA'))
        try:
            rig, rig_errors, rig_warnings, endpoints[clip] = inspect_rig(clip, args.rig_reports / f'{clip}-rig.json', source, args)
        except (OSError, ValueError, TypeError) as error:
            rig, rig_errors, rig_warnings, endpoints[clip] = {'available': False}, [f'{clip}: could not inspect rig report: {error}'], [], {}
        errors.extend(rig_errors)
        warnings.extend(rig_warnings)
        frame_paths[clip] = paths if valid_frames else []
        report['clips'][clip] = {'sourceIntegrity': integrity, 'pixelContinuity': pixel_report,
                                 'identicalFirstLastDecodedFrame': same_end, 'rig': rig}
    compatibility = {}
    reference = frame_paths.get('idle', [])
    if reference:
        with Image.open(reference[0]) as image:
            reference_rgb, reference_alpha = flattened(image), image.getchannel('A')
        for clip, paths in frame_paths.items():
            if not paths:
                continue
            compatibility[clip] = {}
            for label, path in (('first', paths[0]), ('last', paths[-1])):
                with Image.open(path) as image:
                    difference = image_difference(reference_rgb, flattened(image), reference_alpha, image.getchannel('A'))
                joint_distances = {name: distance(values[label]['point'], endpoints['idle'][name]['first']['point'])
                                   for name, values in endpoints[clip].items() if name in endpoints.get('idle', {})}
                maximum = max(joint_distances.values(), default=None)
                compatibility[clip][label] = {'versus': 'idle first frame', **difference,
                                              'jointDistancesPx': joint_distances, 'maxJointDistancePx': maximum}
                if maximum is not None and maximum > args.endpoint_tolerance:
                    errors.append(f'{clip}: {label} endpoint differs from idle first joints by {maximum}px, exceeding endpoint tolerance')
    report['commonStanceCompatibility'] = compatibility
    try:
        manifest, manifest_errors, manifest_warnings = inspect_manifest(args.manifest, exporter, args.require_manifest)
    except (OSError, ValueError, TypeError, KeyError) as error:
        manifest, manifest_errors, manifest_warnings = {'available': False}, [f'Could not inspect v4 manifest: {error}'], []
    report['manifestInterface'] = manifest
    errors.extend(manifest_errors)
    warnings.extend(manifest_warnings)
    report.update({'errors': errors, 'reviewFlags': warnings, 'numericalIntegrityPassed': not errors,
                   'visualReviewPassed': None, 'atlasOrSourceFilesModified': False})
    exporter.atomic_json(args.output, report)
    print(json.dumps({'numericalIntegrityPassed': not errors, 'errors': len(errors),
                      'reviewFlags': len(warnings), 'report': str(args.output), 'visualReviewPassed': None}, ensure_ascii=False))
    raise SystemExit(1 if errors else 0)


if __name__ == '__main__':
    main()
