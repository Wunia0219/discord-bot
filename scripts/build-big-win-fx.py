"""Deterministic padding/packing of the approved aura and an 8-frame light sprite.
Requires Pillow. Run from the repository root; never crops frames to their bounds.
"""
from pathlib import Path
from PIL import Image
import json
import math

root = Path(__file__).resolve().parents[1] / 'images' / 'fx'
master = Image.open(root / 'big-win-aura-source.png').convert('RGBA')
aura = Image.new('RGBA', (1024, 1024))
aura.alpha_composite(master.resize((896, 896), Image.Resampling.LANCZOS), (64, 64))
aura.save(root / 'big-win-aura.webp', quality=90, method=6)

# 8 frames, left to right; 128px cells; root (64,64); max radius 46px.
# Cyan bloom + a four-point glint, breathing over a seamless 1-second loop.
sheet = Image.new('RGBA', (1024, 128))
for frame in range(8):
    image = Image.new('RGBA', (128, 128))
    power = .48 + .52 * (1 - math.cos(2 * math.pi * frame / 8)) / 2
    for y in range(18, 110):
        for x in range(18, 110):
            dx, dy = x - 63.5, y - 63.5
            radius = math.hypot(dx, dy)
            fade = max(0, 1 - radius / 46) ** 2
            glow = math.exp(-radius ** 2 / 230) * .6
            rays = max(math.exp(-abs(dx) * 1.1 - abs(dy) / 18), math.exp(-abs(dy) * 1.1 - abs(dx) / 18))
            alpha = round(min(1, (glow + rays) * power) * fade * 255)
            image.putpixel((x, y), (164, 255, 240, alpha))
    sheet.alpha_composite(image, (frame * 128, 0))
sheet.save(root / 'big-win-spark-sheet.png')
sheet.save(root / 'big-win-spark-sheet.webp', lossless=True, method=6, exact=True)
(root / 'big-win-spark-sheet.json').write_text(json.dumps({
    'image': 'big-win-spark-sheet.webp', 'size': [1024, 128],
    'cell': [128, 128], 'frames': 8, 'columns': 8, 'rows': 1,
    'order': 'left-to-right', 'anchor': [.5, .5], 'safePadding': 18,
    'fps': 8, 'loop': True, 'alpha': True,
}, indent=2) + '\n', encoding='utf-8')
assert aura.getbbox()[0] >= 64
for index in range(8):
    box = sheet.crop((index * 128, 0, (index + 1) * 128, 128)).getbbox()
    assert box and min(box[:2]) >= 18 and max(box[2:]) <= 110
print('Aura: 1024x1024 RGBA, 64px padding; sparks: 8 x 128x128, 18px padding.')
