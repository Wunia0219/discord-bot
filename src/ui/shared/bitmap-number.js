import descriptor from '../../../images/fonts/circus-gold.fnt?raw';
import atlasUrl from '../../../images/fonts/circus-gold.webp';

const glyphs = new Map(descriptor.split('\n').filter(line => line.startsWith('char ')).map(line => {
  const glyph = Object.fromEntries([...line.matchAll(/(\w+)=(-?\d+)/g)].map(([,key,value]) => [key,Number(value)]));
  return [String.fromCodePoint(glyph.id),glyph];
}));
// Font-wide bounds are fixed; retain the authored baseline and descenders.
const fontGlyphs=[...glyphs.values()];
const fontTop=Math.min(...fontGlyphs.map(glyph=>glyph.yoffset))-6;
const fontHeight=Math.max(...fontGlyphs.map(glyph=>glyph.yoffset+glyph.height))-fontTop+6;
const image = new Image(); image.src = atlasUrl;
let loaded = false;
export const prepareNumberFont = () => image.decode().then(() => { loaded = true; });

// The DOM HUD and celebration use the same BMFont metrics/atlas as a game renderer.
// Keep accessible text while drawing only the pre-rendered golden glyphs.
export function setBitmapNumber(element, text) {
  text = String(text);
  if (!loaded) { element.textContent = text; return; }
  if (element.dataset.bitmapValue === text) return;
  element.dataset.bitmapValue = text;
  if (!text) { element.replaceChildren(); return; }
  let canvas = element.querySelector('canvas');
  if (!canvas) {
    const accessible = document.createElement('span'); accessible.className = 'sr-only number-text';
    canvas = document.createElement('canvas'); canvas.className = 'bitmap-number'; canvas.setAttribute('aria-hidden','true');
    element.replaceChildren(accessible,canvas);
  }
  element.querySelector('.number-text').textContent = text;
  const sequence = [...text].map(char => glyphs.get(char === '-' ? '−' : char));
  if (sequence.some(glyph => !glyph)) { element.textContent = text; delete element.dataset.bitmapValue; return; }
  const width=sequence.reduce((width,glyph)=>width+glyph.xadvance,24);
  let resized=false;
  if(canvas.width!==width){canvas.width=width;resized=true;}
  if(canvas.height!==fontHeight){canvas.height=fontHeight;resized=true;}
  if(resized)canvas.style.width=`${width/fontHeight}em`;
  const context = canvas.getContext('2d');
  if(!resized)context.clearRect(0,0,width,fontHeight);
  let x = 12;
  for (const glyph of sequence) {
    context.drawImage(image,glyph.x,glyph.y,glyph.width,glyph.height,x+glyph.xoffset,glyph.yoffset-fontTop,glyph.width,glyph.height);
    x += glyph.xadvance;
  }
}
