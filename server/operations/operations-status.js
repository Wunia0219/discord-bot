import {readFileSync} from 'node:fs';

export async function checkOperationsStatus(settings,{port=4188,fetchImpl=fetch,clock=Date.now}={}){
  if(!settings)return {ok:false,reason:'OPERATIONS_DISABLED'};
  let status;
  try{
    status=JSON.parse(readFileSync(settings.statusFile,'utf8'));
    if(status.sourceId!==settings.sourceId||!Number.isFinite(Date.parse(status.updatedAt)))throw new Error('Invalid status');
  }catch{return {ok:false,reason:'OPERATIONS_STATUS_UNAVAILABLE'};}
  const age=Math.max(0,clock()-Date.parse(status.updatedAt));
  const stale=age>settings.monitorIntervalMs*2+120000;
  let reachable=false;
  try{const response=await fetchImpl(`http://127.0.0.1:${port}/readyz`,{signal:AbortSignal.timeout(3000),cache:'no-store'});reachable=response.status===200;}
  catch{/* Missing or stopped services are unhealthy even with an old green file. */}
  return {...status,ok:status.ok===true&&status.running===true&&!stale&&reachable,reachable,stale};
}
