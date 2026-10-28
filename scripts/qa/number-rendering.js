import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {launchBrowser,createQaServer} from './helpers/browser.js';

const baseline=process.argv.includes('--baseline'),out='test-results/number-rendering',reference='tests/fixtures/number-rendering.json';
await mkdir(out,{recursive:true});
const server=await createQaServer(4198,[{name:'isolated-number-page',configureServer(server){server.middlewares.use((req,res,next)=>{
 if(req.url!=='/__numbers')return next();res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><div id="number"></div><div id="benchmark"></div></body></html>');
});}}],['**/test-results/**']);
let browser;
try{
 await server.listen();browser=await launchBrowser();const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4198'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:4198/__numbers');
 const report=await page.evaluate(async()=>{
  // Pixel readback must use the same software path on desktops and CI runners.
  const getContext=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(type,options){
   return getContext.call(this,type,type==='2d'?{...options,willReadFrequently:true}:options);
  };
  const {prepareNumberFont,setBitmapNumber}=await import('/src/ui/shared/bitmap-number.js');
  const el=document.querySelector('#number');setBitmapNumber(el,'123');const beforeFont=el.textContent;await prepareNumberFont();
  const metrics={widthResets:0,heightResets:0,clears:0};
  for(const property of ['width','height']){
   const descriptor=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,property);
   Object.defineProperty(HTMLCanvasElement.prototype,property,{...descriptor,set(value){metrics[property+'Resets']++;descriptor.set.call(this,value);}});
  }
  const clear=CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect=function(...args){metrics.clears++;return clear.apply(this,args);};
  const cases=[];
  for(const text of ['0','1','8','10','100','101','888','999','1,000','9,900','10,000','+0','+2,000','-500','−500','1,000,000,000,000','','?','100']){
   setBitmapNumber(el,text);const canvas=el.querySelector('canvas');
   let pixels=null;
   if(canvas){const rgba=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;const digest=await crypto.subtle.digest('SHA-256',rgba);pixels=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');}
   cases.push({text,accessible:el.textContent,width:canvas?.width??null,height:canvas?.height??null,cssWidth:canvas?.style.width??null,pixels});
  }
  const unchanged={...metrics};setBitmapNumber(el,'100');
  if(JSON.stringify(metrics)!==JSON.stringify(unchanged))throw new Error('unchanged number redraws');
  const before={...metrics},benchmark=document.querySelector('#benchmark');
  for(let value=10000;value<10300;value++)setBitmapNumber(benchmark,value.toLocaleString('en-US'));
  return {beforeFont,cases,benchmark:Object.fromEntries(Object.keys(metrics).map(key=>[key,metrics[key]-before[key]]))};
 });
 assert.equal(report.beforeFont,'123');assert.deepEqual(errors,[]);
 const pixels={beforeFont:report.beforeFont,cases:report.cases};
 await writeFile(`${out}/${baseline?'baseline':'after'}.json`,JSON.stringify(report,null,2)+'\n');
 if(baseline)await writeFile(reference,JSON.stringify(pixels,null,2)+'\n');
 else{
  assert.deepEqual(pixels,JSON.parse(await readFile(reference,'utf8')),'bitmap pixels, layout, accessibility and fallbacks must remain identical');
  assert.ok(report.benchmark.heightResets<=1);assert.ok(report.benchmark.widthResets<300);
 }
 console.log(JSON.stringify({cases:report.cases.length,baseline,benchmark:report.benchmark}));
}finally{await browser?.close();await server.close();}
