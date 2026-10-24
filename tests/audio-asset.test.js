import test from 'node:test';
import assert from 'node:assert/strict';
import {audioAsset} from '../cloud/audio-asset.js';

const bytes=new Uint8Array([0x49,0x44,0x33,1,2,3]);
const assets={async fetch(request){
  if(request.method==='HEAD')return new Response(null,{headers:{'Content-Type':'audio/mpeg','Content-Length':'6'}});
  assert.equal(request.method,'GET');assert.equal(request.headers.has('range'),false);assert.equal(request.headers.has('if-range'),false);
  return new Response(bytes,{headers:{'Content-Type':'audio/mpeg',ETag:'"track"','Cache-Control':'public, max-age=3600'}});
}};
const request=(headers={},method='GET')=>new Request('https://game.invalid/assets/music.mp3',{headers,method});

test('cloud music serves complete files and HEAD metadata without relying on upstream range support',async()=>{
  const response=await audioAsset(request(),assets);
  assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
  assert.equal(response.headers.get('accept-ranges'),'bytes');assert.equal(response.headers.get('content-type'),'audio/mpeg');
  assert.equal(response.headers.get('cache-control'),'public, max-age=3600');
  const head=await audioAsset(request({Range:'bytes=0-1'},'HEAD'),assets);
  assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'6');
});

test('cloud music supplies probes, open and suffix ranges and respects If-Range validators',async()=>{
  for(const [range,first,last] of [['bytes=0-1',0,1],['bytes=3-',3,5],['bytes=-2',4,5],['bytes=-100',0,5],['bytes=2-99',2,5]]){
    const response=await audioAsset(request({Range:range}),assets);
    assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes ${first}-${last}/6`);
    assert.equal(response.headers.get('content-length'),String(last-first+1));assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes.subarray(first,last+1));
  }
  assert.equal((await audioAsset(request({Range:'bytes=0-1','If-Range':'"track"'}),assets)).status,206);
  assert.equal((await audioAsset(request({Range:'bytes=0-1','If-Range':'"old-track"'}),assets)).status,200);
});

test('cloud music rejects unsatisfiable ranges and preserves normal handling of malformed or missing assets',async()=>{
  for(const range of ['bytes=6-','bytes=3-2','bytes=-0','bytes=9007199254740992-']){
    const response=await audioAsset(request({Range:range}),assets);
    assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),'bytes */6');assert.equal(await response.text(),'');
  }
  for(const range of ['invalid','bytes=-','bytes=0-1,3-4'])assert.equal((await audioAsset(request({Range:range}),assets)).status,200);
  assert.equal((await audioAsset(request(),{fetch:async()=>new Response('missing',{status:404})})).status,404);
});
