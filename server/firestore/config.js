import {createHash} from 'node:crypto';
import {firestoreSettings} from './settings.js';
import {FirestoreWalletStore} from './wallet.js';
import {WalletService} from '../wallet/wallet-service.js';
import {assertDiscordConfiguration} from '../discord/discord-config.js';
import {LocalTestSessions,LOCAL_TEST_PROFILES} from '../testing/local-test-wallet.js';
import {LOCAL_TEST_CASES} from '../testing/local-test-plan.js';
import {APP_VERSION} from '../../src/version.js';
import {firestoreHighlightsConfig} from './highlights.js';
import {walletSettings} from '../wallet/settings.js';
import {commandChannels} from '../discord/discord-channel-scope.js';

export async function firestoreWalletConfig(env){
  const commandChannelIds=commandChannels(env);
  if(env.HOST!=='127.0.0.1')throw new Error('Firestore integration currently requires HOST=127.0.0.1');
  const localTest=env.LOCAL_WALLET_TEST==='true';
  if(localTest&&env.APP_ENV!=='test')throw new Error('Local Firestore testing requires APP_ENV=test');
  if(!localTest)assertDiscordConfiguration(env);
  const {adminRoles,...options}=walletSettings(env);
  const guildIds=localTest?['100000000000000001']:options.guildIds;
  const settings=firestoreSettings(env);
  if(localTest&&!settings.namespace.endsWith('-qa-test'))throw new Error('Local Firestore fixtures require a separate namespace ending in -qa-test');
  const store=new FirestoreWalletStore(settings,{...options,guildIds});
  let highlights;
  try{
    highlights=firestoreHighlightsConfig(env,store);
    await store.initialize();
    if(!localTest)return {store,service:new WalletService(store),adminRoles,commandChannelIds,highlights};
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
