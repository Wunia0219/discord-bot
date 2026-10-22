"""Render one new joyful host action from retained painted sources.

Artist-generated facial keys are composited inside the original facial skin
before the common body coordinate map. No neck/head plate is pasted on top.
The full free arm is sampled once; source PNGs share idle's canvas/anchor.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
import dealer_win_body as field
from dealer_continuous_body import sample_rigid
from dealer_rig_math import distance, rotate
from dealer_expression_morph import morph

ROOT=Path(__file__).resolve().parents[2]
DESIGN=ROOT/'art/dealer/win-design'
ART=ROOT/'art/dealer/v4'
QA=ROOT/'test-results/dealer-win'
FPS=30
COUNT=108
SIZE=(1024,1536)
HD=(1152,1664)
PAD=(64,64)
FACE_BOX=(500,50,756,306)

def load_idle():
 spec=importlib.util.spec_from_file_location('retained_dealer_idle',Path(__file__).with_name('build-dealer-v4.py'))
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 return module

def ramp(t,a,b):
 return field.smooth((t-a)/(b-a))

def face_keys():
 result={}
 for name in ('warm','joy','half-eye','wink'):
  with Image.open(DESIGN/f'{name}-expression-generated.png') as image:
   result[name]=image.convert('RGBA').resize((256,256),Image.Resampling.LANCZOS)
 mask=Image.new('L',(256,256));d=ImageDraw.Draw(mask)
 # Boundary lies inside facial skin; original jaw/hair/collar silhouette stays.
 d.polygon([(80,76),(95,78),(111,88),(121,95),(133,101),(149,103),
  (167,109),(172,121),(158,135),(146,149),(127,163),(114,164),
  (95,153),(82,133),(73,112),(75,94)],fill=255)
 result['face-mask']=mask.filter(ImageFilter.GaussianBlur(2.5))
 eye=Image.new('L',(256,256));e=ImageDraw.Draw(eye)
 e.polygon([(78,78),(91,78),(111,86),(123,97),(117,105),
  (105,101),(88,94),(78,87)],fill=255)
 result['wink-mask']=eye.filter(ImageFilter.GaussianBlur(1.2))
 return result

def expression_at(source,keys,t):
 warm=ramp(t,.06,.42)*(1-ramp(t,2.90,3.43))
 joy=ramp(t,.42,1.00)*(1-ramp(t,2.15,2.90))
 neutral=source.crop(FACE_BOX)
 # Same registered crop and mask for all keys, no per-frame crop/scale.
 painted=(morph(keys['warm'],keys['joy'],'warm','joy',joy)
  if joy>0 else morph(neutral,keys['warm'],'neutral','warm',warm))
 eye=None
 if 1.40<=t<1.80:
  eye='half-eye' if t<1.4666666667 or t>=1.7333333333 else 'wink'
  painted=Image.composite(keys[eye],painted,keys['wink-mask'])
 if warm<=0 and joy<=0 and eye is None:
  return source,{'warm':0.,'joy':0.,'eye':'original'}
 out=source.copy();out.paste(Image.composite(painted,neutral,keys['face-mask']),FACE_BOX[:2])
 return out,{'warm':warm,'joy':joy,'eye':eye or 'open'}

def sample_surface(source,rad,grid=8):
 if abs(rad)<1e-14:return source.convert('RGBa').convert('RGBA')
 width,height=source.size
 xs=list(range(0,width,grid))+[width];ys=list(range(0,height,grid))+[height]
 vertices={(x,y):field.inverse((x,y),rad) for y in ys for x in xs}
 cells=[]
 for top,bottom in zip(ys,ys[1:]):
  for left,right in zip(xs,xs[1:]):
   quad=sum((vertices[p] for p in ((left,top),(left,bottom),(right,bottom),(right,top))),())
   cells.append(((left,top,right,bottom),quad))
 return source.convert('RGBa').transform(SIZE,Image.Transform.MESH,cells,
  resample=Image.Resampling.BICUBIC).convert('RGBA')

def render(idle,parts,keys,index):
 t=index/FPS;m=field.motion(t);rad=m['bodyRad'];gesture=m['gestureRad']
 source,expression=expression_at(parts['_continuous-body-source'],keys,t)
 canvas=sample_surface(source,rad)
 shoulder,elbow,wrist=idle.REST['arm-left'];target=field.forward(shoulder,rad)
 angle=rad+gesture
 canvas.alpha_composite(sample_rigid(parts['arm-left-whole'],shoulder,target,angle))
 data={}
 for name,rest in idle.REST.items():
  if name=='arm-left':
   points=[field.free_arm_point(p,rad,gesture) for p in rest];metric='rigid-limb'
  else:
   points=[field.forward(p,rad) for p in rest];metric='continuous-surface-landmarks'
  lengths=[distance(rest[j],rest[j+1]) for j in (0,1)]
  error=max(abs(distance(points[j],points[j+1])-lengths[j]) for j in (0,1))
  data[name]={'hip':points[0],'knee':points[1],'ankle':points[2],
   'lengths':lengths,'boneError':error,'metricType':metric,
   'method':'Actual mapped painted-source landmarks; free arm rigid, other surface segments bounded by measured 3 percent local strain.'}
 data.update({'frame':index,'timeMs':t*1000,'root':field.forward(idle.WAIST,rad),
  'geometryModel':'continuous-source-landmarks','bodyPivot':field.PIVOT,
  'torsoDegrees':math.degrees(rad),'freeArmRelativeDegrees':math.degrees(gesture),
  'expression':expression,'contactSlipPx':distance(field.forward((877,503),rad),(877,503)),
  'supportFootDisplacement':distance(data['leg-a']['ankle'],idle.REST['leg-a'][2]),
  'renderMethod':'artist facial keys inside original face before one continuous body sample; intact free arm; no neck pin or separate head layer'})
 out=Image.new('RGBA',HD);out.alpha_composite(canvas,PAD)
 return out,data

def expression_probes(parts,keys,directory):
 times=[0,.25,.42,.72,1.10,1.4333333333,1.60,1.7666666667,2.50,3.15,3.5666666667]
 width=256;height=280;sheet=Image.new('RGB',(width*4,height*3),(29,28,39));draw=ImageDraw.Draw(sheet)
 for i,t in enumerate(times):
  source,info=expression_at(parts['_continuous-body-source'],keys,t)
  crop=source.crop(FACE_BOX);crop.save(directory/f'face-{i:02}.png')
  x=i%4*width;y=i//4*height;sheet.paste(crop,(x,y),crop)
  draw.text((x+5,y+258),f'{t:.3f}s {info["eye"]}',fill=(245,218,177))
 sheet.save(directory/'expression-contact.png')

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--probe',action='store_true');ap.add_argument('--faces-only',action='store_true');args=ap.parse_args()
 idle=load_idle();parts=idle.make_parts();keys=face_keys();QA.mkdir(parents=True,exist_ok=True)
 directory=DESIGN/'combined-probes' if args.probe or args.faces_only else ART/'frames/win'
 directory.mkdir(parents=True,exist_ok=True)
 if args.probe or args.faces_only:
  expression_probes(parts,keys,directory)
 if args.faces_only:return
 indices=[0,8,14,23,31,42,44,46,50,53,65,80,96,107] if args.probe else list(range(COUNT))
 rows=[];pics={}
 for i in indices:
  image,data=render(idle,parts,keys,i);image.save(directory/f'win-{i:03}.png',compress_level=3)
  rows.append(data)
  if args.probe or i in (0,14,31,44,50,65,80,107):pics[i]=image
  if i%15==0:print(f'win {i+1}/{COUNT}',flush=True)
 report={'clip':'win','fps':FPS,'count':COUNT,'renderedFrames':indices,'geometryModel':'continuous-source-landmarks',
  'maxBoneError':max(v['boneError'] for row in rows for v in row.values() if isinstance(v,dict) and 'boneError'in v),
  'maxContactSlipPx':max(r['contactSlipPx'] for r in rows),
  'maxSupportDisplacement':max(r['supportFootDisplacement'] for r in rows),'frames':rows}
 report_path=directory/'win-rig.json' if args.probe else ART.parents[2]/'test-results/dealer-v4/win-rig.json'
 report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 idle.contact_sheet(pics,list(pics),directory/'win-contact.png' if args.probe else QA/'win-contact.png')
 print('Rendered',len(rows),'new win samples; idle sources not modified.',flush=True)

if __name__=='__main__':main()
