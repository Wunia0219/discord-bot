import {handleCommand} from './commands.js';
import {setTimeout as delay} from 'node:timers/promises';

export const validInteractionToken=token=>typeof token==='string'&&/^[-A-Za-z0-9._]{16,2048}$/.test(token);

// Acknowledge before cloud I/O, then edit only the original private command reply.
// Never re-run settlement when delivery fails; PATCH retries reuse the same result.
export async function completeDeferredCommand(interaction,wallet,{fetchImpl=fetch,wait=delay,warn=()=>console.warn('Discord command reply unavailable')}={}){
  const result=await handleCommand(interaction,wallet.store,wallet.adminRoles,wallet.commandChannelIds);
  const {flags,...body}=result.data;
  const url=`https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
  for(let attempt=0;attempt<3;attempt++){
    let response;
    try{
      response=await fetchImpl(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000),redirect:'error'});
      if(response.ok)return true;
    }catch{}
    if(response&&[400,401,403,404].includes(response.status))break;
    if(attempt<2){
      const retry=Number(response?.headers?.get('Retry-After'));
      if(response?.status===429&&Number.isFinite(retry)&&retry>10)break;
      await wait(response?.status===429&&Number.isFinite(retry)&&retry>0?Math.ceil(retry*1000):1000);
    }
  }
  warn();return false;
}
