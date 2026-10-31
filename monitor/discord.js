const TIMEOUT=10000;

export function operationsWebhook(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='discord.com'||url.port||url.username||url.password||url.search||url.hash||!/^\/api(?:\/v10)?\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]+$/.test(url.pathname))throw new Error('Separate Discord operations webhook required');
  url.searchParams.set('wait','true');
  return url;
}

// A timeout or 5xx may follow an accepted POST; only a definite 429 is retryable.
export async function postNotification(webhook,payload,{fetchImpl=globalThis.fetch.bind(globalThis),now=Date.now()}={}){
  try{
    const response=await fetchImpl(webhook,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(TIMEOUT)});
    if(response.status===429){
      const body=await response.json().catch(()=>({})),retry=Number(response.headers.get('retry-after')||body.retry_after);
      const nextAttempt=now+Math.ceil((Number.isFinite(retry)&&retry>0?retry:3600)*1000);
      return Number.isSafeInteger(nextAttempt)?{status:'retry',nextAttempt}:{status:'blocked'};
    }
    if(response.ok){
      const message=await response.json();
      return {status:/^\d{17,20}$/.test(message.id||'')?'sent':'uncertain'};
    }
    return {status:response.status>=400&&response.status<500?'blocked':'uncertain'};
  }catch{return {status:'uncertain'};}
}
