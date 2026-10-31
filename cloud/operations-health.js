const HOUR=3600000;
const metrics=['reads','writes','egressBytes','storageBytes'];

// Aggregate maintenance state only. Never inspect players, rounds or spin timing.
export function operationsHealth(status,{now=Date.now()}={}){
  const alerts=[],quotaPercent={};
  const add=(code,severity='critical',scope)=>alerts.push({code,severity,...(scope?{scope}:{})});
  const age=value=>Number.isSafeInteger(value)&&value>0&&value<=now+60000?Math.max(0,now-value):null;
  if(status?.mode!=='active')add('SERVICE_NOT_ACTIVE');
  const backupAge=age(status?.backup?.at),alarmAge=age(status?.alarm?.at);
  if(backupAge===null)add('BACKUP_MISSING');
  else if(status.backup.ok!==true)add('BACKUP_FAILED');
  else if(backupAge>=48*HOUR)add('BACKUP_STALE');
  else if(backupAge>=26*HOUR)add('BACKUP_DELAYED','warning');
  const capacity=[['bytes','limitBytes'],['parts','limitParts']].map(([used,cap])=>[status?.backup?.[used],status?.backup?.[cap]]).filter(([used,cap])=>Number.isSafeInteger(used)&&used>=0&&Number.isSafeInteger(cap)&&cap>0).map(([used,cap])=>used/cap);
  if(capacity.some(value=>value>=1))add('BACKUP_CAPACITY_EXHAUSTED');
  else if(capacity.some(value=>value>=.8))add('BACKUP_CAPACITY_HIGH','warning');
  if(alarmAge===null)add('ALARM_MISSING');
  else if(status.alarm.ok!==true)add('ALARM_FAILED');
  else if(alarmAge>=30*60000)add('ALARM_STALE');
  if(status?.casino?.uncertain>0)add('CASINO_DELIVERY_UNCERTAIN','warning');
  if(status?.casino?.pending>0&&(age(status.casino.oldestPendingAt)??0)>=10*60000)add('CASINO_DELIVERY_DELAYED','warning');
  const scopes={global:status?.quota,...status?.quota?.scopes};
  for(const [scope,quota] of Object.entries(scopes)){
    if(!['global','maintenance','highlights'].includes(scope))continue;
    if(!quota||metrics.some(key=>!Number.isSafeInteger(quota.used?.[key])||quota.used[key]<0||!Number.isSafeInteger(quota.limits?.[key])||quota.limits[key]<1)){
      add('QUOTA_UNAVAILABLE','critical',scope);continue;
    }
    quotaPercent[scope]=Object.fromEntries(metrics.map(key=>[key,Math.round(quota.used[key]/quota.limits[key]*1000)/10]));
    if(quota.enforcement==='notify-only'){
      if(metrics.some(key=>quota.used[key]>=quota.limits[key]*.8))add('QUOTA_HIGH','warning',scope);
    }
    else if(quota.blocked===true||metrics.some(key=>quota.used[key]>=quota.limits[key]))add('QUOTA_EXHAUSTED','critical',scope);
    else if(metrics.some(key=>quota.used[key]>=quota.limits[key]*.8))add('QUOTA_HIGH','warning',scope);
  }
  alerts.sort((a,b)=>(a.code+':'+(a.scope||'')).localeCompare(b.code+':'+(b.scope||'')));
  return {ok:alerts.length===0,level:alerts.some(a=>a.severity==='critical')?'critical':alerts.length?'warning':'ok',checkedAt:now,alerts,backupAgeSeconds:backupAge===null?null:Math.floor(backupAge/1000),alarmAgeSeconds:alarmAge===null?null:Math.floor(alarmAge/1000),quotaPercent};
}

const labels={SERVICE_NOT_ACTIVE:'服務未啟用',SERVICE_UNREACHABLE:'無法連上遊戲服務',STATUS_UNAUTHORIZED:'監控授權失效',STATUS_INVALID:'維運狀態格式異常',BACKUP_MISSING:'缺少有效備份狀態',BACKUP_FAILED:'備份失敗',BACKUP_STALE:'備份超過 48 小時',BACKUP_DELAYED:'備份超過 26 小時',ALARM_MISSING:'缺少排程狀態',ALARM_FAILED:'背景排程失敗',ALARM_STALE:'背景排程超過 30 分鐘未更新',QUOTA_UNAVAILABLE:'無法確認使用額度',QUOTA_EXHAUSTED:'使用額度已達上限',QUOTA_HIGH:'Firestore 保守估算已達八成（非實際帳單用量）'};
const scopes={global:'整體',maintenance:'備份維護',highlights:'得獎公告'};
export const alertFingerprint=alerts=>JSON.stringify(alerts.map(({code,severity,scope})=>[code,severity,scope||'']).sort());
export function notificationPayload(alerts,now){
  const capacityLabels={BACKUP_CAPACITY_HIGH:'完整備份容量已達八成，需安排擴充或調整架構',BACKUP_CAPACITY_EXHAUSTED:'完整備份容量已達上限',CASINO_DELIVERY_UNCERTAIN:'賭場出入場公告傳送結果不明，請人工核對，勿盲目重送',CASINO_DELIVERY_DELAYED:'賭場出入場公告已等待超過十分鐘'};
  const lines=alerts.length?alerts.map(a=>'- '+(capacityLabels[a.code]||labels[a.code]||'維運狀態異常')+(scopes[a.scope]?'（'+scopes[a.scope]+'）':'')):['監控項目已恢復正常。'];
  return {content:['Joker’s Circus｜'+(alerts.length?'維運提醒':'服務恢復'),...lines,'檢查時間：'+new Date(now).toISOString()].join('\n'),allowed_mentions:{parse:[]}};
}
