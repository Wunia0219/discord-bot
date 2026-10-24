"""Migrate project PNGs to compressed WebP and remove verified PNG originals.

Art/QA sources use exact lossless RGBA. The game background uses quality 90
with exact alpha. Dependencies and Git internals are never touched.
Run: npm run assets:webp
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
from PIL import Image, features

ROOT = Path(__file__).resolve().parents[2]
EXCLUDED = {'.git', 'node_modules', '.venv', 'venv'}
REPORT = ROOT / 'test-results/image-compression.json'


def png_files():
    for directory, children, names in os.walk(ROOT):
        children[:] = [name for name in children if name not in EXCLUDED]
        for name in names:
            path = Path(directory) / name
            if path.suffix.lower() == '.png':
                yield path


def encode(source):
    source = source.resolve()
    source.relative_to(ROOT)  # Refuse any resolved target outside the project.
    target = source.with_suffix('.webp').resolve()
    target.relative_to(ROOT)
    lossless = source.relative_to(ROOT).as_posix() != 'images/jokers-circus/circus-background.png'
    before = source.stat().st_size
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    with Image.open(source) as image:
        original = image.convert('RGBA')
    size = original.size

    def verify():
        if not target.exists():
            return False
        with Image.open(target) as decoded:
            if decoded.format != 'WEBP' or decoded.size != size:
                return False
            rgba = decoded.convert('RGBA')
            return (rgba.tobytes() == original.tobytes() if lossless else
                    rgba.getchannel('A').tobytes() == original.getchannel('A').tobytes())

    if not verify():
        temporary = target.with_name(target.name + '.tmp')
        try:
            original.save(temporary, format='WEBP', lossless=lossless,
                          quality=100 if lossless else 90, method=6, exact=True)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    if not verify():
        raise ValueError(f'WebP verification failed; PNG retained: {source}')
    original.close()
    after = target.stat().st_size
    source.unlink()
    return {'source': source.relative_to(ROOT).as_posix(),
            'webp': target.relative_to(ROOT).as_posix(), 'size': list(size),
            'lossless': lossless, 'quality': None if lossless else 90,
            'alphaExact': True, 'rgbaExact': lossless,
            'sourceSha256': digest, 'beforeBytes': before, 'afterBytes': after,
            'pngRemoved': True}


def main():
    if not features.check('webp'):
        raise RuntimeError('Pillow must include WebP support')
    paths = sorted(png_files())
    if not paths:
        print('No project PNGs remain; existing WebP files preserved.')
        return
    records = []
    REPORT.parent.mkdir(exist_ok=True)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            for record in pool.map(encode, paths):
                records.append(record)
                if len(records) % 20 == 0:
                    print(f'Verified and removed {len(records)}/{len(paths)} PNGs', flush=True)
    finally:
        REPORT.write_text(json.dumps(records, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'pngRemoved': len(records),
                      'beforeBytes': sum(row['beforeBytes'] for row in records),
                      'webpBytes': sum(row['afterBytes'] for row in records),
                      'remainingPng': len(list(png_files())), 'report': str(REPORT)}))


if __name__ == '__main__':
    main()
