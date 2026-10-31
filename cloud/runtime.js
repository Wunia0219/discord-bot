import {FirestoreWalletCore} from '../server/firestore/wallet-core.js';
import {FirestoreHighlights} from '../server/firestore/highlights-core.js';
import {SettlementQueue} from '../server/wallet/settlement-queue.js';
import {WalletService} from '../server/wallet/wallet-service.js';
import {highlightSettings} from '../server/discord/highlights.js';
import {createActivityHandler} from '../server/http/app-handler.js';
import {CloudBackup} from './backup.js';
import {commandChannels} from '../server/discord/discord-channel-scope.js';
import {CasinoBot} from '../server/discord/casino-bot.js';
import {FirestoreRest} from './firestore-rest.js';
import {CloudSessions,CloudLoginLimit,Sealer} from './storage.js';
import {SnapshotVault} from './snapshot.js';
import {CloudQuota} from './quota.js';
import {CasinoVisits} from '../server/discord/casino-visits.js';
import {walletSettings} from '../server/wallet/settings.js';
import {cloudIdentity} from './config.js';
import {cloudFetch} from './fetch.js';

export async function createCloudRuntime(project){
  const settings=cloudIdentity(project.env),saved=project.state.get('source');if(!saved||saved.projectId!==settings.projectId||saved.namespace!==settings.namespace||project.quota.identity().projectId!==settings.projectId)throw new Error('Handoff is required');
  const credentials=JSON.parse(project.env.GOOGLE_SERVICE_ACCOUNT_JSON||'null');if(credentials?.type!=='service_account'||credentials.project_id!==settings.projectId||!credentials.private_key||!credentials.client_email)throw new Error('Credentials mismatch');
  const sealer=new Sealer(project.env.CLOUD_ENCRYPTION_KEY),vault=new SnapshotVault(project.ctx.storage,project.state,sealer);
  const transport=()=>new FirestoreRest({...settings,credentials,fetchImpl:cloudFetch,endpoint:project.env.FIRESTORE_ENDPOINT}),{adminRoles,...options}=walletSettings(project.env,{cloud:true});
  // This sole writer refreshes wallets after every committed operation.
  const store=new FirestoreWalletCore(settings,{...options,db:transport(),quota:project.quota,settlementQueue:new SettlementQueue(),stateCacheMs:30000});
  // Never initialize an empty remote namespace from a public request.
  const meta=await store.read(store.meta);store.checkMeta(meta);store.walletEpoch=meta.walletEpoch;store.resetAt=meta.resetAt;store.ready=true;store.readyAt=Date.now();
  const service=new WalletService(store,{fetchImpl:cloudFetch,sessions:new CloudSessions(project.ctx.storage,sealer)}),hs=highlightSettings(project.env,store);
  const bot=hs?.botSettings?new CasinoBot({...hs.botSettings,fetchImpl:cloudFetch}):null;
  const visits=bot?new CasinoVisits({state:project.state,bot,readAccount:(guild,user)=>store.casinoAccount(guild,user),wake:()=>project.ctx.waitUntil(project.schedule(1000)),warn:message=>console.warn(message)}):null;
  const highlights=hs?new FirestoreHighlights(new FirestoreWalletCore(settings,{...options,db:transport(),quota:new CloudQuota(project.ctx.storage,project.state,{scope:'highlights'})}),{...hs,bot,fetchImpl:cloudFetch}):null;
  if(hs)store.highlightsGuild=hs.guild;
  const backup=new CloudBackup(new FirestoreWalletCore(settings,{...options,db:transport(),quota:new CloudQuota(project.ctx.storage,project.state,{scope:'maintenance'})}),project.state,vault);
  const wallet={store,service,visits,commandChannelIds:commandChannels(project.env),adminRoles,highlights:highlights?{enqueue:(session,id,round)=>{if(highlights.enqueue(session,id,round)){project.state.set('highlights-dirty',true);project.ctx.waitUntil(project.schedule(bot?1000:10000));}}}:null};
  const handler=createActivityHandler({fetchImpl:cloudFetch,clientId:project.env.DISCORD_CLIENT_ID,clientSecret:project.env.DISCORD_CLIENT_SECRET,publicKey:project.env.DISCORD_PUBLIC_KEY,wallet,loginLimiter:new CloudLoginLimit(project.state),defer:p=>project.ctx.waitUntil(project.track(p)),operations:{isReady:()=>project.ready(),recordRequest:()=>{}}});
  return {settings,store,service,highlights,visits,backup,vault,handler};
}
