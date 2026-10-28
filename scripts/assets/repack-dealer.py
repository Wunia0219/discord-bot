"""Repack existing runtime drawings with one shared lossless border; --write applies."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
from io import BytesIO
import json
from pathlib import Path
import shutil

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / 'images/dealer/v4'
OUTPUT = ROOT / 'test-results/dealer-atlas-repack'


def frame_image(atlas, entry):
    f, s = entry['frame'], entry['spriteSourceSize']
    tile = atlas.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h'])).convert('RGBA')
    image = Image.new('RGBA', (entry['sourceSize']['w'], entry['sourceSize']['h']))
    image.paste(tile, (s['x'], s['y']))  # Copy all channels, including transparent RGB.
    return image


def sha(image):
    return hashlib.sha256(image.tobytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--from-directory', type=Path, default=DIRECTORY)
    args = parser.parse_args()
    source_directory = args.from_directory.resolve()
    source_directory.relative_to(ROOT)
    manifest_path = DIRECTORY / 'dealer.json'
    original = json.loads((source_directory / 'dealer.json').read_text(encoding='utf-8'))
    if original['frameSize'] != [576, 832] or original['fps'] != 30:
        raise ValueError('Unexpected logical canvas or frame rate')
    bounds, hashes, before_bytes, before_rgba = None, {}, 0, 0
    for name, clip in original['clips'].items():
        for page in clip['pages']:
            if Path(page['file']).name != page['file']:
                raise ValueError('Atlas filenames must be local')
            source = source_directory / page['file']
            before_bytes += source.stat().st_size
            with Image.open(source) as atlas:
                before_rgba += atlas.width * atlas.height * 4
                for key, entry in page['frames'].items():
                    image = frame_image(atlas, entry)
                    if image.size != (576, 832):
                        raise ValueError('Logical drawing size changed')
                    hashes[name + ':' + key] = sha(image)
                    box = image.getbbox(alpha_only=False)
                    if box:
                        bounds = box if bounds is None else (min(bounds[0], box[0]), min(bounds[1], box[1]), max(bounds[2], box[2]), max(bounds[3], box[3]))
    left, top, right, bottom = max(0, bounds[0]-8), max(0, bounds[1]-8), min(576, bounds[2]+8), min(832, bounds[3]+8)
    # Whole 32px storage cells avoid compression penalties from tight odd strides.
    width, height = min(576, ((right-left+31)//32)*32), min(832, ((bottom-top+31)//32)*32)
    left, top = min(left, 576-width), min(top, 832-height)
    right, bottom = left+width, top+height
    region = {'x': left, 'y': top, 'w': width, 'h': height}
    manifest = copy.deepcopy(original)
    manifest['runtimePacking'] = {'type': 'shared-transparent-border-v1', 'padding': 8, 'alignment': 32, 'region': region, 'grid': [2, 2]}
    candidates = OUTPUT / 'candidate'
    candidates.mkdir(parents=True, exist_ok=True)
    after_bytes, after_rgba, checked = 0, 0, 0
    def pack_page(task):
        name, page = task
        if len(page['frames']) > 4:
            raise ValueError('Expected at most four drawings per page')
        packed = Image.new('RGBA', (width*2, height*2))
        with Image.open(source_directory / page['file']) as atlas:
            for index, (key, entry) in enumerate(page['frames'].items()):
                image = frame_image(atlas, entry)
                tile = image.crop((left, top, right, bottom))
                restored = Image.new('RGBA', image.size)
                restored.paste(tile, (left, top))
                if restored.tobytes() != image.tobytes():
                    raise ValueError('Shared border would remove RGBA pixels: ' + key)
                x, y = index % 2 * width, index // 2 * height
                packed.paste(tile, (x, y))
                entry.update(frame={'x': x, 'y': y, 'w': width, 'h': height}, spriteSourceSize=dict(region), trimmed=True)
        destination = candidates / page['file']
        best = None
        for method, quality in [(4, 75), (4, 100), (6, 100)]:
            encoded = BytesIO()
            packed.save(encoded, 'WEBP', lossless=True, exact=True, quality=quality, method=method)
            data = encoded.getvalue()
            if best is None or len(data) < len(best):
                best = data
        destination.write_bytes(best)
        page['meta']['size'] = {'w': packed.width, 'h': packed.height}
        verified = 0
        with Image.open(destination) as check:
            for key, entry in page['frames'].items():
                if sha(frame_image(check, entry)) != hashes[name + ':' + key]:
                    raise ValueError('Encoded full-canvas RGBA mismatch: ' + key)
                verified += 1
        return len(best), packed.width * packed.height * 4, verified
    tasks = [(name, page) for name, clip in manifest['clips'].items() for page in clip['pages']]
    with ThreadPoolExecutor(max_workers=3) as pool:
        for index, (size, rgba_size, count) in enumerate(pool.map(pack_page, tasks), 1):
            after_bytes += size
            after_rgba += rgba_size
            checked += count
            if index % 10 == 0:
                print(f'Encoded and verified {index}/{len(tasks)} pages', flush=True)
    if after_bytes > before_bytes:
        raise ValueError('Repacked download grew; candidates kept for inspection, runtime files unchanged')
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    (candidates / 'dealer.json').write_text(text, encoding='utf-8')
    report = dict(framesVerified=checked, region=region, beforeBytes=before_bytes, afterBytes=after_bytes,
                  beforeRgbaBytes=before_rgba, afterRgbaBytes=after_rgba, fullCanvasRgbaSha256=hashes, applied=args.write)
    if args.write:
        backup = OUTPUT / 'original'
        backup.mkdir(exist_ok=True)
        for clip in original['clips'].values():
            for page in clip['pages']:
                if not (backup / page['file']).exists():
                    shutil.copyfile(DIRECTORY / page['file'], backup / page['file'])
        if not (backup / 'dealer.json').exists():
            shutil.copyfile(manifest_path, backup / 'dealer.json')
        for clip in manifest['clips'].values():
            for page in clip['pages']:
                shutil.copyfile(candidates / page['file'], DIRECTORY / page['file'])
        temporary = manifest_path.with_suffix('.json.repack-tmp')
        temporary.write_text(text, encoding='utf-8')
        temporary.replace(manifest_path)
    (OUTPUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'fullCanvasRgbaSha256'}))


if __name__ == '__main__':
    main()
