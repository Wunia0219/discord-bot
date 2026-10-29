import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createActivityServer} from '../../server/http/app.js';
import {localTestWalletConfig} from '../../server/testing/local-test-wallet.js';
import {launchBrowser} from './helpers/browser.js';
import {contentSecurityPolicy} from '../../server/http/security-headers.js';
import {APP_VERSION} from '../../src/version.js';
if(process.argv.slice(2).some(arg=>arg!=='--delayed-csp-report'))throw new Error('Use --delayed-csp-report or no arguments');
const staticHeaders=readFileSync('dist/_headers','utf8');
assert.ok(staticHeaders.includes(`Content-Security-Policy: ${contentSecurityPolicy}`),'static assets use the server CSP');
for(const name of readdirSync('dist/assets')){
 assert.ok(staticHeaders.includes(`/assets/${name}\n  Cache-Control: public, max-age=31536000, immutable`),`hashed asset cache policy: ${name}`);
}
mkdirSync('test-results/security-smoke',{recursive:true});
const dir=mkdtempSync('test-results/security-smoke/run-'),port=4193;
const cspReportDelay=process.argv.includes('--delayed-csp-report')?500:0;
const wallet=localTestWalletConfig({APP_ENV:'test',HOST:'127.0.0.1',WALLET_ENABLED:'true',LOCAL_WALLET_TEST:'true',DATABASE_PATH:resolve(dir,'wallet.sqlite')});
const server=createActivityServer({wallet,localPort:port,distDir:resolve('dist'),fetchImpl:async()=>{throw new Error('External services are disabled');}});
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
let browser;const report={cspReportDelay,errors:[],checks:[],devices:[]};
try{
 browser=await launchBrowser();
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:375,height:812}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.addInitScript(delay=>{
   window.__cspViolations=[];
   document.addEventListener('securitypolicyviolation',e=>{
    const violation={directive:e.effectiveDirective,blocked:e.blockedURI,disposition:e.disposition};
    if(delay)setTimeout(()=>__cspViolations.push(violation),delay);else __cspViolations.push(violation);
   });
  },cspReportDelay);
  const started=Date.now(),response=await page.goto(`http://127.0.0.1:${port}/?wallet=local&player=qa-a`);
  assert.match(response.headers()['content-security-policy'],/script-src 'self';/);
  await page.waitForFunction(()=>document.querySelector('#spin')?.disabled===false,{},{timeout:60000});
  const readyMs=Date.now()-started;
  await page.locator('#help').click();
  assert.equal(await page.locator('.rules-version span').last().textContent(),`v${APP_VERSION}`,'built UI matches the package release');
  await page.locator('#close-dialog').click();
  const violations=await page.evaluate(()=>__cspViolations);assert.deepEqual(violations,[],'game loads under CSP');
  await page.evaluate(()=>{const s=document.createElement('script');s.textContent='window.__injected=true';document.body.append(s);});
  // CSP blocks immediately, but its violation notification is queued as a separate task.
  await page.waitForFunction(()=>__cspViolations.some(v=>v.directive==='script-src-elem'&&v.blocked==='inline'&&v.disposition==='enforce'),null,{timeout:10000});
  const cspViolations=await page.evaluate(()=>__cspViolations);
  assert.ok(cspViolations.some(v=>v.directive==='script-src-elem'&&v.blocked==='inline'&&v.disposition==='enforce'),'an enforced inline-script violation must be recorded');
  assert.equal(await page.evaluate(()=>window.__injected),undefined,'inline script is rejected');
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
  report.devices.push({device:mobile?'mobile':'desktop',readyMs,cspViolations,initialBalance:before,spinMs:Math.round(spin.request().timing().responseEnd),historyCount:settled.state.history.length});
  await context.close();
 }
 assert.deepEqual(report.errors,[]);
 report.checks.push(`production UI version ${APP_VERSION}`,'production build renders under CSP on desktop/mobile','inline script blocked','real SQLite settlement and history','private API no-store','game still works after rejected injection');
 writeFileSync(join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory:dir,...report},null,2));
}catch(error){
 report.failure={message:error.message,pages:await Promise.all((browser?.contexts()??[]).flatMap(context=>context.pages()).map(page=>page.evaluate(()=>({url:location.href,violations:window.__cspViolations,injected:window.__injected===true})).catch(()=>({unavailable:true}))))};
 writeFileSync(join(dir,'failure.json'),JSON.stringify(report,null,2));console.error(JSON.stringify(report.failure,null,2));throw error;
}finally{await browser?.close();await new Promise(done=>{server.close(done);server.closeAllConnections();});await server.drainCommands();await wallet.store.close();}
