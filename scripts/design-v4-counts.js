// Offline exact integer symbol-count search for a fixed V1 paytable, W=H1.
import {writeFileSync} from 'node:fs';
const paytable=[[20,100,500],[15,75,250],[10,50,150],[8,40,100],[5,15,40],[5,12,30],[4,10,25],[3,8,20],[20,100,500]];
const lut=new Uint16Array(9**5);
for(let key=0;key<lut.length;key++){
 let v=key;const line=Array(5);for(let i=4;i>=0;i--){line[i]=v%9;v=Math.floor(v/9);}
 for(let s=0;s<9;s++){let n=0;while(n<5&&(line[n]===s||(s!==8&&line[n]===8)))n++;if(n>=3)lut[key]=Math.max(lut[key],paytable[s][n-3]);}
}
let seed=20261021;const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};const rand=(a,b)=>a+next()%(b-a+1);
const samples=Number(process.argv[2]||3000);
let selected;
for(let attempt=1;attempt<=samples&&!selected;attempt++){
 const first=Array.from({length:4},()=>{const a=rand(12,16),b=rand(8,12),c=rand(5,9);return [1,1,1,1,a,b,c,35-a-b-c,1];});
 if(first.some(r=>r[7]<3))continue;
 const coefficients=Array(9).fill(0);
 for(let a=0;a<9;a++)for(let b=0;b<9;b++)for(let c=0;c<9;c++)for(let d=0;d<9;d++){
  const weight=first[0][a]*first[1][b]*first[2][c]*first[3][d],key=(((a*9+b)*9+c)*9+d)*9;
  for(let e=0;e<9;e++)coefficients[e]+=weight*lut[key+e];
 }
 const target=40**4*200*24/25;
 for(let trial=0;trial<35&&!selected;trial++){
  const last=[rand(3,7),rand(3,7),rand(3,7),rand(3,7),0,0,0,0,rand(2,4)];
  const remaining=200-last.reduce((a,b)=>a+b,0),fixed=last.reduce((a,b,i)=>a+b*coefficients[i],0),den=coefficients[4]-coefficients[5];
  for(let c=8;c<=65&&!selected;c++)for(let d=8;d<=65&&!selected;d++){
   const a=(target-fixed-c*coefficients[6]-d*coefficients[7]-(remaining-c-d)*coefficients[5])/den;
   const b=remaining-c-d-a;
   if(!Number.isInteger(a)||a<20||a>98||b<20||b>98)continue;
   last[4]=a;last[5]=b;last[6]=c;last[7]=d;
   selected={paytable,counts:[...first.map(r=>r.map(n=>n*5)),last],coefficients,exactLinePayoutSum:target,exactLineStopCombinations:40**4*200,rtp:.96,searchSeed:20261021,attempt};
  }
 }
 if(attempt%100===0)console.log('count candidates',attempt);
}
if(!selected)throw new Error('No exact count solution found');
writeFileSync(new URL('../docs/model-v4-counts.json',import.meta.url),JSON.stringify(selected,null,2)+'\n');console.log(JSON.stringify(selected,null,2));
