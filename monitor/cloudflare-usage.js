const HOUR=3600000,DAY=24*HOUR,STORAGE_GROUP_LIMIT=1000;
export const FREE_METRICS=Object.freeze([
  {id:'workers',label:'Worker 請求',limit:100000},
  {id:'objects',label:'DO 請求',limit:100000},
  {id:'reads',label:'SQLite 讀取列數',limit:5000000},
  {id:'writes',label:'SQLite 寫入列數',limit:100000},
  {id:'duration',label:'DO 活躍時間 (GB-s)',limit:13000},
  {id:'storage',label:'SQLite 儲存近 24 小時峰值合計',limit:5e9,persistent:true},
]);

export function usageWindow(now){
  if(!Number.isSafeInteger(now)||now<=0)throw new Error('Invalid observation time');
  const dayStart=Math.floor(now/DAY)*DAY;
  return {day:new Date(dayStart).toISOString().slice(0,10),dayStart,end:dayStart+DAY,hourStart:Math.max(dayStart,now-HOUR),at:now};
}

export function usageQuery(account,now){
  if(!/^[a-f0-9]{32}$/i.test(account||''))throw new Error('CF_ACCOUNT_ID is required');
  const w=usageWindow(now),filter=start=>`{datetime_geq:"${new Date(start).toISOString()}",datetime_lt:"${new Date(now).toISOString()}"}`;
  const groups=(prefix,start)=>`
    ${prefix}Workers: workersInvocationsAdaptive(limit:1,filter:${filter(start)}) {sum{requests}}
    ${prefix}Objects: durableObjectsInvocationsAdaptiveGroups(limit:1,filter:${filter(start)}) {sum{requests}}
    ${prefix}Sql: durableObjectsPeriodicGroups(limit:1,filter:${filter(start)}) {sum{rowsRead rowsWritten duration}}`;
  return {query:`query Usage($account: string!) {viewer {accounts(filter:{accountTag:$account}) {
    ${groups('day',w.dayStart)} ${groups('hour',w.hourStart)}
    storage: durableObjectsSqlStorageGroups(limit:${STORAGE_GROUP_LIMIT},filter:${filter(now-DAY)}) {dimensions{namespaceId} max{storedBytes}}
  }}}`,variables:{account}};
}

function number(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new Error('Cloudflare metrics are incomplete');
  return value;
}
function aggregate(rows,fields){
  if(!Array.isArray(rows)||rows.length>1)throw new Error('Cloudflare metrics are incomplete');
  return Object.fromEntries(fields.map(field=>[field,rows.length?number(rows[0]?.sum?.[field]):0]));
}
export function parseUsage(body,now){
  const accounts=body?.data?.viewer?.accounts;
  if((body?.errors&&(!Array.isArray(body.errors)||body.errors.length))||!Array.isArray(accounts)||accounts.length!==1)throw new Error('Cloudflare analytics query failed');
  const data=accounts[0],result={...usageWindow(now),used:{},hour:{}};
  for(const [prefix,target] of [['day',result.used],['hour',result.hour]]){
    target.workers=aggregate(data[prefix+'Workers'],['requests']).requests;
    target.objects=aggregate(data[prefix+'Objects'],['requests']).requests;
    const sql=aggregate(data[prefix+'Sql'],['rowsRead','rowsWritten','duration']);
    Object.assign(target,{reads:sql.rowsRead,writes:sql.rowsWritten,duration:sql.duration});
  }
  if(!Array.isArray(data.storage)||data.storage.length>=STORAGE_GROUP_LIMIT)throw new Error('Cloudflare storage metrics are incomplete');
  const namespaces=new Set();
  result.used.storage=data.storage.reduce((sum,row)=>{
    const namespace=row?.dimensions?.namespaceId;
    if(!/^[a-f0-9]{32}$/i.test(namespace||'')||namespaces.has(namespace))throw new Error('Cloudflare storage metrics are incomplete');
    namespaces.add(namespace);return number(sum+number(row?.max?.storedBytes));
  },0);
  return result;
}

