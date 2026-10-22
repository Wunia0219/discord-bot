"""Encode numbered revision previews from supplied v4 WebP frame sequences.

Exactly one HD-to-preview downsample is performed per supplied frame. No pose
generation, cropping, registration, reversed playback or atlas export occurs.
The WebP encoder may coalesce identical holds; report coded frames separately
from source/render samples. These are previews, not newly drawn animation art.
"""
import argparse
import bisect
import hashlib
import json
from pathlib import Path
import struct
import uuid

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[2]
SIZES = ((1152, 1664), (576, 832))
COUNTS = {'idle': 96, 'win': 108}
SAMPLES = {'idle': (0, 24, 38, 60, 95), 'win': (0, 14, 31, 44, 50, 65, 80, 107)}


def positive_revision(value):
    try:
        revision = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError('revision must be a positive integer') from error
    if revision < 1:
        raise argparse.ArgumentTypeError('revision must be a positive integer')
    return revision


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def codec_frames(path):
    """Read ANMF codec tags to distinguish lossless VP8L from lossy VP8."""
    data = path.read_bytes()
    if data[:4] != b'RIFF' or data[8:12] != b'WEBP':
        raise ValueError('Output is not a RIFF WebP file')
    frames = []
    offset = 12
    while offset + 8 <= len(data):
        tag = data[offset:offset + 4]
        size = struct.unpack_from('<I', data, offset + 4)[0]
        if tag == b'ANMF':
            body = data[offset + 8:offset + 8 + size]
            tags = []
            sub = 16  # frame rectangle/duration/flags header
            while sub + 8 <= len(body):
                subtag = body[sub:sub + 4]
                length = struct.unpack_from('<I', body, sub + 4)[0]
                tags.append(subtag.decode('ascii'))
                sub += 8 + length + length % 2
            frames.append({'codecTags': tags, 'losslessVP8L': 'VP8L' in tags and 'VP8 ' not in tags})
        offset += 8 + size + size % 2
    return frames


def visible_difference(expected, actual):
    """Ignore invisible RGB under alpha zero, but compare all nonzero alpha."""
    expected_alpha = expected.getchannel('A')
    actual_alpha = actual.getchannel('A')
    alpha_diff = ImageChops.difference(expected_alpha, actual_alpha)
    rgb_diff = ImageChops.difference(expected.convert('RGB'), actual.convert('RGB'))
    visible = expected_alpha.point(lambda value: 255 if value else 0)
    rgb_diff = Image.composite(rgb_diff, Image.new('RGB', expected.size), visible)
    alpha_max = alpha_diff.getextrema()[1]
    rgb_max = max(high for _, high in rgb_diff.getextrema())
    return {'alphaMaximumError': alpha_max, 'visibleRgbMaximumError': rgb_max,
            'visibleRgbaExactlyEqual': alpha_max == 0 and rgb_max == 0}


def inspect_preview(path, frames, durations, sample_indices):
    codec = codec_frames(path)
    coded_durations, extrema = [], []
    with Image.open(path) as image:
        canvas = list(image.size)
        loop = image.info.get('loop')
        background = image.info.get('background')
        coded_count = image.n_frames
        for index in range(coded_count):
            image.seek(index)
            image.load()
            coded_durations.append(image.info.get('duration'))
            extrema.append(list(image.convert('RGBA').getchannel('A').getextrema()))
        if any(not isinstance(value, int) or value <= 0 for value in coded_durations):
            raise ValueError(f'Invalid decoded frame durations: {coded_durations}')
        coded_ends, total = [], 0
        for duration in coded_durations:
            total += duration
            coded_ends.append(total)
        source_starts, elapsed = [], 0
        for duration in durations:
            source_starts.append(elapsed)
            elapsed += duration
        sample_checks = []
        for source_index in sample_indices:
            at_time = source_starts[source_index] + durations[source_index] / 2
            coded_index = bisect.bisect_right(coded_ends, at_time)
            image.seek(coded_index)
            decoded = image.convert('RGBA')
            sample_checks.append({'sourceFrame': source_index, 'codedFrame': coded_index,
                                  'sampleTimeMs': at_time, **visible_difference(frames[source_index], decoded)})
    return {'actualCodedFrames': coded_count, 'codedDurationsMs': coded_durations,
            'durationMs': sum(coded_durations), 'canvasSize': canvas, 'loop': loop,
            'background': background, 'alphaExtremaEachDecodedFrame': extrema,
            'allDecodedFramesHaveTransparentAndVisiblePixels': all(low == 0 and high > 0 for low, high in extrema),
            'codecFrames': codec, 'allCodecFramesLosslessVP8L': bool(codec) and all(frame['losslessVP8L'] for frame in codec),
            'decodedSampleChecks': sample_checks,
            'allSampleVisibleRgbaExactlyEqual': all(row['visibleRgbaExactlyEqual'] for row in sample_checks)}


