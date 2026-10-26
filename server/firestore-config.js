import {createHash} from 'node:crypto';
import {firestoreSettings} from './firestore-settings.js';
import {FirestoreWalletStore} from './firestore-wallet.js';
import {WalletService} from './wallet-service.js';
import {assertDiscordConfiguration} from './discord-config.js';
import {LocalTestSessions,LOCAL_TEST_PROFILES} from './local-test-wallet.js';
import {LOCAL_TEST_CASES} from './local-test-plan.js';
import {APP_VERSION} from '../src/version.js';
import {firestoreHighlightsConfig} from './firestore-highlights.js';

export async function firestoreWalletConfig(env){
  if(env.HOST!=='127.0.0.1')throw new Error('Firestore integration currently requires HOST=127.0.0.1');
  const localTest=env.LOCAL_WALLET_TEST==='true';
  if(localTest&&env.APP_ENV!=='test')throw new Error('Local Firestore testing requires APP_ENV=test');
  if(!localTest)assertDiscordConfiguration(env);
  const guildIds=localTest?['100000000000000001']:(env.ALLOWED_GUILD_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
  const adminRoles=(env.CHIP_ADMIN_ROLE_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(adminRoles.some(id=>!/^\d{17,20}$/.test(id)))throw new Error('Invalid CHIP_ADMIN_ROLE_IDS');
  const settings=firestoreSettings(env);
  if(localTest&&!settings.namespace.endsWith('-qa-test'))throw new Error('Local Firestore fixtures require a separate namespace ending in -qa-test');
  const store=new FirestoreWalletStore(settings,{guildIds,weeklyRewards:env.WEEKLY_CHECKIN_REWARDS,grantMax:Number(env.ADMIN_GRANT_MAX||100000),grantDaily:Number(env.ADMIN_DAILY_MAX||1000000)});
  let highlights;
  try{
    highlights=firestoreHighlightsConfig(env,store);
    await store.initialize();
    if(!localTest)return {store,service:new WalletService(store),adminRoles,highlights};
    const guild=guildIds[0];
    for(const profile of LOCAL_TEST_PROFILES)await store.ensureFixture(guild,profile.user,profile.balance,profile.key);
    const localOverview=async()=>({ok:await store.isReady(),environment:'test',version:APP_VERSION,
      runId:createHash('sha256').update(settings.projectId+':'+settings.namespace).digest('hex').slice(0,16),weeklyRewards:store.weeklyRewards,cases:LOCAL_TEST_CASES,
      profiles:await Promise.all(LOCAL_TEST_PROFILES.map(async profile=>{
        const state=await store.state(guild,profile.user);
        return {key:profile.key,name:profile.name,initialBalance:profile.balance,purpose:profile.purpose,balance:state.balance,claimed:state.claimed,
          rounds:state.history.length,url:`/?wallet=local&player=${profile.key}`};
      }))});
    return {store,service:new LocalTestSessions(store),adminRoles:[],localTest:true,localOverview};
  }catch(error){await highlights?.close();await store.close();throw error;}
}
