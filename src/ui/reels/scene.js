import { Application, Assets, Container, Graphics, Sprite, Texture, Rectangle } from 'pixi.js';
import 'pixi.js/prepare';
import 'pixi.js/unsafe-eval';
import { SYMBOLS, SYMBOL_FRAMES, INITIAL_STOPS, REEL_STRIPS, gridFromStops } from '../../game/index.js';
import { reelOffset, pendingReelFrame, reelLandingAnimation, reelBounceOffset, REEL_SETTLE_MS, REEL_BOUNCE_MS, WinCycle, WinSymbolPop } from './presentation.js';
import { Dealer } from '../dealer/dealer.js';
import { dealerClipForRound } from '../dealer/dealer-motion.js';
import mainAtlas from '../../../images/main.json';
import symbolAtlas from '../../../images/symbols.json';
import mainUrl from '../../../images/main.webp';
import symbolsUrl from '../../../images/symbols.webp';
import backgroundUrl from '../../../images/jokers-circus/circus-background.webp';
import winFrameUrl from '../../../images/fx/circus-win-frame.webp';
import dealerManifest from '../../../images/dealer/v4/dealer.json';

const dealerPages = import.meta.glob('../../../images/dealer/v4/*.webp', {eager:true, query:'?url', import:'default'});

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
  winCycle = new WinCycle();
  symbolPop = new WinSymbolPop();
  winningSymbols = [];
  presentationPaused = false;
  assetUrls = new Set();
  disposed = false;
  async init(host, onProgress = () => {}) {
    if(this.disposed)throw new Error('Scene disposed');
    this.initTask ||= this.prepareScene(host,onProgress);
    return this.initTask;
  }
  async prepareScene(host,onProgress) {
    await this.app.init({ width: W, height: H, backgroundAlpha: 0, antialias: true, preference: 'webgl', resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true });
    this.appInitialized=true;
    if(this.disposed){this.app.stop();throw new Error('Scene disposed');}
    onProgress(28, '正在點亮馬戲團');
    host.append(this.app.canvas);
    this.app.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.app.canvas.style, { width: '100%', height: 'auto', display: 'block' });
    this.app.ticker.maxFPS = 60;
    const background = new Image(); background.src = backgroundUrl;
    let completed = 0;
    const loaded = value => { onProgress(28 + (++completed * 14), '正在準備馬戲團道具'); return value; };
    this.dealer=new Dealer({
      motionManifest:dealerManifest,
      resolvePage:page=>dealerPages['../../../images/dealer/v4/'+page.file],
      uploadTextures:textures=>this.app.renderer.prepare.upload(textures),
      canRelease:()=>!this.active,
    });
    const dealerReady=this.dealer.init().catch(error=>{if(!this.disposed)console.warn('Dealer artwork unavailable:',error.message);});
    const loadAsset=async url=>{const texture=await Assets.load(url);this.assetUrls.add(url);return texture;};
    // Collect late successes too, so startup failure can release the entire batch.
    const resources=await Promise.allSettled([loadAsset(mainUrl).then(loaded),loadAsset(symbolsUrl).then(loaded),loadAsset(winFrameUrl),background.decode().then(loaded),dealerReady]);
    const failed=resources.find(resource=>resource.status==='rejected');
    if(failed)throw failed.reason;
    if(this.disposed)throw new Error('Scene disposed');
    const [main,symbols,winFrame]=resources.map(resource=>resource.value);
    this.winFrameTexture = winFrame;
    this.art = textures(main, mainAtlas);
    const sheet = textures(symbols, symbolAtlas, true);
    this.textures = Object.fromEntries(SYMBOLS.map(s => {
      const texture = sheet[SYMBOL_FRAMES[s]];
      if (!texture) throw new Error(`圖集缺少符號：${SYMBOL_FRAMES[s]}`);
      return [s, texture];
    }));
    this.app.stage.addChild(new Graphics().rect(GRID.x, GRID.y, GRID.w, GRID.h).fill(0x10172d));
    const frame = this.addArt('circus-reel-frame.png', GRID.x - 80 * GRID.w / 607, GRID.y - 90 * GRID.h / 335, 768 * GRID.w / 607);
    frame.height = 483 * GRID.h / 335;
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
    // Keep the companion in front of the decorative curtains, below the reels.
    if(this.dealer.sprite)this.app.stage.addChild(this.dealer.sprite);
    this.reels.forEach(r => this.app.stage.addChild(r.mask, r.strip));
    this.setStops(this.currentStops);
    const shade = new Graphics();
    for (let i = 0; i < 22; i++) {
      const alpha = .45 * (1 - i / 22);
      shade.rect(GRID.x, GRID.y + i, GRID.w, 1).fill({ color: 0x220e29, alpha });
      shade.rect(GRID.x, GRID.y + GRID.h - i - 1, GRID.w, 1).fill({ color: 0x220e29, alpha });
    }
    this.app.stage.addChild(shade);
    this.links = new Graphics();
    this.links.alpha = 0;
    this.winShade = new Graphics();
    this.app.stage.addChild(this.winShade);
    // Unmasked overlay lets a winning symbol protrude beyond its reel cell.
    this.winVisuals = new Container();
    this.app.stage.addChild(this.winVisuals);
    // Keep the payline above popped symbols; dimming belongs underneath them.
    this.app.stage.addChild(this.links);
    this.app.stage.addChild(new Graphics().poly([238, 425, 250, 432, 238, 439]).fill(GOLD).poly([962, 425, 950, 432, 962, 439]).fill(GOLD));
    this.addArt('logo-long.png', 350, 0, 500);
    onProgress(92, '馬戲團舞台已就位');
    this.effects = new Container(); this.app.stage.addChild(this.effects);
    // Reframe the same game coordinates; never stretch symbols or restart animation.
    const fitViewport = () => {
      const style = getComputedStyle(host);
      const width = Number(style.getPropertyValue('--scene-width')) || W;
      const height = Number(style.getPropertyValue('--scene-height')) || H;
      const x = Number(style.getPropertyValue('--scene-x')) || 0;
      this.app.renderer.resize(width, height);
      this.app.stage.position.set(-x, 0);
      this.dealer.layout(width);
      Object.assign(this.app.canvas.style, { width: '100%', height: 'auto' });
    };
    this.resizeObserver = new ResizeObserver(fitViewport);
    this.resizeObserver.observe(host);
    fitViewport();
    this.app.ticker.add(t => this.tick(t));
    onProgress(96, '即將進入馬戲團');
  }
  destroy() {
    if(this.destroyTask)return this.destroyTask;
    this.disposed=true;this.app.stop?.();this.resizeObserver?.disconnect();
    this.destroyTask=(async()=>{
      await Promise.allSettled([this.initTask].filter(Boolean));
      this.app.stop?.();this.resizeObserver?.disconnect();
      await this.dealer?.destroy();
      for(const reel of this.reels)for(const spare of reel.spare||[])spare.destroy();
      const views=new Set([...Object.values(this.art||{}),...Object.values(this.textures||{})]);
      if(this.appInitialized)this.app.destroy({removeView:true,releaseGlobalResources:true},{children:true,texture:false,textureSource:false});
      else {this.app.stage?.destroy({children:true});this.app.renderer?.destroy({removeView:true,releaseGlobalResources:true});}
      for(const texture of views)texture.destroy(false);
      await Promise.allSettled([...this.assetUrls].map(url=>Assets.unload(url)));
      this.assetUrls.clear();this.art={};this.textures={};this.reels=[];this.particles=[];this.winningSymbols=[];this.winFrameTexture=null;
    })();
    return this.destroyTask;
  }
  addArt(name, x, y, width) {
    const s = new Sprite(this.art[name]); s.position.set(x, y); s.scale.set(width / s.texture.width); this.app.stage.addChild(s); return s;
  }
  populate(reel, names, rowOffset = 0) {
    // Only active cells stay attached; reuse sprites across cruise, landing and rest.
    reel.spare ??= [];
    while(reel.strip.children.length>names.length)reel.spare.push(reel.strip.removeChildAt(reel.strip.children.length-1));
    names.forEach((name, row) => {
      let sprite=reel.strip.children[row];
      if(!sprite){sprite=reel.spare.pop()??new Sprite();reel.strip.addChild(sprite);}
      sprite.texture=this.textures[name];sprite.visible=true;sprite.anchor.set(.5);sprite.scale.set(132 / 256);
      sprite.position.set(reel.x + CW / 2, GRID.y + CH / 2 + (row + rowOffset) * CH);
    });
    reel.strip.y = 0;
  }
  setStops(stops) { const grid = gridFromStops(stops); this.currentStops = [...stops]; this.reels.forEach((r, i) => this.populate(r, grid[i])); }
  clearWins() {
    this.clearWinVisuals();
    this.symbolPop.clear();
    this.winCycle.clear();
    this.links.clear(); this.links.alpha = 0;
    this.winShade.clear(); this.winShade.alpha = 0;
  }
  clearWinVisuals() {
    this.winningSymbols.forEach(({ original }) => { original.visible = true; });
    this.winningSymbols = [];
    this.winVisuals.removeChildren().forEach(child => child.destroy());
  }
  showWins(wins, onWin = () => {}) {
    this.clearWins();
    this.winCycle.start(wins, (win, index, total) => {
      const color = this.drawWin(win);
      onWin(win, index, total, `#${color.toString(16).padStart(6, '0')}`);
    });
  }
  drawWin(win) {
    this.clearWinVisuals();
    this.symbolPop.start(this.reduced);
    this.links.clear();
    this.winShade.clear();
    const cells = new Set(win.cells.map(([col,row])=>`${col},${row}`));
    const color = [GOLD, 0x80f0e5, 0xe9a7ff, 0xffb58e, 0xa4eaa0][SYMBOLS.indexOf(win.symbol) % 5];
    for (let col = 0; col < 5; col++) for (let row = 0; row < 3; row++) {
      const x = GRID.x + col * CW, y = GRID.y + row * CH;
      if (cells.has(`${col},${row}`)) {
        const original = this.reels[col].strip.children[row];
        original.visible = false;
        const frame = new Sprite(this.winFrameTexture);
        frame.anchor.set(.5); frame.position.set(x + CW / 2, y + CH / 2);
        frame.width = 148; frame.height = 148;
        const symbol = new Sprite(original.texture);
        symbol.anchor.set(.5); symbol.position.copyFrom(original.position); symbol.scale.set(132 / 256);
        this.winVisuals.addChild(frame, symbol);
        this.winningSymbols.push({ original, symbol });
      } else this.winShade.rect(x, y, CW, CH).fill({ color: 0x140c20, alpha: .52 });
    }
    // Subtle links show every valid adjacent pair without inventing a payline.
    for(let col=0;col<win.count-1;col++)for(let a=0;a<3;a++)for(let b=0;b<3;b++){
      if(!cells.has(`${col},${a}`)||!cells.has(`${col+1},${b}`))continue;
      this.links.moveTo(GRID.x+(col+.5)*CW,GRID.y+(a+.5)*CH)
        .lineTo(GRID.x+(col+1.5)*CW,GRID.y+(b+.5)*CH).stroke({color,width:2,alpha:.18});
    }
    this.links.alpha = 1;
    this.winShade.alpha = 1;
    return color;
  }
  beginSpin() {
    if (this.active) throw new Error('轉輪正在運轉');
    this.clearCelebration(); this.clearWins();
    this.dealer?.play('idle',{reduced:this.reduced});
    this.active = { waiting: true, time: 0, quickStop: false, reduced: this.reduced };
    this.reels.forEach((r, i) => {
      const frame = pendingReelFrame(REEL_STRIPS[i], this.currentStops[i], 0, CH);
      Object.assign(r, { names: frame.names, pendingStep: frame.step, speed: frame.speed, reduced: this.reduced, stopped: false, impacted: false });
      this.populate(r, r.names, -1);
    });
  }
  cancelSpin(stops = this.currentStops) {
    const a = this.active; this.active = null;
    this.reels.forEach(r => { r.stopped = true; });
    this.setStops(stops); a?.resolve?.();
  }
  spin(stops, onStop) {
    if (this.active && !this.active.waiting) throw new Error('轉輪正在運轉');
    gridFromStops(stops);
    if (!this.active) this.beginSpin();
    const waiting = this.active;
    return new Promise(resolve => {
      this.active = { time: 0, resolve, onStop, stops, quickStop: waiting.quickStop };
      this.reels.forEach((r, i) => {
        const plan = reelLandingAnimation(REEL_STRIPS[i], stops[i], r.names, r.strip.y, i, CH,
          { elapsed: waiting.time, quick: waiting.quickStop, reduced: waiting.reduced });
        Object.assign(r, plan, { start: 0, duration: plan.stopAt, stopped: false, impacted: false });
        this.populate(r, r.names, -1); r.strip.y = plan.offset;
      });
    });
  }
  requestQuickStop() {
    const a = this.active;
    if (!a || a.quickStop) return;
    a.quickStop = true;
    if (a.waiting) return;
    // Once the shared landing has begun, preserve every remaining impact and
    // sound interval. A stop request can only remove the earlier cruise.
    if (this.reels.some(r => r.impacted || r.stopAt - a.time <= (r.reduced ? 0 : REEL_SETTLE_MS))) return;
    const plans = this.reels.map((r, i) => reelLandingAnimation(REEL_STRIPS[i], a.stops[i], r.names, r.strip.y, i, CH, { quick: true, reduced: r.reduced }));
    if (plans[0].stopAt >= this.reels[0].stopAt - a.time) return;
    this.reels.forEach((r, i) => {
      const plan = plans[i];
      Object.assign(r, plan, { start: a.time, duration: plan.stopAt, stopAt: a.time + plan.stopAt });
      this.populate(r, plan.names, -1);
      r.strip.y = plan.offset;
    });
  }
  preloadDealer(){this.dealer?.preload('win');}
  prepareDealer(round){this.dealer?.preload(dealerClipForRound(round));}
  reactToRound(round){this.dealer?.play(dealerClipForRound(round),{reduced:this.reduced});}
  dealerFeedbackDuration(round){return dealerClipForRound(round)==='win'?this.dealer?.motionManifest?.clips.win?.durationMs??0:0;}
  reactToMilestone(){this.dealer?.play('idle',{reduced:this.reduced});}
  setDealerVisible(visible){this.dealer?.setVisible(visible);}
  celebrate(big = false, showLine = true) {
    this.presentationPaused = big || !showLine;
    this.links.alpha = this.presentationPaused ? 0 : 1;
    this.winShade.alpha = this.links.alpha;
    this.winVisuals.visible = !this.presentationPaused;
    this.winningSymbols.forEach(({ original }) => { original.visible = this.presentationPaused; });
    if (this.reduced || big) return;
    for (let i = 0; i < (big ? 100 : 30); i++) {
      const g = new Graphics();
      if (i % 3 === 0) g.star(0, 0, 4, 4 + Math.random() * 4, 2).fill(GOLD);
      else g.circle(0, 0, 4 + Math.random() * 4).fill(0xeab346).stroke({ color: 0xffec9d, width: 1.5 });
      g.position.set(600, 400); this.effects.addChild(g);
      this.particles.push({ g, vx: (Math.random() - .5) * 800, vy: -140 - Math.random() * 430, life: 1.8 + Math.random(), age: 0, spin: (Math.random() - .5) * 9 });
    }
  }
  clearCelebration() {
    this.presentationPaused = false;
    this.winVisuals.visible = true;
    this.winningSymbols.forEach(({ original }) => { original.visible = false; });
    if (this.winCycle.index >= 0) { this.links.alpha = 1; this.winShade.alpha = 1; }
  }
  tick(t) {
    this.dealer?.update(t,this.reduced);
    const dt = Math.min(t.elapsedMS, 50) / 1000;
    if (this.active) {
      // Ticker deltaMS is capped during slow frames. Reel duration must follow
      // actual elapsed time so a rendering hitch cannot stretch a quick stop.
      const a = this.active; a.time += Math.max(0,t.elapsedMS);
      if (a.waiting) {
        if (!a.reduced) this.reels.forEach((r, i) => {
          const frame = pendingReelFrame(REEL_STRIPS[i], this.currentStops[i], a.time, CH);
          if (frame.step !== r.pendingStep) {
            r.pendingStep = frame.step; r.names = frame.names;
            r.strip.children.forEach((sprite, row) => { sprite.texture = this.textures[r.names[row]]; });
          }
          r.strip.y = frame.offset;
        });
      } else {
        this.reels.forEach((r, i) => {
          if (r.stopped) return;
          const landingElapsed = a.time - r.stopAt;
          r.strip.y = landingElapsed < 0
            ? reelOffset(r.steps * CH, a.time - r.start, r.duration, r.reduced)
            : reelBounceOffset(landingElapsed, CH, r.reduced);
          if (!r.impacted && landingElapsed >= 0) { r.impacted = true; a.onStop(i); }
          if (landingElapsed >= (r.reduced ? 0 : REEL_BOUNCE_MS)) r.stopped = true;
        });
        if (this.reels.every(r => r.stopped)) { this.active = null; this.setStops(a.stops); a.resolve(); }
      }
    }
    this.winCycle.tick(t.deltaMS, this.presentationPaused || !!this.active);
    const popScale = this.symbolPop.tick(dt * 1000, this.presentationPaused || !!this.active, this.reduced);
    this.winningSymbols.forEach(({ symbol }) => symbol.scale.set(132 / 256 * popScale));
    this.particles = this.particles.filter(p => {
      p.age += dt; p.vy += 330 * dt; p.g.x += p.vx * dt; p.g.y += p.vy * dt; p.g.rotation += p.spin * dt; p.g.alpha = Math.max(0, 1 - p.age / p.life);
      if (p.age >= p.life) { p.g.destroy(); return false; } return true;
    });
  }
  finish() {
    if (!this.active || this.active.waiting) return;
    const a = this.active; this.active = null;
    this.reels.forEach((r,i)=>{if(!r.stopped){r.stopped=true;if(!r.impacted){r.impacted=true;a.onStop(i);}}});
    this.setStops(a.stops); a.resolve();
    this.particles.forEach(p => p.g.destroy()); this.particles = [];
  }
}
