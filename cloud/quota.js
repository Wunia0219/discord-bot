import {problem} from '../server/wallet-common.js';
export const QUOTA_LIMITS=Object.freeze({
  global:{reads:40000,writes:15000,egressBytes:128*1024**2,storageBytes:128*1024**2},
  maintenance:{reads:6000,writes:1,egressBytes:32*1024**2,storageBytes:128*1024**2},
  highlights:{reads:3000,writes:1000,egressBytes:8*1024**2,storageBytes:128*1024**2},
});
const unavailable=()=>problem(503,'服務今天的使用量較高，請稍後再試。','FIRESTORE_BUDGET');
const integer=n=>Number.isSafeInteger(n)&&n>=0;
export class CloudQuota {
  constructor(storage,state,{scope='global',clock=Date.now}={}){
    if(!QUOTA_LIMITS[scope])throw new Error('Unknown quota scope');Object.assign(this,{storage,state,scope,clock});this.sql=storage.sql;
    for(const query of [
      'CREATE TABLE IF NOT EXISTS quota_usage(scope TEXT,slot INTEGER,reads INTEGER,writes INTEGER,egressBytes INTEGER,PRIMARY KEY(scope,slot))',
      'CREATE TABLE IF NOT EXISTS quota_growth(scope TEXT PRIMARY KEY,bytes INTEGER)',
      'CREATE TABLE IF NOT EXISTS quota_documents(scope TEXT,key TEXT,bytes INTEGER,PRIMARY KEY(scope,key))',
    ])this.sql.exec(query);
  }
  seed(bundle,projectId){
    if(this.state.get('quota-identity'))throw new Error('Quota already imported; never reset it');
    if(bundle?.projectId!==projectId||!integer(bundle.exportedAt)||bundle.exportedAt>this.clock()+60000||this.clock()-bundle.exportedAt>300000)throw new Error('Fresh matching quota handoff required');
    for(const scope of Object.keys(QUOTA_LIMITS)){
      const s=bundle.scopes?.[scope];if(!s||!Array.isArray(s.usage)||!Array.isArray(s.documents)||!integer(s.growth))throw new Error('Incomplete quota handoff');
      for(const [key,max] of Object.entries(QUOTA_LIMITS[scope]))if(!Number.isSafeInteger(s.limits?.[key])||s.limits[key]<1||s.limits[key]>max)throw new Error('Quota cap cannot be raised');
      const slots=new Set(),docs=new Set();
      for(const r of s.usage){if(!['slot','reads','writes','egressBytes'].every(k=>integer(r[k]))||r.slot>this.clock()+60000||r.slot%60000||slots.has(r.slot))throw new Error('Invalid quota slot');slots.add(r.slot);}
      for(const r of s.documents){if(!/^[a-f0-9]{64}$/.test(r.key)||!integer(r.bytes)||docs.has(r.key))throw new Error('Invalid growth record');docs.add(r.key);}
    }
    this.storage.transactionSync(()=>{
      if([...this.sql.exec('SELECT COUNT(*) n FROM quota_usage')][0].n)throw new Error('Refusing populated quota');
      for(const [scope,s] of Object.entries(bundle.scopes)){if(!QUOTA_LIMITS[scope])throw new Error('Unknown quota');
        this.sql.exec('INSERT INTO quota_growth VALUES(?,?)',scope,s.growth);
        for(const r of s.usage)this.sql.exec('INSERT INTO quota_usage VALUES(?,?,?,?,?)',scope,r.slot,r.reads,r.writes,r.egressBytes);
        for(const r of s.documents)this.sql.exec('INSERT INTO quota_documents VALUES(?,?,?)',scope,r.key,r.bytes);
      }
      this.state.set('quota-identity',{projectId,limits:Object.fromEntries(Object.entries(bundle.scopes).map(([k,v])=>[k,v.limits]))});
    });
  }
  identity(){const i=this.state.get('quota-identity');if(!i)throw unavailable();return i;}
  totals(scope=this.scope){
    const minute=Math.floor(this.clock()/60000);
    if(this.state.quotaCache?.minute!==minute)this.state.quotaCache={minute,scopes:new Map()};
    const cache=this.state.quotaCache.scopes;
    if(!cache.has(scope)){const u=[...this.sql.exec('SELECT COALESCE(SUM(reads),0) reads,COALESCE(SUM(writes),0) writes,COALESCE(SUM(egressBytes),0) egressBytes FROM quota_usage WHERE scope=? AND slot>?',scope,this.clock()-86460000)][0];cache.set(scope,{...u,storageBytes:[...this.sql.exec('SELECT bytes FROM quota_growth WHERE scope=?',scope)][0]?.bytes??0});}
    return {...cache.get(scope)};
  }
  updateTotals(scope,cost){const cached=this.state.quotaCache?.scopes.get(scope);if(cached)for(const key of Object.keys(QUOTA_LIMITS.global))cached[key]+=cost[key]||0;}

