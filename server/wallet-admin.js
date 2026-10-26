export const RESET_BALANCE=10000;
export const RESET_WALLET_LIMIT=100;
export const RESET_REASON='管理員重設戲籌';
export const resetFingerprint=actor=>JSON.stringify(['wallet-reset-v1',actor,RESET_BALANCE]);
export const resetMarker=(entry,roundId=null)=>({id:entry.id,time:entry.time,balance:entry.after,roundId});
const snowflake=s=>typeof s==='string'&&/^\d{17,20}$/.test(s);
const amount=n=>Number.isSafeInteger(n)&&n>=0&&n<=1e12;

export function resetResult(actor,requestId,time,entries){
  return {reset:{version:1,actor,requestId,time,balance:RESET_BALANCE,count:entries.length,
    changed:entries.filter(e=>e.before!==RESET_BALANCE).length,
    totalBefore:entries.reduce((n,e)=>n+BigInt(e.before),0n).toString()},entries};
}

// A single immutable request owns the whole reset. Each wallet still has its
// own append-only ledger entry, including a zero delta if already at 10,000.
export function validResetOperation(operation,result,entryById){
  const r=result?.reset,match=/^reset:([-a-zA-Z0-9]{16,80})$/.exec(operation.key);
  if(!match||r?.version!==1||!snowflake(r.actor)||r.requestId!==match[1]||r.balance!==RESET_BALANCE
    ||operation.fingerprint!==resetFingerprint(r.actor)||!Number.isFinite(Date.parse(r.time))
    ||!Array.isArray(result.entries)||!result.entries.length||result.entries.length>RESET_WALLET_LIMIT
    ||r.count!==result.entries.length)return false;
  const ids=new Set(),users=new Set();let total=0n,changed=0,previousId=null;
  for(const cached of result.entries){
    if(!cached||!Number.isSafeInteger(cached.id)||cached.id<1||(previousId!==null&&cached.id!==previousId+1))return false;
    const e=entryById(cached?.id);
    if(!e||e.guild!==operation.guild||e.kind!=='reset'||e.actor!==r.actor||e.reference!==r.requestId
      ||e.time!==r.time||e.reason!==RESET_REASON||!snowflake(e.user)||e.user!==cached.user
      ||!Number.isSafeInteger(e.id)||ids.has(e.id)||users.has(e.user)||!amount(e.before)
      ||e.after!==RESET_BALANCE||e.delta!==e.after-e.before
      ||!['id','before','after','delta'].every(k=>cached[k]===e[k]))return false;
    ids.add(e.id);users.add(e.user);total+=BigInt(e.before);changed+=Number(e.before!==RESET_BALANCE);previousId=e.id;
  }
  return r.totalBefore===String(total)&&r.changed===changed;
}
