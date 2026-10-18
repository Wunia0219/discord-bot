import './big-win.css';
import mainUrl from '../images/main.webp';
import atlas from '../images/main.json';
import auraUrl from '../images/fx/big-win-aura.webp';
import sparkUrl from '../images/fx/big-win-spark-sheet.webp';
import superTitleUrl from '../images/fx/super-win-title.webp';
import megaTitleUrl from '../images/fx/mega-win-title.webp';
import { WIN_TITLES } from './win-tier.js';
import { prepareNumberFont, setBitmapNumber } from './bitmap-number.js';

function art(name, className) {
  const {x,y,w,h} = atlas.frames[name].frame;
  return `<div class="${className}" style="aspect-ratio:${w}/${h}"><img src="${mainUrl}" alt="" style="width:${atlas.meta.size.w/w*100}%;left:${-x/w*100}%;top:${-y/h*100}%" /></div>`;
}

export class BigWinPresentation {
  constructor(host) {
    this.element = document.createElement('div');
    this.element.className = 'bigwin-display'; this.element.setAttribute('aria-hidden','true');
    this.element.innerHTML = `<div class="bigwin-shade"></div><div class="bigwin-stage">
      <div class="bigwin-aura"><img src="${auraUrl}" alt="" /></div><div class="bigwin-rays"></div>
      ${art('big_win_decor.png','bigwin-lotus')}${art('big_win.png','bigwin-title bigwin-title-big')}
      <div class="bigwin-title bigwin-title-super" hidden><img src="${superTitleUrl}" alt="" /></div>
      <div class="bigwin-title bigwin-title-mega" hidden><img src="${megaTitleUrl}" alt="" /></div>
      <div class="bigwin-score"></div><div class="bigwin-dust" aria-hidden="true"></div>
      </div>`;
    host.append(this.element);
    this.score = this.element.querySelector('.bigwin-score');
    const dust = this.element.querySelector('.bigwin-dust');
    // A single 8-frame sprite sheet is shared by the floating energy motes.
    for (let i=0;i<18;i++) {
      const mote = document.createElement('i');
      const angle = i * 2.39996;
      mote.style.cssText = `--x:${50+Math.cos(angle)*(34+i%3*5)}%;--y:${50+Math.sin(angle)*(35+i%4*3)}%;--delay:${-(i%8)*.125}s;--float-delay:${-i*.21}s;--size:${18+i%5*7}px;background-image:url('${sparkUrl}')`;
      dust.append(mote);
    }
  }
  async prepare() {
    await Promise.all([prepareNumberFont(),...[auraUrl,sparkUrl,superTitleUrl,megaTitleUrl].map(src => {const img=new Image();img.src=src;return img.decode();})]);
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
