"""Encode PNG masters to WebP without resizing or changing atlas coordinates.

Requires Pillow with WebP support. Originals remain available for future exports.
Run from anywhere: python scripts/optimize-images.py
"""
import json
import math
from pathlib import Path
from PIL import Image, ImageChops, ImageStat, features

ROOT = Path(__file__).resolve().parents[1]
assert features.check('webp'), 'Pillow must include WebP support'
# Only runtime assets are encoded; archived art and source exports stay untouched.
ASSETS = {
    'main.png': (True, 100),
    'symbols.png': (True, 100),
    'fonts/circus-gold.png': (True, 100),
    'fx/circus-win-frame.png': (True, 100),
    'jokers-circus/circus-background.png': (False, 90),
}
records = []
for asset, (lossless, quality) in ASSETS.items():
    source = ROOT / 'images' / asset
    name = source.relative_to(ROOT / 'images').as_posix()
    target = source.with_suffix('.webp')
    original = Image.open(source).convert('RGBA')
    original.save(target, format='WEBP', lossless=lossless, quality=quality,
                  alpha_quality=100, method=6, exact=True)
    with Image.open(target) as decoded:
        decoded = decoded.convert('RGBA')
        assert decoded.size == original.size, name
        assert ImageChops.difference(original.getchannel('A'), decoded.getchannel('A')).getbbox() is None, name
        if lossless:
            assert original.tobytes() == decoded.tobytes(), name
        # Measure visible RGB error on both dark and light backgrounds.
        errors = []
        for color in ('black', 'white'):
            backdrop = Image.new('RGBA', original.size, color)
            before = Image.alpha_composite(backdrop, original).convert('RGB')
            after = Image.alpha_composite(backdrop, decoded).convert('RGB')
            rms = ImageStat.Stat(ImageChops.difference(before, after)).rms
            mse = sum(v*v for v in rms) / 3
            errors.append(None if mse == 0 else round(10 * math.log10(255**2/mse), 2))
    records.append({'source': 'images/' + name, 'webp': target.relative_to(ROOT).as_posix(),
                    'size': list(original.size), 'lossless': lossless,
                    'quality': None if lossless else quality, 'alphaExact': True,
                    'beforeBytes': source.stat().st_size, 'afterBytes': target.stat().st_size,
                    'compositedPSNR': {'black': errors[0], 'white': errors[1]}})
    print(f'{name}: {source.stat().st_size:,} -> {target.stat().st_size:,} bytes', flush=True)
(ROOT / 'docs/image-compression.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
