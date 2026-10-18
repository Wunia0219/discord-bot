import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('gold BMFont covers HUD punctuation and all digits inside its PNG page',()=>{
  const text=readFileSync(new URL('../images/fonts/kemet-gold.fnt',import.meta.url),'utf8');
  const image=readFileSync(new URL('../images/fonts/kemet-gold.png',import.meta.url));
  const fields=line=>Object.fromEntries([...line.matchAll(/(\w+)=(-?\d+)/g)].map(([,key,value])=>[key,Number(value)]));
  const common=fields(text.split('\n').find(line=>line.startsWith('common ')));
  assert.equal(common.scaleW,image.readUInt32BE(16));assert.equal(common.scaleH,image.readUInt32BE(20));
  const glyphs=text.split('\n').filter(line=>line.startsWith('char ')).map(fields);
  assert.equal(new Set(glyphs.map(g=>g.id)).size,13);
  for(const char of '0123456789,+−')assert.ok(glyphs.some(g=>g.id===char.codePointAt(0)));
  for(const g of glyphs){
    assert.ok(g.width>0&&g.height>0&&g.xadvance>0);
    assert.ok(g.x>=0&&g.y>=0&&g.x+g.width<=common.scaleW&&g.y+g.height<=common.scaleH);
    assert.ok(g.yoffset+g.height<=common.lineHeight);
    assert.equal(g.page,0);
  }
});
