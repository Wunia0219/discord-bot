import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createActivityServer} from '../../server/http/app.js';
import {localTestWalletConfig} from '../../server/testing/local-test-wallet.js';
import {browserOptions} from './browser-options.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
mkdirSync('test-results/security-smoke',{recursive:true});
const dir=mkdtempSync('test-results/security-smoke/run-'),port=4193;
const wallet=localTestWalletConfig({APP_ENV:'test',HOST:'127.0.0.1',WALLET_ENABLED:'true',LOCAL_WALLET_TEST:'true',DATABASE_PATH:resolve(dir,'wallet.sqlite')});
const server=createActivityServer({wallet,localPort:port,distDir:resolve('dist'),fetchImpl:async()=>{throw new Error('External services are disabled');}});
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
let browser;const report={errors:[],checks:[],devices:[]};
try{
 browser=await chromium.launch(browserOptions());
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(()=>{window.__cspViolations=[];document.addEventListener('securitypolicyviolation',e=>__cspViolations.push({directive:e.effectiveDirective,blocked:e.blockedURI}));});
  const started=Date.now(),response=await page.goto(`http://127.0.0.1:${port}/?wallet=local&player=qa-a`);
  assert.match(response.headers()['content-security-policy'],/script-src 'self';/);
  await page.waitForFunction(()=>document.querySelector('#spin')?.disabled===false,{},{timeout:60000});
  const readyMs=Date.now()-started;
  const violations=await page.evaluate(()=>__cspViolations);assert.deepEqual(violations,[],'game loads under CSP');
  await page.evaluate(()=>{const s=document.createElement('script');s.textContent='window.__injected=true';document.body.append(s);});
  assert.equal(await page.evaluate(()=>window.__injected),undefined,'inline script is rejected');
  assert.ok((await page.evaluate(()=>__cspViolations)).some(v=>v.directive==='script-src-elem'));
  const before=await page.locator('#balance').textContent();
  const spinResponse=page.waitForResponse(r=>r.url().endsWith('/api/spin'));
  await page.locator('#spin').click();const spin=await spinResponse;
  assert.equal(spin.status(),200);assert.equal(spin.headers()['cache-control'],'no-store');
  const settled=await spin.json();assert.equal(settled.state.history.length,mobile?2:1);
  await page.waitForFunction(()=>document.querySelector('#spin')?.disabled===false&&document.querySelector('#spin').getAttribute('aria-label')!=='快速停止');
  await page.locator('#all-history').click();await page.waitForSelector('.play-record');
  assert.equal(await page.locator('.play-record').count(),mobile?2:1);
  await page.locator('#close-dialog').click();
  await page.screenshot({path:join(dir,mobile?'mobile.png':'desktop.png')});
  report.devices.push({device:mobile?'mobile':'desktop',readyMs,initialBalance:before,spinMs:Math.round(spin.request().timing().responseEnd),historyCount:settled.state.history.length});
  await context.close();
 }
 assert.deepEqual(report.errors,[]);
 report.checks.push('production build renders under CSP on desktop/mobile','inline script blocked','real SQLite settlement and history','private API no-store','game still works after rejected injection');
 writeFileSync(join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory:dir,...report},null,2));
}finally{await browser?.close();await new Promise(done=>{server.close(done);server.closeAllConnections();});await server.drainCommands();await wallet.store.close();}
