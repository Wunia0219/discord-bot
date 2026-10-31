import {problem} from '../server/wallet/wallet-common.js';
export const QUOTA_LIMITS=Object.freeze({
  global:{reads:40000,writes:15000,egressBytes:128*1024**2,storageBytes:128*1024**2},
  maintenance:{reads:6000,writes:1,egressBytes:32*1024**2,storageBytes:128*1024**2},
  highlights:{reads:3000,writes:1000,egressBytes:8*1024**2,storageBytes:128*1024**2},
});
// Existing projects keep their persisted caps until an explicit admin action.
// These ceilings match Firestore's free daily document allowance.
export const FREE_DOCUMENT_LIMITS=Object.freeze({reads:50000,writes:20000});
const FREE_RESOURCES={...FREE_DOCUMENT_LIMITS,egressBytes:10*1024**3,storageBytes:1024**3};
const monthFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit'});
const quotaMonth=time=>{const parts=monthFormatter.formatToParts(time);return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;};
const notificationLimits=scope=>({...FREE_RESOURCES,...(scope==='maintenance'?{writes:1}:{})});
const unavailable=()=>problem(503,'服務今天的使用量較高，請稍後再試。','FIRESTORE_BUDGET');
const integer=n=>Number.isSafeInteger(n)&&n>=0;
export class CloudQuota {
  constructor(storage,state,{scope='global',clock=Date.now}={}){
    if(!QUOTA_LIMITS[scope])throw new Error('Unknown quota scope');Object.assign(this,{storage,state,scope,clock});this.sql=storage.sql;
    for(const query of [
      'CREATE TABLE IF NOT EXISTS quota_usage(scope TEXT,slot INTEGER,reads INTEGER,writes INTEGER,egressBytes INTEGER,PRIMARY KEY(scope,slot))',
      'CREATE TABLE IF NOT EXISTS quota_growth(scope TEXT PRIMARY KEY,bytes INTEGER)',
      'CREATE TABLE IF NOT EXISTS quota_documents(scope TEXT,key TEXT,bytes INTEGER,PRIMARY KEY(scope,key))',
      'CREATE TABLE IF NOT EXISTS quota_document_sizes(scope TEXT,key TEXT,bytes INTEGER,PRIMARY KEY(scope,key)) WITHOUT ROWID',
      'CREATE TABLE IF NOT EXISTS quota_monthly_egress(scope TEXT,month TEXT,bytes INTEGER,PRIMARY KEY(scope,month))',
    ])this.sql.exec(query);
  }
  seed(bundle,projectId){
    if(this.state.get('quota-identity'))throw new Error('Quota already imported; never reset it');
    if(bundle?.projectId!==projectId||!integer(bundle.exportedAt)||bundle.exportedAt>this.clock()+60000||this.clock()-bundle.exportedAt>300000)throw new Error('Fresh matching quota handoff required');
    if(bundle.enforcement!==undefined&&bundle.enforcement!=='notify-only')throw new Error('Invalid quota policy');
    for(const scope of Object.keys(QUOTA_LIMITS)){
      const s=bundle.scopes?.[scope];if(!s||!Array.isArray(s.usage)||!Array.isArray(s.documents)||!integer(s.growth))throw new Error('Incomplete quota handoff');
      const ceiling=bundle.enforcement==='notify-only'?notificationLimits(scope):{...QUOTA_LIMITS[scope],...(scope==='global'?FREE_DOCUMENT_LIMITS:{})};
      for(const [key,max] of Object.entries(ceiling))if(!Number.isSafeInteger(s.limits?.[key])||s.limits[key]<1||s.limits[key]>max)throw new Error('Quota cap exceeds its ceiling');
      const slots=new Set(),docs=new Set();
      for(const r of s.usage){if(!['slot','reads','writes','egressBytes'].every(k=>integer(r[k]))||r.slot>this.clock()+60000||r.slot%60000||slots.has(r.slot))throw new Error('Invalid quota slot');slots.add(r.slot);}
      for(const r of s.documents){if(!/^[a-f0-9]{64}$/.test(r.key)||!integer(r.bytes)||docs.has(r.key))throw new Error('Invalid growth record');docs.add(r.key);}
      if(bundle.enforcement==='notify-only'){
        const months=new Set();if(!Array.isArray(s.monthlyEgress))throw new Error('Monthly egress history required');
        for(const row of s.monthlyEgress){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month)||row.month>quotaMonth(this.clock())||!integer(row.bytes)||months.has(row.month))throw new Error('Invalid monthly egress');months.add(row.month);}
      }
    }
    this.storage.transactionSync(()=>{
      if([...this.sql.exec('SELECT EXISTS(SELECT 1 FROM quota_usage) OR EXISTS(SELECT 1 FROM quota_growth) OR EXISTS(SELECT 1 FROM quota_documents) OR EXISTS(SELECT 1 FROM quota_document_sizes) OR EXISTS(SELECT 1 FROM quota_monthly_egress) populated')][0].populated)throw new Error('Refusing populated quota');
      for(const [scope,s] of Object.entries(bundle.scopes)){if(!QUOTA_LIMITS[scope])throw new Error('Unknown quota');
        this.sql.exec('INSERT INTO quota_growth VALUES(?,?)',scope,s.growth);
        for(const r of s.usage)this.sql.exec('INSERT INTO quota_usage VALUES(?,?,?,?,?)',scope,r.slot,r.reads,r.writes,r.egressBytes);
        for(const r of s.documents)this.recordDocument(scope,r.key,r.bytes);
        if(bundle.enforcement==='notify-only')for(const row of s.monthlyEgress)this.sql.exec('INSERT INTO quota_monthly_egress VALUES(?,?,?)',scope,row.month,row.bytes);
      }
      this.state.set('quota-identity',{projectId,limits:Object.fromEntries(Object.entries(bundle.scopes).map(([k,v])=>[k,v.limits])),...(bundle.enforcement?{enforcement:bundle.enforcement}:{})});
    });
  }
  identity(){const i=this.state.get('quota-identity');if(!i)throw unavailable();return i;}
  // Read both layouts; leave legacy rows in place to avoid a bulk rewrite on release.
  documentBytes(scope,key){return [...this.sql.exec('SELECT MAX(bytes) bytes FROM (SELECT bytes FROM quota_documents WHERE scope=? AND key=? UNION ALL SELECT bytes FROM quota_document_sizes WHERE scope=? AND key=?)',scope,key,scope,key)][0]?.bytes||0;}
  recordDocument(scope,key,bytes){this.sql.exec('INSERT INTO quota_document_sizes VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET bytes=MAX(bytes,excluded.bytes)',scope,key,bytes);}
  documents(scope){return [...this.sql.exec('SELECT key,MAX(bytes) bytes FROM (SELECT key,bytes FROM quota_documents WHERE scope=? UNION ALL SELECT key,bytes FROM quota_document_sizes WHERE scope=?) GROUP BY key ORDER BY key',scope,scope)];}
  enableNotificationsOnly({allowPaidUsage}={}){
    if(this.scope!=='global'||allowPaidUsage!==true)throw new Error('Explicit paid usage approval required');
    return this.storage.transactionSync(()=>{
      const identity=this.identity();
      if(identity.enforcement!=='notify-only'){
        // Retain all available legacy observations; future months have their own
        // durable ledger and are not lost when the daily usage slots expire.
        for(const row of this.sql.exec('SELECT scope,slot,egressBytes FROM quota_usage WHERE egressBytes>0'))this.recordMonthlyEgress(row.scope,row.egressBytes,row.slot);
        identity.enforcement='notify-only';
        identity.limits=Object.fromEntries(Object.keys(QUOTA_LIMITS).map(scope=>[scope,notificationLimits(scope)]));
        this.state.set('quota-identity',identity);this.state.quotaCache=null;
      }
      return this.status();
    });
  }
  recordMonthlyEgress(scope,bytes,time=this.clock()){
    if(bytes)this.sql.exec('INSERT INTO quota_monthly_egress VALUES(?,?,?) ON CONFLICT(scope,month) DO UPDATE SET bytes=bytes+excluded.bytes',scope,quotaMonth(time),bytes);
  }
  raiseDocumentLimits(limits){
    if(this.scope!=='global'||!limits||Object.keys(limits).sort().join(',')!=='reads,writes')throw new Error('Explicit document limits required');
    return this.storage.transactionSync(()=>{
      const identity=this.identity(),previous={...identity.limits.global};
      for(const [key,max] of Object.entries(FREE_DOCUMENT_LIMITS)){
        if(!Number.isSafeInteger(limits[key])||limits[key]<previous[key]||limits[key]>max)throw new Error('Document limits must stay within the free allowance');
      }
      identity.limits.global={...previous,...limits};
      this.state.set('quota-identity',identity);
      return {previous,...this.status()};
    });
  }
  totals(scope=this.scope){
    const minute=Math.floor(this.clock()/60000),monthly=this.identity().enforcement==='notify-only';
    if(this.state.quotaCache?.minute!==minute||this.state.quotaCache?.monthly!==monthly)this.state.quotaCache={minute,monthly,scopes:new Map()};
    const cache=this.state.quotaCache.scopes;
    if(!cache.has(scope)){const u=[...this.sql.exec('SELECT COALESCE(SUM(reads),0) reads,COALESCE(SUM(writes),0) writes,COALESCE(SUM(egressBytes),0) egressBytes FROM quota_usage WHERE scope=? AND slot>?',scope,this.clock()-86460000)][0];if(monthly)u.egressBytes=[...this.sql.exec('SELECT bytes FROM quota_monthly_egress WHERE scope=? AND month=?',scope,quotaMonth(this.clock()))][0]?.bytes??0;cache.set(scope,{...u,storageBytes:[...this.sql.exec('SELECT bytes FROM quota_growth WHERE scope=?',scope)][0]?.bytes??0});}
    return {...cache.get(scope)};
  }
  updateTotals(scope,cost){const cached=this.state.quotaCache?.scopes.get(scope);if(cached)for(const key of Object.keys(QUOTA_LIMITS.global))cached[key]+=cost[key]||0;}

  reserve(cost={},document=null){
    return this.reserveBatch([{cost,document}]);
  }
  reserveBatch(requests){
    const identity=this.identity(),scopes=this.scope==='global'?['global']:[this.scope,'global'];
    if(!Array.isArray(requests)||!requests.length)throw new Error('Invalid quota batch');
    const cost={reads:0,writes:0,egressBytes:0,storageBytes:0},documents=new Map();
    for(const {cost:delta={},document=null} of requests){
      if(Object.keys(delta).some(k=>!Object.hasOwn(cost,k))||Object.values(delta).some(n=>!integer(n)))throw new Error('Invalid quota cost');
      if(this.scope==='maintenance'&&(delta.writes||delta.storageBytes||document))throw unavailable();
      if(document&&(!/^[a-f0-9]{64}$/.test(document.key)||!integer(document.bytes)))throw new Error('Invalid quota document');
      for(const key of Object.keys(cost)){cost[key]+=delta[key]||0;if(!integer(cost[key]))throw new Error('Quota cost overflow');}
      if(document)documents.set(document.key,Math.max(documents.get(document.key)||0,document.bytes));
    }
    const charged=[];
    this.storage.transactionSync(()=>{for(const scope of scopes){const limits=identity.limits[scope],current=this.totals(scope),v=Object.fromEntries(Object.keys(limits).map(k=>[k,cost[k]||0]));
      const growth=[];
      for(const [key,bytes] of documents){const previous=this.documentBytes(scope,key);
        if(bytes>previous){v.storageBytes+=bytes-previous;growth.push([key,bytes]);}}
      if(Object.values(v).some(n=>!integer(n)))throw new Error('Quota cost overflow');
      if(identity.enforcement!=='notify-only'&&Object.keys(limits).some(k=>current[k]+v[k]>limits[k]))throw unavailable();
      if(v.reads||v.writes||v.egressBytes)this.sql.exec('INSERT INTO quota_usage VALUES(?,?,?,?,?) ON CONFLICT(scope,slot) DO UPDATE SET reads=reads+excluded.reads,writes=writes+excluded.writes,egressBytes=egressBytes+excluded.egressBytes',scope,Math.floor(this.clock()/60000)*60000,v.reads,v.writes,v.egressBytes);
      if(identity.enforcement==='notify-only')this.recordMonthlyEgress(scope,v.egressBytes);
      if(v.storageBytes)this.sql.exec('UPDATE quota_growth SET bytes=bytes+? WHERE scope=?',v.storageBytes,scope);
      for(const [key,bytes] of growth)this.recordDocument(scope,key,bytes);
      charged.push([scope,v]);
    }});
    for(const [scope,cost] of charged)this.updateTotals(scope,cost);
  }
  observe(bytes){if(!integer(bytes))throw new Error('Invalid egress');this.reserve({});const monthly=this.identity().enforcement==='notify-only';this.storage.transactionSync(()=>{for(const scope of this.scope==='global'?['global']:[this.scope,'global']){this.sql.exec('INSERT INTO quota_usage VALUES(?,?,0,0,?) ON CONFLICT(scope,slot) DO UPDATE SET egressBytes=egressBytes+excluded.egressBytes',scope,Math.floor(this.clock()/60000)*60000,bytes);if(monthly)this.recordMonthlyEgress(scope,bytes);}});for(const scope of this.scope==='global'?['global']:[this.scope,'global'])this.updateTotals(scope,{egressBytes:bytes});}
  status(){const identity=this.identity(),used=this.totals('global'),limits=identity.limits.global,notify=identity.enforcement==='notify-only';const policy=notify?{enforcement:'notify-only',egressWindow:'calendar-month-pacific'}:{};const status={used,limits,blocked:!notify&&Object.keys(limits).some(k=>used[k]>=limits[k]),windowHours:24,estimated:true,...policy};if(this.scope!=='global'){const sub=this.totals(),caps=identity.limits[this.scope];status[this.scope==='maintenance'?'maintenance':'delivery']={used:sub,limits:caps,blocked:!notify&&Object.keys(caps).some(k=>sub[k]>=caps[k]),...policy};}return status;}
  export(){const identity=this.identity(),notify=identity.enforcement==='notify-only';return {projectId:identity.projectId,exportedAt:this.clock(),...(notify?{enforcement:'notify-only'}:{}),scopes:Object.fromEntries(Object.keys(QUOTA_LIMITS).map(scope=>[scope,{limits:identity.limits[scope],growth:this.totals(scope).storageBytes,usage:[...this.sql.exec('SELECT slot,reads,writes,egressBytes FROM quota_usage WHERE scope=? AND slot>? ORDER BY slot',scope,this.clock()-86460000)],documents:this.documents(scope),...(notify?{monthlyEgress:[...this.sql.exec('SELECT month,bytes FROM quota_monthly_egress WHERE scope=? ORDER BY month',scope)]}:{})}]))};}
  close(){}
}
