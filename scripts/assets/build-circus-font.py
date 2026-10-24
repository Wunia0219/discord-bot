"""Bake the existing Georgia Bold numeral shapes with ivory-gold faces and ruby-red sides into an AngelCode BMFont.
The font file stays on Windows; only the rendered glyph atlas is exported.
"""
from pathlib import Path
from PIL import Image, ImageFont, ImageDraw, ImageFilter, ImageChops
import math

root = Path(__file__).resolve().parents[2] / 'images' / 'fonts'
root.mkdir(exist_ok=True)
font = ImageFont.truetype('C:/Windows/Fonts/georgiab.ttf', 190)
chars = '0123456789,+−'
cw, ch = 192, 256
sheet = Image.new('RGBA', (cw * 4, ch * math.ceil(len(chars) / 4)))
rows = []
stops = [(0, (255, 249, 232)), (52, (255, 242, 205)), (90, (244, 214, 151)),
         (135, (183, 125, 65)), (156, (255, 234, 184)), (203, (233, 187, 107)), (255, (133, 71, 42))]
for i, char in enumerate(chars):
    mask = Image.new('L', (cw, ch))
    ImageDraw.Draw(mask).text((18, 207), char, font=font, fill=255, anchor='ls')
    tile = Image.new('RGBA', (cw, ch))
    stroke = mask.filter(ImageFilter.MaxFilter(7))
    for dx, dy, color in [(5, 8, '#48152b'), (3, 5, '#a52e45'), (0, 0, '#731f38')]:
        layer = Image.new('RGBA', (cw, ch), color)
        layer.putalpha(ImageChops.offset(stroke, dx, dy))
        tile.alpha_composite(layer)
    rim = Image.new('RGBA', (cw, ch), '#f5d397')
    rim.putalpha(mask.filter(ImageFilter.MaxFilter(3)))
    tile.alpha_composite(rim)
    material = Image.new('RGBA', (cw, ch))
    draw = ImageDraw.Draw(material)
    for y in range(ch):
        for (a, ca), (b, cb) in zip(stops, stops[1:]):
            if a <= y <= b:
                t = (y-a)/(b-a)
                color = tuple(round(x+(z-x)*t) for x,z in zip(ca,cb))
                draw.line((0,y,cw,y),fill=(*color,255))
                break
    material.putalpha(mask)
    tile.alpha_composite(material)
    for dx,dy,color in [(2,3,'#fff9e5'),(-3,-3,'#ad7139')]:
        edge = ImageChops.subtract(mask, ImageChops.offset(mask,dx,dy))
        layer = Image.new('RGBA',(cw,ch),color);layer.putalpha(edge)
        tile.alpha_composite(layer)
    box = tile.getbbox()
    assert box and box[0] >= 6 and box[2] < cw-6 and box[1] > 0 and box[3] < ch
    x,y = (i%4)*cw,(i//4)*ch
    sheet.alpha_composite(tile,(x,y))
    l,t,r,b=box
    rows.append(f'char id={ord(char)} x={x+l} y={y+t} width={r-l} height={b-t} xoffset={l-18} yoffset={t} xadvance={math.ceil(font.getlength(char))+8} page=0 chnl=15')
sheet.save(root/'circus-gold.webp', lossless=True, method=6, exact=True)
(root/'circus-gold.fnt').write_text('\n'.join([
    'info face="Circus Gold Numerals" size=190 bold=1 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1 padding=8,8,8,8 spacing=0,0',
    f'common lineHeight={ch} base=207 scaleW={cw*4} scaleH={sheet.height} pages=1 packed=0',
    'page id=0 file="circus-gold.webp"', f'chars count={len(chars)}', *rows, 'kernings count=0',
])+'\n', encoding='utf-8')
print(f'Circus Gold: {len(chars)} glyphs, {sheet.width}x{sheet.height} RGBA, AngelCode text .fnt')
