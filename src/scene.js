import { Application, Assets, Container, Graphics, Sprite, Texture, Rectangle } from 'pixi.js';
import { SYMBOLS, SYMBOL_FRAMES, INITIAL_STOPS, REEL_STRIPS, gridFromStops, reelMotion, PAYLINES } from './game.js';
import { BOUNCE_MS, reelOffset, WinLineCycle } from './presentation.js';
import mainAtlas from '../images/main.json';
import symbolAtlas from '../images/symbols.json';
import mainUrl from '../images/main.png';
import symbolsUrl from '../images/symbols.png';

const W = 1200, H = 760;
const GRID = { x: 255, y: 228, w: 690, h: 408 };
const CW = GRID.w / 5, CH = GRID.h / 3, GOLD = 0xffd57d;

// Read exported pixel rectangles directly; main.json has a 0.5 export scale.
// Original atlases remain unchanged. Symbols keep their original transparent padding.
function textures(base, data, padded = false) {
  return Object.fromEntries(Object.entries(data.frames).map(([name, entry]) => {
    const f = entry.frame, s = entry.spriteSourceSize;
    return [name, new Texture({ source: base.source, frame: new Rectangle(f.x, f.y, f.w, f.h),
      ...(padded ? { orig: new Rectangle(0, 0, entry.sourceSize.w, entry.sourceSize.h), trim: new Rectangle(s.x, s.y, s.w, s.h) } : {}) })];
  }));
}
export class SlotScene {
  app = new Application();
  reels = [];
  particles = [];
  active = null;
  currentStops = INITIAL_STOPS;
  reduced = false;
  lineCycle = new WinLineCycle();
  presentationPaused = false;
  async init(host) {
    await this.app.init({ width: W, height: H, backgroundAlpha: 0, antialias: true, preference: 'webgl', resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true });
    host.append(this.app.canvas);
    this.app.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.app.canvas.style, { width: '100%', height: 'auto', display: 'block' });
    this.app.ticker.maxFPS = 60;
    const [main, symbols] = await Promise.all([Assets.load(mainUrl), Assets.load(symbolsUrl)]);
    this.art = textures(main, mainAtlas);
    const sheet = textures(symbols, symbolAtlas, true);
    this.textures = Object.fromEntries(SYMBOLS.map(s => {
      const texture = sheet[SYMBOL_FRAMES[s]];
      if (!texture) throw new Error(`圖集缺少符號：${SYMBOL_FRAMES[s]}`);
      return [s, texture];
    }));
    this.addArt('reel_frame_filled.png', 140, 104, 920);
    const ornament = new Graphics();
    for (let col = 0; col < 5; col++) {
      const x = GRID.x + col * CW;
      ornament.rect(x, GRID.y + 3, CW, GRID.h - 6).fill({ color: col % 2 ? 0x100c25 : 0x572c50, alpha: .25 });
      if (col) ornament.moveTo(x, GRID.y + 8).lineTo(x, GRID.y + GRID.h - 8).stroke({ color: GOLD, alpha: .2, width: 1 });
      const strip = new Container();
      const mask = new Graphics().rect(x, GRID.y, CW, GRID.h).fill(0xffffff);
      strip.mask = mask;
      this.reels.push({ strip, x, mask, stopped: true });
    }
    this.app.stage.addChild(ornament);
    this.reels.forEach(r => this.app.stage.addChild(r.mask, r.strip));
    this.setStops(this.currentStops);
    const shade = new Graphics();
    for (let i = 0; i < 22; i++) {
      const alpha = .45 * (1 - i / 22);
      shade.rect(GRID.x, GRID.y + i, GRID.w, 1).fill({ color: 0x220e29, alpha });
      shade.rect(GRID.x, GRID.y + GRID.h - i - 1, GRID.w, 1).fill({ color: 0x220e29, alpha });
    }
    this.app.stage.addChild(shade);
    this.line = new Graphics();
    this.line.alpha = 0;
    this.app.stage.addChild(this.line);
    this.app.stage.addChild(new Graphics().poly([238, 425, 250, 432, 238, 439]).fill(GOLD).poly([962, 425, 950, 432, 962, 439]).fill(GOLD));
    this.addArt('logo_long.png', 225, 38, 750);
    this.guardian = this.addArt('anubis.png', 11, 265, 160);
    this.resizeObserver = new ResizeObserver(() => { this.guardian.visible = host.clientWidth >= 800; });
    this.resizeObserver.observe(host);
    this.effects = new Container(); this.app.stage.addChild(this.effects);
    this.winArt = new Container();
    this.winArt.addChild(new Graphics().roundRect(270, 280, 660, 340, 20).fill({ color: 0x21102b, alpha: .94 }).stroke({ color: GOLD, alpha: .8, width: 2 }));
    const decor = new Sprite(this.art['big_win_decor.png']); decor.anchor.set(.5); decor.position.set(600, 365); decor.width = 290; decor.height = 206;
    const title = new Sprite(this.art['big_win.png']); title.anchor.set(.5); title.position.set(600, 385); title.width = 540; title.height = 133;
    this.winArt.addChild(decor, title); this.winArt.visible = false; this.app.stage.addChild(this.winArt);
    this.app.ticker.add(t => this.tick(t));
  }
  addArt(name, x, y, width) {
    const s = new Sprite(this.art[name]); s.position.set(x, y); s.scale.set(width / s.texture.width); this.app.stage.addChild(s); return s;
  }
  populate(reel, names, rowOffset = 0) {
    reel.strip.removeChildren().forEach(s => s.destroy());
    names.forEach((name, row) => {
      const s = new Sprite(this.textures[name]); s.anchor.set(.5); s.scale.set(132 / 256);
      s.position.set(reel.x + CW / 2, GRID.y + CH / 2 + (row + rowOffset) * CH); reel.strip.addChild(s);
    });
    reel.strip.y = 0;
  }
  setStops(stops) { const grid = gridFromStops(stops); this.currentStops = [...stops]; this.reels.forEach((r, i) => this.populate(r, grid[i])); }
  clearWins() {
    this.lineCycle.clear();
    this.line.clear(); this.line.alpha = 0;
  }
  showWins(wins, onLine = () => {}) {
    this.clearWins();
    this.lineCycle.start(wins, (win, index, total) => {
      const color = this.drawWin(win);
      onLine(win, index, total, `#${color.toString(16).padStart(6, '0')}`);
    });
  }
  drawWin(win) {
    this.line.clear();
    const rows = PAYLINES[win.line - 1];
    const color = [GOLD, 0x80f0e5, 0xe9a7ff, 0xffb58e, 0xa4eaa0][(win.line - 1) % 5];
    for (let col = 0; col < 5; col++) for (let row = 0; row < 3; row++) {
      const x = GRID.x + col * CW, y = GRID.y + row * CH;
      if (col < win.count && row === rows[col]) {
        this.line.roundRect(x + 4, y + 3, CW - 8, CH - 6, 10).fill({ color, alpha: .1 }).stroke({ color, width: 3 });
      } else this.line.rect(x, y, CW, CH).fill({ color: 0x140c20, alpha: .52 });
    }
    const path = (count, width, alpha) => {
      this.line.moveTo(GRID.x - 10, GRID.y + (rows[0] + .5) * CH);
      for (let col = 0; col < count; col++) this.line.lineTo(GRID.x + (col + .5) * CW, GRID.y + (rows[col] + .5) * CH);
      this.line.stroke({ color, width, alpha, cap: 'round', join: 'round' });
    };
    path(5, 2, .35); path(win.count, 11, .25); path(win.count, 3, 1);
    for (let col = 0; col < win.count; col++) this.line.circle(GRID.x + (col + .5) * CW, GRID.y + (rows[col] + .5) * CH, 5).fill(color);
    this.line.alpha = 1;
    return color;
  }
  spin(stops, onStop) {
    if (this.active) throw new Error('轉輪正在運轉');
    this.clearCelebration(); this.clearWins();
    return new Promise(resolve => {
      this.active = { time: 0, resolve, onStop, stops };
      this.reels.forEach((r, i) => {
        const { steps, names } = reelMotion(i, this.currentStops[i], stops[i]);
        r.steps = steps; r.stopAt = this.reduced ? 240 + i * 70 : 1200 + i * 230;
        r.reduced = this.reduced; r.stopped = false; r.impacted = false;
        const strip = REEL_STRIPS[i], length = strip.length;
        // Guard cells above/below keep the mask filled during both bounce directions.
        const before = strip[(stops[i] - 2 + length) % length];
        const after = strip[(stops[i] + steps + 2) % length];
        this.populate(r, [before, ...names, after], -1);
        r.strip.y = -r.steps * CH;
      });
    });
  }
  celebrate(big = false, showLine = true) {
    this.presentationPaused = big || !showLine;
    this.line.alpha = this.presentationPaused ? 0 : 1; this.winArt.visible = big;
    if (this.reduced) return;
    for (let i = 0; i < (big ? 100 : 30); i++) {
      const g = new Graphics();
      if (i % 3 === 0) g.star(0, 0, 4, 4 + Math.random() * 4, 2).fill(GOLD);
      else g.circle(0, 0, 4 + Math.random() * 4).fill(0xeab346).stroke({ color: 0xffec9d, width: 1.5 });
      g.position.set(600, 400); this.effects.addChild(g);
      this.particles.push({ g, vx: (Math.random() - .5) * 800, vy: -140 - Math.random() * 430, life: 1.8 + Math.random(), age: 0, spin: (Math.random() - .5) * 9 });
    }
  }
  clearCelebration() {
    if (this.winArt) this.winArt.visible = false;
    this.presentationPaused = false;
    if (this.lineCycle.index >= 0) this.line.alpha = 1;
  }
  tick(t) {
    const dt = Math.min(t.elapsedMS, 50) / 1000;
    if (this.active) {
      const a = this.active; a.time += t.deltaMS;
      this.reels.forEach((r, i) => {
        if (r.stopped) return;
        r.strip.y = reelOffset(r.steps * CH, a.time, r.stopAt, CH, r.reduced);
        if (!r.impacted && a.time >= r.stopAt) { r.impacted = true; a.onStop(i); }
        if (a.time >= r.stopAt + (r.reduced ? 0 : BOUNCE_MS)) r.stopped = true;
      });
      if (this.reels.every(r => r.stopped)) { this.active = null; this.setStops(a.stops); a.resolve(); }
    }
    this.lineCycle.tick(t.deltaMS, this.presentationPaused || !!this.active);
    this.particles = this.particles.filter(p => {
      p.age += dt; p.vy += 330 * dt; p.g.x += p.vx * dt; p.g.y += p.vy * dt; p.g.rotation += p.spin * dt; p.g.alpha = Math.max(0, 1 - p.age / p.life);
      if (p.age >= p.life) { p.g.destroy(); return false; } return true;
    });
  }
  finish() {
    if (!this.active) return;
    const a = this.active; this.active = null; this.setStops(a.stops); a.resolve();
    this.particles.forEach(p => p.g.destroy()); this.particles = [];
  }
}
