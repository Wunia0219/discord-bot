"""Render continuous-source body motion and the frozen approved lean.

Original pixels and the AI occlusion underpainting are extracted by reviewed
source-space masks. Bones retain their source lengths. Connected head/neck/collars use one continuous inverse map with measured cloth
strain; the renderer paints no replacement anatomy or temporal AI redraw.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops, ImageFilter
from dealer_rig_math import distance, angle, rotate, solve_ik, transform_layer, axis_mask, masked
from dealer_continuous_body import PIVOT as BODY_PIVOT, forward as continuous_point, rigid as body_rigid, sample_body, sample_rigid

ROOT=Path(__file__).resolve().parents[2]
ART=ROOT/'art/dealer/v4'
CHECK=ROOT/'test-results/dealer-v4'
SIZE=(1024,1536)
HD=(1152,1664)
PAD=(64,64)
FPS=30
WAIST=(606,657)
REST={
 'leg-a':[(660,670),(605,1000),(505,1338)],
 'leg-b':[(535,670),(595,1015),(676,1377)],
 'arm-left':[(450,410),(365,525),(423,550)],
 'arm-right':[(749,372),(874,477),(807,539)],
}
POLYS={
 'leg-a':[(478,700),(704,700),(690,807),(669,900),(643,980),(613,1080),(581,1209),(561,1298),(559,1345),(580,1383),(611,1448),(610,1473),(570,1483),(508,1464),(463,1432),(442,1394),(444,1331),(464,1251),(498,1136),(524,1059),(534,1008),(519,962),(494,873),(478,790)],
 'leg-b':[(505,700),(609,700),(608,805),(618,882),(631,960),(637,1005),(670,1109),(698,1228),(712,1290),(739,1369),(746,1433),(760,1498),(740,1526),(694,1536),(651,1517),(639,1475),(638,1409),(624,1342),(610,1287),(585,1193),(554,1101),(544,1047),(521,984),(501,905),(483,820),(478,750)],
 'arm-left':[(440,409),(432,440),(421,476),(415,497),(417,516),(436,533),(461,545),(480,572),(509,591),(516,620),(489,646),(460,655),(433,645),(416,628),(405,611),(392,591),(376,580),(359,569),(344,547),(338,524),(341,503),(355,486),(379,465),(405,444),(425,421)],
 'arm-right':[(733,365),(783,379),(838,406),(890,434),(906,476),(900,511),(875,532),(850,546),(832,569),(817,620),(806,660),(782,680),(753,673),(732,656),(721,632),(732,598),(747,563),(767,521),(763,492),(748,466),(725,441),(710,407)],
 'rail':[(916,491),(986,511),(1002,534),(991,570),(972,590),(930,615),(956,662),(935,705),(932,796),(914,810),(886,802),(870,731),(853,699),(835,658),(811,639),(748,604),(705,581),(707,550),(758,522),(821,508)],
}

def poly(points,blur=.5):
 m=Image.new('L',SIZE);ImageDraw.Draw(m).polygon(points,fill=255)
 return m.filter(ImageFilter.GaussianBlur(blur)) if blur else m

def add(a,b):return (a[0]+b[0],a[1]+b[1])
def sub(a,b):return (a[0]-b[0],a[1]-b[1])
def ease(v):
 v=max(0,min(1,v));return v*v*v*(v*(v*6-15)+10)
def ramp(t,a,b):return ease((t-a)/(b-a))
def bump(t,a,b):
 if not a<t<b:return 0
 return math.sin(math.pi*(t-a)/(b-a))**2

def blink(t,center):
 d=abs(t-center)
 return 0 if d>.12 else ease(1-d/.12)

def eye_patch(master):
 path=ART/'source/eyes-closed-generated.webp'
 if not path.exists():return None
 p=Image.open(path).convert('RGBA').resize((169,112),Image.Resampling.LANCZOS)
 # Only cover the two eye sockets; retain brows, nose, skin and hair elsewhere.
 m=Image.new('L',(169,112));d=ImageDraw.Draw(m)
 d.polygon([(42,30),(51,29),(79,40),(87,51),(80,58),(61,51),(45,42)],fill=255)
 d.polygon([(92,57),(102,54),(127,59),(139,67),(140,76),(124,83),(107,77),(94,68)],fill=255)
 m=m.filter(ImageFilter.GaussianBlur(1.5))
 p.putalpha(m)
 out=Image.new('RGBA',SIZE);out.alpha_composite(p,(535,98));return out



def make_parts():
 master=Image.open(ROOT/'art/dealer/rebuild/host-master.webp').convert('RGBA')
 under=Image.open(ART/'source/occlusion-underpaint.webp').convert('RGBA')
 if master.size!=SIZE or under.size!=SIZE:raise ValueError('Source geometry changed; do not auto-register')
 masks={'arm-left':poly(POLYS['arm-left'])}
 parts={}
 shoulder_fade=Image.new('L',SIZE);sf=ImageDraw.Draw(shoulder_fade)
 for y in range(409,456):sf.line((0,y,1024,y),fill=round(255*(y-409)/46))
 sf.rectangle((0,456,1024,1536),fill=255)
 parts['arm-left-whole']=masked(master,ImageChops.multiply(masks['arm-left'],shoulder_fade))
 parts['eyes-closed']=eye_patch(master)
 left_hole=masks['arm-left'].filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.GaussianBlur(1.5))
 parts['_continuous-body-source']=Image.composite(under,master,left_hole)
 dest=ART/'parts';dest.mkdir(parents=True,exist_ok=True)
 for name,img in parts.items():
  if img is not None and not name.startswith('_'):img.save(dest/(name+'.webp'),lossless=True, quality=100, method=6, exact=True)
 return parts

def motion(clip,t,duration):
 # Envelopes are authored in time with staggered body/arm phases. This is
 # rigid painted-source motion, not newly drawn recovery or reversed frames.
 if clip=='idle':
  # A readable inhale, relaxed side lean, then a later return of the free arm.
  # Distinct phase offsets prevent the entire upper body moving as one pulse.
  lift=ramp(t,0,.90)*(1-ramp(t,1.18,duration-.03))
  lean=ramp(t,.12,1.22)*(1-ramp(t,1.48,duration-.03))
  release=bump(t,1.62,3.12)
  hand_follow=ramp(t,.28,1.38)*(1-ramp(t,1.77,duration-.03))
  return {'root':(-1.5*lift,-2.6*lift),'torso':math.radians(-.85*lean+.28*release),
          'armGestureRad':math.radians(2.3*hand_follow-.7*release),
          'hand':(0,0),'foot':(0,0),'footAngle':0,'blink':blink(t,1.47),'solidBlink':True}
 raise ValueError(clip)

def render_continuous(parts,clip,index,count):
 duration=count/FPS;t=index/FPS;m=motion(clip,t,duration)
 # The authored timing is retained; the body angle is calibrated to the
 # continuous cloth field, rather than forcing the larger pinned-plate pose.
 rad=m['torso']*(.5 if clip=='idle' else 1.0)
 body=parts['_continuous-body-source'].copy()
 blink_alpha=(1 if m['blink']>=.5 else 0) if m.get('solidBlink') else m['blink']
 if parts['eyes-closed'] is not None and blink_alpha>0:
  eyes=parts['eyes-closed'].copy();eyes.putalpha(eyes.getchannel('A').point(lambda a:round(a*blink_alpha)))
  body.alpha_composite(eyes)
 # One continuous coordinate map owns all head/neck/collar/cape/support pixels.
 # No original-master pin, waist RGBA crossfade or right-arm overlay is used.
 canvas=sample_body(body,rad)
 shoulder,elbow,wrist=REST['arm-left']
 target_shoulder=body_rigid(shoulder,rad)
 arm_angle=rad+m['armGestureRad']
 canvas.alpha_composite(sample_rigid(parts['arm-left-whole'],shoulder,target_shoulder,arm_angle))
 moved=lambda p:add(rotate(p,shoulder,arm_angle),sub(target_shoulder,shoulder))
 data={}
 for name in ['leg-a','leg-b','arm-right']:
  hip,knee,ankle=REST[name]
  mapped=[continuous_point(p,rad) for p in (hip,knee,ankle)]
  lengths=[distance(hip,knee),distance(knee,ankle)]
  error=max(abs(distance(mapped[j],mapped[j+1])-lengths[j]) for j in (0,1))
  data[name]={'hip':mapped[0],'knee':mapped[1],'ankle':mapped[2],
   'lengths':lengths,'boneError':error,'anglesDegrees':[0,0],
   'method':'actual continuous-map fixed support/leg core; no plate split'}
 data['arm-left']={'hip':target_shoulder,'knee':moved(elbow),'ankle':moved(wrist),
  'lengths':[distance(shoulder,elbow),distance(elbow,wrist)],'boneError':0,
  'anglesDegrees':[math.degrees(arm_angle)]*2,'method':'single intact bent-arm rigid sample, shoulder attached to body rigid core'}
 data.update({'frame':index,'timeMs':t*1000,'root':continuous_point(WAIST,rad),
  'bodyPivot':BODY_PIVOT,'torsoDegrees':math.degrees(rad),'blink':m['blink'],
  'renderedBlinkAlpha':blink_alpha,'supportFootDisplacement':distance(data['leg-a']['ankle'],REST['leg-a'][2]),
  'contactSlipPx':distance(continuous_point((877,503),rad),(877,503)),
  'renderMethod':'single continuous body source sampling; premultiplied alpha; separate intact free arm; no neck pin/image crossfade'})
 out=Image.new('RGBA',HD);out.alpha_composite(canvas,PAD)
 return out,data


def render(parts,clip,index,count):
 if clip!='idle':raise ValueError(clip)
 return render_continuous(parts,clip,index,count)


def contact_sheet(frames,indices,path,leg=False):
 w,h=(384,555) if not leg else (300,420)
 out=Image.new('RGB',(w*4,(h+28)*math.ceil(len(indices)/4)),(29,28,39));draw=ImageDraw.Draw(out)
 for j,i in enumerate(indices):
  p=frames[i]
  if leg:p=p.crop((475,750,845,1640))
  p=p.copy();p.thumbnail((w,h),Image.Resampling.LANCZOS)
  x=j%4*w+(w-p.width)//2;y=j//4*(h+28)
  out.paste(p,(x,y),p);draw.text((j%4*w+8,y+h+5),f'{i:02d} / {i/FPS:.3f}s',fill=(241,213,167))
 out.save(path, lossless=True, method=6, exact=True)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--clip',choices=['idle'],default='idle');ap.add_argument('--draft',action='store_true');ap.add_argument('--frame',type=int)
 args=ap.parse_args();parts=make_parts();count=96 if args.clip=='idle' else 60
 indices=([args.frame] if args.frame is not None else sorted(set([0,5,12,20,29,38,47,59] if args.clip!='idle' else [0,12,24,32,40,52,72,95]))) if args.draft or args.frame is not None else list(range(count))
 directory=ART/'frames'/args.clip;directory.mkdir(parents=True,exist_ok=True);CHECK.mkdir(parents=True,exist_ok=True)
 report=[];pics={}
 for i in indices:
  image,data=render(parts,args.clip,i,count);image.save(directory/f'{args.clip}-{i:03}.webp',lossless=True, quality=100, method=6, exact=True)
  report.append(data)
  if args.draft or i in [0,5,12,20,29,38,47,59] or i==count-1:pics[i]=image
  print(f'{args.clip} {i+1}/{count}',flush=True) if i%15==0 else None
 (ART/'rig-source.json').write_text(json.dumps({'sourceSize':SIZE,'canvas':HD,'pad':PAD,'fps':FPS,'restJoints':REST,'sourcePolygons':POLYS,'renderMethod':'same painted master; continuous premultiplied body sampling with rigid head-neck-collar core and bounded cloth transition; intact rigid free arm; approved lean frozen','sources':['art/dealer/rebuild/host-master.webp','art/dealer/v4/source/occlusion-underpaint.webp','art/dealer/v4/source/eyes-closed-generated.webp'],'legMotion':'original crossed stance retained; foot/leg IK rejected in visual review and excluded from these frames','motionRevision':4,'continuousBodyR4':'Single source-coordinate surface, no fixed/moving neck image blend; pivot620425; idle body angle-.425 max. Right support joints and legs fixed; rough mask cloth overlaps have measured subpixel movement.','status':'candidate motion, requires individual frame and actual browser review'},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 (CHECK/f'{args.clip}-rig.json').write_text(json.dumps({'clip':args.clip,'fps':FPS,'count':count,'renderedFrames':indices,'maxBoneError':max(v['boneError'] for row in report for v in row.values() if isinstance(v,dict) and 'boneError'in v),'maxSupportDisplacement':max(row['supportFootDisplacement'] for row in report),'maxContactSlipPx':max(row['contactSlipPx'] for row in report),'frames':report},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 contact_sheet(pics,list(pics),CHECK/f'{args.clip}-contact.webp')
 contact_sheet(pics,list(pics),CHECK/f'{args.clip}-legs.webp',True)
 print('Rendered',len(indices),'source-space rig frames; not new drawings')

if __name__=='__main__':main()
