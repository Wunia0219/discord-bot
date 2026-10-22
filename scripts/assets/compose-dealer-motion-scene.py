"""Build actor-free v4 scene layers from original game art, without AI redraw.

The existing static concept and its composer are left untouched. Foot/contact
shadows belong to the animated actor, so none are painted into these layers.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'art/dealer/rebuild'
CHECK = ROOT / 'test-results/dealer-v4'
W, H = 1440, 900
COMPOSITION = json.loads((OUT / 'composition.json').read_text(encoding='utf8'))
assert COMPOSITION['canvas'] == [W, H]


def art(atlas, data, key, padded=False):
    entry = data['frames'][key]
    frame = entry['frame']
    result = atlas.crop((frame['x'], frame['y'],
                         frame['x'] + frame['w'], frame['y'] + frame['h']))
    if not padded:
        return result
    canvas = Image.new('RGBA', (entry['sourceSize']['w'], entry['sourceSize']['h']))
    offset = entry['spriteSourceSize']
    canvas.alpha_composite(result, (offset['x'], offset['y']))
    return canvas


def main():
    CHECK.mkdir(parents=True, exist_ok=True)
    back = Image.open(ROOT / 'images/jokers-circus/circus-background.webp').convert('RGBA')
    canvas = ImageOps.fit(back, (W, H), Image.Resampling.LANCZOS, centering=(.5, .57))
    shade = Image.new('RGBA', (W, H))
    draw = ImageDraw.Draw(shade)
    for y in range(H):
        alpha = round(35 + 65 * max(0, (y / H - .6) / .4))
        draw.line((0, y, W, y), fill=(12, 13, 30, alpha))
    canvas.alpha_composite(shade)

    main_atlas = Image.open(ROOT / 'images/main.webp').convert('RGBA')
    main_data = json.loads((ROOT / 'images/main.json').read_text(encoding='utf8'))
    symbols = Image.open(ROOT / 'images/symbols.webp').convert('RGBA')
    symbol_data = json.loads((ROOT / 'images/symbols.json').read_text(encoding='utf8'))
    gx, gy, gw, gh = 435, 258, 690, 408
    field = Image.new('RGBA', (gw, gh), (16, 23, 45, 255))
    draw = ImageDraw.Draw(field)
    for column in range(5):
        draw.rectangle((column * 138, 3, (column + 1) * 138 - 1, gh - 3),
                       fill=(25, 16, 43, 255) if column % 2 else (35, 28, 54, 255))
        if column:
            draw.line((column * 138, 8, column * 138, gh - 8), fill=(100, 83, 63, 255))
    canvas.alpha_composite(field, (gx, gy))

    frame = art(main_atlas, main_data, 'circus-reel-frame.png')
    frame = frame.resize(tuple(COMPOSITION['frameSize']), Image.Resampling.LANCZOS)
    frame_layer = Image.new('RGBA', (W, H))
    frame_layer.alpha_composite(frame, tuple(COMPOSITION['frameOrigin']))
    canvas.alpha_composite(frame_layer)
    columns = [['L4.png', 'H1.png', 'L3.png'], ['H3.png', 'L2.png', 'H1.png'],
               ['L1.png', 'L3.png', 'H1.png'], ['L1.png', 'WILD.png', 'H1.png'],
               ['L4.png', 'H1.png', 'H2.png']]
    for column, names in enumerate(columns):
        for row, key in enumerate(names):
            symbol = art(symbols, symbol_data, key, True).resize((132, 132), Image.Resampling.LANCZOS)
            canvas.alpha_composite(symbol, (gx + column * 138 + 3, gy + row * 136 + 2))
    logo = art(main_atlas, main_data, 'logo-long.png')
    canvas.alpha_composite(logo.resize((500, round(logo.height * 500 / logo.width)),
                                       Image.Resampling.LANCZOS), (530, 30))
    canvas.save(OUT / 'motion-scene-background.webp', lossless=True, method=6, exact=True)

    # Only the left cabinet border can overlap this companion. Leave all reels,
    # logo and right frame out of the foreground. The entire contact forearm,
    # hanging hand and ledge are protected by a conservative fixed scene box.
    # RGB is sampled from the already composed actor-free cabinet, so putting
    # this overlay over its own background cannot darken semi-transparent gold.
    mask = frame_layer.getchannel('A')
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rectangle((gx, 0, W, H), fill=0)
    contact_protection = (280, 258, 430, 416)
    mask_draw.rectangle(contact_protection, fill=0)
    # Clear hidden RGB as well; a transparent layer should not carry a second
    # copy of the full background or waste its WebP payload on invisible pixels.
    foreground = Image.composite(canvas, Image.new('RGBA', (W, H)),
                                 mask.point(lambda alpha: 255 if alpha else 0))
    foreground.putalpha(mask)
    foreground.save(OUT / 'motion-scene-foreground.webp', lossless=True, method=6, exact=True)
    assert foreground.getchannel('A').crop(contact_protection).getextrema() == (0, 0)
    assert foreground.getchannel('A').crop((gx, 0, W, H)).getextrema() == (0, 0)

    host_scale = COMPOSITION['hostScale']
    source_origin = COMPOSITION['hostOrigin']
    source_pad = (64, 64)
    hd_size = (1152, 1664)
    runtime_size = (576, 832)
    padded_origin = [source_origin[index] - source_pad[index] * host_scale for index in range(2)]
    position = [padded_origin[0] + hd_size[0] * .5 * host_scale,
                padded_origin[1] + 1600 * host_scale]
    placement = {'canvas': [W, H], 'position': position, 'scale': host_scale * 2,
                 'background': '/art/dealer/rebuild/motion-scene-background.webp',
                 'foreground': '/art/dealer/rebuild/motion-scene-foreground.webp'}
    report = {'status': 'scene layering draft; motion occlusion still requires review',
              'placement': {'scene': placement}, 'runtimeFrameSize': runtime_size,
              'sourceFrameSize': hd_size, 'anchor': [.5, 1600 / 1664],
              'sourceMasterOrigin': source_origin, 'sourceMasterScale': host_scale,
              'paddedFrameOrigin': padded_origin, 'contactProtectedBox': contact_protection,
              'foregroundMaskBounds': mask.getbbox(),
              'actorPixelsInBackground': False, 'actorShadowsInBackground': False,
              'sources': COMPOSITION['machineOriginalArt'],
              'limits': ['Fixed foreground mask protects current contact forearm/hand only inside its declared box.',
                         'Foreground covers cabinet border x<435; no reel symbols or controls are masked.',
                         'No actor ground/contact shadow is baked; animated foot contact needs its own dynamic shadow.',
                         'Original static concept is preserved; all scene layers are newly composed from original game art.']}
    (OUT / 'motion-scene-placement.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')

    mask.save(CHECK / 'scene-occlusion-mask.webp', lossless=True, method=6, exact=True)
    # These still composites verify positioning/occlusion, not motion quality.
    for index in (0, 44, 107):
        path = ROOT / f'art/dealer/v4/frames/win/win-{index:03}.webp'
        if not path.exists():
            continue
        actor = Image.open(path).convert('RGBA')
        assert actor.size == hd_size
        preview = canvas.copy()
        preview.alpha_composite(actor.resize(tuple(round(value * host_scale) for value in hd_size),
                                            Image.Resampling.LANCZOS), tuple(round(value) for value in padded_origin))
        preview.alpha_composite(foreground)
        preview.save(CHECK / f'scene-composite-{index:03}.webp', lossless=True, method=6, exact=True)
        if index == 0:
            preview.crop((245, 230, 448, 485)).save(CHECK / 'scene-contact-detail.webp', lossless=True, method=6, exact=True)
    # Verify the overlay cannot alter an empty scene through repeated alpha.
    combined = canvas.copy()
    combined.alpha_composite(foreground)
    assert combined.tobytes() == canvas.tobytes()
    print(json.dumps({'background': str(OUT / 'motion-scene-background.webp'),
                      'foreground': str(OUT / 'motion-scene-foreground.webp'),
                      'placement.scene': placement, 'protectedBox': contact_protection}, ensure_ascii=False))


if __name__ == '__main__':
    main()
