import {cloudPlan} from '../../cloud/plan.js';

const HOUR=3600000;
export const FREE_METRICS=Object.freeze([
  {id:'workers',label:'Worker 請求',limit:100000},
  {id:'objects',label:'DO 請求',limit:100000},
  {id:'reads',label:'SQLite 讀取列數',limit:5000000},
  {id:'writes',label:'SQLite 寫入列數',limit:100000},
  {id:'duration',label:'DO 活躍時間 (GB-s)',limit:13000},
  {id:'storage',label:'SQLite 儲存近 24 小時峰值合計',limit:5e9,persistent:true},
]);

function number(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new Error('Cloudflare metrics are incomplete');
  return value;
}
export function usageRisks(snapshot,{plan='free'}={}){
  cloudPlan(plan);
  const {day,at,end,hourStart}=snapshot;
  return FREE_METRICS.map(metric=>{
    const used=number(snapshot.used[metric.id]),percent=used/metric.limit*100;
    const rate=plan==='free'&&!metric.persistent&&at-hourStart>=15*60000?number(snapshot.hour[metric.id])/(at-hourStart):0;
    const etaMs=rate>0?Math.max(0,metric.limit-used)/rate:null;
    const quotaStage=plan==='paid'?0:percent>=100?3:percent>=90?2:percent>=80?1:0;
    const forecastStage=plan==='free'&&etaMs!==null&&used<metric.limit&&etaMs<end-at?(etaMs<=2*HOUR?2:1):0;
    const prefix=metric.persistent?'storage':`${day}:${metric.id}`;
    const keys=[...[80,90,100].slice(0,quotaStage).map(level=>`${prefix}:quota${level}`),...[1,2].slice(0,forecastStage).map(level=>`${prefix}:forecast${level}`)];
    return {...metric,used,percent,etaMs,quotaStage,forecastStage,keys};
  });
}

