import test from 'node:test';
import assert from 'node:assert/strict';
import {DealerPreviewControls} from '../src/ui/dealer/dealer-preview-controls.js';

const clips={idle:{frames:72,loop:true},'win':{frames:48,loop:false},'big-win':{frames:72,loop:false}};

function makeDealer({deferred=false}={}){
  const waiting=[],calls=[];
  const sprite={
    currentFrame:0,totalFrames:72,playing:true,loop:true,
    play(){this.playing=true;calls.push('play');},
    stop(){this.playing=false;calls.push('stop');},
    gotoAndPlay(frame){this.currentFrame=frame;this.play();},
    gotoAndStop(frame){this.currentFrame=frame;this.stop();},
    update({frames=1}={}){
      // Match AnimatedSprite: manually calling update does not resume a stopped sprite.
      if(!this.playing)return;
      this.currentFrame+=frames;
      if(this.currentFrame>=this.totalFrames){
        if(this.loop)this.currentFrame%=this.totalFrames;
        else {this.gotoAndStop(this.totalFrames-1);this.onComplete?.();}
      }
    },
  };
  const dealer={
    sprite,action:'idle',request:0,updates:0,
    async play(name){
      const request=++this.request;
      if(deferred)await new Promise((resolve,reject)=>waiting.push({name,resolve,reject}));
      if(request!==this.request)return;
      this.action=name;sprite.totalFrames=clips[name].frames;sprite.loop=clips[name].loop;
      sprite.onComplete=()=>this.play('idle');sprite.gotoAndPlay(0);
    },
    update(ticker){this.updates++;sprite.update(ticker);},
  };
  return {dealer,sprite,waiting,calls};
}

test('resuming after middle-frame inspection restarts the stopped AnimatedSprite',async()=>{
  const {dealer,sprite}=makeDealer(),controls=new DealerPreviewControls(dealer,clips);
  await controls.select('win');
  controls.showMiddle();
  assert.equal(sprite.currentFrame,24);assert.equal(sprite.playing,false);
  controls.tick({frames:2});assert.equal(sprite.currentFrame,24);
  controls.setPaused(false);
  assert.equal(sprite.playing,true);
  controls.tick({frames:2});assert.equal(sprite.currentFrame,26);
  controls.togglePaused();controls.tick({frames:2});assert.equal(sprite.currentFrame,26);
  controls.togglePaused();controls.tick({frames:2});assert.equal(sprite.currentFrame,28);
});

test('selecting or reselecting a motion always starts at frame zero and unpauses',async()=>{
  const {dealer,sprite}=makeDealer(),controls=new DealerPreviewControls(dealer,clips);
  await controls.select('big-win');controls.tick({frames:17});
  assert.equal(sprite.currentFrame,17);
  await controls.select('big-win');assert.equal(sprite.currentFrame,0);
  controls.showMiddle();
  await controls.select('idle');
  assert.equal(controls.paused,false);assert.equal(sprite.playing,true);assert.equal(sprite.currentFrame,0);
});

test('preview repeat holds one-shot reactions while disabling repeat preserves return-to-idle',async()=>{
  const {dealer,sprite}=makeDealer(),controls=new DealerPreviewControls(dealer,clips);
  await controls.select('win');
  assert.equal(clips['win'].loop,false,'preview must not mutate manifest semantics');
  assert.equal(sprite.loop,true);
  controls.tick({frames:50});assert.equal(dealer.action,'win');assert.equal(sprite.currentFrame,2);
  controls.setRepeat(false);assert.equal(sprite.loop,false);
  controls.tick({frames:48});await Promise.resolve();
  assert.equal(dealer.action,'idle');assert.equal(sprite.loop,true);
  controls.setRepeat(false);assert.equal(sprite.loop,true,'native idle loops remain enabled');
  controls.setRepeat(true);assert.equal(sprite.loop,true);
});

test('pause intent made during loading survives the completed selection',async()=>{
  const {dealer,sprite,waiting}=makeDealer({deferred:true});
  const controls=new DealerPreviewControls(dealer,clips),selection=controls.select('big-win');
  controls.setPaused(true);controls.tick({frames:5});
  assert.equal(dealer.updates,0);
  waiting[0].resolve();await selection;
  assert.equal(controls.loading,false);assert.equal(controls.paused,true);
  assert.equal(sprite.currentFrame,0);assert.equal(sprite.playing,false);
  controls.setPaused(false);controls.tick({frames:3});assert.equal(sprite.currentFrame,3);
});

test('rapid selections resolving out of order cannot stop or rewind the newer motion',async()=>{
  const {dealer,sprite,waiting,calls}=makeDealer({deferred:true});
  const changes=[],controls=new DealerPreviewControls(dealer,clips,()=>changes.push(controls.selected));
  const first=controls.select('win'),second=controls.select('big-win');
  waiting[1].resolve();assert.equal(await second,true);
  controls.tick({frames:9});
  const currentCalls=calls.length,currentChanges=changes.length;
  waiting[0].resolve();assert.equal(await first,false);
  assert.equal(dealer.action,'big-win');assert.equal(controls.selected,'big-win');
  assert.equal(sprite.currentFrame,9);assert.equal(sprite.playing,true);
  assert.equal(calls.length,currentCalls);assert.equal(changes.length,currentChanges);
  assert.equal(controls.loading,false);
});

test('middle-frame and repeat intent made during loading apply to the newly loaded clip',async()=>{
  const {dealer,sprite,waiting}=makeDealer({deferred:true});
  const controls=new DealerPreviewControls(dealer,clips),selection=controls.select('win');
  controls.showMiddle();controls.setRepeat(false);
  waiting[0].resolve();await selection;
  assert.equal(sprite.currentFrame,24);assert.equal(sprite.playing,false);assert.equal(sprite.loop,false);
});

test('a swallowed Dealer load failure cannot label or restart the old idle artwork as a new motion',async()=>{
  const {dealer,sprite,calls}=makeDealer();
  // Core Dealer.play logs asset failures and resolves with its old action intact.
  dealer.play=async()=>{};sprite.currentFrame=17;
  const controls=new DealerPreviewControls(dealer,clips),notifications=[];
  controls.onChange=()=>notifications.push({selected:controls.selected,loading:controls.loading});
  await assert.rejects(controls.select('big-win'),/motion was not activated: big-win/);
  assert.equal(controls.selected,'idle');assert.equal(controls.loading,false);
  assert.equal(dealer.action,'idle');assert.equal(sprite.currentFrame,17);
  assert.equal(sprite.playing,true);assert.equal(sprite.loop,true);
  assert.deepEqual(calls,[],'failed activation must not rewind or alter the old sprite');
  assert.deepEqual(notifications.at(-1),{selected:'idle',loading:false});
});
