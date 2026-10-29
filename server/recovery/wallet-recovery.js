// Operator-only recovery helpers. Backups retain the complete accounting chain;
// this module never pauses a writer, modifies Firestore, or releases ownership.
import {decodeCloudArchive} from './cloud-handoff.js';
import {digest} from '../../cloud/snapshot.js';

export function recoverySummary(envelope,key,environment,{guildId}={}){
  const archive=envelope.archive||envelope,snapshot=decodeCloudArchive(archive,key,environment);
  if(guildId&&!/^\d{17,20}$/.test(guildId))throw new Error('Invalid expected guild');
  if(guildId&&Object.entries(snapshot.tables).some(([table,rows])=>table!=='settings'&&rows.some(row=>row.guild!==guildId)))throw new Error('Archive contains another guild; no data filtered or restored');
  return {snapshot,summary:{ok:true,environment,revision:snapshot.revision,
    backupReadTime:archive.manifest.readTime||archive.manifest.header?.readTime||null,
    snapshotCreatedAt:new Date(snapshot.createdAt).toISOString(),
    counts:Object.fromEntries(Object.entries(snapshot.tables).map(([name,rows])=>[name,rows.length])),
    walletCount:snapshot.tables.wallets.length,
    totalBalance:snapshot.tables.wallets.reduce((sum,w)=>sum+BigInt(w.balance),0n).toString(),
    archiveSha256:digest(JSON.stringify(envelope)),
    scope:'Full encrypted snapshot verification; not a live restore or a claim of current balances'}};
}

export async function downloadRecoveryArchive({origin,token,source,fetchImpl=fetch}){
  const base=new URL(origin);
  if(base.protocol!=='https:'||!/^[-a-z0-9]+\.[-a-z0-9]+\.workers\.dev$/.test(base.hostname)||base.port||base.pathname!=='/'||base.search||base.hash||base.username||base.password)throw new Error('Reviewed workers.dev origin required');
  if(!/^[a-f0-9]{64}$/i.test(token||''))throw new Error('Admin token required to download encrypted backup');
  if(!source||!['test','production'].includes(source.environment)||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(source.projectId||'')||!/^[-a-z0-9]{3,80}$/.test(source.namespace||'')||!source.namespace.endsWith('-'+source.environment))throw new Error('Explicit expected source required');
  const request=async(path,body)=>{
    let response;
    try{response=await fetchImpl(new URL(path,base),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(30000),...(body?{body:JSON.stringify(body)}:{})});}
    catch{throw new Error('Backup download unavailable; original backup and service retained');}
    if(!response.ok)throw new Error('Backup download refused (HTTP '+response.status+'); no service change requested');
    try{return await response.json();}catch{throw new Error('Invalid backup response');}
  };
  const match=value=>{if(!value||['projectId','namespace','environment'].some(k=>value[k]!==source[k]))throw new Error('Backup source does not match the expected project, namespace and environment');};
  const status=await request('/__ops/status');match(status.source);
  const envelope=await request('/__ops/archive-manifest',{});match(envelope.source);
  const manifest=envelope.archive?.manifest;
  if(manifest?.environment!==source.environment||!Number.isSafeInteger(manifest.parts)||manifest.parts<1||manifest.parts>8192||!manifest.generation)throw new Error('Invalid archive manifest');
  const chunks=[];
  while(chunks.length<manifest.parts){
    const start=chunks.length,limit=Math.min(16,manifest.parts-start);
    const page=await request('/__ops/archive-page',{generation:manifest.generation,start,limit});
    if(page.generation!==manifest.generation||page.sha256!==manifest.sha256||page.start!==start||!Array.isArray(page.chunks)||page.chunks.length!==limit)throw new Error('Archive page changed or incomplete');
    chunks.push(...page.chunks);
  }
  return {...envelope,archive:{manifest,chunks}};
}

// Only this redacted payload can reach Discord. No archives, keys, IDs, balances,
// raw errors, local paths or arbitrary operator text are accepted as message text.
export function recoveryNotification(report){
  if(!['backup','drill'].includes(report.operation)||!['complete','failed'].includes(report.status))throw new Error('Completed recovery report required');
  const count=report.walletCount;
  if(report.status==='complete'&&(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(report.revision)||report.revision<0))throw new Error('Invalid recovery summary');
  const title=report.operation==='backup'?'加密備份下載與驗證':'隔離恢復演練';
  const content=['Joker’s Circus｜'+title+(report.status==='complete'?'完成':'失敗'),
    '正式／測試服務與玩家資料均未切換。',
    ...(report.status==='complete'?['已核對錢包數：'+count,'備份帳本版本：'+report.revision]:['請維運人員檢查本機報告；不要直接重設錢包或覆蓋現行資料。']),
    ...(report.operation==='drill'&&report.status==='complete'?['此為隔離還原與原請求重播驗證，不代表正式雲端已完成切換。']:[]),
    '檢查時間：'+new Date(report.finishedAt).toISOString()].join('\n');
  return {content,allowed_mentions:{parse:[]}};
}

export async function sendRecoveryNotification({webhook,guildId,channelId,report,save,fetchImpl=fetch}){
  if(!/^\d{17,20}$/.test(guildId||'')||!/^\d{17,20}$/.test(channelId||'')||typeof save!=='function')throw new Error('Explicit maintenance destination and durable receipt required');
  const url=new URL(webhook);
  if(url.protocol!=='https:'||url.hostname!=='discord.com'||url.port||url.username||url.password||url.search||url.hash||!/^\/api(?:\/v10)?\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]+$/.test(url.pathname))throw new Error('Invalid maintenance webhook');
  const payload=recoveryNotification(report);
  if(report.notification){
    if(report.notification.status==='sending'){report.notification={status:'uncertain'};await save(report);}
    return report.notification;
  }
  let info;
  try{const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error();info=await response.json();}
  catch{throw new Error('Cannot verify maintenance destination; no notification sent');}
  if(info.guild_id!==guildId||info.channel_id!==channelId)throw new Error('Maintenance destination mismatch; no notification sent');
  report.notification={status:'sending'};await save(report);
  url.searchParams.set('wait','true');
  try{
    const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(response.ok){const message=await response.json();if(!/^\d{17,20}$/.test(message.id||'')||message.channel_id!==channelId)throw new Error();report.notification={status:'sent',messageId:message.id};}
    else report.notification={status:response.status>=400&&response.status<500?'blocked':'uncertain'};
  }catch{report.notification={status:'uncertain'};}
  await save(report);return report.notification;
}
