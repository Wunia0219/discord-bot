import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,mkdirSync,mkdtempSync,writeFileSync,copyFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DiscordSDK,Common} from '@discord/embedded-app-sdk';
import {connectActivity} from '../src/platform/discord-activity.js';
import {checkDiscordSdk,patchSource} from '../scripts/security/patch-discord-sdk.js';

const require=createRequire(import.meta.url);
const root=dirname(require.resolve('@discord/embedded-app-sdk/package.json'));
const bundled=ext=>join(root,'output/lib/zod/lib/index.'+ext);
const implementations={esm:await import(pathToFileURL(bundled('mjs')).href),cjs:require(bundled('cjs'))};

test('locked SDK patch is installed, repeatable, and legacy declarations match the bundled API',()=>{
  assert.deepEqual(checkDiscordSdk(),{sdk:'2.5.0',zod:'4.6.7',patchedRuntimeFiles:2});
  const before=Object.values({esm:bundled('mjs'),cjs:bundled('cjs')}).map(path=>readFileSync(path,'utf8'));
  checkDiscordSdk({apply:true});
  assert.deepEqual([bundled('mjs'),bundled('cjs')].map(path=>readFileSync(path,'utf8')),before);
  assert.throws(()=>patchSource('unknown implementation'),/Unexpected/);
  const output=join(root,'output');let declarations=0;
  for(const file of readdirSync(output,{recursive:true})){
    if(!/\.(?:d\.ts|mjs|cjs)$/.test(file))continue;
    const source=readFileSync(join(output,file),'utf8');
    if(file.endsWith('.d.ts')){
      assert.doesNotMatch(source,/['"]zod['"]/);
      if(source.includes('zod/v3'))declarations++;
    }else{
      assert.doesNotMatch(source,/(?:from\s*|require\()['"]zod(?:\/v3)?['"]/,'SDK runtime must use its patched bundled validator');
    }
  }
  assert.ok(declarations>0);
});

test('missing patches, changed code and unknown versions block verification before any write',()=>{
  const base=resolve('test-results/discord-sdk-security');mkdirSync(base,{recursive:true});
  const fixture=mkdtempSync(join(base,'guard-')),sdkFile=join(fixture,'package.json');
  mkdirSync(join(fixture,'node_modules/zod'),{recursive:true});
  writeFileSync(join(fixture,'node_modules/zod/package.json'),JSON.stringify({version:'4.6.7'}));
  writeFileSync(sdkFile,JSON.stringify({version:'2.5.0'}));
  mkdirSync(join(fixture,'output/lib/zod/lib'),{recursive:true});
  for(const ext of ['mjs','cjs'])copyFileSync(bundled(ext),join(fixture,'output/lib/zod/lib/index.'+ext));
  checkDiscordSdk({sdkFile});
  const target=join(fixture,'output/lib/zod/lib/index.mjs'),patched=readFileSync(target,'utf8');
  let original=patched.replace('if (tooBig) return INVALID;\n                status.dirty();','status.dirty();');
  for(const field of ['maxLength','maxSize'])original=original.replace(`message: def.${field}.message,\n                });\n                return INVALID;`,`message: def.${field}.message,\n                });\n                status.dirty();`);
  writeFileSync(target,original);
  assert.throws(()=>checkDiscordSdk({sdkFile}),/patch missing/);
  const other=join(fixture,'output/lib/zod/lib/index.cjs');
  writeFileSync(other,readFileSync(other,'utf8')+'\n// altered release');
  assert.throws(()=>checkDiscordSdk({sdkFile,apply:true}),/unexpected source/);
  assert.equal(readFileSync(target,'utf8'),original,'validate all hashes before applying a partial patch');
  writeFileSync(sdkFile,JSON.stringify({version:'9.0.0'}));
  assert.throws(()=>checkDiscordSdk({sdkFile,apply:true}),/versions changed/);
});

for(const [name,z] of Object.entries(implementations)){
  test(`${name}: oversized constrained collections reject before visiting any element, sync and async`,async()=>{
    let visited=0;
    const item=z.preprocess(value=>{visited++;return value;},z.string());
    for(const [schema,input] of [
      [z.array(item).max(2,'bounded'),new Array(100000).fill(1)],
      [z.array(item).length(2,'bounded'),new Array(100000).fill(1)],
      [z.set(item).max(2,'bounded'),new Set(Array.from({length:10000},(_,i)=>i))],
      [z.set(item).size(2,'bounded'),new Set([1,2,3])],
    ]){
      for(const result of [schema.safeParse(input),await schema.safeParseAsync(input)]){
        assert.equal(result.success,false);assert.equal(visited,0);
        assert.equal(result.error.issues.length,1);
        assert.equal(result.error.issues[0].code,'too_big');
        assert.equal(result.error.issues[0].message,'bounded');
      }
    }
  });

  test(`${name}: normal values, transformations, too-small errors and nested paths retain legacy behavior`,async()=>{
    const item=z.string().transform(value=>value.toUpperCase());
    assert.deepEqual(z.array(item).max(2).parse(['a','b']),['A','B']);
    assert.deepEqual(await z.array(item).length(2).parseAsync(['a','b']),['A','B']);
    assert.deepEqual([...z.set(item).size(2).parse(new Set(['a','b']))],['A','B']);
    const small=z.array(z.string()).length(2).safeParse([1]);
    assert.deepEqual(small.error.issues.map(i=>i.code),['too_small','invalid_type']);
    const nested=z.object({rows:z.array(item).max(1)}).safeParse({rows:['a','b']});
    assert.deepEqual(nested.error.issues[0].path,['rows']);
    assert.equal(z.array(item).max(2).safeParse('bad').error.issues[0].code,'invalid_type');
  });
}

test('the external Zod dependency uses the upstream fixed array/set/map size gates',async()=>{
  const {z}=await import('zod');let visited=0;
  const item=z.preprocess(value=>{visited++;return value;},z.string());
  for(const [schema,input] of [[z.array(item).max(1),[1,2]],[z.set(item).max(1),new Set([1,2])],[z.map(item,item).max(1),new Map([[1,1],[2,2]])]]){
    assert.equal(schema.safeParse(input).success,false);assert.equal(visited,0);
  }
});

const clientId='123456789012345678',guildId='223456789012345678',userId='323456789012345678';
function transport(platform,{deny=false,sessionUser=userId}={}){
  const calls=[];
  class SDK extends DiscordSDK{
    constructor(id,config){
      super(id,config);this.guildId=guildId;this.platform=platform;
      this.source={postMessage:([opcode,payload])=>{
        calls.push({opcode,...payload});
        if(opcode===0){
          queueMicrotask(()=>this.handleFrame({cmd:'DISPATCH',evt:'READY',nonce:null,data:{v:1,config:{api_endpoint:'//discord.com/api',environment:'test'}}}));return;
        }
        let data=null;
        if(payload.cmd==='AUTHORIZE')data={code:'isolated-code'};
        if(payload.cmd==='AUTHENTICATE')data={access_token:'isolated-token',user:{id:userId,username:'tester',discriminator:'0',public_flags:0,global_name:'玩家',avatar:null},scopes:['identify','guilds.members.read','future-scope'],expires:'2099-01-01T00:00:00Z',application:{id:clientId,name:'test',description:''}};
        const rejected=deny&&payload.cmd==='AUTHORIZE';
        queueMicrotask(()=>this.handleFrame({cmd:payload.cmd,nonce:payload.nonce,evt:rejected?'ERROR':null,data:rejected?{code:4006,message:'private-provider-detail'}:data}));
      }};
      this.addOnReadyListener();this.handshake();
    }
  }
  const options={location:{hostname:`${clientId}.discordsays.com`,search:`?frame_id=test-frame&instance_id=test-instance&platform=${platform}`},clientId,authEnabled:true,walletEnabled:true,loadSdk:async()=>({DiscordSDK:SDK,Common}),fetchImpl:async(url,options)=>{
    calls.push({exchange:true});assert.equal(url,'/api/token');
    assert.deepEqual(JSON.parse(options.body),{code:'isolated-code',guildId});
    return Response.json({access_token:'isolated-token',session:{token:'isolated-session',guildId,userId:sessionUser}});
  }};
  return {calls,options};
}

for(const platform of ['desktop','mobile'])test(`real SDK ${platform}: handshake, READY, orientation, OAuth and wallet identity remain compatible`,{timeout:5000},async()=>{
  const {calls,options}=transport(platform);
  const result=await connectActivity(options);
  assert.equal(result.mode,'discord');assert.equal(result.sdk.isReady,true);
  assert.deepEqual(result.user,{id:userId,username:'tester',global_name:'玩家',avatar:null});
  assert.equal(result.session.userId,userId);assert.equal(result.access_token,undefined);
  assert.deepEqual(calls.map(c=>c.opcode===0?'HANDSHAKE':c.exchange?'EXCHANGE':c.cmd),['HANDSHAKE','SET_ORIENTATION_LOCK_STATE','AUTHORIZE','EXCHANGE','AUTHENTICATE']);
  const orientation=platform==='mobile'?Common.OrientationLockStateTypeObject.PORTRAIT:Common.OrientationLockStateTypeObject.UNLOCKED;
  assert.deepEqual(calls[1].args,{lock_state:orientation,picture_in_picture_lock_state:orientation,grid_lock_state:orientation});
  assert.deepEqual(calls[2].args.scope,['identify','guilds.members.read']);
  assert.equal(result.sdk.pendingCommands.size,0);
});

test('real SDK errors and mismatched wallet identities still fail safely', {timeout:5000},async()=>{
  const denied=transport('desktop',{deny:true});
  await assert.rejects(connectActivity(denied.options),error=>/授權尚未完成/.test(error.message)&&!error.message.includes('private-provider'));
  assert.equal(denied.calls.some(call=>call.exchange),false);
  await assert.rejects(connectActivity(transport('desktop',{sessionUser:clientId}).options),/身分驗證失敗/);
});
