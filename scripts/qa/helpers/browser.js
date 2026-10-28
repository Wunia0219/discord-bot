import {createRequire} from 'node:module';
import {createServer} from 'vite';

const require=createRequire(import.meta.url);
export const browserOptions=()=>({
  channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined),
  headless:true,args:['--mute-audio'],
});

export function launchBrowser(){
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
  return chromium.launch(browserOptions());
}

export function createQaServer(port,plugins,ignored=['**/test-results/**','**/data/**','**/backups/**']){
  return createServer({configFile:false,envDir:false,plugins,server:{
    host:'127.0.0.1',port,strictPort:true,hmr:false,watch:{ignored},
  }});
}
