// Explicit, resumable maintenance for a paused test namespace. Disabled without a matching operation ID.
import {TABLES,digest} from './snapshot.js';

const rootCollections=['wallets','ledger','operations','adminDays','reversals','highlightEvents','highlightBoards'];
const allowedPath=/^(?:wallets\/\d{17,20}_\d{17,20}(?:\/(?:rounds|days)\/[A-Za-z0-9-]+)?|ledger\/\d+|operations\/[a-f0-9]{64}|adminDays\/\d{17,20}_\d{17,20}_\d{4}-\d{2}-\d{2}|reversals\/\d+|highlightEvents\/[A-Za-z0-9_-]+|highlightBoards\/\d{17,20})$/;
const requireValue=(value,message)=>{if(!value)throw new Error(message);};
const unpack=doc=>doc.exists?JSON.parse(doc.get('json')):null;
const fields=value=>({json:JSON.stringify(value)});

export function validateTestReset(input,{settings,enabledId,manifest,mode}){
 requireValue(settings.environment==='test'&&settings.schemaVersion===2&&settings.namespace.endsWith('-test'),'Test namespace required');
 requireValue(/^[a-f0-9]{32}$/.test(enabledId||'')&&input.id===enabledId,'Explicit reset enablement required');
 requireValue(mode==='paused','Paused writer required');
 requireValue(input.confirm==='DELETE ALL TEST PLAYERS'&&input.projectId===settings.projectId&&input.namespace===settings.namespace,'Exact source confirmation required');
 requireValue(input.generation===manifest.generation&&input.sha256===manifest.sha256&&input.revision===manifest.revision,'Downloaded latest backup required');
 requireValue(manifest.format===2,'Current archive required');
 requireValue(Array.isArray(input.paths)&&input.paths.length>0&&input.paths.length<=12000&&new Set(input.paths).size===input.paths.length&&input.paths.every(p=>typeof p==='string'&&allowedPath.test(p)),'Invalid bounded deletion plan');
 const counts=Object.fromEntries(TABLES.map(t=>[t,manifest.segments.filter(s=>s.table===t).reduce((n,s)=>n+s.rows,0)]));
 for(const [table,pattern] of [['wallets',/^wallets\/[^/]+$/],['ledger',/^ledger\//],['operations',/^operations\//],['rounds',/^wallets\/[^/]+\/rounds\//],['highlight_events',/^highlightEvents\//],['highlight_boards',/^highlightBoards\//]])requireValue(input.paths.filter(p=>pattern.test(p)).length===counts[table],'Incomplete primary data plan');
 return {paths:[...input.paths].sort(),counts};
}

export class TestDataReset {
 constructor({state,storage,db,quota,vault,settings,enabledId}){Object.assign(this,{state,storage,db,quota,vault,settings,enabledId});this.root=db.collection('circus_wallet_v1').doc(settings.namespace);this.meta=this.root.collection('meta').doc('state');}
 clearSessions(){if([...this.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")].length)this.storage.sql.exec('DELETE FROM sessions');this.state.set('casino-visits',null);}
 async readMeta(tx){this.quota.reserve({reads:1});const doc=await (tx?tx.get(this.meta):this.meta.get());this.quota.observe(Buffer.byteLength(JSON.stringify(doc.data())));return unpack(doc);}
 checkMeta(meta,job){requireValue(meta?.environment==='test'&&meta.version===2&&meta.nextId===job.revision,'Source changed');requireValue(meta.status==='ready'||meta.status==='resetting'&&meta.testResetId===job.id&&meta.testResetPlan===job.planHash,'Unexpected maintenance state');}
 async start(input){
  const latest=this.state.get('backup-latest'),manifest=this.vault.manifest(latest);
  const {paths,counts}=validateTestReset(input,{settings:this.settings,enabledId:this.enabledId,manifest,mode:this.state.get('mode')});
  requireValue(!this.state.get('backup-job'),'Finish backup first');
  let job=this.state.get('test-reset');const planHash=digest(JSON.stringify(paths));
  if(job){requireValue(job.id===input.id&&job.planHash===planHash,'Another reset exists');return this.status(job);}
  const meta=await this.readMeta();requireValue(meta?.status==='ready'&&meta.nextId===input.revision&&meta.environment==='test'&&meta.version===2,'Latest backup must match source');
  const wallets=paths.filter(p=>/^wallets\/[^/]+$/.test(p));
  job={id:input.id,projectId:this.settings.projectId,namespace:this.settings.namespace,phase:'freeze',planHash,paths,counts,revision:input.revision,generation:latest,backupSha256:manifest.sha256,cursor:0,verifyCursor:0,resetAt:Date.now(),fingerprint:meta.importFingerprint??null,collections:[...rootCollections,...wallets.flatMap(w=>[w+'/rounds',w+'/days'])]};
  this.storage.transactionSync(()=>{this.state.set('test-reset',job);this.clearSessions();});
  return this.status(job);
 }
 status(job=this.state.get('test-reset')){return job?{id:job.id,phase:job.phase,documents:job.paths?.length??job.documents,deleted:job.cursor,verifiedCollections:job.verifyCursor,collections:job.collections?.length??job.totalCollections,complete:job.phase==='complete'}:{complete:false,phase:'absent'};}
 async step(input){
  requireValue(this.settings.environment==='test'&&this.settings.namespace.endsWith('-test')&&this.enabledId===input.id&&/^[a-f0-9]{32}$/.test(input.id||''),'Test reset is disabled');
  requireValue(this.state.get('mode')==='paused','Paused writer required');
  const job=this.state.get('test-reset');requireValue(job?.id===input.id&&job.projectId===this.settings.projectId&&job.namespace===this.settings.namespace,'Prepare matching reset first');
  if(job.phase==='complete')return this.status(job);
  if(job.phase==='freeze'){
   await this.db.runTransaction(async tx=>{const meta=await this.readMeta(tx);this.checkMeta(meta,job);this.quota.reserve({writes:2});tx.set(this.meta,fields({...meta,status:'resetting',testResetId:job.id,testResetPlan:job.planHash}));},{maxAttempts:1});
   job.phase='deleting';
  }else if(job.phase==='deleting'){
   const paths=job.paths.slice(job.cursor,job.cursor+20);
   if(paths.length){
    await this.db.runTransaction(async tx=>{const meta=await this.readMeta(tx);this.checkMeta(meta,job);requireValue(meta.status==='resetting','Reset ownership required');this.quota.reserve({writes:paths.length*2});for(const path of paths)tx.delete(this.db.doc(this.root.path+'/'+path));},{maxAttempts:1});
    job.cursor+=paths.length;
   }
   if(job.cursor===job.paths.length)job.phase='verifying';
  }else if(job.phase==='verifying'){
   const collection=job.collections[job.verifyCursor];
   if(collection){this.quota.reserve({reads:1});const page=await this.db.collection(this.root.path+'/'+collection).limit(1).get();requireValue(page.empty,'Unplanned player documents remain');job.verifyCursor++;}
   if(job.verifyCursor===job.collections.length)job.phase='finalizing';
  }else if(job.phase==='finalizing'){
   await this.db.runTransaction(async tx=>{
    const meta=await this.readMeta(tx);
    if(meta?.status==='ready'&&meta.nextId===0&&meta.walletEpoch===job.id)return;
    this.checkMeta(meta,job);requireValue(meta.status==='resetting','Reset ownership required');this.quota.reserve({writes:2});
    tx.set(this.meta,fields({version:2,environment:'test',status:'ready',nextId:0,importFingerprint:job.fingerprint,walletEpoch:job.id,resetAt:job.resetAt}));
   },{maxAttempts:1});
   const snapshot={format:1,environment:'test',createdAt:job.resetAt,revision:0,upstreamImportFingerprint:job.fingerprint,tables:Object.fromEntries(TABLES.map(t=>[t,t==='settings'?[{key:'environment',value:'test'}]:[]]))};
   const generation='test-reset-'+job.id;
   this.storage.transactionSync(()=>{
    this.vault.save(generation,snapshot);this.vault.audit(generation);this.vault.publish(generation);
    this.state.set('source',{...this.state.get('source'),revision:0});
    this.state.set('backup-job',null);this.state.set('backup-status',{ok:true,at:Date.now(),revision:0});
    this.state.set('highlights-dirty',false);this.state.set('highlights-revision',0);this.clearSessions();
    job.documents=job.paths.length;job.totalCollections=job.collections.length;delete job.paths;delete job.collections;job.phase='complete';this.state.set('test-reset',job);
   });
  }
  this.state.set('test-reset',job);return this.status(job);
 }
}
