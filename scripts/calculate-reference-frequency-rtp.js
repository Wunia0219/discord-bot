// Frequency-first, offline calculation. No reel length, RTP target, live-model
// edits, payout edits, or single-symbol frequency optimization.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { SYMBOLS, SYMBOL_NAMES, PAYTABLE, PAYLINES, MODEL_VERSION, evaluateLine } from '../src/slot-math.js';

const source=JSON.parse(readFileSync(new URL('../docs/reference-243-analysis.json',import.meta.url)));
if(process.argv[2]) {
  const raw=readFileSync(process.argv[2]);
  assert.equal(createHash('sha256').update(raw).digest('hex'),source.sourceSha256);
  const original=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));
  assert.equal(original.length,5);
  original.forEach((r,i)=>{
    assert.equal(r.length,source.reference[i].length);
    assert.deepEqual(Object.fromEntries([...new Set(r)].sort().map(s=>[s,r.filter(x=>x===s).length])),source.reference[i].counts);
  });
}
const codes=['H1','H2','H3','H4','L1','L2','L3','L4','W'];
const pay=SYMBOLS.map(s=>PAYTABLE[s]);
assert.deepEqual(pay,[[20,100,500],[15,75,250],[10,50,150],[8,40,100],[5,15,40],[5,12,30],[4,10,25],[3,8,20],[20,100,500]]);
assert.equal(PAYLINES.length,20);
const gcd=(a,b)=>b?gcd(b,a%b):a;
const rat=(n,d=1n)=>{n=BigInt(n);d=BigInt(d);assert.ok(d>0n);const g=gcd(n<0n?-n:n,d);return [n/g,d/g];};
const add=([a,b],[c,d])=>rat(a*d+c*b,b*d);
const mul=([a,b],[c,d])=>rat(a*c,b*d);
const sub=([a,b],[c,d])=>rat(a*d-c*b,b*d);
const integer=n=>rat(BigInt(n));
const one=integer(1),zero=integer(0);
const sum=a=>a.reduce(add,zero);
const value=([a,b])=>Number(a)/Number(b);
const record=q=>({numerator:String(q[0]),denominator:String(q[1]),value:value(q)});
const percent=q=>(value(q)*100).toFixed(6)+'%';

const probabilities=source.reference.map(({length,counts})=>{
  const high=Array.from({length:4},(_,i)=>rat(counts['H'+(i+1)]||0,length));
  const wild=rat(counts.W||0,length);
  const lowSlots=length-Object.entries(counts).reduce((n,[s,c])=>n+(s.startsWith('H')||s==='W'?c:0),0);
  const normalWeights=Array.from({length:4},(_,i)=>counts['N'+(i+1)]);
  const normalTotal=normalWeights.reduce((a,b)=>a+b,0);
  // Keep the four surviving normals in their original N1:N2:N3:N4 ratio.
  // Redistribute N5 and SC probability into that same low-symbol ratio.
  const low=normalWeights.map(n=>rat(BigInt(lowSlots)*BigInt(n),BigInt(length)*BigInt(normalTotal)));
  const row=[...high,...low,wild];assert.deepEqual(sum(row),one);
  return row;
});
assert.deepEqual(probabilities[0][8],zero);assert.deepEqual(probabilities[1][8],zero);
// Per-symbol frequency checks precede payout calculation. No soft objective can
// trade away these requirements to improve RTP.
source.reference.forEach(({length,counts},r)=>{
  for(let s=0;s<4;s++)assert.deepEqual(probabilities[r][s],rat(counts[codes[s]],length));
  assert.deepEqual(probabilities[r][8],rat(counts.W||0,length));
  for(let a=4;a<8;a++)for(let b=4;b<8;b++) {
    assert.deepEqual(mul(probabilities[r][a],integer(counts['N'+(b-3)])),mul(probabilities[r][b],integer(counts['N'+(a-3)])));
  }
});

