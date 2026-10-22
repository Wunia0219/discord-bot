"""Register painted lip contours before mixing expression textures.

No mouth is drawn by code. Authored source landmarks guide a bounded inverse
coordinate warp; both painted lip lines meet at the interpolated contour.
Outside the small mouth region the source coordinates remain unchanged.
"""
import bisect
from PIL import Image

# Positions in the common 256px face reference crop. Joy corresponds to the
# upper lip; the painted lower lip/teeth emerge as the aperture opens.
CURVES={
 'neutral':[(89,135.0),(94,139.0),(99,142.0),(104,144.0),(109,146.0),(114,147.5),(121,148.5)],
 'warm':[(89,132.0),(94,136.2),(99,139.0),(104,141.5),(109,144.0),(114,145.5),(124,147.5)],
 'joy':[(89,132.0),(94,135.7),(99,138.0),(104,140.5),(109,143.0),(114,145.0),(124,147.3)],
}

def smooth(v):
 v=max(0.,min(1.,v));return v*v*v*(v*(v*6.-15.)+10.)

def curve(points,u):
 position=u*(len(points)-1);i=max(0,min(len(points)-2,int(position)))
 f=position-i
 return tuple(points[i][a]*(1-f)+points[i+1][a]*f for a in (0,1))

def align(source,source_curve,target_curve):
 """Single common inverse warp with fixed outer skin coordinates."""
 if source_curve==target_curve:return source
 width,height=source.size;grid=2
 xs=list(range(0,width,grid))+[width];ys=list(range(0,height,grid))+[height]
 left,right=target_curve[0][0],target_curve[-1][0]
 def inverse(x,y):
  weight=smooth((x-78)/11)*(1-smooth((x-126)/13))*smooth((y-121)/10)*(1-smooth((y-152)/15))
  if weight==0:return x,y
  # Find correspondence along the target contour, rather than trusting equal
  # parameter spacing when its mouth width changes between painted keys.
  columns=[p[0] for p in target_curve]
  index=max(0,min(len(columns)-2,bisect.bisect_right(columns,x)-1))
  fraction=(x-columns[index])/(columns[index+1]-columns[index])
  u=(index+fraction)/(len(columns)-1)
  sx,sy=curve(source_curve,u);_,ty=curve(target_curve,u)
  return x+weight*(sx-x),y+weight*(sy-ty)
 vertices={(x,y):inverse(x,y) for y in ys for x in xs};cells=[]
 for top,bottom in zip(ys,ys[1:]):
  for left,right in zip(xs,xs[1:]):
   quad=sum((vertices[p] for p in ((left,top),(left,bottom),(right,bottom),(right,top))),())
   cells.append(((left,top,right,bottom),quad))
 return source.convert('RGBa').transform(source.size,Image.Transform.MESH,cells,
  resample=Image.Resampling.BICUBIC).convert('RGBA')

def morph(first,second,first_name,second_name,amount):
 if amount<=0:return first
 if amount>=1:return second
 a=CURVES[first_name];b=CURVES[second_name]
 target=[tuple(p[i]*(1-amount)+q[i]*amount for i in (0,1)) for p,q in zip(a,b)]
 return Image.blend(align(first,a,target),align(second,b,target),amount)
