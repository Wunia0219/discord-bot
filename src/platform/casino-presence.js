// Hidden tabs stay seated; pagehide is best-effort and server leases handle crashes.
export function createCasinoPresence(session,{fetchImpl=fetch,target=window,setTimer=globalThis.setInterval.bind(globalThis),clearTimer=globalThis.clearInterval.bind(globalThis),uuid=()=>crypto.randomUUID()}={}){
  let instanceId=uuid(),closed=false,running=null,timer=null,enabled=true;
  const send=async(action,keepalive=false,instance=instanceId)=>{
    const response=await fetchImpl('/api/casino-visit',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.token,...(session.walletEpoch?{'X-Wallet-Epoch':session.walletEpoch}:{})},body:JSON.stringify({action,instanceId:instance}),keepalive,cache:'no-store',...(!keepalive?{signal:AbortSignal.timeout(8000)}:{})});
    if(!response.ok)throw new Error('Casino presence unavailable');return response.json();
  };
  const pulse=()=>{
    if(closed||!enabled)return Promise.resolve();
    if(running)return running;
    const instance=instanceId;
    const task=(async()=>{
      const result=await send('heartbeat',false,instance);
      if(closed||instance!==instanceId)return;
      if(result.enabled===false){enabled=false;return;}
      if(!result.active)await send('enter',false,instance);
    })().catch(()=>{}).finally(()=>{if(running===task)running=null;});
    running=task;return task;
  };
  const leave=()=>{if(closed)return;closed=true;clearTimer(timer);timer=null;void send('leave',true).catch(()=>{});};
  const resume=event=>{if(event.persisted){closed=false;instanceId=uuid();running=null;void start();}};
  const visible=()=>{if(target.document?.visibilityState==='visible')void pulse();};
  async function start(){
    if(closed)return;
    const instance=instanceId;
    try{
      const result=await send('enter',false,instance);
      if(instance!==instanceId||closed)return;
      enabled=result.enabled!==false;
    }catch{/* heartbeat retries an unacknowledged entry */}
    if(instance===instanceId&&!closed&&enabled&&!timer)timer=setTimer(()=>void pulse(),45000);
  }
  target.addEventListener('pagehide',leave);target.addEventListener('pageshow',resume);target.document?.addEventListener('visibilitychange',visible);
  return {start,leave,pulse,dispose(){leave();target.removeEventListener('pagehide',leave);target.removeEventListener('pageshow',resume);target.document?.removeEventListener('visibilitychange',visible);}};
}
