"""Pack imagegen title masters into the original 1072x264 title slot.
Only deterministic export/geometry: preserve artwork and alpha, never repaint.
"""
from pathlib import Path
import json
from PIL import Image, ImageChops
root=Path(__file__).resolve().parents[1]/'images'/'fx'
manifest={'size':[1072,264],'anchor':[536,132],'safePadding':[16,12],'titles':{}}
for tier in ['super','mega']:
    source=root/f'{tier}-win-title-source.png'
    image=Image.open(source).convert('RGBA')
    # Ignore imagegen's near-transparent (<3.2%) canvas dust when sizing text.
    # Keep the untouched source master; include an 8px margin around visible art.
    visible=image.getchannel('A').point(lambda a:255 if a>8 else 0).getbbox()
    bounds=(max(0,visible[0]-8),max(0,visible[1]-8),min(image.width,visible[2]+8),min(image.height,visible[3]+8))
    assert bounds is not None
    # Each source is a single title, not a multi-frame sprite sheet.
    title=image.crop(bounds)
    title.thumbnail((1040,240),Image.Resampling.LANCZOS)
    canvas=Image.new('RGBA',(1072,264))
    position=((1072-title.width)//2,252-title.height)
    canvas.alpha_composite(title,position)
    png=root/f'{tier}-win-title.png';webp=png.with_suffix('.webp')
    canvas.save(png);canvas.save(webp,lossless=True,method=6,exact=True)
    actual=canvas.getchannel('A').getbbox()
    assert actual[0]>=16 and actual[1]>=12 and actual[2]<=1056 and actual[3]<=252
    decoded=Image.open(webp).convert('RGBA')
    assert ImageChops.difference(canvas.getchannel('A'),decoded.getchannel('A')).getbbox() is None
    manifest['titles'][tier]={'sourceSize':list(image.size),'sourceBounds':list(bounds),'bounds':list(actual),'file':webp.name,'text':tier.upper()+' WIN'}
(root/'win-titles.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
