import test from 'node:test';
import assert from 'node:assert/strict';
import {Sound} from '../src/ui/audio/audio.js';
import {cueVoices} from '../src/ui/audio/audio-cues.js';

function fixture({music=true,stereo=true}={}){
  const parameter=()=>({value:0,setValueAtTime(value){this.value=value;},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(value){this.value=value;}});
  const node=()=>({gain:parameter(),connect(){},disconnect(){this.disconnected=true;}});
  const oscillators=[],panners=[];
  const context={state:'suspended',currentTime:1,destination:{},createGain:node,resume:async()=>{context.state='running';},suspend:async()=>{context.state='suspended';},close:async()=>{context.state='closed';},createOscillator:()=>{
    const oscillator={...node(),frequency:parameter(),stops:[],start(at){this.started=at;},stop(at){this.stops.push(at);}};
    oscillators.push(oscillator);return oscillator;
  }};
  if(stereo)context.createStereoPanner=()=>{const panner={...node(),pan:parameter()};panners.push(panner);return panner;};
  const player={paused:true,plays:0,handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},play:async()=>{player.paused=false;player.plays++;},pause:()=>{player.paused=true;}};
  let hidden=false;
  const changes=[];
  const sound=new Sound({contextFactory:()=>context,musicUrl:music?'/provided-music.mp3':null,musicFactory:()=>player,isHidden:()=>hidden,onStateChange:state=>changes.push(state)});
  return {sound,context,player,oscillators,panners,changes,set hidden(value){hidden=value;}};
}

test('audio is silent by default and missing music remains unavailable',async()=>{
  const {sound,oscillators}=fixture({music:false});
  assert.deepEqual(sound.state,{effectsEnabled:false,musicEnabled:false,musicAvailable:false});
  sound.spin();sound.win(true);assert.equal(oscillators.length,0);
  assert.equal(await sound.setMusicEnabled(true),false);
  assert.equal(sound.context,null,'an unavailable music button does not initialize effects');
  const unavailable=new Sound({contextFactory:()=>null});assert.equal(await unavailable.enable(),false);
});

test('music and effects switches control independent playback paths',async()=>{
  const {sound,player,context,oscillators}=fixture();
  assert.equal(await sound.setMusicEnabled(true),true);assert.equal(sound.context,null);
  assert.equal(await sound.enable(),true);sound.win('big');assert.ok(oscillators.length>0);
  assert.equal(await sound.setEffectsEnabled(false),false);
  assert.equal(sound.voices.size,0);assert.equal(player.paused,false);assert.equal(sound.musicEnabled,true);
  await sound.enable();sound.stop(2);const playing=sound.voices.size;
  await sound.setMusicEnabled(false);
  assert.equal(player.paused,true);assert.equal(sound.enabled,true);assert.equal(context.state,'running');
  assert.equal(sound.voices.size,playing,'music off does not cancel effects');
});

test('muting cancels scheduled chimes and completed voices release their nodes',async()=>{
  const {sound,oscillators,context}=fixture();await sound.enable();sound.win(true);
  const voices=[...oscillators];assert.ok(voices.some(voice=>voice.started>context.currentTime));
  await sound.setEffectsEnabled(false);
  assert.ok(voices.every(voice=>voice.stops.at(-1)<=context.currentTime+.015));
  const count=oscillators.length;sound.stop(4);assert.equal(oscillators.length,count);
  for(const voice of voices)voice.onended();assert.ok(voices.every(voice=>voice.disconnected));
  assert.equal(sound.voices.size,0);
});

test('backgrounding pauses both channels and returning does not replay old effects',async()=>{
  const h=fixture();await h.sound.enable();await h.sound.setMusicEnabled(true);h.sound.win(true);
  h.hidden=true;await h.sound.setVisible(false);
  assert.equal(h.context.state,'suspended');assert.equal(h.player.paused,true);assert.equal(h.sound.voices.size,0);
  assert.ok(h.oscillators.every(voice=>voice.stops.at(-1)===h.context.currentTime));
  const count=h.oscillators.length;h.sound.stop(0);assert.equal(h.oscillators.length,count);
  h.hidden=false;await h.sound.setVisible(true);
  assert.equal(h.context.state,'running');assert.equal(h.player.paused,false);
  assert.equal(h.oscillators.length,count);assert.equal(h.sound.enabled,true);assert.equal(h.sound.musicEnabled,true);
});

test('an unavailable or blocked channel does not disable the other channel',async()=>{
  const {sound,context,player}=fixture();await sound.enable();
  player.play=async()=>{throw new Error('autoplay denied');};
  assert.equal(await sound.setMusicEnabled(true),false);assert.equal(sound.enabled,true);
  player.play=async()=>{player.paused=false;};await sound.setMusicEnabled(true);
  sound.win('big');context.resume=async()=>{throw new Error('audio unavailable');};
  assert.equal(await sound.enable(),false);assert.equal(sound.musicEnabled,true);assert.equal(player.paused,false);
  assert.equal(sound.voices.size,0);assert.equal(sound.effectsGain.gain.value,0);
  player.handlers.error();assert.equal(sound.musicEnabled,false);
});

test('a delayed enable cannot undo a newer mute request',async()=>{
  const {sound,context,player}=fixture();let resumed;
  context.resume=()=>new Promise(resolve=>{resumed=()=>{context.state='running';resolve();};});
  const enabling=sound.enable();await sound.setEffectsEnabled(false);resumed();await enabling;
  assert.equal(sound.enabled,false);assert.equal(sound.effectsGain.gain.value,0);
  let played;player.play=()=>new Promise(resolve=>{played=resolve;});
  const music=sound.setMusicEnabled(true);await sound.setMusicEnabled(false);played();await music;
  assert.equal(sound.musicEnabled,false);assert.equal(player.paused,true);
});

test('voice budget bounds repeated cues and cue plans stay within safe ranges',async()=>{
  const {sound}=fixture();await sound.enable();for(let i=0;i<10;i++)sound.win(true);
  assert.ok(sound.voices.size<=96);
  for(const kind of ['spin','stop','return','small','big']){
    const voices=cueVoices(kind,4);assert.ok(voices.length);
    assert.ok(voices.length<=96,'a complete cue fits without stealing its own opening notes');
    assert.ok(voices.every(voice=>Number.isFinite(voice.frequency)&&voice.frequency>0&&voice.frequency<10000&&voice.frequencyEnd>0&&voice.frequencyEnd<10000&&Math.abs(voice.pan)<=1&&voice.volume>0&&voice.volume<.15&&voice.hold>=0&&voice.duration>voice.attack+voice.hold&&voice.at>=0));
  }
  assert.deepEqual(cueVoices('stop',5),[]);
  sound.dispose();assert.equal(sound.voices.size,0);assert.equal(sound.enabled,false);
});

test('stereo placement releases its nodes and unsupported stereo keeps effects playable',async()=>{
  const {sound,oscillators,panners}=fixture();await sound.enable();sound.stop(0);
  assert.equal(panners.length,oscillators.length);
  assert.ok(panners.some(panner=>panner.pan.value<0));
  assert.ok(panners.some(panner=>panner.pan.value>0));
  for(const oscillator of oscillators)oscillator.onended();
  assert.ok(panners.every(panner=>panner.disconnected));
  assert.equal(sound.voices.size,0);
  const mono=fixture({stereo:false});await mono.sound.enable();mono.sound.win('small');
  assert.ok(mono.oscillators.length>0);assert.equal(mono.panners.length,0);
});

