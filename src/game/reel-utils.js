import { SYMBOLS,SYMBOL_CODES } from './symbols.js';
export const wrap=(n,length)=>((n%length)+length)%length;
export function makeReels(codes){
  const names=Object.fromEntries(SYMBOLS.map(s=>[SYMBOL_CODES[s],s]));
  return Object.freeze(codes.map(r=>Object.freeze(r.map(code=>{
    if(!names[code])throw new Error(`未知輪帶圖標：${code}`);return names[code];
  }))));
}
export function validateReelStops(reels,stops){
  if(!Array.isArray(stops)||stops.length!==reels.length||stops.some((s,i)=>!Number.isInteger(s)||s<0||s>=reels[i].length))throw new Error('無效的轉輪停點');
}
export function gridFromReels(reels,stops){
  validateReelStops(reels,stops);
  return stops.map((stop,i)=>[-1,0,1].map(d=>reels[i][wrap(stop+d,reels[i].length)]));
}
export function uniformStop(length,nextUint32=()=>crypto.getRandomValues(new Uint32Array(1))[0]){
  if(!Number.isInteger(length)||length<1||length>2**32)throw new Error('無效的轉輪長度');
  const ceiling=Math.floor(2**32/length)*length;let value;
  do{value=nextUint32();if(!Number.isInteger(value)||value<0||value>=2**32)throw new Error('無效的亂數');}while(value>=ceiling);
  return value%length;
}
