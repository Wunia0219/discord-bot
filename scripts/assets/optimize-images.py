"""Audit tracked artwork; --write keeps smaller files after exact RGBA comparison."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import hashlib
import json
from pathlib import Path
import subprocess
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]

def digest(data):
    return hashlib.sha256(data).hexdigest()

def audit(name, write):
    path = ROOT / name
    path.resolve().relative_to(ROOT)
    if path.is_symlink():
        raise ValueError(f'Refusing linked asset: {name}')
    original = path.read_bytes()
    with Image.open(BytesIO(original)) as image:
        frames = getattr(image, 'n_frames', 1)
        metadata = any(image.info.get(key) for key in ('icc_profile', 'exif', 'xmp'))
        rgba = image.convert('RGBA')
        pixels = rgba.tobytes()
        record = dict(file=name, format=image.format, size=list(image.size), frames=frames,
                      beforeBytes=len(original), afterBytes=len(original), sha256=digest(original),
                      rgbaSha256=digest(pixels), changed=False)
    record['lossySource'] = b'VP8 ' in original if path.suffix == '.webp' else False
    # Preserve animated files' frame timing and disposal metadata.
    if frames != 1 or metadata:
        record['status'] = 'metadata-preserved' if metadata else 'animated-preserved'
        return record
    candidate = BytesIO()
    if path.suffix == '.webp':
        rgba.save(candidate, 'WEBP', lossless=True, exact=True, quality=75, method=4)
    else:
        rgba.save(candidate, 'PNG', optimize=True)
    encoded = candidate.getvalue()
    with Image.open(BytesIO(encoded)) as check:
        if check.size != rgba.size or check.convert('RGBA').tobytes() != pixels:
            raise ValueError(f'Pixel mismatch: {name}')
    record['candidateBytes'] = len(encoded)
    record['status'] = 'already-smaller' if len(encoded) >= len(original) else 'smaller-verified'
    if write and len(encoded) < len(original):
        path.write_bytes(encoded)
        record.update(afterBytes=len(encoded), sha256=digest(encoded), changed=True)
    return record

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    tracked = subprocess.check_output(['git', 'ls-files', '-z', '--', 'images', 'art'], cwd=ROOT).decode().split('\0')
    names = sorted(name for name in tracked if Path(name).suffix.lower() in {'.png', '.webp'})
    records = []
    report = ROOT / 'test-results/image-compression.json'
    report.parent.mkdir(exist_ok=True)
    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            for record in pool.map(lambda name: audit(name, args.write), names):
                records.append(record)
                if len(records) % 5 == 0:
                    print(f'Verified {len(records)}/{len(names)}', flush=True)
    finally:
        report.write_text(json.dumps(records, indent=2) + '\n', encoding='utf8')
    print(json.dumps(dict(verified=len(records), changed=sum(r['changed'] for r in records),
                         savedBytes=sum(r['beforeBytes']-r['afterBytes'] for r in records),
                         lossySources=[r['file'] for r in records if r['lossySource']], report=str(report))))

if __name__ == '__main__':
    main()
