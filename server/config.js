import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { WalletStore } from './wallet/wallet.js';
import { WalletService } from './wallet/wallet-service.js';
import { highlightsConfig } from './discord/highlights.js';
import { localTestWalletConfig } from './testing/local-test-wallet.js';
import { assertDatabaseEnvironment } from './sqlite/database.js';
import { assertDiscordConfiguration } from './discord/discord-config.js';
import {walletSettings} from './wallet/settings.js';
import {commandChannels} from './discord/discord-channel-scope.js';

export function walletConfig(env=process.env){
  if(env.WALLET_ENABLED==='true'&&env.WALLET_BACKEND==='firestore')return import('./firestore/config.js').then(({firestoreWalletConfig})=>firestoreWalletConfig(env));
  if(env.WALLET_BACKEND&&!['sqlite','firestore'].includes(env.WALLET_BACKEND))throw new Error('Invalid WALLET_BACKEND');
  if(env.LOCAL_WALLET_TEST==='true')return localTestWalletConfig(env);
  if(env.WALLET_ENABLED!=='true')return null;
  const environment=env.APP_ENV;
  // Validate before creating directories, opening a DB or applying migrations.
  assertDatabaseEnvironment(environment);
  assertDiscordConfiguration(env);
  const commandChannelIds=commandChannels(env);
  const {adminRoles,...options}=walletSettings(env);
  const filename=resolve(env.DATABASE_PATH || `data/${environment}.sqlite`);
  mkdirSync(dirname(filename),{recursive:true});
  const store=new WalletStore({filename,environment,...options});
  try { return {store,service:new WalletService(store),adminRoles,commandChannelIds,highlights:highlightsConfig(env,store)}; }
  catch(error) { store.close();throw error; }
}
