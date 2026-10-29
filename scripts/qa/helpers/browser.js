import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';

const require=createRequire(import.meta.url);
export const browserOptions=()=>{
  const channel=process.env.PLAYWRIGHT_BROWSER_CHANNEL;
  return {channel:channel==='bundled'?undefined:channel||(process.platform==='win32'?'msedge':undefined),headless:true,args:['--mute-audio']};
};

export async function launchBrowser(){
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
  const options=browserOptions(),browser=await chromium.launch(options);
  try{
    mkdirSync('test-results',{recursive:true});
    writeFileSync('test-results/browser-runtime.json',JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,channel:options.channel??'bundled-chromium',browser:browser.version(),projectPlaywright:require('playwright/package.json').version,moduleOverride:!!process.env.PLAYWRIGHT_MODULE_PATH},null,2)+'\n');
    return browser;
  }catch(error){await browser.close();throw error;}
}

export async function createQaServer(port,plugins,ignored=['**/test-results/**','**/data/**','**/backups/**']){
  const {createServer}=await import('vite');
  return createServer({configFile:false,envDir:false,plugins,server:{
    host:'127.0.0.1',port,strictPort:true,hmr:false,watch:{ignored},
  }});
}
