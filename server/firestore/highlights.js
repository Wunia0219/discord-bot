import {FirestoreHighlights} from './highlights-core.js';
import {FirestoreWalletStore} from './wallet.js';
import {FirestoreQuota} from './quota.js';
import {highlightSettings} from '../discord/highlights.js';
function limit(env,name,fallback,max){
  const value=env[name]===undefined?Math.min(fallback,max):Number(env[name]);
  if(!Number.isSafeInteger(value)||value<1||value>max)throw new Error(`Invalid ${name}`);return value;
}
export class HighlightsQuota {
  constructor(settings,env){
    this.global=new FirestoreQuota(settings.quota);
    try{this.delivery=new FirestoreQuota({...settings.quota,filename:settings.quota.filename+'.highlights.sqlite',
      reads:limit(env,'FIRESTORE_HIGHLIGHTS_READ_BUDGET',3000,settings.quota.reads),
      writes:limit(env,'FIRESTORE_HIGHLIGHTS_WRITE_BUDGET',1000,settings.quota.writes),
      egressBytes:limit(env,'FIRESTORE_HIGHLIGHTS_EGRESS_MB',8,Math.floor(settings.quota.egressBytes/1024**2))*1024**2});}
    catch(error){this.global.close();throw error;}
  }
  reserve(cost={},document=null){this.delivery.reserve(cost,document);this.global.reserve(cost,document);}
  observe(bytes){this.global.observe(bytes);this.delivery.observe(bytes);}
  status(){return {...this.global.status(),delivery:this.delivery.status()};}
  close(){this.global.close();this.delivery.close();}
}
export function firestoreHighlightsConfig(env,game,options={}){
  const settings=highlightSettings(env,game);if(!settings)return null;
  if(env.LOCAL_WALLET_TEST==='true')throw new Error('Local fixture servers cannot publish Discord highlights');
  const queue=new FirestoreWalletStore(game.settings,{guildIds:[settings.guild],quota:new HighlightsQuota(game.settings,env)});
  game.highlightsGuild=settings.guild;
  return new FirestoreHighlights(queue,{...settings,ownsStore:true,...options});
}

export {FirestoreHighlights} from './highlights-core.js';
