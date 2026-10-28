import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {freshState,createRound,INITIAL_STOPS} from '../../src/game/index.js';
import {browserOptions} from './browser-options.js';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const out='test-results/reel-experience';await mkdir(out,{recursive:true});
const stops=JSON.parse(await readFile('docs/data/math-report.json','utf8')).examples.none.stops;
const observe={name:'local-reel-observation',enforce:'pre',transform(source,id){
  const path=id.replaceAll('\\','/');
  if(path.endsWith('/src/ui/reels/scene.js'))return source
    .replace('await this.app.init(', 'globalThis.__qaScene=this; await this.app.init(')
    .replace('beginSpin() {',"beginSpin() { globalThis.__qaTimeline?.push({kind:'visual-start',at:performance.now()});")
    .replace('spin(stops, onStop) {',"spin(stops, onStop) { globalThis.__qaTimeline?.push({kind:'result-ready',at:performance.now()});")
    .replace('requestQuickStop() {',"requestQuickStop() { globalThis.__qaTimeline?.push({kind:'quick-request',at:performance.now()});")
    .replace('const landingElapsed = a.time - r.stopAt;',"const landingElapsed = a.time - r.stopAt;if(i===0&&!a.__qaBraking&&landingElapsed>=-160){a.__qaBraking=true;globalThis.__qaTimeline?.push({kind:'braking-start',at:performance.now()});}")
    .replaceAll('a.resolve();',"globalThis.__qaTimeline?.push({kind:'reels-settled',at:performance.now()});a.resolve();");
  if(path.endsWith('/src/ui/audio/audio.js'))return source
    .replace('this.music=musicUrl?', 'globalThis.__qaSound=this; this.music=musicUrl?')
    .replace("stop(index){this.play('stop',index);}","stop(index){globalThis.__qaTimeline?.push({kind:'stop',index,at:performance.now(),clock:globalThis.__qaScene?.active?.time});this.play('stop',index);}");
}};
const vite=await createServer({configFile:false,envDir:false,plugins:[observe],server:{host:'127.0.0.1',port:4194,strictPort:true,hmr:false,watch:{ignored:['**/test-results/**','**/data/**','**/backups/**']}}});
let browser;
const report={checks:[],timings:[],errors:[],clientTelemetry:[]};
try{
  await vite.listen();browser=await chromium.launch(browserOptions());
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
  await page.addInitScript(()=>{
    window.__qaTimeline=[];const nativeFetch=window.fetch;
    window.fetch=function(input,...args){if(String(input).startsWith('/api/spin'))window.__qaTimeline.push({kind:'request-start',at:performance.now()});return nativeFetch.call(this,input,...args);};
  });
  page.on('pageerror',error=>report.errors.push(error.message));
  let state={...freshState(),revision:0,historyRevision:0},delayMs=0,requests=0,releaseHistory=null,gap=false,historyLoaded=true;
  await page.route('**/api/local-session',route=>route.fulfill({json:{mode:'local',user:{id:'100000000000000004',username:'QA 玩家'},session:{environment:'test',token:'isolated-memory-only',guildId:'100000000000000002',userId:'100000000000000004'}}}));
  await page.route('**/api/wallet',route=>route.fulfill({json:{state}}));
  await page.route('**/api/rounds?*',async route=>{
    if(gap){await new Promise(resolve=>{releaseHistory=resolve;});historyLoaded=true;}
    await route.fulfill({json:{rows:state.history.map((round,i)=>({sequence:state.historyRevision-i,round}))}});
  });
  await page.route('**/api/spin',async route=>{
    requests++;assert.equal(route.request().headers()['x-spin-timing'],undefined);const body=route.request().postDataJSON();
    if(gap)for(let i=0;i<2;i++){const extra=createRound(state,body.bet,stops,'remote-'+i);state={...extra.state,revision:state.revision+1,historyRevision:state.historyRevision+1};}
    const update=createRound(state,body.bet,stops,body.requestId);
    state={...update.state,revision:state.revision+1,historyRevision:state.historyRevision+1};
    await new Promise(resolve=>setTimeout(resolve,delayMs));
    if(gap){const {history,...compact}=state;await route.fulfill({json:{round:update.round,state:compact,historyBase:state.historyRevision-1,historyRevision:state.historyRevision}});}
    else await route.fulfill({json:{...update,state}});
  });
  await page.goto('http://127.0.0.1:4194/?wallet=local&platform=desktop');
  await page.waitForFunction(()=>document.querySelector('#spin')?.disabled===false);
  await page.click('#sound');await page.waitForFunction(()=>__qaSound.enabled);
  for(const [name,delay,quickAt] of [['normal',0,null],['early-quick',0,100],['queued-quick',1500,80],['late-quick',0,1300]]){
    delayMs=delay;await page.evaluate(()=>{__qaTimeline=[];});
    await page.click('#spin');
    if(quickAt!==null){await page.waitForTimeout(quickAt);await page.click('#spin');}
    assert.equal(await page.locator('#player-toast').isVisible(),false,'quick stop must not open any text UI');
    assert.equal(await page.locator('#dialog').evaluate(dialog=>dialog.open),false);
    await page.waitForFunction(()=>__qaTimeline.filter(event=>event.kind==='stop').length===5);
    await page.waitForFunction(()=>!__qaScene.active&&!document.querySelector('#spin').disabled);
    const events=await page.evaluate(()=>__qaTimeline),request=events.find(e=>e.kind==='request-start'),visual=events.find(e=>e.kind==='visual-start'),sounds=events.filter(e=>e.kind==='stop');
    assert.ok(request.at<=visual.at,'settlement fetch starts before reel setup');
    assert.deepEqual(sounds.map(e=>e.index),[0,1,2,3,4]);
    const gaps=sounds.slice(1).map((event,i)=>event.clock-sounds[i].clock);
    assert.ok(gaps.every(gap=>Math.abs(gap-60)<35),'normal and quick sounds share the shorter 60ms cadence');
    const ready=events.find(e=>e.kind==='result-ready'),braking=events.find(e=>e.kind==='braking-start'),quick=events.find(e=>e.kind==='quick-request');
    const responseToBrakingMs=braking.at-Math.max(ready.at,quick?.at||0);
    const finished=events.find(e=>e.kind==='reels-settled');
    if(name==='early-quick'||name==='queued-quick')assert.ok(responseToBrakingMs<=200,'quick braking begins promptly once its result is ready');
    if(name==='normal')assert.ok(sounds[4].at-visual.at<1730,'normal spin no longer waits over two seconds for the last reel');
    assert.deepEqual(await page.evaluate(()=>__qaScene.currentStops),stops);
    report.timings.push({case:name,requestBeforeVisualMs:visual.at-request.at,responseToBrakingMs:Math.round(responseToBrakingMs),impactGapsMs:gaps.map(Math.round),lastImpactAfterVisualMs:Math.round(sounds[4].at-visual.at),allReelsSettledAfterVisualMs:Math.round(finished.at-visual.at),readyToFinalMs:Math.round(finished.at-Math.max(ready.at,quick?.at||0))});
  }
  assert.equal(requests,4);assert.equal(state.history.length,4);
  report.checks.push('no quick-stop text, immediate fetch, one settlement per round, quick braking starts within 200ms of readiness, shared 60ms cadence');

  const sceneChecks=await page.evaluate(async({target,initial})=>{
    const scene=__qaScene;scene.app.stop();const results=[];const cell=136,settle=160,bounce=190,speed=cell/60;
    const tick=ms=>scene.tick({elapsedMS:ms,deltaMS:ms});
    for(const reduced of [false,true])for(const mode of ['normal','queued','cruise','landing']){
      scene.reduced=reduced;scene.setStops(initial);scene.beginSpin();tick(217);
      if(mode==='queued')scene.requestQuickStop();
      const sounds=[],animation=scene.spin(target,i=>sounds.push({index:i,time:scene.active.time}));
      if(mode==='cruise'){
        tick(100);const before=scene.reels.map(r=>r.stopAt);scene.requestQuickStop();
        if(!reduced&&scene.reels[0].stopAt>=before[0])throw new Error('quick stop did not remove cruise');
      }
      if(mode==='landing'){
        tick(scene.reels[0].stopAt-(reduced?0:settle/2));const before=scene.reels.map(r=>r.stopAt);scene.requestQuickStop();
        if(JSON.stringify(before)!==JSON.stringify(scene.reels.map(r=>r.stopAt)))throw new Error('quick stop altered an ongoing landing');
      }
      const gap=reduced?60:60;
      if(scene.reels.some((r,i)=>i&&Math.abs(r.stopAt-scene.reels[i-1].stopAt-gap)>1e-7))throw new Error('planned cadence differs');
      let maxError=0,elapsed=0;
      while(scene.active&&elapsed<4000){
        tick(5);elapsed+=5;if(!scene.active)break;
        for(const r of scene.reels){
          const relative=scene.active.time-r.stopAt;
          if(reduced||relative < -settle||relative>bounce)continue;
          const expected=relative<0?-speed*settle/2*(relative/settle)**2:relative>=bounce?0:cell*.17*Math.sin(relative/bounce*Math.PI*2)*(1-relative/bounce)**2;
          maxError=Math.max(maxError,Math.abs(r.strip.y-expected));
        }
      }
      if(scene.active)throw new Error('reels did not complete');await animation;
      if(maxError>1e-7)throw new Error('terminal motion differs from original normal landing');
      if(sounds.map(event=>event.index).join(',')!=='0,1,2,3,4')throw new Error('impact callback order differs');
      if(JSON.stringify(scene.currentStops)!==JSON.stringify(target))throw new Error('authoritative result changed');
      results.push({mode,reduced,maxTerminalPositionError:maxError,impacts:sounds});
    }
    for(const quick of [false,true]){
      scene.reduced=false;scene.setStops(initial);scene.beginSpin();
      scene.tick({elapsedMS:300,deltaMS:100});
      if(scene.active.time!==300)throw new Error('pending reels lost actual wall time to the ticker cap');
      if(quick)scene.requestQuickStop();
      const sound=[],animation=scene.spin(target,i=>sound.push(i));
      const deadline=Math.max(...scene.reels.map(r=>r.stopAt))+bounce;let wall=0;
      while(scene.active&&wall<5000){wall+=200;scene.tick({elapsedMS:200,deltaMS:100});if(scene.active&&scene.active.time!==wall)throw new Error('reel clock follows capped rendering time');}
      await animation;
      if(wall>deadline+200)throw new Error('rendering hitches stretched reel completion');
      if(sound.join(',')!=='0,1,2,3,4')throw new Error('low-frame-rate stop cues changed order');
      if(JSON.stringify(scene.currentStops)!==JSON.stringify(target))throw new Error('slow-frame result changed');
      results.push({mode:quick?'slow-render-quick':'slow-render-normal',wallMs:wall,deadlineMs:deadline,renderStepMs:200,cappedDeltaMs:100});
    }
    scene.reduced=false;scene.setStops(initial);scene.app.start();return results;
  },{target:stops,initial:INITIAL_STOPS});
  report.sceneChecks=sceneChecks;report.checks.push('actual Pixi scene retains original terminal deceleration and bounce in normal/queued/cruise/late modes, including reduced motion');

  state={...freshState(),revision:0,historyRevision:0};gap=true;historyLoaded=false;delayMs=0;
  await page.reload();await page.waitForFunction(()=>document.querySelector('#spin')?.disabled===false);
  await page.click('#spin');await page.waitForTimeout(100);await page.click('#spin');
  await page.waitForFunction(()=>!__qaScene.active&&!document.querySelector('#spin').disabled);
  assert.equal(historyLoaded,false,'slow history must still be blocked while the new round has already finished');
  assert.equal(await page.locator('#dialog').evaluate(dialog=>dialog.open),false);
  assert.equal(await page.locator('#player-toast').isVisible(),false);
  await page.click('#all-history');await page.waitForSelector('.records-loading');
  releaseHistory();await page.waitForSelector('.play-record');
  assert.equal(await page.locator('.play-record').count(),3);
  report.checks.push('confirmed result and all reel feedback finish before older history returns; opening records waits and then displays the complete history');
  await page.click('#close-dialog');await page.screenshot({path:out+'/desktop.png'});
  const mobileContext=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true}),mobile=await mobileContext.newPage();
  mobile.on('pageerror',error=>report.errors.push(error.message));
  await mobile.addInitScript(()=>{window.__qaTimeline=[];});
  let mobileState={...freshState(),revision:0},mobileRequests=0;
  await mobile.route('**/api/local-session',route=>route.fulfill({json:{mode:'local',user:{id:'100000000000000004',username:'QA 玩家'},session:{environment:'test',token:'isolated-touch-only',guildId:'100000000000000002',userId:'100000000000000004'}}}));
  await mobile.route('**/api/wallet',route=>route.fulfill({json:{state:mobileState}}));
  await mobile.route('**/api/spin',async route=>{
    mobileRequests++;const body=route.request().postDataJSON(),update=createRound(mobileState,body.bet,stops,body.requestId);mobileState={...update.state,revision:mobileState.revision+1};
    await new Promise(resolve=>setTimeout(resolve,600));await route.fulfill({json:{...update,state:mobileState}});
  });
  await mobile.goto('http://127.0.0.1:4194/?wallet=local&platform=mobile');await mobile.waitForFunction(()=>document.querySelector('#spin')?.disabled===false);
  await mobile.locator('#spin').tap();await mobile.waitForTimeout(100);await mobile.locator('#spin').tap();
  assert.equal(await mobile.locator('#player-toast').isVisible(),false);
  await mobile.waitForFunction(()=>__qaTimeline.filter(e=>e.kind==='stop').length===5&&!__qaScene.active);
  const touchSounds=await mobile.evaluate(()=>__qaTimeline.filter(e=>e.kind==='stop'));
  assert.deepEqual(touchSounds.map(e=>e.index),[0,1,2,3,4]);assert.ok(touchSounds.slice(1).every((e,i)=>Math.abs(e.clock-touchSounds[i].clock-60)<35));
  assert.equal(mobileRequests,1);assert.equal(mobileState.history.length,1);
  await mobile.screenshot({path:out+'/mobile.png'});await mobileContext.close();
  report.checks.push('mobile touch queues one silent quick stop during network latency and retains the same ordered landing cadence');
  assert.deepEqual(report.errors,[]);
  await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){
 const pages=browser?browser.contexts().flatMap(context=>context.pages()):[];
 report.failure={message:error.message,pages:await Promise.all(pages.map(page=>page.evaluate(()=>({url:location.href,timeline:globalThis.__qaTimeline,active:!!globalThis.__qaScene?.active,spinDisabled:document.querySelector('#spin')?.disabled,text:document.body.innerText})).catch(()=>({unavailable:true}))))};
 await writeFile(out+'/failure.json',JSON.stringify(report,null,2));throw error;
}finally{await browser?.close();await vite.close();}
