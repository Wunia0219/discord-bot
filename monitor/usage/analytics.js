const HOUR=3600000,DAY=24*HOUR,STORAGE_GROUP_LIMIT=1000;

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

