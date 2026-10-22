import { fileURLToPath } from 'node:url';
import { createActivityServer } from './app.js';
import { walletConfig } from './config.js';
import { discordConfigurationReady } from './discord-config.js';

const port = Number(process.env.PORT || 4188);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const discord = {clientId:process.env.DISCORD_CLIENT_ID,clientSecret:process.env.DISCORD_CLIENT_SECRET,publicKey:process.env.DISCORD_PUBLIC_KEY};
const configured = discordConfigurationReady(discord);
const wallet=walletConfig();
const server = createActivityServer({
  ...discord,
  localPort:port,
  wallet,
  distDir:fileURLToPath(new URL('../dist/', import.meta.url)),
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, process.env.HOST || '127.0.0.1', () => {
  wallet?.highlights?.start();
  console.log(wallet?.localTest?`Local wallet game: http://127.0.0.1:${port}/?wallet=local`:`Activity server: http://127.0.0.1:${port} (OAuth ${configured ? 'configured' : 'not configured'})`);
});
const shutdown=()=>{server.close(async()=>{await wallet?.highlights?.close();wallet?.store.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();};
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
