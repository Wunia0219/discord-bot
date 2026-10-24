import {createWalletSync} from './wallet-sync.js';

export function createWalletClient(session,fetchImpl=fetch,storage=globalThis.sessionStorage,{clock=()=>performance.now(),wait=delay=>new Promise(resolve=>globalThis.setTimeout(resolve,delay))}={}){
  const key=`kemet-pending:${session.guildId}:${session.userId}`;
  let pending,nextSpinAt=0,spinPromise=null,statePromise=null,latestState=null;
  const validDelay=value=>Number.isFinite(value)&&value>0&&value<=60000;
  try{pending=JSON.parse(storage?.getItem(key)||'null');}catch{pending=null;}
  if(pending&&(!Number.isInteger(pending.bet)||!/^[-a-zA-Z0-9]{16,80}$/.test(pending.requestId||'')))pending=null;
  const persist=()=>{try{if(pending)storage?.setItem(key,JSON.stringify(pending));else storage?.removeItem(key);}catch{}};
  async function request(path,body,{deferHistory=false}={}){
    let response;
    try{response=await fetchImpl(path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${session.token}`,'X-Wallet-View':'compact-v1',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),cache:'no-store'});}
    catch{throw new Error('網路暫時中斷。下一次按 SPIN 會先確認上一筆結果，不會重複下注。');}
    let data;try{data=await response.json();}catch{throw new Error('服務回應中斷，請稍後重試。');}
    if(!response.ok){
      const error=new Error(data.error||'服務暫時無法使用。');error.status=response.status;
      if(response.status===429&&data.code==='SPIN_COOLDOWN'&&validDelay(data.retryAfterMs))Object.assign(error,{code:data.code,retryAfterMs:data.retryAfterMs});
      throw error;
    }
    // Relative server time avoids depending on the player's device clock.
    if(validDelay(data?.state?.spinCooldownMs))nextSpinAt=Math.max(nextSpinAt,clock()+data.state.spinCooldownMs);
    const synchronized=sync(data).then(update=>{
      if(update.state&&(!latestState||(update.state.revision||0)>=(latestState.revision||0)))latestState=update.state;
      return update;
    });
    if(!deferHistory||!data.round||!data.state)return synchronized;
    // The round and wallet balance are already authoritative. Older history
    // can arrive separately without delaying the reels or another valid spin.
    synchronized.catch(()=>{});
    let history=data.state.history||latestState?.history||[];
    if(!data.state.history&&data.historyRevision===data.state.historyRevision){
      history=[data.round,...history.filter(round=>round.id!==data.round.id)].slice(0,100);
    }
    return {...data,state:{...data.state,history,historyBefore:latestState?.historyBefore||0},synchronized};
  }
  const loadRounds=options=>request('/api/rounds?'+new URLSearchParams(options));
  const sync=createWalletSync(loadRounds);
  async function requestSpin(bet,options){
    pending ||= {bet,requestId:crypto.randomUUID()};persist();
    try{
      for(let attempt=0;;attempt++){
        let remaining;
        while((remaining=nextSpinAt-clock())>0)await wait(remaining);
        try{const data=await request('/api/spin',pending,options);pending=null;persist();return data;}
        catch(error){
          // A different device can start a round after our last wallet snapshot.
          // Only this explicit cooldown is retried, keeping the same bet and ID.
          if(error.code==='SPIN_COOLDOWN'&&attempt<2){nextSpinAt=Math.max(nextSpinAt,clock()+error.retryAfterMs+25);continue;}
          throw error;
        }
      }
    }catch(error){if([400,403,409,429].includes(error.status)){pending=null;persist();}throw error;}
  }
  return {
    state(){
      statePromise ||= request('/api/wallet').finally(()=>{statePromise=null;});
      return statePromise;
    },
    ledger:()=>request('/api/ledger'),
    rounds:before=>loadRounds({before,limit:50}),
    checkin:()=>request('/api/checkin',{}),
    spin(bet,options){
      spinPromise ||= requestSpin(bet,options).finally(()=>{spinPromise=null;});
      return spinPromise;
    },
    hasPending:()=>!!pending,
  };
}
