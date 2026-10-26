import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { WalletStore } from './wallet.js';
import { WalletService } from './wallet-service.js';
import { highlightsConfig } from './highlights.js';
import { localTestWalletConfig } from './local-test-wallet.js';
import { assertDatabaseEnvironment } from './database.js';
import { assertDiscordConfiguration } from './discord-config.js';

export function walletConfig(env=process.env){
  if(env.WALLET_ENABLED==='true'&&env.WALLET_BACKEND==='firestore')return import('./firestore-config.js').then(({firestoreWalletConfig})=>firestoreWalletConfig(env));
  if(env.WALLET_BACKEND&&!['sqlite','firestore'].includes(env.WALLET_BACKEND))throw new Error('Invalid WALLET_BACKEND');
  if(env.LOCAL_WALLET_TEST==='true')return localTestWalletConfig(env);
  if(env.WALLET_ENABLED!=='true')return null;
  const environment=env.APP_ENV;
  // Validate before creating directories, opening a DB or applying migrations.
  assertDatabaseEnvironment(environment);
  assertDiscordConfiguration(env);
  const guildIds=(env.ALLOWED_GUILD_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
  const filename=resolve(env.DATABASE_PATH || `data/${environment}.sqlite`);
  const adminRoles=(env.CHIP_ADMIN_ROLE_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(adminRoles.some(id=>!/^\d{17,20}$/.test(id)))throw new Error('Invalid CHIP_ADMIN_ROLE_IDS');
  mkdirSync(dirname(filename),{recursive:true});
  const store=new WalletStore({filename,environment,guildIds,weeklyRewards:env.WEEKLY_CHECKIN_REWARDS,grantMax:Number(env.ADMIN_GRANT_MAX||100000),grantDaily:Number(env.ADMIN_DAILY_MAX||1000000)});
  try { return {store,service:new WalletService(store),adminRoles,highlights:highlightsConfig(env,store)}; }
  catch(error) { store.close();throw error; }
}
