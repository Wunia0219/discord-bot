"""Export supplied RGBA animation drawings without generating or deforming art.

Input PNG files are ordered naturally by their filenames. Every drawing must
already use the shared 1152x1664 canvas, with at least 16 transparent pixels on
all sides. The only resize is one 1152x1664 -> 576x832 runtime downsample.

Example:
  python scripts/assets/export-dealer-v4.py --frames-dir art/dealer/v4/idle \
    --clip idle --fps 30 --status draft

Identical drawings are refused by default. --allow-duplicates explicitly keeps
authored holds, and --duplicate-note can record why those holds are necessary.
Numerical checks do not certify identity consistency or natural motion.
"""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import uuid

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'images/dealer/v4'
ART = ROOT / 'art/dealer/v4/sheets'
CHECKS = ROOT / 'test-results/dealer-v4'
SOURCE_SIZE = (1152, 1664)
FRAME_SIZE = (576, 832)
ANCHOR = [0.5, 1600 / 1664]
PADDING = 16
COLS = ROWS = 2
CLIPS = {'idle': '待機', 'win': '中獎・傾心致意'}


def natural_key(path):
    return tuple((1, int(piece)) if piece.isdigit() else (0, piece.casefold())
                 for piece in re.split(r'(\d+)', path.name))


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    try:
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def canvas_contract():
    return {'version': 4, 'fps': 30, 'frameSize': list(FRAME_SIZE),
            'sourceFrameSize': list(SOURCE_SIZE), 'anchor': ANCHOR}


def merge_manifest_data(previous, clip_name, clip_entry=None):
    """Preserve authored metadata while replacing only generated clip fields.

    Placement/source/provenance can live at root or clip level. Re-exporting
    frames must not erase these, and must not import metadata from v3.
    """
    manifest = {**canvas_contract(), 'clips': {}}
    if previous is not None:
        for key, expected in canvas_contract().items():
            if previous.get(key) != expected:
                raise ValueError(f'Existing v4 manifest has incompatible {key}; refusing to merge')
        old_clips = previous.get('clips')
        if (not isinstance(old_clips, dict)
                or any(name not in CLIPS or not isinstance(entry, dict) for name, entry in old_clips.items())):
            raise ValueError('Existing v4 manifest contains invalid or unsupported clips')
        manifest = {**previous, **canvas_contract(), 'clips': dict(old_clips)}
    if clip_entry is not None:
        manifest['clips'][clip_name] = {**manifest['clips'].get(clip_name, {}), **clip_entry}
    return manifest


def merged_manifest(clip_name, clip_entry=None):
    """Read only the v4 manifest and refuse an incompatible contract."""
    path = OUT / 'dealer.json'
    previous = json.loads(path.read_text(encoding='utf8')) if path.exists() else None
    return merge_manifest_data(previous, clip_name, clip_entry)