// Exact integer weights are an arithmetic device, not proposed strip lengths.
const denominators=probabilities.map(row=>row.reduce((n,[,d])=>n/gcd(n,d)*d,1n));
const weights=probabilities.map((row,r)=>row.map(([n,d])=>n*(denominators[r]/d)));
const denominator=denominators.reduce((a,b)=>a*b,1n);
let numerator=0n;
for(let key=0;key<9**5;key++) {
  let v=key;const line=Array(5);for(let r=4;r>=0;r--){line[r]=v%9;v=Math.floor(v/9);}
  let best=0;
  // Independent prefix oracle checked against the production longest-run scorer.
  for(let n=3;n<=5;n++) {
    const ordinary=[...new Set(line.slice(0,n).filter(s=>s!==8))];
    if(!ordinary.length)best=Math.max(best,...pay.map(p=>p[n-3]));
    else if(ordinary.length===1)best=Math.max(best,pay[ordinary[0]][n-3]);
  }
  assert.equal(best,evaluateLine(line.map(s=>SYMBOLS[s])).multiplier);
  numerator+=BigInt(best)*line.reduce((n,s,r)=>n*weights[r][s],1n);
}
const rtp=rat(numerator,denominator);
// A second, closed-form check. No WILD on the first two reference reels means
// each winning line has exactly one ordinary symbol; no overlapping awards.
const contribution=Array.from({length:8},(_,s)=>{
  const firstThree=mul(mul(probabilities[0][s],probabilities[1][s]),add(probabilities[2][s],probabilities[2][8]));
  const q4=add(probabilities[3][s],probabilities[3][8]);
  const q5=add(probabilities[4][s],probabilities[4][8]);
  const exactThree=mul(firstThree,sub(one,q4));
  const exactFour=mul(mul(firstThree,q4),sub(one,q5));
  const exactFive=mul(mul(firstThree,q4),q5);
  return sum([mul(exactThree,integer(pay[s][0])),mul(exactFour,integer(pay[s][1])),mul(exactFive,integer(pay[s][2]))]);
});
assert.deepEqual(sum(contribution),rtp);
const expectedAt100=mul(rtp,integer(100));
const highShares=probabilities.map(r=>sum(r.slice(0,4)));
const lowShares=probabilities.map(r=>sum(r.slice(4,8)));
const names=SYMBOLS.map(s=>SYMBOL_NAMES[s]);
const result={
  design:'reference-frequency-fixed-paytable',
  status:'offline probability design and exact RTP for review; no replacement game model installed',
  sourceSha256:source.sourceSha256,
  frequencyPolicy:'Per-symbol target probabilities are fixed before scoring. H1..H4 and W match the source exactly on every reel; surviving low-symbol relative frequencies match source N1:N2:N3:N4 exactly.',
  mapping:'H1..H4 retained. N1..N4 map to L1..L4. Because this game has four lows and no Scatter feature, N5 and SC mass is redistributed proportionally across these four lows. No N5 or Scatter award is added.',
  lengthPolicy:'No strip length is prescribed or selected. Rational common denominators are only used for arithmetic, not as a physical strip proposal.',
  codes,names,
  probabilitiesByReel:probabilities.map(row=>row.map(record)),
  groupProbabilitiesByReel:probabilities.map((row,r)=>({high:record(highShares[r]),low:record(lowShares[r]),wild:record(row[8])})),
  paytable:pay,paylines:PAYLINES,
  scoring:{rows:3,reels:5,paylines:20,lineBet:'totalBet / 20',direction:'left to right',minimumMatch:3,paylineAward:'highest matching award only',roundAward:'sum of all payline awards',scatterAwards:false,bonusAwards:false},
  exact:{rtp:record(rtp),expectedPayoutAtTotalBet100:record(expectedAt100),singleLineExpectationInLineBets:record(rtp),ordinarySymbolRtpContributions:contribution.map((q,s)=>({code:codes[s],value:record(q)})),contributionNote:'WILD substitution is included in the ordinary-symbol contributions. A standalone WILD match cannot start on these reference R1/R2 reels.'},
  verification:{symbolOutcomesChecked:9**5,allOutcomesMatchProductionScorer:true,oracleAndClosedFormAgree:true,arithmetic:'BigInt rational arithmetic, no Monte Carlo estimate',reelOrderDependence:'Expected RTP is independent of strip order for independent uniform stops and fixed paylines. Whole-game hit rate, variance and reachable maximum require a specified order and are not claimed here.'},
  deployment:{applied:false,unchangedActiveVersion:MODEL_VERSION},
};
const out=new URL('../output/reference-frequency-study/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('probabilities-and-rtp.json',out),JSON.stringify(result,null,2)+'\n');
const table='| 圖標 | R1 | R2 | R3 | R4 | R5 |\n|---|---:|---:|---:|---:|---:|\n'+codes.map((s,i)=>`| ${s} ${names[i]} | ${probabilities.map(r=>percent(r[i])).join(' | ')} |`).join('\n');
const breakdown='| 圖標 | 對 RTP 的貢獻（百分點） |\n|---|---:|\n'+contribution.map((q,s)=>`| ${codes[s]} | ${(value(q)*100).toFixed(8)} |`).join('\n');
const report=`# 參考頻率＋原賠率：20 線實際 RTP

依使用者最新選擇：保留參考頻率與原賠率，先呈現實際 RTP。此階段為離線機率設計，不預設 80 格、不以 96% 為搜尋目標，也未套用替代版本。

## 計算結果

- 理論 RTP：**${percent(rtp)}**（約 19%）。精確分數為 ${rtp[0]} / ${rtp[1]}。
- 每 100 總下注，長期期望總派彩為 ${value(expectedAt100).toFixed(8)}；不是每一回合固定支付此金額。
- L1 五軸每格比例為 ${probabilities.map(r=>percent(r[4])).join('／')}。
- 沒有調高 L1、增加前兩軸 WILD，或為接近 96% 改動其他圖標頻率。

## 逐圖標每格出現率

${table}

上表為各軸「單一格位」的機率；不是整局有中獎率，也不是三格窗口至少出現一次的機率。

## 與參考表的對應

H1～H4 與 W 在每一軸的機率都與使用者原表完全相同，第一、二軸 W 保持為 0。

原表有 N1～N5 五種低分與 SC；目前此款只有四種低分、沒有 SC 功能。因此沿用已說明的轉換：N1～N4 對應 L1～L4，並把 N5／SC 原本占用的機率，按該軸 N1:N2:N3:N4 比例分配給四種低分。這保留四種低分之間的相對頻率；不能稱為五種低分的逐項原樣複製。

如果日後增加第五種低分或 SC 功能，必須按新的符號與派彩規則重算。此處不是公司原本 243 路遊戲的 RTP；原遊戲的賠率與 SC／免費遊戲規則未提供。

## 原賠率與下注基準

維持 20 條固定賠線、單線下注＝總下注÷20，從左往右至少三連、每線只付最高獎，各線相加。H1／W 為 20／100／500；H2 為 15／75／250；H3 為 10／50／150；H4 為 8／40／100；L1 為 5／15／40；L2 為 5／12／30；L3 為 4／10／25；L4 為 3／8／20，皆乘單線下注。

## 驗算方式

使用任意精度整數權重，列舉全部 59,049 種單線符號組合，逐項比對獨立前綴算分器與目前遊戲算分器；另用三／四／五連的封閉式機率公式交叉核對，結果完全相同。

每條固定賠線具有相同的各軸邊際機率，且總下注平均分配到 20 條線，因此整局 RTP 等於單線期望派彩／單線下注。輪帶長短、圖標在輪帶上的重排不會改變這個期望值。

${breakdown}

W 的替代作用已計入各一般圖標的貢獻；原表前兩軸沒有 W，因此沒有以 W 開頭的獨立 W 三連派彩。

此階段尚未指定實體輪帶排列，所以不宣稱整局命中率、波動、最大獎可達性或三格窗口出現率，也沒有沿用 v5 的這些數字。

## 重現與資料

執行 \`node scripts/calculate-reference-frequency-rtp.js\`。來源指紋為 \`${source.sourceSha256}\`。精確機率與結果在 [probabilities-and-rtp.json](../output/reference-frequency-study/probabilities-and-rtp.json)。來源逐軸計數在 [reference-243-analysis.json](reference-243-analysis.json) 的 reference 區段；該檔舊的 80 格 candidate 區段不參與本次計算。
`;
writeFileSync(new URL('../docs/reference-frequency-rtp.md',import.meta.url),report);
console.log(JSON.stringify({rtpPercent:value(rtp)*100,rtpFraction:`${rtp[0]}/${rtp[1]}`,L1Percent:probabilities.map(r=>value(r[4])*100),sourceHighAndWildMatchExactly:true,sourceLowRatiosMatchExactly:true,symbolOutcomesChecked:9**5,applied:false},null,2));
