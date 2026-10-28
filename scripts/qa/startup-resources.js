import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {freshState} from '../../src/game/index.js';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const out='test-results/startup-resources';await mkdir(out,{recursive:true});
const observe={name:'isolated-startup-cleanup',enforce:'pre',transform(source,id){
 const path=id.replaceAll('\\','/');
 if(path.endsWith('/src/ui/reels/scene.js'))return source.replace('async init(host, onProgress = () => {}) {',"async init(host, onProgress = () => {}) { globalThis.__qaScene=this; if(globalThis.__qaOptions.failStage)throw new Error('isolated stage failure');");
 if(path.endsWith('/src/ui/wins/big-win.js'))return source.replace('async prepare() {',"async prepare() { if(globalThis.__qaOptions.failWin)throw new Error('isolated win preparation failure');");
}};
const vite=await createServer({configFile:false,envDir:false,plugins:[observe],server:{host:'127.0.0.1',port:4197,strictPort:true,hmr:false,watch:{ignored:['**/test-results/**','**/data/**','**/backups/**']}}});
let browser;const report={checks:[],errors:[]};
try{
 await vite.listen();browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 for(const options of [
  {name:'early-login-failure',failLogin:true},
  {name:'login-during-assets',failLogin:true,holdLogin:true,holdAssets:true},
  {name:'wallet-during-assets',failWallet:true,holdWallet:true,holdAssets:true},
  {name:'stage-asset-failure',failAsset:true},
  {name:'before-renderer-initialization',failStage:true},
  {name:'win-font-preparation-failure',failWin:true},
 ]){
  const context=await browser.newContext(),page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.addInitScript(options=>{globalThis.__qaOptions=options;},options);
  let releaseLogin,releaseWallet,releaseAssets,assetRequested=false,spins=0;
  const login=options.holdLogin?new Promise(resolve=>releaseLogin=resolve):Promise.resolve();
  const wallet=options.holdWallet?new Promise(resolve=>releaseWallet=resolve):Promise.resolve();
  const assets=options.holdAssets?new Promise(resolve=>releaseAssets=resolve):Promise.resolve();
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!=='http://127.0.0.1:4197')throw new Error('Unexpected external request');
   if(url.pathname==='/api/local-session'){
    await login;
    return route.fulfill({status:options.failLogin?503:200,json:options.failLogin?{error:'isolated login failure'}:{mode:'local',user:{id:'100000000000000004',username:'QA'},session:{environment:'test',token:'isolated-only',guildId:'100000000000000002',userId:'100000000000000004'}}});
   }
   if(url.pathname==='/api/wallet'){
    await wallet;return route.fulfill({status:options.failWallet?503:200,json:options.failWallet?{error:'isolated wallet failure'}:{state:freshState()}});
   }
   if(url.pathname==='/api/spin'){spins++;return route.fulfill({status:503,json:{error:'not permitted'}});}
   if(url.pathname==='/images/symbols.webp'&&!url.search){
    assetRequested=true;await assets;if(options.failAsset)return route.fulfill({status:503,body:'isolated asset failure'});
   }
   return route.continue();
  });
  await page.goto('http://127.0.0.1:4197/?wallet=local',{waitUntil:'domcontentloaded'});
  if(options.holdAssets){
   for(let i=0;i<200&&!assetRequested;i++)await new Promise(resolve=>setTimeout(resolve,20));
   assert.equal(assetRequested,true);releaseLogin?.();releaseWallet?.();
  }
  await page.waitForSelector('#loading.has-error');
  const message=await page.locator('#loading-status').textContent();
  const stopped=await page.evaluate(()=>!__qaScene.app.ticker?.started);
  assert.equal(stopped,true,'rendering must stop as soon as failure is reported');
  releaseAssets?.();
  const cleanup=await page.evaluate(async()=>{
   const scene=__qaScene;await scene.destroy();
   return {disposed:scene.disposed,rendererReleased:!scene.app.renderer,canvasCount:document.querySelector('#canvas-host').children.length,assets:scene.assetUrls.size,dealer:scene.dealer?{disposed:scene.dealer.disposed,clips:scene.dealer.cache.size,pending:scene.dealer.pending.size,releasing:scene.dealer.releasing.size,timers:scene.dealer.releaseTimers.size}:null};
  });
  assert.equal(cleanup.disposed,true);assert.equal(cleanup.rendererReleased,true);assert.equal(cleanup.canvasCount,0);assert.equal(cleanup.assets,0);
  if(cleanup.dealer)assert.deepEqual(cleanup.dealer,{disposed:true,clips:0,pending:0,releasing:0,timers:0});
  await page.keyboard.press('Space');await page.waitForTimeout(100);
  assert.equal(await page.locator('#spin').isDisabled(),true);assert.equal(await page.locator('#app').evaluate(el=>el.inert),true);
  assert.equal(await page.locator('#loading-retry').isVisible(),true);assert.equal(await page.locator('#loading-status').textContent(),message);assert.equal(spins,0);
  report.checks.push({name:options.name,cleanup});await context.close();
 }
 assert.deepEqual(report.errors,[]);
 await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(out+'/failure.json',JSON.stringify({...report,failure:error.stack},null,2));throw error;}
finally{await browser?.close();await vite.close();}
