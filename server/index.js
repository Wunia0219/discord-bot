import { fileURLToPath } from 'node:url';
import { createActivityServer } from './http/app.js';
import { walletConfig } from './config.js';
import { discordConfigurationReady } from './discord/discord-config.js';
import {operationsSettings} from './operations/operations-settings.js';
import {Operations} from './operations/operations.js';

const port = Number(process.env.PORT || 4188);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const discord = {clientId:process.env.DISCORD_CLIENT_ID,clientSecret:process.env.DISCORD_CLIENT_SECRET,publicKey:process.env.DISCORD_PUBLIC_KEY};
const configured = discordConfigurationReady(discord);
const maintenance=operationsSettings();
const wallet=await walletConfig();
const operations=wallet&&maintenance?new Operations(maintenance):null;
const server = createActivityServer({
  ...discord,
  localPort:port,
  wallet,
  operations,
  distDir:fileURLToPath(new URL('../dist/', import.meta.url)),
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, process.env.HOST || '127.0.0.1', () => {
  wallet?.highlights?.start();
  operations?.start();
  console.log(wallet?.localTest?`Local wallet game: http://127.0.0.1:${port}/?wallet=local`:`Activity server: http://127.0.0.1:${port} (OAuth ${configured ? 'configured' : 'not configured'})`);
});
let shuttingDown=false;
const shutdown=()=>{
  if(shuttingDown)return;shuttingDown=true;
  const maintenanceClosed=operations?.close();
  server.close(async()=>{await Promise.all([wallet?.highlights?.close(),maintenanceClosed,server.drainCommands()]);await wallet?.store.close();process.exit(0);});
  server.closeIdleConnections();
  // Let the bounded maintenance worker finish before closing its source database.
  setTimeout(()=>process.exit(1),130000).unref();
};
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