export async function fetchUsage({account,token,now=Date.now(),fetchImpl=globalThis.fetch.bind(globalThis)}){
  if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))throw new Error('CF_ANALYTICS_TOKEN is required');
  const request=usageQuery(account,now);
  let response;
  try{response=await fetchImpl('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(request),redirect:'error',signal:AbortSignal.timeout(30000)});}
  catch{throw new Error('Cloudflare analytics unavailable');}
  if(!response.ok)throw new Error('Cloudflare analytics unavailable');
  let body;try{body=await response.json();}catch{throw new Error('Cloudflare analytics response invalid');}
  return parseUsage(body,now);
}

export function usageRisks(snapshot){
  const {day,at,end,hourStart}=snapshot;
  return FREE_METRICS.map(metric=>{
    const used=number(snapshot.used[metric.id]),percent=used/metric.limit*100;
    const rate=!metric.persistent&&at-hourStart>=15*60000?number(snapshot.hour[metric.id])/(at-hourStart):0;
    const etaMs=rate>0?Math.max(0,metric.limit-used)/rate:null;
    const quotaStage=percent>=100?3:percent>=90?2:percent>=80?1:0;
    const forecastStage=etaMs!==null&&used<metric.limit&&etaMs<end-at?(etaMs<=2*HOUR?2:1):0;
    const prefix=metric.persistent?'storage':`${day}:${metric.id}`;
    const keys=[...[80,90,100].slice(0,quotaStage).map(level=>`${prefix}:quota${level}`),...[1,2].slice(0,forecastStage).map(level=>`${prefix}:forecast${level}`)];
    return {...metric,used,percent,etaMs,quotaStage,forecastStage,keys};
  });
}

export function readUsageState(value,now){
  if(value===undefined)return {schema:1,day:usageWindow(now).day,at:now,notified:[],apiFailed:false,pending:null};
  const validKey=key=>typeof key==='string'&&/^(?:\d{4}-\d{2}-\d{2}:(?:workers|objects|reads|writes|duration):(?:quota(?:80|90|100)|forecast[12])|storage:quota(?:80|90|100)|api:(?:failure|recovery))$/.test(key);
  const validKeys=keys=>Array.isArray(keys)&&keys.length<=64&&keys.every(validKey);
  const pending=value?.pending;
  const validPending=!pending||['sending','retry','sent','uncertain','blocked'].includes(pending.status)&&validKeys(pending.keys)&&typeof pending.content==='string'&&pending.content.length<=1900&&(pending.nextAttempt===undefined||Number.isSafeInteger(pending.nextAttempt));
  if(value?.schema!==1||!/^\d{4}-\d{2}-\d{2}$/.test(value.day)||!Number.isSafeInteger(value.at)||value.at<=0||value.at>now+60000||!validKeys(value.notified)||typeof value.apiFailed!=='boolean'||!validPending)throw new Error('Usage notification state is invalid; restore the last trusted artifact');
  return structuredClone(value);
}

export function prepareUsage(previous,snapshot,{now=Date.now()}={}){
  const state=readUsageState(previous,now),day=usageWindow(now).day;
  if(state.pending?.status==='sending')state.pending.status='uncertain';
  if(state.day!==day)state.notified=state.notified.filter(key=>key.startsWith('storage:')||key.startsWith('api:'));
  state.day=day;state.at=now;
  const failed=!snapshot,changed=state.apiFailed!==failed;
  if(changed)state.notified=state.notified.filter(key=>!key.startsWith('api:'));
  const risks=snapshot?usageRisks(snapshot):[];
  if(risks.find(metric=>metric.id==='storage')?.percent<70)state.notified=state.notified.filter(key=>!key.startsWith('storage:'));
  const active=risks.flatMap(metric=>metric.keys);
  if(failed)active.push('api:failure');
  else if(changed||state.pending?.status==='retry'&&state.pending.keys.includes('api:recovery'))active.push('api:recovery');
  state.apiFailed=failed;
  const retry=state.pending?.status==='retry'?state.pending:null;
  const keys=[...new Set([...active.filter(key=>!state.notified.includes(key)),...(retry?.keys||[]).filter(key=>active.includes(key))])];
  const lines=risks.filter(metric=>metric.keys.some(key=>keys.includes(key))).map(metric=>{
    const eta=metric.forecastStage?`；依近一小時速率，約 ${(metric.etaMs/HOUR).toFixed(1)} 小時後用盡`:'';
    return `${metric.label}：${formatAmount(metric,metric.used)}／${formatAmount(metric,metric.limit)}（${metric.percent.toFixed(1)}%）${eta}`;
  });
  if(keys.includes('api:failure'))lines.push('Cloudflare 官方用量暫時無法取得；目前用量未知，請查看 Actions 失敗紀錄。');
  if(keys.includes('api:recovery'))lines.push('Cloudflare 官方用量查詢已恢復。');
  let send=false;
  if(keys.length){
    const content=['Cloudflare 免費額度預警（帳戶合計）',...lines,'每日額度於台灣 08:00 重設；儲存不每日歸零。官方指標可能延遲，預測不等於帳單。','此通知不會停用遊戲或更改訂閱。'].join('\n');
    if(retry?.nextAttempt>now)state.pending={...retry,keys,content};
    else{
      state.notified=[...new Set([...state.notified,...keys])];
      state.pending={status:'sending',keys,content};send=true;
    }
  }else if(retry)state.pending=null;
  return {state,risks,send,queryOk:!failed};
}

function formatAmount(metric,value){return metric.persistent?(value/1e9).toFixed(3)+' GB':value.toLocaleString('en-US',{maximumFractionDigits:1});}
export function usageSummary(result){
  const {state,risks,queryOk}=result;
  return [
    `Cloudflare Free 參考用量：${state.day} UTC；查詢${queryOk?'成功':'失敗（用量未知）'}。`,
    '| 項目 | 已用 | 免費參考線 | 百分比 | 預估剩餘 |',
    '| --- | ---: | ---: | ---: | --- |',
    ...risks.map(metric=>`| ${metric.label} | ${formatAmount(metric,metric.used)} | ${formatAmount(metric,metric.limit)} | ${metric.percent.toFixed(1)}% | ${metric.forecastStage?(metric.etaMs/HOUR).toFixed(1)+' 小時':'—'} |`),
    `通知狀態：${state.pending?.status||'quiet'}。每日窗口為 UTC 00:00～24:00，儲存為各 namespace 近 24 小時峰值合計。`,
    '預測使用最近最多一小時平均，至少觀察十五分鐘；官方數據可能延遲。這是免費額度風險監測，不是帳單或方案證明。',
  ].join('\n');
}