def export_clip(name, frames_root, output_root, revision):
    count = COUNTS[name]
    directory = frames_root / name
    paths = [directory / f'{name}-{index:03}.webp' for index in range(count)]
    if not all(path.exists() for path in paths):
        raise ValueError(f'{name}: all {count} source WebP frames are required')
    frames, source_records, frame_hashes = [], [], []
    for index, path in enumerate(paths):
        source_records.append({'frame': index, 'file': str(path), 'sha256': file_hash(path)})
        with Image.open(path) as image:
            if image.mode != 'RGBA' or image.size != SIZES[0]:
                raise ValueError(f'{path}: expected RGBA {SIZES[0]}, got {image.mode} {image.size}')
            # This is the only resize; no intermediate, crop, reversal or warp.
            resized = image.resize(SIZES[1], Image.Resampling.LANCZOS)
        frames.append(resized)
        frame_hashes.append(hashlib.sha256(resized.tobytes()).hexdigest())
    durations = [33 if index % 3 < 2 else 34 for index in range(count)]
    expected_time = count * 1000 // 30
    assert sum(durations) == expected_time
    output_root.mkdir(parents=True, exist_ok=True)
    destination = output_root / f'{name}-r{revision}.webp'
    temporary = destination.with_name(f'.{destination.name}.{uuid.uuid4().hex}.tmp')
    try:
        print(f'{name}: encoding {count} supplied render samples at 576x832, lossless WebP', flush=True)
        frames[0].save(temporary, format='WEBP', save_all=True, append_images=frames[1:],
                       duration=durations, loop=0, lossless=True, quality=100,
                       method=4, exact=True, background=(0, 0, 0, 0), allow_mixed=False)
        decoded = inspect_preview(temporary, frames, durations, SAMPLES[name])
        changed = [row['frame'] for row in source_records if file_hash(Path(row['file'])) != row['sha256']]
        hard_checks = (decoded['canvasSize'] == list(SIZES[1]) and decoded['loop'] == 0
                       and decoded['durationMs'] == expected_time
                       and decoded['allDecodedFramesHaveTransparentAndVisiblePixels']
                       and decoded['allCodecFramesLosslessVP8L']
                       and decoded['allSampleVisibleRgbaExactlyEqual'] and not changed)
        if not hard_checks:
            raise ValueError(f'{name}: output timing/canvas/alpha/codec/fidelity or source-preservation check failed')
        temporary.replace(destination)
        report = {'clip': name, 'revision': revision,
                  'output': str(destination), 'outputSha256': file_hash(destination), 'bytes': destination.stat().st_size,
                  'sourceFrames': count, 'sourceFrameSize': list(SIZES[0]),
                  'sourceRenderSamplesAreNotNewDrawings': True,
                  'previewFrameSize': list(SIZES[1]), 'sourceDurationsMs': durations,
                  'expectedDurationMs': expected_time, 'sourceRecords': source_records,
                  'uniqueResizedRgbaSamples': len(set(frame_hashes)),
                  'encoderCoalescedFrames': count - decoded['actualCodedFrames'],
                  'allSourceFramesSuppliedInForwardOrder': True,
                  'originalFramesChangedDuringExport': changed, **decoded,
                  'limitations': 'Preview/export only. Encoder hold coalescing changes coded count, not source order or total timing. No new drawings, pose changes, per-frame crop, reverse playback, atlas, renderer or manifest modification.'}
        print(f'{name}: coded={decoded["actualCodedFrames"]}, time={decoded["durationMs"]}ms, sample visible RGBA equal={decoded["allSampleVisibleRgbaExactlyEqual"]}', flush=True)
        return report
    finally:
        temporary.unlink(missing_ok=True)
        for frame in frames:
            frame.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', type=positive_revision, default=5,
                        help='positive preview/report revision number (default: 5)')
    parser.add_argument('--clips', nargs='+', choices=tuple(COUNTS), default=['win'])
    parser.add_argument('--frames-root', type=Path, default=ROOT / 'art/dealer/v4/frames')
    parser.add_argument('--output-root', type=Path, default=ROOT / 'images/dealer/v4/previews')
    parser.add_argument('--report', type=Path,
                        help='report path; defaults to test-results/dealer-v4/revision-N/webp-preview-export.json')
    args = parser.parse_args()
    report_path = args.report or ROOT / f'test-results/dealer-v4/revision-{args.revision}/webp-preview-export.json'
    reports = {name: export_clip(name, args.frames_root, args.output_root, args.revision) for name in args.clips}
    # Recheck earlier clips too: a renderer must not change idle WebPs while
    # a subsequent preview is being encoded.
    changed_after_all_exports = [row['file'] for clip in reports.values()
                                 for row in clip['sourceRecords']
                                 if file_hash(Path(row['file'])) != row['sha256']]
    if changed_after_all_exports:
        raise ValueError(f'Source WebPs changed across the complete export: {changed_after_all_exports}')
    result = {'revision': args.revision, 'clips': reports,
              'scope': f'Revision-{args.revision} animated WebP export and decoding verification only; no new drawings or visual/runtime acceptance.',
              'allSourceHashesRecheckedAfterAllExports': True,
              'allSourceHashesStillMatch': True,
              'sourceStatus': 'Supplied WebP hashes matched both per-clip and after-all-exports checks; source readiness and visual acceptance are established separately.',
              'allDecodedSampleVisibleRgbaExactlyEqual': all(value['allSampleVisibleRgbaExactlyEqual'] for value in reports.values())}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print('Report:', report_path, flush=True)


if __name__ == '__main__':
    main()
