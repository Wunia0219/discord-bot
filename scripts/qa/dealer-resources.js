import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const baseline=process.argv.includes('--baseline'),out='test-results/dealer-resources';
await mkdir(out,{recursive:true});
const observe={name:'isolated-dealer-resources',enforce:'pre',transform(source,id){
 const path=id.replaceAll('\\','/');
 if(path.endsWith('/src/ui/reels/scene.js'))return source.replace('await this.app.init(','globalThis.__qaScene=this; await this.app.init(');
 if(path.endsWith('/src/ui/dealer/dealer.js'))return source.replace('await this.uploadTextures(','globalThis.__qaResources.uploads++; await this.uploadTextures(')+`
globalThis.__qaDealer=Dealer;globalThis.__qaAssets=Assets;
const originalLoad=Assets.load.bind(Assets),originalUnload=Assets.unload.bind(Assets);
Assets.load=(url,...args)=>{if(typeof url==='string'&&/\\/win-\\d+\\.webp/.test(url))globalThis.__qaResources.winLoads++;return originalLoad(url,...args);};
Assets.unload=(url,...args)=>{if(typeof url==='string'&&/\\/win-\\d+\\.webp/.test(url))globalThis.__qaResources.winUnloads++;return originalUnload(url,...args);};`;
}};
const vite=await createServer({configFile:false,envDir:false,plugins:[observe],server:{host:'127.0.0.1',port:4196,strictPort:true,hmr:false,watch:{ignored:['**/test-results/**','**/data/**','**/backups/**']}}});
let browser;const report={baseline,checks:[],views:[],errors:[]};
async function open(mobile=false){
 const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
 const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
 await page.addInitScript(()=>{globalThis.__qaResources={winLoads:0,winUnloads:0,uploads:0};});
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4196'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:4196/');
 await page.waitForFunction(()=>document.querySelector('#spin')?.disabled===false,{},{timeout:45000});
 return {page,context};
}
try{
 await vite.listen();browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});
 for(const mobile of [false,true]){
  const {page,context}=await open(mobile);
  const name=mobile?'mobile':'desktop';
  // Capture the untouched stage before rendering individual sprites offscreen.
  await page.screenshot({path:`${out}/${baseline?'baseline':'after'}-${name}.png`});
  const view=await page.evaluate(async()=>{
   const scene=__qaScene,d=scene.dealer;scene.app.stop();await d.prepare('win');
   const pixels={},layout={position:[d.sprite.x,d.sprite.y],scale:[d.sprite.scale.x,d.sprite.scale.y],anchor:[d.sprite.anchor.x,d.sprite.anchor.y]};
   const drain=async()=>{await new Promise(resolve=>setTimeout(resolve,0));await Promise.all([...d.releasing.values()]);};
   const bytes=()=>[...d.cache.values()].reduce((sum,clip)=>sum+clip.pages.reduce((n,p)=>n+p.meta.size.w*p.meta.size.h*4,0),0);
   const peakRgbaBytes=bytes();
   for(const name of ['idle','win']){
    await d.play(name);d.sprite.stop();const clip=d.cache.get(name);pixels[name]=[];
    for(let i=0;i<clip.frames;i++){
     d.sprite.gotoAndStop(i);
     const {pixels:rgba,width,height}=scene.app.renderer.extract.pixels({target:d.sprite,resolution:1});
     const digest=await crypto.subtle.digest('SHA-256',rgba);
     pixels[name].push({width,height,sha256:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join(''),time:clip.textures[i].time});
    }
   }
   await d.play('idle');await drain();
   const before={...__qaResources},cycles=[];
   for(let i=0;i<3;i++){
    const started=performance.now();await d.play('win');const preparedMs=performance.now()-started;
    let ticks=0;
    while(d.sprite.playing&&ticks<230){d.update({deltaTime:1,deltaMS:1000/60},false);ticks++;}
    await drain();
    if(d.action!=='idle'||ticks<216||ticks>217)throw new Error('authored win duration/return changed');
    cycles.push({preparedMs:Math.round(preparedMs),ticks});
   }
   const changes=Object.fromEntries(Object.keys(before).map(key=>[key,__qaResources[key]-before[key]]));
   scene.app.render();
   return {pixels,layout,peakRgbaBytes,retainedRgbaBytes:bytes(),cycles,changes};
  });
  report.views.push({name,...view});
  if(!baseline&&!mobile){
   const cacheChecks=await page.evaluate(async()=>{
    const scene=__qaScene,d=scene.dealer,checks=[];
    const until=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('resource lifecycle did not settle');};
    if(d.cacheGraceMs!==30000)throw new Error('unexpected retention budget');
    d.cacheGraceMs=60;
    await d.play('win');await new Promise(resolve=>setTimeout(resolve,100));
    if(!d.cache.has('win'))throw new Error('an active gesture was released');
    await d.play('idle');scene.beginSpin();
    await new Promise(resolve=>setTimeout(resolve,150));
    if(!d.cache.has('win'))throw new Error('resources released during reel motion');
    scene.cancelSpin(scene.currentStops);
    await until(()=>!d.cache.has('win')&&!d.releasing.size);
    checks.push('expiry waits until reels are idle and never unloads an active gesture');
    const before={...__qaResources};
    await Promise.all([d.prepare('win'),d.prepare('win'),d.play('win')]);
    if(__qaResources.winLoads-before.winLoads!==27||__qaResources.uploads-before.uploads!==1)throw new Error('concurrent preparation duplicated work');
    checks.push('simultaneous prepare/play loads each of 27 pages once and uploads once');
    await d.play('idle');d.setVisible(false);
    await until(()=>!d.cache.has('win')&&!d.releasing.size);
    if(!d.cache.has('idle')||d.sprite.visible)throw new Error('background cleanup lost idle or stayed visible');
    const hiddenLoads=__qaResources.winLoads;d.preload('win');
    await new Promise(resolve=>setTimeout(resolve,20));
    if(__qaResources.winLoads!==hiddenLoads)throw new Error('hidden preload started unnecessary work');
    d.setVisible(true);await until(()=>d.sprite.visible);
    if(d.sprite.textures.length!==96)throw new Error('foreground did not restore the complete idle');
    checks.push('background frees optional motion while preserving all 96 idle frames');
    // Unique URLs isolate fault injection from the real scene's atlas ownership.
    const base=d.resolvePage(d.motionManifest.clips.idle.pages[0]);
    const frame={frame:{x:0,y:0,w:1,h:1},sourceSize:{w:1,h:1},spriteSourceSize:{x:0,y:0,w:1,h:1},durationMs:100};
    const manifest=tag=>({fps:30,anchor:[0,0],frameSize:[1,1],clips:{trial:{loop:false,pages:[0,1].map(i=>({file:base+'?qa-resource='+tag+'-'+i,frames:{['frame-'+i]:frame},meta:{size:{w:1152,h:1664},scale:'1'}}))}}});
    const assets=__qaAssets,load=assets.load;
    const m=manifest('failed'),urls=m.clips.trial.pages.map(p=>p.file);
    let releaseSlow;
    const gate=new Promise(resolve=>releaseSlow=resolve);
    assets.load=async(url,...args)=>{if(url===urls[0])throw new Error('isolated load failure');if(url===urls[1])await gate;return load(url,...args);};
    const failed=new __qaDealer({motionManifest:m,resolvePage:p=>p.file});
    let rejected=false;
    const task=failed.prepare('trial').then(()=>{throw new Error('fault accepted');},()=>{rejected=true;});
    await new Promise(resolve=>setTimeout(resolve,30));
    if(rejected)throw new Error('failed preparation abandoned an in-flight page');
    releaseSlow();await task;assets.load=load;
    if(urls.some(url=>assets.cache.has(url))||failed.cache.size||failed.pending.size)throw new Error('partial load leaked assets');
    await failed.prepare('trial');await failed.destroy();
    if(urls.some(url=>assets.cache.has(url)))throw new Error('retry/destroy leaked assets');
    checks.push('one failed page waits for delayed peers, cleans successful pages, and supports retry');
    const uploadManifest=manifest('upload-failed'),uploadUrls=uploadManifest.clips.trial.pages.map(p=>p.file);
    const uploadFailed=new __qaDealer({motionManifest:uploadManifest,resolvePage:p=>p.file,uploadTextures:async()=>{throw new Error('isolated upload failure');}});
    await uploadFailed.prepare('trial').then(()=>{throw new Error('upload fault accepted');},()=>{});
    if(uploadUrls.some(url=>assets.cache.has(url)))throw new Error('upload failure leaked assets');
    await uploadFailed.destroy();
    checks.push('GPU preparation failure cleans every loaded page');
    const retiringManifest=manifest('retiring'),retiringUrls=retiringManifest.clips.trial.pages.map(p=>p.file);
    let finishUpload;
    const retiring=new __qaDealer({motionManifest:retiringManifest,resolvePage:p=>p.file,uploadTextures:()=>new Promise(resolve=>finishUpload=resolve)});
    const retiringTask=retiring.prepare('trial');
    const retirement=retiringTask.then(()=>{throw new Error('disposed preparation accepted');},()=>{});
    await until(()=>!!finishUpload);
    const destroyed=retiring.destroy();finishUpload();await Promise.all([retirement,destroyed]);
    if(retiringUrls.some(url=>assets.cache.has(url))||retiring.cache.size||retiring.pending.size)throw new Error('in-flight destroy leaked assets');
    checks.push('destroy during GPU preparation cleans late arrivals without resurrecting clips');
    await d.play('win');await d.play('idle');
    await d.destroy();
    if(d.releaseTimers.size||d.cache.size||d.pending.size||d.releasing.size)throw new Error('destroy retained resources or timers');
    checks.push('destroy clears retained clips and expiry timers');
    return checks;
   });
   report.checks.push(...cacheChecks);
  }
  await context.close();
 }
 if(!baseline){
  const before=await readFile(out+'/baseline.json','utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  report.referenceComparison=!!before;
  for(const view of report.views){
   assert.equal(view.pixels.idle.length,96);assert.equal(view.pixels.win.length,108);
   assert.ok(Math.abs(view.pixels.idle.reduce((sum,f)=>sum+f.time,0)-3200)<1e-6);
   assert.ok(Math.abs(view.pixels.win.reduce((sum,f)=>sum+f.time,0)-3600)<1e-6);
   if(before){
    const original=before.views.find(item=>item.name===view.name);
    assert.deepEqual(view.pixels,original.pixels,view.name+' all 204 rendered frames must match');
    assert.deepEqual(view.layout,original.layout,view.name+' anchor, placement and scale must match');
    assert.equal(view.peakRgbaBytes,original.peakRgbaBytes,'peak atlas footprint must not increase');
    assert.deepEqual(view.cycles.map(c=>c.ticks),original.cycles.map(c=>c.ticks));
   }
   assert.equal(view.changes.winLoads,0);assert.equal(view.changes.uploads,0);assert.equal(view.changes.winUnloads,0);
  }
  report.checks.push('three consecutive wins reuse existing uploads; complete authored frame counts/durations are preserved');
  if(before)report.checks.push('all 204 rendered frames/timings match before/after in desktop and mobile without increasing the atlas peak');
 }
 assert.deepEqual(report.errors,[]);
 await writeFile(`${out}/${baseline?'baseline':'after'}.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({...report,views:report.views.map(({pixels,...view})=>({...view,frames:Object.fromEntries(Object.entries(pixels).map(([name,frames])=>[name,frames.length]))}))},null,2));
}catch(error){await writeFile(`${out}/failure.json`,JSON.stringify({...report,failure:error.stack},null,2));throw error;}
finally{await browser?.close();await vite.close();}
