import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webpSize } from './helpers/webp.js';

test('circus main atlas contains every scene, loading, button and celebration frame', () => {
  const atlas = JSON.parse(readFileSync(new URL('../images/main.json', import.meta.url), 'utf8'));
  const [width, height] = webpSize(new URL('../images/main.webp', import.meta.url));
  assert.equal(atlas.meta.image, 'main.webp');
  assert.deepEqual(atlas.meta.size, { w: width, h: height });
  for (const name of ['circus-reel-frame.png', 'logo-long.png', 'logo-short.png', 'spin-button.png', 'big-win.png', 'super-win.png', 'mega-win.png', 'win-aura.png', 'celebration-coin.png']) {
    const entry = atlas.frames[name];
    assert.ok(entry, name);
    assert.equal(entry.rotated, false, name);
    const { x, y, w, h } = entry.frame;
    assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height, name);
    const trim = entry.spriteSourceSize;
    assert.equal(trim.w, w); assert.equal(trim.h, h);
    assert.ok(trim.x + w <= entry.sourceSize.w && trim.y + h <= entry.sourceSize.h, name);
  }
});
