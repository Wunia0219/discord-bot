import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dealerFrameSequence} from '../src/ui/dealer/dealer-motion.js';
import {webpSize} from './helpers/webp.js';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('images/dealer/v4/dealer.json',root),'utf8'));

test('shipping dealer atlas contains complete authored idle/win sequences and actual WebP files',()=>{
  assert.deepEqual(Object.keys(manifest.clips).sort(),['idle','win']);
  assert.deepEqual(manifest.frameSize,[576,832]);
  const region=manifest.runtimePacking?.region||{x:0,y:0,w:576,h:832};
  for(const [name,count] of [['idle',96],['win',108]]){
    const clip=manifest.clips[name],sequence=dealerFrameSequence(clip,manifest.fps);
    assert.equal(sequence.length,count);assert.equal(clip.frames,count);
    assert.ok(Math.abs(sequence.reduce((sum,frame)=>sum+frame.durationMs,0)-count/30*1000)<1e-6);
    for(const page of clip.pages){
      assert.match(page.file,/\.webp$/);
      const bytes=readFileSync(new URL('images/dealer/v4/'+page.file,root));
      assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
      assert.deepEqual(webpSize(new URL('images/dealer/v4/'+page.file,root)),[region.w*2,region.h*2]);
      assert.deepEqual(page.meta.size,{w:region.w*2,h:region.h*2});
      for(const {frame:f,sourceSize,spriteSourceSize} of Object.values(page.frames)){
        assert.ok(f.x>=0&&f.y>=0&&f.x+f.w<=page.meta.size.w&&f.y+f.h<=page.meta.size.h);
        assert.deepEqual(sourceSize,{w:576,h:832});
        assert.deepEqual(spriteSourceSize,region);
        assert.equal(f.w,region.w);assert.equal(f.h,region.h);
      }
    }
  }
});

test('project art and shipping assets contain no PNG originals',()=>{
  function scan(path){for(const entry of readdirSync(path,{withFileTypes:true})){
    const file=join(path,entry.name);
    if(entry.isDirectory())scan(file);else assert.doesNotMatch(entry.name,/\.png$/i,file);
  }}
  for(const directory of ['images','art','public'])scan(fileURLToPath(new URL(directory,root)));
});
