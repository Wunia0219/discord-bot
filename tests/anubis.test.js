import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BaseTexture } from '@pixi/core';
import { TextureAtlas } from '@pixi-spine/base';
import { SkeletonJson, AtlasAttachmentLoader, AnimationState, AnimationStateData, Skeleton } from '@pixi-spine/runtime-3.8';
import { playAnubisResult, resetAnubisIdle } from '../src/guardian-animation.js';
import { prepareAnubisData } from '../src/anubis-asset.js';
const json=JSON.parse(readFileSync(new URL('../images/spine/anubis/character_anubis.json',import.meta.url)));
const text=readFileSync(new URL('../images/spine/anubis/character_anubis.atlas',import.meta.url),'utf8');
const base=new BaseTexture(null,{width:1413,height:1540});
const atlas=await new Promise(resolve=>new TextureAtlas(text,(_,done)=>done(base),resolve));
const data=new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(json);
test('freestanding character removes panel clipping/shadows without editing source or body shading',()=>{
 const prepared=prepareAnubisData(json);
 assert.equal(json.slots.find(s=>s.name==='m').attachment,'m');
 for(const name of ['m','character_symbol_anubis_bg','character_symbol_anubis_shadow','character_symbol_anubis_overall_shadow']){
  assert.equal(prepared.slots.find(s=>s.name===name).attachment,undefined);
  assert.equal(prepared.skins[0].attachments[name],undefined);
  for(const animation of Object.values(prepared.animations))assert.equal(animation.slots?.[name],undefined);
 }
 assert.deepEqual(prepared.skins[0].attachments.character_symbol_anubis_body,json.skins[0].attachments.character_symbol_anubis_body);
 assert.deepEqual(prepared.skins[0].attachments.character_symbol_anubis_body_neck_shadow,json.skins[0].attachments.character_symbol_anubis_body_neck_shadow);
 const actual=new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(prepared);
 const skeleton=new Skeleton(actual),state=new AnimationState(new AnimationStateData(actual));
 for(const animation of ['idle','action']){
  state.setAnimation(0,animation,false);
  for(let i=0;i<125;i++){
   state.update(1/60);state.apply(skeleton);skeleton.updateWorldTransform();
   const slot=skeleton.findSlot('character_symbol_anubis_body'),attachment=slot.getAttachment();
   const vertices=new Float32Array(attachment.worldVerticesLength);
   attachment.computeWorldVertices(slot,0,vertices.length,vertices,0,2);
   for(let v=0;v<vertices.length;v+=2){assert.ok(vertices[v]+260>0&&vertices[v]+260<800);assert.ok(vertices[v+1]+520>0&&vertices[v+1]+520<1280);}
   assert.equal(skeleton.findSlot('m').getAttachment(),null);
  }
 }
});
function create(){const settings=new AnimationStateData(data);settings.defaultMix=.12;return new AnimationState(settings);}
test('real Spine 3.8 asset parses with both animations, deforms and clipping intact',()=>{
 assert.equal(json.skeleton.spine,'3.8.99');assert.equal(data.findAnimation('idle').duration,2);assert.ok(Math.abs(data.findAnimation('action').duration-1.6667)<1e-6);
 const skeleton=new Skeleton(data),state=create();playAnubisResult(state,[{line:1,payout:5}]);
 for(let i=0;i<240;i++){state.update(1/60);state.apply(skeleton);skeleton.updateWorldTransform();for(const b of skeleton.bones)for(const n of ['a','b','c','d','tx','ty'])assert.ok(Number.isFinite(b.matrix[n]));}
 assert.equal(state.getCurrent(0).animation.name,'idle');assert.equal(state.getCurrent(0).loop,true);
});
test('any winning line queues one full action then idle, regardless of payout size or line count',()=>{
 for(const wins of [[{line:3,payout:5}],Array.from({length:20},(_,i)=>({line:i+1,payout:5}))]){
  const state=create(),skeleton=new Skeleton(data);playAnubisResult(state,wins);
  assert.equal(state.getCurrent(0).animation.name,'action');assert.equal(state.getCurrent(0).loop,false);
  assert.equal(state.getCurrent(0).next.delay,data.findAnimation('action').duration);assert.ok(state.getCurrent(0).next.next == null);
  for(let i=0;i<99;i++){state.update(1/60);state.apply(skeleton);}
  assert.equal(state.getCurrent(0).animation.name,'action');
  for(let i=0;i<20;i++){state.update(1/60);state.apply(skeleton);}
  assert.equal(state.getCurrent(0).animation.name,'idle');assert.equal(state.getCurrent(0).loop,true);
 }
});
test('no win preserves the current idle playback position',()=>{
 const state=create();resetAnubisIdle(state);state.update(.75);
 const idle=state.getCurrent(0);playAnubisResult(state,[]);
 assert.equal(state.getCurrent(0),idle);assert.equal(idle.trackTime,.75);
 state.update(.25);assert.equal(idle.trackTime,1);
});
test('no win lets an ongoing action finish and return to idle',()=>{
 const state=create(),skeleton=new Skeleton(data);playAnubisResult(state,[{line:1}]);
 state.update(.5);state.apply(skeleton);
 const action=state.getCurrent(0),queuedIdle=action.next;playAnubisResult(state,[]);
 assert.equal(state.getCurrent(0),action);assert.equal(action.trackTime,.5);assert.equal(action.next,queuedIdle);
 for(let i=0;i<120;i++){state.update(1/60);state.apply(skeleton);}
 assert.equal(state.getCurrent(0),queuedIdle);assert.equal(queuedIdle.animation.name,'idle');assert.equal(queuedIdle.loop,true);
});
test('explicit reset cancels an action and starts idle from the beginning',()=>{
 const state=create();playAnubisResult(state,[{line:1}]);state.update(.5);resetAnubisIdle(state);
 const idle=state.getCurrent(0);
 assert.equal(idle.animation.name,'idle');assert.equal(idle.trackTime,0);assert.ok(idle.next==null);assert.equal(idle.loop,true);
});
