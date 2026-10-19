import test from 'node:test';
import assert from 'node:assert/strict';
import { SpinControls } from '../src/ui/spin-controls.js';
import { TEST_STOPS } from './helpers/current-model.js';
import { createRound,freshState } from '../src/game/index.js';
function harness(){
  let ready=true,busy=false,starts=0,stops=0,id=0;
  const queued=new Map(),changes=[];
  const controls=new SpinControls({isReady:()=>ready,isBusy:()=>busy,startSpin:()=>{starts++;busy=true;controls.beginRound();},stopReels:()=>{stops++;},onAutoChange:value=>changes.push(value),schedule:(callback,delay)=>{queued.set(++id,{callback,delay});return id;},cancel:id=>queued.delete(id)});
  return {controls,queued,changes,get starts(){return starts;},get stops(){return stops;},set busy(value){busy=value;},set ready(value){ready=value;},finish(delay){busy=false;controls.endRound(delay);},advance(){const q=[...queued.values()];queued.clear();q.forEach(({callback})=>callback());}};
}
test('first Space starts once; subsequent presses request only a quick stop, including network latency',()=>{
  const h=harness();h.controls.space();assert.equal(h.starts,1);
  h.controls.space();h.controls.space();assert.equal(h.starts,1);assert.ok(h.controls.quickStop);
  h.controls.animationStarted();assert.equal(h.stops,3);
  h.finish();h.controls.space();assert.equal(h.starts,2);assert.equal(h.controls.quickStop,false);
});
test('auto queues exactly one next round after feedback and can stop during a spin or the delay',()=>{
  const h=harness();h.controls.toggleAuto();assert.equal(h.starts,1);assert.equal(h.queued.size,0);
  h.finish(5200);assert.equal(h.queued.size,1);assert.equal([...h.queued.values()][0].delay,5200);
  h.advance();assert.equal(h.starts,2);
  h.controls.toggleAuto();assert.equal(h.controls.auto,false);h.finish();h.advance();assert.equal(h.starts,2);
  h.controls.toggleAuto();h.finish(1600);h.controls.stopAuto();h.advance();assert.equal(h.starts,3);
});
test('enabling auto during a manual spin waits for its settlement and Space cannot create duplicate queued spins',()=>{
  const h=harness();h.controls.space();h.controls.toggleAuto();assert.equal(h.starts,1);
  h.finish(1600);assert.equal(h.queued.size,1);
  h.controls.space();assert.equal(h.starts,2);assert.equal(h.queued.size,0);h.advance();assert.equal(h.starts,2);
});
test('background, dialogs, insufficient funds and errors cancel automatic continuation',()=>{
  for(const reason of ['background','dialog','insufficient','error']){
    const h=harness();h.controls.toggleAuto();h.finish();
    if(reason==='background'||reason==='dialog'){h.ready=false;h.advance();}
    else {h.controls.stopAuto();h.advance();}
    assert.equal(h.controls.auto,false);assert.equal(h.starts,1);assert.equal(h.queued.size,0);
  }
  const h=harness();h.ready=false;h.controls.space();h.controls.toggleAuto();assert.equal(h.starts,0);
});

test('automatic play stops on a real insufficient-funds settlement without another debit',()=>{
  let state={...freshState(),balance:20},busy=false,nextRound,attempts=0;
  const controls=new SpinControls({isReady:()=>true,isBusy:()=>busy,stopReels:()=>{},onAutoChange:()=>{},schedule:callback=>{nextRound=callback;return 1;},cancel:()=>{nextRound=null;},startSpin:()=>{
    controls.beginRound();busy=true;attempts++;
    try{state=createRound(state,20,TEST_STOPS.none,`auto-${attempts}`).state;}
    catch{controls.stopAuto();}
    finally{busy=false;controls.endRound();}
  }});
  controls.toggleAuto();assert.equal(state.balance,0);assert.equal(state.history.length,1);
  const callback=nextRound;nextRound=null;callback();assert.equal(attempts,2);assert.equal(state.balance,0);
  assert.equal(state.history.length,1);assert.equal(controls.auto,false);assert.equal(nextRound,null);
});

test('a quick stop requested before the wallet response does not repeat settlement or discard its result',async()=>{
  let busy=false,release,settlements=0,stops=0,state=freshState(),pending;
  const response=new Promise(resolve=>{release=resolve;});
  const controls=new SpinControls({isReady:()=>true,isBusy:()=>busy,onAutoChange:()=>{},stopReels:()=>{stops++;},startSpin:()=>{
    controls.beginRound();busy=true;
    pending=(async()=>{await response;const update=createRound(state,20,TEST_STOPS.none,'network-round');state=update.state;settlements++;controls.animationStarted();busy=false;controls.endRound();})();
  }});
  controls.space();controls.space();controls.space();assert.equal(settlements,0);
  release();await pending;
  assert.equal(settlements,1);assert.equal(state.balance,9980);assert.equal(state.history.length,1);
  assert.deepEqual(state.history[0].stops,TEST_STOPS.none);assert.equal(stops,3);
});