def inspect_sources(paths, clip, status, allow_duplicates=False, duplicate_note=''):
    records, errors, by_hash = [], [], {}
    for index, path in enumerate(paths):
        record = {'index': index, 'file': path.name, 'sourcePath': str(path),
                  'sha256File': hashlib.sha256(path.read_bytes()).hexdigest()}
        try:
            with Image.open(path) as image:
                record.update({'size': list(image.size), 'mode': image.mode, 'format': image.format})
                if image.format != 'PNG' or image.mode != 'RGBA' or image.size != SOURCE_SIZE:
                    errors.append(f'{path.name}: expected RGBA PNG {SOURCE_SIZE[0]}x{SOURCE_SIZE[1]}, got {image.format} {image.mode} {image.size}')
                    records.append(record)
                    continue
                image.load()
                alpha = image.getchannel('A')
                bbox = alpha.getbbox()
                effective_bbox = alpha.point(lambda value: 255 if value > 24 else 0).getbbox()
                digest = hashlib.sha256(image.tobytes()).hexdigest()
                by_hash.setdefault(digest, []).append(index)
                record.update({'sha256DecodedRGBA': digest,
                               'alphaBounds': list(bbox) if bbox else None,
                               'effectiveAlphaBounds24': list(effective_bbox) if effective_bbox else None})
                if not bbox or not effective_bbox:
                    record['minimumPaddingPx'] = None
                    errors.append(f'{path.name}: empty or only imperceptible alpha; a complete character is required')
                else:
                    minimum = min(bbox[0], bbox[1], SOURCE_SIZE[0] - bbox[2], SOURCE_SIZE[1] - bbox[3])
                    record['minimumPaddingPx'] = minimum
                    if minimum < PADDING:
                        errors.append(f'{path.name}: transparent padding is {minimum}px, below {PADDING}px')
        except (OSError, ValueError) as error:
            errors.append(f'{path.name}: {error}')
            record['readError'] = str(error)
        records.append(record)
    duplicates = [indices for indices in by_hash.values() if len(indices) > 1]
    if duplicates and not allow_duplicates:
        errors.append(f'Identical decoded RGBA frames at indices {duplicates}; remove redundant sources or explicitly use --allow-duplicates for authored holds')
    return {'version': 4, 'clip': clip, 'status': status,
            'sourceFrameSize': list(SOURCE_SIZE), 'runtimeFrameSize': list(FRAME_SIZE),
            'fps': 30, 'anchor': ANCHOR, 'sourceFrames': len(paths),
            'uniqueDecodedFrames': len(by_hash), 'duplicateGroups': duplicates,
            'allowDuplicates': allow_duplicates, 'duplicateNote': duplicate_note,
            'minimumTransparentPaddingPx': PADDING,
            'paddingAlphaRule': 'All nonzero source alpha, including antialias pixels, must remain 16px inside the fixed canvas; alpha>24 is also checked for nonempty content.',
            'frames': records, 'errors': errors, 'numericalChecksPassed': not errors,
            'manifestUpdated': False,
            'scope': 'Numerical source integrity and full-canvas silhouette checks only. No claim of natural motion, consistent anatomy, identity or artistic completion.',
            'processing': 'No generation, pose deformation, interpolation, per-frame crop or registration. Runtime frames are resized exactly once from supplied HD PNGs.'}


def stage_image(picture, destination, image_format, run_id, staged, **options):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f'.{destination.name}.{run_id}.tmp')
    staged.append((temporary, destination))
    picture.save(temporary, format=image_format, **options)


def export_pages(paths, clip_name, status, run_id, staged, allow_duplicates, duplicate_note):
    duration = 1000 / 30
    entry = {'loop': clip_name == 'idle', 'frames': len(paths),
             'durationMs': len(paths) * duration, 'label': CLIPS[clip_name],
             'status': status, 'pages': [],
             'order': [f'{clip_name}-{index:04}' for index in range(len(paths))],
             'sourceFiles': [path.name for path in paths],
             'allowDuplicates': allow_duplicates}
    if duplicate_note:
        entry['duplicateNote'] = duplicate_note
    capacity = COLS * ROWS
    for start in range(0, len(paths), capacity):
        hd = Image.new('RGBA', (SOURCE_SIZE[0] * COLS, SOURCE_SIZE[1] * ROWS))
        runtime = Image.new('RGBA', (FRAME_SIZE[0] * COLS, FRAME_SIZE[1] * ROWS))
        rects = {}
        for local, path in enumerate(paths[start:start + capacity]):
            column, row = local % COLS, local // COLS
            with Image.open(path) as drawing:
                # Already checked exact mode/size. No crop, alpha alteration,
                # affine/mesh transform or intermediate downsample occurs.
                hd.alpha_composite(drawing, (column * SOURCE_SIZE[0], row * SOURCE_SIZE[1]))
                small = drawing.resize(FRAME_SIZE, Image.Resampling.LANCZOS)
                runtime.alpha_composite(small, (column * FRAME_SIZE[0], row * FRAME_SIZE[1]))
                small.close()
            index = start + local
            rects[f'{clip_name}-{index:04}'] = {
                'frame': {'x': column * FRAME_SIZE[0], 'y': row * FRAME_SIZE[1],
                          'w': FRAME_SIZE[0], 'h': FRAME_SIZE[1]},
                'sourceSize': {'w': FRAME_SIZE[0], 'h': FRAME_SIZE[1]},
                'spriteSourceSize': {'x': 0, 'y': 0, 'w': FRAME_SIZE[0], 'h': FRAME_SIZE[1]},
                'durationMs': duration,
            }
        basename = f'{clip_name}-{start // capacity:03}'
        stage_image(hd, ART / f'{basename}.png', 'PNG', run_id, staged, compress_level=3)
        stage_image(runtime, OUT / f'{basename}.webp', 'WEBP', run_id, staged,
                    lossless=True, quality=100, method=4, exact=True)
        entry['pages'].append({'file': f'{basename}.webp', 'frames': rects,
                               'meta': {'size': {'w': runtime.width, 'h': runtime.height}, 'scale': '1'}})
        hd.close()
        runtime.close()
        print(f'{clip_name}: staged page {start // capacity + 1}/{math.ceil(len(paths) / capacity)}', flush=True)
    return entry


def arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--frames-dir', required=True, type=Path,
                        help='Directory containing completed same-canvas RGBA PNG drawings, naturally sorted by filename')
    parser.add_argument('--clip', required=True, choices=tuple(CLIPS))
    parser.add_argument('--fps', type=int, default=30,
                        help='V4 contract is fixed at 30 fps; other values are refused')
    parser.add_argument('--status', choices=('draft', 'reviewed'), default='draft')
    parser.add_argument('--allow-duplicates', action='store_true',
                        help='Explicitly retain identical authored hold frames; all duplicate groups remain in the report')
    parser.add_argument('--duplicate-note', default='', help='Optional reason for retained holds, recorded with the clip and report')
    return parser.parse_args()


def main():
    args = arguments()
    if args.fps != 30:
        raise ValueError('The v4 contract requires --fps 30')
    directory = args.frames_dir.resolve()
    if not directory.is_dir():
        raise ValueError(f'Frames directory does not exist: {directory}')
    paths = sorted((path for path in directory.iterdir() if path.is_file() and path.suffix.casefold() == '.png'), key=natural_key)
    if not paths:
        raise ValueError(f'No source PNG frames found in {directory}')
    # Validate existing v4 metadata before encoding any output. Never read v3
    # or the historical root-level dealer manifest.
    merged_manifest(args.clip)
    report = inspect_sources(paths, args.clip, args.status, args.allow_duplicates, args.duplicate_note)
    report['sourceDirectory'] = str(directory)
    report_path = CHECKS / f'{args.clip}-report.json'
    atomic_json(report_path, report)
    if report['errors']:
        raise ValueError(f'Source validation failed; manifest and pages preserved. See {report_path}: ' + '; '.join(report['errors']))
    staged = []
    run_id = f'{os.getpid()}-{uuid.uuid4().hex}'
    try:
        clip = export_pages(paths, args.clip, args.status, run_id, staged,
                            args.allow_duplicates, args.duplicate_note)
        # Re-read immediately before the merge to preserve another completed
        # v4 clip. Call this exporter sequentially for a shared output folder.
        manifest = merged_manifest(args.clip, clip)
        for temporary, destination in staged:
            temporary.replace(destination)
        atomic_json(OUT / 'dealer.json', manifest)
        report.update({'manifestUpdated': True, 'manifestPath': str(OUT / 'dealer.json'),
                       'pages': len(clip['pages']), 'durationMs': clip['durationMs'],
                       'runtimeEncoding': 'lossless WebP; exact=True',
                       'hdSheetsDirectory': str(ART)})
        atomic_json(report_path, report)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)
    print(json.dumps({'clip': args.clip, 'status': args.status, 'frames': len(paths),
                      'uniqueDecodedFrames': report['uniqueDecodedFrames'],
                      'pages': report['pages'], 'manifest': str(OUT / 'dealer.json'),
                      'report': str(report_path), 'artisticMotionReview': 'not assessed by this exporter'},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
