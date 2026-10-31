import {build} from 'vite';
import {resolve} from 'node:path';
import {createActivityServer} from '../../server/http/app.js';
import {localTestWalletConfig} from '../../server/testing/local-test-wallet.js';

// Never load .env files or forward inherited credentials to the test backend.
const port=4192,distDir=resolve('test-results/validation-dist');
for(const key of Object.keys(process.env))if(key.startsWith('VITE_'))delete process.env[key];
await build({configFile:false,envDir:false,mode:'validation',build:{outDir:distDir},define:{
  'import.meta.env.VITE_DISCORD_AUTH_ENABLED':JSON.stringify('false'),
  'import.meta.env.VITE_DISCORD_WALLET_ENABLED':JSON.stringify('false'),
  'import.meta.env.VITE_DISCORD_CLIENT_ID':JSON.stringify(''),
}});
const wallet=localTestWalletConfig({APP_ENV:'test',HOST:'127.0.0.1',WALLET_ENABLED:'true',LOCAL_WALLET_TEST:'true',DATABASE_PATH:resolve('data/validation/wallet.sqlite')});
const server=createActivityServer({wallet,localPort:port,distDir,fetchImpl:async()=>{throw new Error('External services are disabled in validation');}});
server.on('error',async()=>{await wallet.store.close();console.error('Validation could not bind its dedicated port; existing services were not changed.');process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`Isolated validation: http://127.0.0.1:${port}/?wallet=local&player=qa-a\nOnly synthetic local data; no Discord, Firestore or Webhook credentials. Progress persists in data/validation/wallet.sqlite.`));
const close=()=>{server.close(async()=>{await server.drainCommands();await wallet.store.close();process.exit(0);});server.closeIdleConnections();};
process.on('SIGINT',close);process.on('SIGTERM',close);
