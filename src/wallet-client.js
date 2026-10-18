export function createWalletClient(session,fetchImpl=fetch,storage=globalThis.sessionStorage){
  const key=`kemet-pending:${session.guildId}:${session.userId}`;
  let pending;
  try{pending=JSON.parse(storage?.getItem(key)||'null');}catch{pending=null;}
  if(pending&&(!Number.isInteger(pending.bet)||!/^[-a-zA-Z0-9]{16,80}$/.test(pending.requestId||'')))pending=null;
  const persist=()=>{try{if(pending)storage?.setItem(key,JSON.stringify(pending));else storage?.removeItem(key);}catch{}};
  async function request(path,body){
    let response;
    try{response=await fetchImpl(path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${session.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),cache:'no-store'});}
    catch{throw new Error('網路暫時中斷。下一次按 SPIN 會先確認上一筆結果，不會重複下注。');}
    let data;try{data=await response.json();}catch{throw new Error('服務回應中斷，請稍後重試。');}
    if(!response.ok){const error=new Error(data.error||'服務暫時無法使用。');error.status=response.status;throw error;}
    return data;
  }
  return {
    state:()=>request('/api/wallet'),
    ledger:()=>request('/api/ledger'),
    checkin:()=>request('/api/checkin',{}),
    async spin(bet){
      pending ||= {bet,requestId:crypto.randomUUID()};persist();
      try{const data=await request('/api/spin',pending);pending=null;persist();return data;}
      catch(error){if([400,403,409,429].includes(error.status)){pending=null;persist();}throw error;}
    },
    hasPending:()=>!!pending,
  };
}
