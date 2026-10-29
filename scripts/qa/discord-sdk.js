import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchBrowser,createQaServer} from './helpers/browser.js';
import {checkDiscordSdk} from '../security/patch-discord-sdk.js';

checkDiscordSdk();
const out='test-results/discord-sdk',origin='http://127.0.0.1:4195';
await mkdir(out,{recursive:true});
const server=await createQaServer(4195,[{name:'isolated-discord-host',configureServer(server){
  server.middlewares.use((req,res,next)=>{
    if(!req.url.startsWith('/__sdk-'))return next();
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');
  });
}}]);
let browser;const report={devices:[],errors:[]};
try{
  await server.listen();browser=await launchBrowser();
  for(const platform of ['desktop','mobile']){
    const context=await browser.newContext({isMobile:platform==='mobile',hasTouch:platform==='mobile'});
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.goto(origin+'/__sdk-host');
    await page.evaluate(platform=>{
      window.__commands=[];
      window.addEventListener('message',event=>{
        if(event.source!==document.querySelector('iframe')?.contentWindow||!Array.isArray(event.data))return;
        const [opcode,payload]=event.data;if(opcode===2)return;
        __commands.push(opcode===0?'HANDSHAKE':payload.cmd);
        const reply=frame=>event.source.postMessage([1,frame],location.origin);
        if(opcode===0)return reply({cmd:'DISPATCH',evt:'READY',nonce:null,data:{v:1,config:{api_endpoint:'//discord.com/api',environment:'test'}}});
        let data=null;
        if(payload.cmd==='AUTHORIZE')data={code:'isolated-code'};
        if(payload.cmd==='AUTHENTICATE')data={access_token:'isolated-token',user:{id:'323456789012345678',username:'tester',discriminator:'0',public_flags:0,global_name:'玩家',avatar:null},scopes:['identify','guilds.members.read'],expires:'2099-01-01T00:00:00Z',application:{id:'123456789012345678',name:'test',description:''}};
        reply({cmd:payload.cmd,evt:null,nonce:payload.nonce,data});
      });
      const frame=document.createElement('iframe');frame.src=`/__sdk-client?frame_id=test-frame&instance_id=test-instance&platform=${platform}&guild_id=223456789012345678`;document.body.append(frame);
    },platform);
    const frame=await (await page.waitForSelector('iframe')).contentFrame();await frame.waitForLoadState();
    const result=await frame.evaluate(async()=>{
      const {connectActivity}=await import('/src/platform/discord-activity.js');
      const result=await connectActivity({clientId:'123456789012345678',authEnabled:true,walletEnabled:true,fetchImpl:async(url,options)=>{
        const body=JSON.parse(options.body);
        if(url!=='/api/token'||body.code!=='isolated-code'||body.guildId!=='223456789012345678')throw new Error('OAuth request changed');
        return Response.json({access_token:'isolated-token',session:{token:'isolated-session',guildId:body.guildId,userId:'323456789012345678'}});
      }});
      const {Responses}=await import('/node_modules/@discord/embedded-app-sdk/output/index.mjs');
      const schema=Responses.GetGuildsResponse.shape.guilds.max(2),element=schema.element,parse=element._parse;let visits=0;
      element._parse=function(...args){visits++;return parse.apply(this,args);};
      let oversized;try{oversized=schema.safeParse(new Array(10000).fill(null));}finally{element._parse=parse;}
      const summary={mode:result.mode,ready:result.sdk.isReady,userId:result.user.id,sessionUserId:result.session.userId,tokenExposed:result.access_token!==undefined,visits,issues:oversized.error?.issues.length,code:oversized.error?.issues[0]?.code};
      result.sdk.close(1000,'test complete');return summary;
    });
    assert.deepEqual(result,{mode:'discord',ready:true,userId:'323456789012345678',sessionUserId:'323456789012345678',tokenExposed:false,visits:0,issues:1,code:'too_big'});
    const commands=await page.evaluate(()=>__commands);
    assert.deepEqual(commands,['HANDSHAKE','SET_ORIENTATION_LOCK_STATE','AUTHORIZE','AUTHENTICATE']);
    report.devices.push({platform,...result,commands});await context.close();
  }
  assert.deepEqual(report.errors,[]);
  await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();await server.close();}
