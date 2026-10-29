import './big-win.css';
import { mainArt as art, prepareMainArt } from '../shared/main-art.js';
import { WIN_TITLES } from '../../game/win-tier.js';
import { prepareNumberFont, setBitmapNumber } from '../shared/bitmap-number.js';

export class BigWinPresentation {
  constructor(host) {
    this.element = document.createElement('div');
    this.element.className = 'bigwin-display'; this.element.setAttribute('aria-hidden','true');
    this.element.innerHTML = `<div class="bigwin-shade"></div><div class="bigwin-stage">
      ${art('win-aura.png','bigwin-aura')}<div class="bigwin-rays"></div>
      ${art('big-win.png','bigwin-title bigwin-title-big')}
      ${art('super-win.png','bigwin-title bigwin-title-super',true)}
      ${art('mega-win.png','bigwin-title bigwin-title-mega',true)}
      <div class="bigwin-score"></div><div class="bigwin-dust" aria-hidden="true"></div>
      </div>`;
    host.append(this.element);
    this.score = this.element.querySelector('.bigwin-score');
    const dust = this.element.querySelector('.bigwin-dust');
    for (let i=0;i<24;i++) {
      const particle = document.createElement('div');
      particle.className = 'bigwin-coin';
      particle.style.cssText = `--x:${(i*37)%96}%;--delay:${-i*.17}s;--duration:${2.5+i%4*.3}s;--size:${22+i%5*7}px`;
      particle.innerHTML = art('celebration-coin.png','coin-art');
      dust.append(particle);
    }
  }
  async prepare() {
    await Promise.all([prepareNumberFont(), prepareMainArt()]);
  }

  show(amount, reduced=false, tier='big') {
    this.hide();
    if(!Object.hasOwn(WIN_TITLES,tier))tier='big';
    this.element.dataset.tier=tier;
    for(const key of Object.keys(WIN_TITLES))this.element.querySelector(`.bigwin-title-${key}`).hidden=key!==tier;
    this.element.classList.toggle('reduced',reduced);
    this.element.setAttribute('aria-hidden','false');
    this.element.setAttribute('aria-label',`${WIN_TITLES[tier]}，中獎 ${amount.toLocaleString('en-US')} 分`);
    setBitmapNumber(this.score,reduced?amount.toLocaleString('en-US'):'0');
    // Restart the authored entrance even when a new preview interrupts a prior one.
    void this.element.offsetWidth;
    this.element.classList.add('show');
    const started=performance.now();
    const animate=now=>{
      const p=reduced?1:Math.min(1,Math.max(0,(now-started-450)/2550));
      const value=p===1?amount:Math.floor(amount*(1-(1-p)**3));
      setBitmapNumber(this.score,value.toLocaleString('en-US'));
      if(p<1)this.frame=requestAnimationFrame(animate);
      else {this.frame=0;this.element.classList.add('settled');}
    };
    this.frame=requestAnimationFrame(animate);
  }
  hide() {
    cancelAnimationFrame(this.frame);this.frame=0;
    this.element.classList.remove('show','settled');
    this.element.setAttribute('aria-hidden','true');
  }
}
