import {cloudPlan} from '../../cloud/plan.js';
import {usageWindow} from './analytics.js';
import {usageRisks} from './policy.js';

const HOUR=3600000;

export function readUsageState(value,now){
  if(value===undefined)return {schema:1,plan:'free',day:usageWindow(now).day,at:now,notified:[],apiFailed:false,pending:null};
  const validKey=key=>typeof key==='string'&&/^(?:\d{4}-\d{2}-\d{2}:(?:workers|objects|reads|writes|duration):(?:quota(?:80|90|100)|forecast[12])|storage:quota(?:80|90|100)|api:(?:failure|recovery))$/.test(key);
  const validKeys=keys=>Array.isArray(keys)&&keys.length<=64&&keys.every(validKey);
  const pending=value?.pending;
  const validPending=!pending||['sending','retry','sent','uncertain','blocked'].includes(pending.status)&&validKeys(pending.keys)&&typeof pending.content==='string'&&pending.content.length<=1900&&(pending.nextAttempt===undefined||Number.isSafeInteger(pending.nextAttempt));
  if(value?.schema!==1||value.plan!==undefined&&!['free','paid'].includes(value.plan)||!/^\d{4}-\d{2}-\d{2}$/.test(value.day)||!Number.isSafeInteger(value.at)||value.at<=0||value.at>now+60000||!validKeys(value.notified)||typeof value.apiFailed!=='boolean'||!validPending)throw new Error('Usage notification state is invalid; restore the last trusted artifact');
  return structuredClone(value);
}

export function prepareUsage(previous,snapshot,{now=Date.now(),plan='free'}={}){
  cloudPlan(plan);
  const state=readUsageState(previous,now),day=usageWindow(now).day;
  // Keep API incident history across plan changes, but discard obsolete quota retries.
  if((state.plan||'free')!==plan){
    state.notified=state.notified.filter(key=>key.startsWith('api:'));
    if(state.pending?.status==='retry'&&!state.pending.keys.some(key=>key.startsWith('api:')))state.pending=null;
  }
  state.plan=plan;
  if(state.pending?.status==='sending')state.pending.status='uncertain';
  if(state.day!==day)state.notified=state.notified.filter(key=>key.startsWith('storage:')||key.startsWith('api:'));
  state.day=day;state.at=now;
  const failed=!snapshot,changed=state.apiFailed!==failed;
  if(changed)state.notified=state.notified.filter(key=>!key.startsWith('api:'));
  const risks=snapshot?usageRisks(snapshot,{plan}):[];
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
    const content=[plan==='paid'?'Cloudflare Paid 用量查詢狀態（帳戶合計）':'Cloudflare 免費額度預警（帳戶合計）',...lines,plan==='paid'?'Paid 依月用量計費；此每日觀測不代表月帳單或剩餘內含量。':'每日額度於台灣 08:00 重設；儲存不每日歸零。官方指標可能延遲，預測不等於帳單。','此通知不會停用遊戲或更改訂閱。'].join('\n');
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
  if(state.plan==='paid')return [
    `Cloudflare Paid 每日觀測：${state.day} UTC；查詢${queryOk?'成功':'失敗（用量未知）'}。`,
    '| 項目 | 已用 |',
    '| --- | ---: |',
    ...risks.map(metric=>`| ${metric.label} | ${formatAmount(metric,metric.used)} |`),
    `通知狀態：${state.pending?.status||'quiet'}。UTC 每日累計；儲存為各 namespace 近 24 小時峰值合計。`,
    'Paid 不適用 Free 每日停服門檻；只通知查詢故障與恢復。此報告未量測月累計、Worker CPU 或 GB-month，付費內含量及帳單請查 Cloudflare Billing。',
  ].join('\n');
  return [
    `Cloudflare Free 參考用量：${state.day} UTC；查詢${queryOk?'成功':'失敗（用量未知）'}。`,
    '| 項目 | 已用 | 免費參考線 | 百分比 | 預估剩餘 |',
    '| --- | ---: | ---: | ---: | --- |',
    ...risks.map(metric=>`| ${metric.label} | ${formatAmount(metric,metric.used)} | ${formatAmount(metric,metric.limit)} | ${metric.percent.toFixed(1)}% | ${metric.forecastStage?(metric.etaMs/HOUR).toFixed(1)+' 小時':'—'} |`),
    `通知狀態：${state.pending?.status||'quiet'}。每日窗口為 UTC 00:00～24:00，儲存為各 namespace 近 24 小時峰值合計。`,
    '預測使用最近最多一小時平均，至少觀察十五分鐘；官方數據可能延遲。這是免費額度風險監測，不是帳單或方案證明。',
  ].join('\n');
}
