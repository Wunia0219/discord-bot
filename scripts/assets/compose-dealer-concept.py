"""Non-destructive concept assembly using original game pixels + one new host.
No painting, character warp, per-frame registration or AI redraw of the cabinet.
"""
from pathlib import Path
import json
from PIL import Image,ImageDraw,ImageFilter,ImageOps
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'art/dealer/rebuild'
W,H=1440,900
back=Image.open(ROOT/'images/jokers-circus/circus-background.webp').convert('RGBA')
canvas=ImageOps.fit(back,(W,H),Image.Resampling.LANCZOS,centering=(.5,.57))
shade=Image.new('RGBA',(W,H));d=ImageDraw.Draw(shade)
for y in range(H):
 alpha=round(35+65*max(0,(y/H-.6)/.4))
 d.line((0,y,W,y),fill=(12,13,30,alpha))
canvas.alpha_composite(shade)
main=Image.open(ROOT/'images/main.webp').convert('RGBA')
main_data=json.loads((ROOT/'images/main.json').read_text())
symbols=Image.open(ROOT/'images/symbols.webp').convert('RGBA')
symbol_data=json.loads((ROOT/'images/symbols.json').read_text())
def art(atlas,data,key,padded=False):
 e=data['frames'][key];f=e['frame'];p=atlas.crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']))
 if padded:
  out=Image.new('RGBA',(e['sourceSize']['w'],e['sourceSize']['h']))
  out.alpha_composite(p,(e['spriteSourceSize']['x'],e['spriteSourceSize']['y']));return out
 return p
# Original 1200px game coordinates translated 180px right, 30px down.
gx,gy,gw,gh=435,258,690,408
field=Image.new('RGBA',(gw,gh),(16,23,45,255));draw=ImageDraw.Draw(field)
for c in range(5):
 draw.rectangle((c*138,3,(c+1)*138-1,gh-3),fill=(25,16,43,255) if c%2 else (35,28,54,255))
 if c:draw.line((c*138,8,c*138,gh-8),fill=(100,83,63,255),width=1)
canvas.alpha_composite(field,(gx,gy))
# New full-resolution drawing, scaled once for this concept only.
host=Image.open(OUT/'host-master.png').convert('RGBA')
scale=.42
host_size=tuple(round(v*scale) for v in host.size)
host_origin=(-7,112)
host_scaled=host.resize(host_size,Image.Resampling.LANCZOS)
ground=Image.new('RGBA',(W,H));draw=ImageDraw.Draw(ground)
draw.ellipse((195,716,270,731),fill=(5,4,12,160));draw.ellipse((254,744,317,760),fill=(5,4,12,170));ground=ground.filter(ImageFilter.GaussianBlur(5));canvas.alpha_composite(ground)
canvas.alpha_composite(host_scaled,host_origin)
frame=art(main,main_data,'circus-reel-frame.png')
frame_size=(round(768*gw/607),round(483*gh/335))
frame_origin=(round(gx-80*gw/607),round(gy-90*gh/335))
canvas.alpha_composite(frame.resize(frame_size,Image.Resampling.LANCZOS),frame_origin)
contact_shadow=Image.new('RGBA',(W,H));contact_draw=ImageDraw.Draw(contact_shadow)
contact_draw.ellipse((388,352,420,370),fill=(12,5,13,90));canvas.alpha_composite(contact_shadow.filter(ImageFilter.GaussianBlur(3)))
# The rear cape is behind the existing frame; the contact forearm/ledge is in front.
contact=Image.new('RGBA',host.size)
contact_box=(690,380,1024,615)
contact.alpha_composite(host.crop(contact_box),contact_box[:2])
canvas.alpha_composite(contact.resize(host_size,Image.Resampling.LANCZOS),host_origin)
# Same padded symbol art and 132px render size as the live game.
columns=[['L4.png','H1.png','L3.png'],['H3.png','L2.png','H1.png'],['L1.png','L3.png','H1.png'],['L1.png','WILD.png','H1.png'],['L4.png','H1.png','H2.png']]
for col,names in enumerate(columns):
 for row,key in enumerate(names):
  p=art(symbols,symbol_data,key,True).resize((132,132),Image.Resampling.LANCZOS)
  canvas.alpha_composite(p,(gx+col*138+3,gy+row*136+2))
logo=art(main,main_data,'logo-long.png');logo=logo.resize((500,round(logo.height*500/logo.width)),Image.Resampling.LANCZOS)
canvas.alpha_composite(logo,(530,30))
canvas.save(OUT/'concept-composite.png')
# A close view for judging texture and the physical contact, not another generated drawing.
canvas.crop((0,95,490,780)).save(OUT/'concept-contact-detail.png')
(OUT/'composition.json').write_text(json.dumps({'status':'static design concept, not a gameplay screenshot or completed animation','canvas':[W,H],'machineTranslation':[180,30],'machineOriginalArt':['images/main.webp','images/symbols.webp','images/jokers-circus/circus-background.webp'],'frameOrigin':frame_origin,'frameSize':frame_size,'hostNativeSize':host.size,'hostScale':scale,'hostOrigin':host_origin,'layerOrder':['background','reel field','host rear/body','existing machine frame','host contact forearm/ledge','original reel symbols','original logo'],'note':'Wider concept layout explores a true left-side host area. Runtime responsive layout has not been changed.'},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('Concept',canvas.size,'Host native',host.size)
