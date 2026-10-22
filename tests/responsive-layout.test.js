import test from 'node:test';
import assert from 'node:assert/strict';
import { gameLayoutMode, desktopGameScale } from '../src/ui/responsive-layout.js';

test('Discord platform determines composition independently of window size or input hardware', () => {
  assert.equal(gameLayoutMode('?platform=desktop', true), 'desktop');
  assert.equal(gameLayoutMode('?platform=mobile', false), 'mobile');
  assert.equal(gameLayoutMode('', false), 'desktop');
  assert.equal(gameLayoutMode('', true), 'mobile');
});

test('the same desktop composition fits both windowed and fullscreen areas without changing proportions', () => {
  for (const [width,height] of [[1207,515],[1904,1008],[784,528],[584,328],[3440,1008]]) {
    const scale = desktopGameScale(width,height);
    assert.ok(1160*scale <= width + 1e-8);
    assert.ok(740*scale <= height + 1e-8);
    assert.ok(Math.abs(1160*scale-width)<1e-8 || Math.abs(740*scale-height)<1e-8);
  }
  assert.equal(desktopGameScale(0,0),0);
});
