// Minimal Firestore v1 REST transport for the existing settlement contract.
// No automatic transport retries: an ambiguous commit is resolved by the caller's
// original request ID. Only an explicit ABORTED transaction may rerun its callback.
import {createSign} from 'node:crypto';

export class GoogleAccessToken {
  constructor(credentials,{fetchImpl=globalThis.fetch.bind(globalThis),clock=Date.now}={}){Object.assign(this,{credentials,fetchImpl,clock});}
  async get(){
    if(this.token&&this.expires>this.clock()+60000)return this.token;
    this.pending ||= this.exchange().finally(()=>this.pending=null);return this.pending;
  }
  async exchange(){
    const c=this.credentials,now=Math.floor(this.clock()/1000),enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    const body=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:c.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
    const signature=createSign('RSA-SHA256').update(body).sign(c.private_key).toString('base64url');
    const response=await this.fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:body+'.'+signature}),redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('Google authorization unavailable');
    const token=await response.json();if(typeof token.access_token!=='string'||!Number.isFinite(token.expires_in)||token.expires_in<=0)throw new Error('Invalid Google authorization');
    this.token=token.access_token;this.expires=this.clock()+Math.min(3600,token.expires_in)*1000;return this.token;
  }
}
export function encodeValue(value){
  if(value===null)return {nullValue:null};
  if(typeof value==='string')return {stringValue:value};
  if(typeof value==='boolean')return {booleanValue:value};
  if(Number.isSafeInteger(value))return {integerValue:String(value)};
  if(typeof value==='number'&&Number.isFinite(value))return {doubleValue:value};
  throw new Error('Unsupported Firestore field value');
}
function decodeValue(value){
  if('stringValue' in value)return value.stringValue;
  if('integerValue' in value){const n=Number(value.integerValue);if(!Number.isSafeInteger(n))throw new Error('Unsafe Firestore integer');return n;}
  if('doubleValue' in value)return value.doubleValue;
  if('booleanValue' in value)return value.booleanValue;
  if('nullValue' in value)return null;
  throw new Error('Unsupported Firestore response field');
}
class Snapshot {
  constructor(db,name,document,readTime){this.ref=db.doc(name.slice(db.prefix.length+1));this.id=this.ref.id;this.exists=!!document;this.readTime=readTime;this.fields=document?Object.fromEntries(Object.entries(document.fields||{}).map(([k,v])=>[k,decodeValue(v)])):undefined;}
  get(key){return this.fields?.[key];}data(){return this.fields;}
}
const pathSegments=path=>{const segments=path.split('/');if(!segments.length||segments.some(p=>!p||p==='.'||p==='..'||/[?#\u0000]/.test(p)))throw new Error('Invalid document path');return segments;};
class Reference {
  constructor(db,path){this.db=db;this.path=path;this.id=pathSegments(path).at(-1);}
  collection(name){if(name.includes('/'))throw new Error('Invalid collection');return new Query(this.db,this.path+'/'+name);}
  get(){return this.db.getAll(this).then(rows=>rows[0]);}
}
class Query {
  constructor(db,path,query={}){this.db=db;this.path=path;pathSegments(path);this.query=query;}
  doc(id){return this.db.doc(this.path+'/'+id);}
  where(field,operator,value){const ops={'==':'EQUAL','>':'GREATER_THAN','>=':'GREATER_THAN_OR_EQUAL','<':'LESS_THAN','<=':'LESS_THAN_OR_EQUAL'};if(!ops[operator])throw new Error('Unsupported operator');const val=field==='__name__'?{referenceValue:this.db.prefix+'/'+this.path+'/'+value}:encodeValue(value);return new Query(this.db,this.path,{...this.query,filters:[...(this.query.filters||[]),{fieldFilter:{field:{fieldPath:field},op:ops[operator],value:val}}]});}
  orderBy(field,direction='asc'){if(!['asc','desc'].includes(direction))throw new Error('Invalid ordering');return new Query(this.db,this.path,{...this.query,orderBy:[...(this.query.orderBy||[]),{field:{fieldPath:field},direction:direction==='asc'?'ASCENDING':'DESCENDING'}]});}
  limit(n){if(!Number.isSafeInteger(n)||n<1||n>1000)throw new Error('Invalid query limit');return new Query(this.db,this.path,{...this.query,limit:n});}
  startAfter(value){const field=this.query.orderBy?.[0]?.field.fieldPath;if(!field)throw new Error('Cursor needs ordering');return new Query(this.db,this.path,{...this.query,startAt:{values:[field==='__name__'?{referenceValue:this.db.prefix+'/'+this.path+'/'+value}:encodeValue(value)],before:false}});}
  get(){return this.db.query(this);}
}
export class FirestoreRest {
  constructor({projectId,namespace,credentials,emulator,fetchImpl=globalThis.fetch.bind(globalThis),readOnly=false,endpoint}){
    if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)||!namespace)throw new Error('Invalid Firestore identity');
    if(emulator&&(!projectId.startsWith('demo-')||!/^127\.0\.0\.1:\d+$/.test(emulator)))throw new Error('Unsafe emulator');
    if(endpoint&&(emulator||!/^https:\/\/firestore\.[a-z0-9-]+\.rep\.googleapis\.com$/.test(endpoint)))throw new Error('Invalid regional Firestore endpoint');
    Object.assign(this,{projectId,namespace,fetchImpl,readOnly});this.prefix=`projects/${projectId}/databases/(default)/documents`;
    this.base=emulator?'http://'+emulator:endpoint||'https://firestore.googleapis.com';this.auth=emulator?{get:async()=>'owner'}:new GoogleAccessToken(credentials,{fetchImpl});
  }
  doc(path){const root='circus_wallet_v1/'+this.namespace;if(pathSegments(path).length%2!==0||(path!==root&&!path.startsWith(root+'/')))throw new Error('Namespace boundary');return new Reference(this,path);}
  collection(path){if(pathSegments(path).length%2!==1)throw new Error('Invalid collection');return new Query(this,path);}
  async call(path,body){
    const token=this.auth?await this.auth.get():null;
    const r=await this.fetchImpl(this.base+'/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!r.ok){let status;try{status=(await r.json()).error?.status;}catch{}throw Object.assign(new Error('Firestore request unavailable'),{restStatus:status,httpStatus:r.status});}
    return r.json();
  }
  async getAll(...refs){return this.batchGet(refs);}
  async batchGet(refs,consistency={},onTransaction){
    if(!refs.length)return [];for(const ref of refs)this.doc(ref.path);
    const rows=await this.call(this.prefix+':batchGet',{documents:refs.map(r=>this.prefix+'/'+r.path),...consistency}),found=new Map();
    if(consistency.newTransaction){const transaction=rows.find(row=>row.transaction)?.transaction;if(typeof transaction!=='string'||!transaction)throw new Error('Missing transaction');onTransaction?.(transaction);}
    for(const row of rows){const name=row.found?.name||row.missing;if(name)found.set(name,new Snapshot(this,name,row.found,row.readTime));}
    return refs.map(ref=>{const row=found.get(this.prefix+'/'+ref.path);if(!row)throw new Error('Incomplete Firestore response');return row;});
  }
  async query(ref,consistency={}){
    const parts=ref.path.split('/'),id=parts.pop(),parent=parts.join('/');
    const root='circus_wallet_v1/'+this.namespace;if(parent!==root&&!parent.startsWith(root+'/'))throw new Error('Namespace boundary');
    const {filters,...query}=ref.query,structuredQuery={from:[{collectionId:id}],...query,...(filters?.length?{where:filters.length===1?filters[0]:{compositeFilter:{op:'AND',filters}}}:{})};
    const rows=await this.call(this.prefix+'/'+parent+':runQuery',{structuredQuery,...consistency});
    const docs=rows.filter(r=>r.document).map(r=>new Snapshot(this,r.document.name,r.document,r.readTime));return {docs,size:docs.length,empty:!docs.length,readTime:rows.at(-1)?.readTime};
  }
  async runTransaction(callback,{maxAttempts=3,readOnly=false}={}){
    for(let attempt=0;attempt<maxAttempts;attempt++){
      const options=readOnly?{readOnly:{}}:{readWrite:{}};
      const writes=[],beforeCommit=[];let wrote=false,transaction,starting;
      const begin=async()=>{
        if(!transaction&&!starting)starting=this.call(this.prefix+':beginTransaction',{options}).then(result=>{transaction=result.transaction;if(!transaction)throw new Error('Missing transaction');});
        if(starting)try{await starting;}finally{starting=null;}
        return transaction;
      };
      const read=async refs=>{
        if(wrote)throw new Error('Read after write');if(!refs.length)return [];
        if(!transaction&&!starting){
          // Firestore can open the transaction with its first document batch.
          // This saves one full network round trip without optimistic results.
          starting=this.batchGet(refs,{newTransaction:options},id=>{transaction=id;});
          try{return await starting;}finally{starting=null;}
        }
        await begin();return this.batchGet(refs,{transaction});
      };
      const write=(ref,data,create)=>{if(readOnly||this.readOnly)throw new Error('Read-only transport');this.doc(ref.path);wrote=true;writes.push({update:{name:this.prefix+'/'+ref.path,fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,encodeValue(v)]))},...(create?{currentDocument:{exists:false}}:{})});};
      const tx={beforeCommit:callback=>beforeCommit.push(callback),get:ref=>{if(wrote)throw new Error('Read after write');return ref instanceof Query?begin().then(()=>this.query(ref,{transaction})):read([ref]).then(r=>r[0]);},getAll:(...refs)=>read(refs),set:(r,d)=>write(r,d,false),create:(r,d)=>write(r,d,true),delete:ref=>{if(readOnly||this.readOnly)throw new Error('Read-only transport');this.doc(ref.path);wrote=true;writes.push({delete:this.prefix+'/'+ref.path});}};
      try{const result=await callback(tx);if(writes.length){await begin();for(const reserve of beforeCommit)await reserve();await this.call(this.prefix+':commit',{transaction,writes});}else if(transaction)await this.call(this.prefix+':rollback',{transaction});return result;}
      catch(error){if(transaction)try{await this.call(this.prefix+':rollback',{transaction});}catch{}if(error.restStatus==='ABORTED'&&!readOnly&&attempt+1<maxAttempts){await new Promise(resolve=>setTimeout(resolve,50*2**attempt+Math.floor(Math.random()*100)));continue;}throw error;}
    }
  }
  async terminate(){}
}
