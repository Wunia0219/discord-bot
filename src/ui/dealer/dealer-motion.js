import { winTier } from '../../game/win-tier.js';

export function dealerClipForRound({payout,bet}){
  // The existing WIN overlay owns big-prize feedback; the companion only
  // reacts to a profitable round below that threshold.
  if(winTier(payout,bet))return 'idle';
  return payout>bet?'win':'idle';
}

// Both layouts reserve a complete full-body area to the left of the reels.
// Desktop gives the host a larger presence; phones keep every limb in view.
export function dealerPlacement(sceneWidth){
  return sceneWidth>=1100?{x:40,y:680,scale:1.65}:{x:156,y:660,scale:.85};
}

// A playback reference can reuse a drawing, for example when a gesture returns
// through its earlier poses. Keep timing and texture selection in that order.
export function dealerFrameSequence(clip,fps){
  const drawings=clip.pages.flatMap((page,pageIndex)=>Object.entries(page.frames).map(([key,entry])=>({key,pageIndex,entry})));
  const byKey=new Map(drawings.map(drawing=>[drawing.key,drawing]));
  if(byKey.size!==drawings.length)throw new RangeError('Duplicate dealer drawing key');
  const order=clip.order??drawings.map(drawing=>drawing.key).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  return order.map(key=>{
    const drawing=byKey.get(key);
    if(!drawing)throw new RangeError('Unknown dealer drawing: '+key);
    const durationMs=drawing.entry.durationMs??1000/fps;
    if(!Number.isFinite(durationMs)||durationMs<=0)throw new RangeError('Invalid dealer frame duration: '+key);
    return {key,pageIndex:drawing.pageIndex,durationMs};
  });
}
