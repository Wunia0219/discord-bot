import assert from 'node:assert/strict';

// A slow frame may cross several deadlines; each cue must fire on that first frame.
export function assertFirstDueFrame(event,label){
  assert.ok([event.previousClock,event.clock,event.scheduled].every(Number.isFinite),`${label}: missing frame timing`);
  assert.ok(event.previousClock<event.scheduled&&event.scheduled<=event.clock,
    `${label}: expected first frame crossing ${event.scheduled}ms, got ${event.previousClock}..${event.clock}ms`);
}

export function assertReelCadence(sounds,label){
  assert.deepEqual(sounds.map(event=>event.index),[0,1,2,3,4],`${label}: five ordered cues`);
  for(const [index,event] of sounds.entries()){
    assertFirstDueFrame(event,`${label}: reel ${index}`);
    if(index)assert.ok(Math.abs(event.scheduled-sounds[index-1].scheduled-60)<1e-7,
      `${label}: planned cadence must remain 60ms`);
  }
}
