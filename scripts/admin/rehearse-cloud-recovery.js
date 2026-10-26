// Isolated recovery drill: no environment files, credentials or outbound services.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {randomBytes} from 'node:crypto';
import {decodeCloudArchive,restoreCloudSnapshot,snapshotForCloud} from '../../server/cloud-handoff.js';
import {WalletStore} from '../../server/wallet.js';
import {createActivityServer} from '../../server/app.js';
import {digest} from '../../cloud/snapshot.js';

const flags=new Map(),args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2){if(!['--archive','--key-file','--out','--environment'].includes(args[i])||!args[i+1]||flags.has(args[i]))throw new Error('Expected --archive --key-file --out --environment');flags.set(args[i],args[i+1]);}
const need=k=>{if(!flags.get(k))throw new Error('Missing '+k);return flags.get(k);};
const started=performance.now(),source=readFileSync(need('--archive')),sourceHash=digest(source),environment=need('--environment');
const envelope=JSON.parse(source),snapshot=decodeCloudArchive(envelope.archive||envelope,readFileSync(need('--key-file'),'utf8').trim(),environment);
const out=resolve(need('--out'));if(existsSync(out))throw new Error('Use a new drill directory; never overwrite');mkdirSync(out,{recursive:true});
const filename=join(out,'restored.sqlite');restoreCloudSnapshot(snapshot,filename,environment);
const compare=()=>assert.deepEqual(snapshotForCloud(filename,environment).tables,snapshot.tables);
compare();const restoreMs=performance.now()-started,token=randomBytes(32).toString('hex');let session;
const store=new WalletStore({filename,environment,guildIds:[...new Set(snapshot.tables.wallets.map(w=>w.guild))]});
const service={authorize:async header=>{assert.equal(header,'Bearer '+token);return session;}};
const server=createActivityServer({clientId:'100000000000000001',clientSecret:'isolated-recovery-no-discord',publicKey:'0'.repeat(64),wallet:{store,service,adminRoles:[]},fetchImpl:async()=>{throw new Error('Recovery drill forbids external services');}});
await new Promise((res,rej)=>{server.once('error',rej);server.listen(0,'127.0.0.1',res);});
let replayed=0,wallets=0;const origin='http://127.0.0.1:'+server.address().port;
const request=async(path,body)=>{const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200);return r.json();};
try{
 for(const w of snapshot.tables.wallets){session={guild:w.guild,user:w.user};assert.equal((await request('/api/wallet')).state.balance,w.balance);wallets++;}
 for(const op of snapshot.tables.operations){
  const expected=JSON.parse(op.result);let result;
  if(op.key.startsWith('spin:')){const [,user,id]=op.key.split(':');session={guild:op.guild,user};result=await request('/api/spin',{bet:Number(op.fingerprint),requestId:id});assert.deepEqual(result.round,expected.round);}
  else if(op.key.startsWith('daily:')){const [,user]=op.key.split(':');session={guild:op.guild,user};store.clock=()=>Date.parse(snapshot.tables.ledger.find(e=>e.id===expected.entry.id).time);result=await request('/api/checkin',{});assert.deepEqual(result.entry,expected.entry);}
  else if(op.key.startsWith('reset:')){result=store.resetWallets(op.guild,expected.reset.actor,expected.reset.requestId);assert.deepEqual(result.entries,expected.entries);assert.deepEqual(result.reset,expected.reset);}
  else continue;
  assert.equal(result.duplicate,true);replayed++;
 }
}finally{await new Promise(res=>{server.close(res);server.closeIdleConnections();});await server.drainCommands();store.close();}
compare();assert.equal(digest(readFileSync(need('--archive'))),sourceHash);
const report={ok:true,at:new Date().toISOString(),environment,sourceArchiveSha256:sourceHash,revision:snapshot.revision,counts:Object.fromEntries(Object.entries(snapshot.tables).map(([k,v])=>[k,v.length])),restoreMs:Math.round(restoreMs),totalDrillMs:Math.round(performance.now()-started),walletsVerified:wallets,originalRequestsReplayed:replayed,allSevenTablesUnchanged:true,sourceUnchanged:true,externalServicesAccessed:false,scope:'Local SQLite API recovery; not cloud redeployment, Discord OAuth or a production cutover'};
writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
