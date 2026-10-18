import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import { SYMBOLS } from './game.js';

const W = 900, H = 410, CELL = 124;
const gold = 0xe9c983;
export class SlotScene {
  app = new Application();
  reels = [];
  particles = [];
  elapsed = 0;
  active = null;
  fps = 0;
  reduced = false;
  async init(host) {
    await this.app.init({ width: W, height: H, backgroundAlpha: 0, antialias: true, preference: 'webgl', resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true });
    host.append(this.app.canvas);
    this.app.canvas.setAttribute('aria-hidden', 'true');
    this.app.canvas.style.width = '100%'; this.app.canvas.style.height = 'auto'; this.app.canvas.style.display = 'block';
    this.app.ticker.maxFPS = 60;
    this.textures = Object.fromEntries(SYMBOLS.map(s => {
      const art = this.symbol(s);
      const texture = this.app.renderer.generateTexture({ target: art, resolution: 2 });
      art.destroy({ children: true });
      return [s, texture];
    }));
    const back = new Graphics();
    back.roundRect(57, 15, 786, 380, 15).fill(0x060e17).stroke({ color: gold, alpha: .25, width: 1 });
    for (let i = 0; i < 3; i++) {
      const x = 78 + i * 250;
      back.roundRect(x, 30, 244, 350, 7).fill(0x111f2a).stroke({ color: 0x3c505a, alpha: .45, width: 1 });
      const strip = new Container();
      const mask = new Graphics().rect(x, 33, 244, 344).fill(0xffffff);
      this.app.stage.addChild(mask);
      strip.mask = mask;
      this.reels.push({ strip, x, stopped: true, base: 0 });
    }
    this.app.stage.addChildAt(back, 0);
    this.reels.forEach(r => this.app.stage.addChild(r.strip));
    this.setStatic(['moon', 'seven', 'gem']);
    const shade = new Graphics();
    for (let i = 0; i < 50; i++) {
      shade.rect(78, 30 + i * 2, 744, 2).fill({ color: 0x060e17, alpha: .86 * (1 - i / 50) });
      shade.rect(78, 378 - i * 2, 744, 2).fill({ color: 0x060e17, alpha: .86 * (1 - i / 50) });
    }
    this.app.stage.addChild(shade);
    this.line = new Graphics().roundRect(72, 142, 756, 126, 7).stroke({ color: gold, alpha: .36, width: 1 });
    this.app.stage.addChild(this.line);
    const marks = new Graphics();
    marks.poly([28, 194, 44, 205, 28, 216]).fill(gold);
    marks.poly([872, 194, 856, 205, 872, 216]).fill(gold);
    for (const x of [66, 834]) for (const y of [24, 386]) marks.circle(x, y, 2).fill(gold);
    this.app.stage.addChild(marks);
    this.effects = new Container(); this.app.stage.addChild(this.effects);
    this.app.ticker.add(t => this.tick(t));
  }
  symbol(type) {
    const c = new Container();
    const bounds = new Graphics().rect(-62, -57, 124, 114).fill({ color: 0, alpha: 0 }); c.addChild(bounds);
    const g = new Graphics(); c.addChild(g);
    if (type === 'gem') {
      g.poly([-43,-18,-24,-43,24,-43,43,-18,0,45]).fill(0x367b88).stroke({ color: 0x90e9de, width: 2 });
      g.poly([-43,-18,0,45,-14,-18]).fill(0x40b8c3);
      g.poly([-14,-18,0,45,17,-18]).fill(0xa2e5db);
      g.poly([-24,-43,-14,-18,17,-18,24,-43]).fill(0x68c5c6);
      g.moveTo(-43,-18).lineTo(43,-18).moveTo(-24,-43).lineTo(-14,-18).lineTo(0,45).lineTo(17,-18).lineTo(24,-43).stroke({color:0xc4fff0,width:1.5,alpha:.8});
    } else if (type === 'moon') {
      g.moveTo(16,-40).bezierCurveTo(-40,-57,-64,27,-15,43).bezierCurveTo(10,52,34,35,40,15).bezierCurveTo(-1,29,-22,-8,16,-40).closePath().fill(0xe9c987).stroke({color:0xffe2a1,width:2});
      g.star(29,19,4,13,4).fill(0xffe4a3);
      g.star(40,-32,4,5,2).fill(0xffe4a3);
    } else if (type === 'star') {
      g.star(0,0,5,47,22,-Math.PI/2).fill(0xc18e48).stroke({color:0xffe7b5,width:2});
      g.star(-2,-4,5,37,17,-Math.PI/2).fill(0xf3d694);
      g.star(-2,-4,5,23,11,-Math.PI/2).stroke({color:0xfff2cc,width:1});
    } else if (type === 'seven') {
      const shadow = new Text({ text: '7', style: { fontFamily:'Georgia', fontSize:112, fontWeight:'bold', fill:0x67282c, stroke:{color:0x391a22,width:4} } });
      shadow.anchor.set(.5); shadow.position.set(3,3); c.addChild(shadow);
      const seven = new Text({ text:'7', style:{fontFamily:'Georgia',fontSize:112,fontWeight:'bold',fill:0xf19383,stroke:{color:0xffd6ac,width:2}} });
      seven.anchor.set(.5); seven.position.set(0,-3); c.addChild(seven);
    } else if (type === 'cherry') {
      g.moveTo(-20,6).quadraticCurveTo(-12,-12,13,-38).quadraticCurveTo(10,-12,24,9).stroke({color:0xd9bc7a,width:4});
      g.ellipse(26,-30,16,7).fill(0x609c82);
      g.circle(-21,20,24).fill(0xb34c57).stroke({color:0xea8b8b,width:2});
      g.circle(25,22,23).fill(0xca6570).stroke({color:0xf5a4a0,width:2});
      g.ellipse(-27,12,6,9).fill({color:0xffd0c0,alpha:.7});g.ellipse(19,14,5,8).fill({color:0xffd0c0,alpha:.7});
    } else {
      g.poly([-43,-26,-23,-4,0,-39,23,-4,43,-26,35,30,-35,30]).fill(0xcf9d50).stroke({color:0xffe7af,width:2});
      g.poly([-30,3,0,-25,30,3,25,18,-25,18]).fill(0xf3dba0);
      g.roundRect(-36,27,72,12,4).fill(0xe8c482);
      [-43,0,43].forEach((x,i)=>g.circle(x,i===1?-41:-29,5).fill(0xfce6b7));
      g.poly([0,-1,8,9,0,19,-8,9]).fill(0x427b82);
    }
    return c;
  }
  populate(reel, names) {
    reel.strip.removeChildren().forEach(c => c.destroy());
    names.forEach((name,i) => {
      const s = new Sprite(this.textures[name]); s.anchor.set(.5); s.position.set(reel.x + 122, 81 + i * CELL); reel.strip.addChild(s);
    });
    reel.strip.y = 0;
  }
  setStatic(symbols) {
    this.reels.forEach((r,i) => this.populate(r,[SYMBOLS[(i+2)%6],symbols[i],SYMBOLS[(i+4)%6]]));
  }
  spin(symbols, onStop) {
    if (this.active) throw new Error('轉輪正在運轉');
    this.line.alpha = .3;
    return new Promise(resolve => {
      this.active = { time:0, resolve, onStop, symbols };
      this.reels.forEach((r,i) => {
        r.steps = 18 + i * 5; r.duration = this.reduced ? 350 + i*100 : 2200 + i*480; r.stopped = false;
        const names = Array.from({length:r.steps+4},(_,j)=>SYMBOLS[(j*5+i+Math.floor(Math.random()*6))%6]);
        names[0] = SYMBOLS[(i+2)%6]; names[1] = this.current?.[i] || ['moon','seven','gem'][i];
        names[r.steps+1] = symbols[i]; this.populate(r,names);
      });
      this.current = symbols;
    });
  }
  celebrate(big = false) {
    this.line.alpha = 1;
    if (this.reduced) return;
    for(let i=0;i<(big?95:30);i++) {
      const g=new Graphics();
      if(i%3===0) g.star(0,0,4,5+Math.random()*5,2).fill(gold);
      else g.roundRect(-3,-6,6,12,2).fill(i%2?gold:0x83c5bf);
      g.position.set(450,205); this.effects.addChild(g);
      this.particles.push({g,vx:(Math.random()-.5)*700,vy:-180-Math.random()*370,life:1.7+Math.random(),age:0,spin:(Math.random()-.5)*8});
    }
  }
  tick(t) {
    const dt = Math.min(t.elapsedMS,50)/1000;
    this.fps = this.fps*.95 + t.FPS*.05;
    if(this.active) {
      const a=this.active; a.time += t.deltaMS;
      this.reels.forEach((r,i)=>{
        if(r.stopped) return;
        const p=Math.min(a.time/r.duration,1);
        // Cubic deceleration ends exactly on the server/test-selected symbol.
        const eased=1-Math.pow(1-p,3);
        r.strip.y=-r.steps*CELL*eased;
        if(p===1){r.stopped=true;r.strip.y=-r.steps*CELL;a.onStop(i);}
      });
      if(this.reels.every(r=>r.stopped)) {
        this.active=null; this.setStatic(a.symbols);this.line.alpha=1; a.resolve();
      }
    }
    this.particles = this.particles.filter(p=>{
      p.age+=dt;p.vy+=330*dt;p.g.x+=p.vx*dt;p.g.y+=p.vy*dt;p.g.rotation+=p.spin*dt;p.g.alpha=Math.max(0,1-p.age/p.life);
      if(p.age>=p.life){p.g.destroy();return false;}return true;
    });
  }
  finish() {
    if(!this.active)return;
    const a=this.active;this.active=null;this.current=a.symbols;this.setStatic(a.symbols);this.line.alpha=1;a.resolve();
    this.particles.forEach(p=>p.g.destroy());this.particles=[];
  }
}