  reserve(cost={},document=null){
    const identity=this.identity(),scopes=this.scope==='global'?['global']:[this.scope,'global'];
    if(this.scope==='maintenance'&&(cost.writes||cost.storageBytes||document))throw unavailable();
    if(Object.keys(cost).some(k=>!Object.hasOwn(QUOTA_LIMITS.global,k))||Object.values(cost).some(n=>!integer(n)))throw new Error('Invalid quota cost');
    if(document&&(!/^[a-f0-9]{64}$/.test(document.key)||!integer(document.bytes)))throw new Error('Invalid quota document');
    const charged=[];
    this.storage.transactionSync(()=>{for(const scope of scopes){const limits=identity.limits[scope],current=this.totals(scope),v=Object.fromEntries(Object.keys(limits).map(k=>[k,cost[k]||0]));
      let previous=0;
      if(document){previous=[...this.sql.exec('SELECT bytes FROM quota_documents WHERE scope=? AND key=?',scope,document.key)][0]?.bytes||0;v.storageBytes+=Math.max(0,document.bytes-previous);}
      if(Object.keys(limits).some(k=>current[k]+v[k]>limits[k]))throw unavailable();
      if(v.reads||v.writes||v.egressBytes)this.sql.exec('INSERT INTO quota_usage VALUES(?,?,?,?,?) ON CONFLICT(scope,slot) DO UPDATE SET reads=reads+excluded.reads,writes=writes+excluded.writes,egressBytes=egressBytes+excluded.egressBytes',scope,Math.floor(this.clock()/60000)*60000,v.reads,v.writes,v.egressBytes);
      if(v.storageBytes)this.sql.exec('UPDATE quota_growth SET bytes=bytes+? WHERE scope=?',v.storageBytes,scope);
      if(document&&document.bytes>previous)this.sql.exec('INSERT INTO quota_documents VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET bytes=MAX(bytes,excluded.bytes)',scope,document.key,document.bytes);
      charged.push([scope,v]);
    }});
    for(const [scope,cost] of charged)this.updateTotals(scope,cost);
  }
  observe(bytes){if(!integer(bytes))throw new Error('Invalid egress');this.reserve({});this.storage.transactionSync(()=>{for(const scope of this.scope==='global'?['global']:[this.scope,'global'])this.sql.exec('INSERT INTO quota_usage VALUES(?,?,0,0,?) ON CONFLICT(scope,slot) DO UPDATE SET egressBytes=egressBytes+excluded.egressBytes',scope,Math.floor(this.clock()/60000)*60000,bytes);});for(const scope of this.scope==='global'?['global']:[this.scope,'global'])this.updateTotals(scope,{egressBytes:bytes});}
  status(){const identity=this.identity(),used=this.totals('global'),limits=identity.limits.global;const status={used,limits,blocked:Object.keys(limits).some(k=>used[k]>=limits[k]),windowHours:24,estimated:true};if(this.scope!=='global'){const sub=this.totals(),caps=identity.limits[this.scope];status[this.scope==='maintenance'?'maintenance':'delivery']={used:sub,limits:caps,blocked:Object.keys(caps).some(k=>sub[k]>=caps[k])};}return status;}
  export(){const identity=this.identity();return {projectId:identity.projectId,exportedAt:this.clock(),scopes:Object.fromEntries(Object.keys(QUOTA_LIMITS).map(scope=>[scope,{limits:identity.limits[scope],growth:this.totals(scope).storageBytes,usage:[...this.sql.exec('SELECT slot,reads,writes,egressBytes FROM quota_usage WHERE scope=? AND slot>? ORDER BY slot',scope,this.clock()-86460000)],documents:[...this.sql.exec('SELECT key,bytes FROM quota_documents WHERE scope=? ORDER BY key',scope)]}]))};}
  close(){}
}
