"""Offline integer paytable design. Requires scipy; never edits the live model.
The full-grid verifier must validate any selected candidate before release.
"""
import itertools, json, math
from pathlib import Path
import numpy as np
from scipy.optimize import milp, Bounds, LinearConstraint

ROOT = Path(__file__).resolve().parents[1]
COUNTS = [[1,1,2,2,3,3,3,4,1], [1,2,1,2,3,3,4,3,1],
          [2,1,2,1,3,4,3,3,1], [1,2,2,1,4,3,3,3,1], [2,2,2,2,4,4,4,4,1]]
TARGET = np.array([[25,80,400],[20,70,300],[16,60,200],[14,50,150],
                   [12,35,90],[10,30,80],[9,25,70],[8,20,60],[20,60,2000]]).flatten()
denominator = math.prod(map(sum,COUNTS))
coeff = np.zeros(27, dtype=np.int64)
comparisons=set()
for symbols in itertools.product(range(9), repeat=5):
    options=[]
    for symbol in range(9):
        count=0
        for value in symbols:
            if value==symbol or (symbol!=8 and value==8): count+=1
            else: break
        if count>=3: options.append(symbol*3+count-3)
    if not options: continue
    best=max(options,key=lambda i: TARGET[i])
    coeff[best]+=math.prod(COUNTS[i][s] for i,s in enumerate(symbols))
    comparisons.update((best,other) for other in options if other!=best)

rows=[]; lower=[]; upper=[]
def constraint(items, lo, hi):
    row=np.zeros(54)
    for i,value in items: row[i]=value
    rows.append(row);lower.append(lo);upper.append(hi)
# Integer equation uses unscaled counts to preserve exact RTP.
constraint(enumerate(coeff), denominator*24//25, denominator*24//25)
for best,other in comparisons: constraint([(best,1),(other,-1)],0,np.inf)
for s in range(9):
    for n in range(2): constraint([(s*3+n+1,1),(s*3+n,-1)],1,np.inf)
for s in range(7):
    for n in range(3): constraint([(s*3+n,1),((s+1)*3+n,-1)],0,np.inf)
# Low-symbol wins should contribute 40–65 percentage points of return.
constraint([(i,int(coeff[i])) for i in range(12,24)],.4*denominator,.65*denominator)
for i,target in enumerate(TARGET):
    constraint([(i,1),(27+i,-1)],-np.inf,target)
    constraint([(i,-1),(27+i,-1)],-np.inf,-target)
lb=np.concatenate([np.maximum(1,np.floor(TARGET*.5)),np.zeros(27)])
ub=np.concatenate([np.ceil(TARGET*2),np.full(27,np.inf)])
lb[26]=ub[26]=2000
objective=np.concatenate([np.zeros(27),1/np.sqrt(TARGET)])
result=milp(objective,integrality=np.concatenate([np.ones(27),np.zeros(27)]),
            bounds=Bounds(lb,ub),constraints=LinearConstraint(np.array(rows),lower,upper),
            options={'time_limit':90,'mip_rel_gap':.002})
if result.x is None: raise RuntimeError(result.message)
pay=np.rint(result.x[:27]).astype(int)
# WILD can substitute a full prefix for any symbol. Canonicalize dominated
# WILD table entries to the effective award without changing any outcome.
for n in range(3):
    effective=max(pay[s*3+n] for s in range(8))
    if pay[24+n]<effective:
        assert coeff[24+n]==0
        pay[24+n]=effective
assert int(coeff@pay)*25==denominator*24
output={'counts':COUNTS,'paytable':pay.reshape(9,3).tolist(),'linePayoutSum':int(coeff@pay),
        'stopCombinations':denominator,'lowReturn':float(coeff[12:24]@pay[12:24]/denominator),'solver':result.message}
(ROOT/'docs/model-v2-candidate.json').write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps(output,indent=2))
