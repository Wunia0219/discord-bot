import {DurableObject} from 'cloudflare:workers';
import {CloudState} from '../../cloud/storage.js';
import {CloudQuota,QUOTA_LIMITS} from '../../cloud/quota.js';

export class QuotaRowsFixture extends DurableObject {
  async fetch(request){
    let rows=0;const original=this.ctx.storage.sql;
    const storage={sql:{exec:(query,...args)=>{const cursor=original.exec(query,...args),result=[...cursor];rows+=cursor.rowsWritten;return result;}},transactionSync:fn=>this.ctx.storage.transactionSync(fn)};
    const path=new URL(request.url).pathname;
    const state=new CloudState(storage),q=new CloudQuota(storage,state),now=Date.now();
    if(path.startsWith('/upgrade/')){
      const startupRowsWritten=rows;rows=0;
      if(path.endsWith('/legacy')){
        const scopes=Object.fromEntries(Object.entries(QUOTA_LIMITS).map(([scope,limits])=>[scope,{limits,growth:300,usage:[],documents:[{key:'a'.repeat(64),bytes:300}]}]));
        for(let i=0;i<1000;i++)scopes.global.documents.push({key:i.toString(16).padStart(64,'0'),bytes:1});scopes.global.growth+=1000;
        q.seed({projectId:'demo-jokers-circus',exportedAt:now,scopes},'demo-jokers-circus');
        const quota=q.export();storage.sql.exec('INSERT INTO quota_documents SELECT * FROM quota_document_sizes');storage.sql.exec('DROP TABLE quota_document_sizes');return Response.json({quota});
      }
      if(path.endsWith('/grow'))q.reserveBatch([{cost:{writes:2},document:{key:'a'.repeat(64),bytes:600}},{cost:{writes:2},document:{key:'b'.repeat(64),bytes:400}}]);
      return Response.json({startupRowsWritten,rowsWritten:rows,quota:q.export(),legacy:[...storage.sql.exec('SELECT key,bytes FROM quota_documents WHERE scope=? ORDER BY key','global')]});
    }
    q.seed({projectId:'demo-jokers-circus',exportedAt:now,scopes:Object.fromEntries(Object.entries(QUOTA_LIMITS).map(([scope,limits])=>[scope,{limits,growth:0,usage:[],documents:[]}]))},'demo-jokers-circus');
    const requests=['a','b','c','d'].map(c=>({cost:{writes:2},document:{key:c.repeat(64),bytes:400}}));
    rows=0;
    if(new URL(request.url).pathname==='/batch')q.reserveBatch(requests);
    else for(const {cost,document} of requests)q.reserve(cost,document);
    return Response.json({rowsWritten:rows,used:q.status().used,documents:q.export().scopes.global.documents});
  }
}
export default {fetch(request,env){const path=new URL(request.url).pathname;return env.QUOTA.get(env.QUOTA.idFromName(path.startsWith('/upgrade/')?'upgrade':path)).fetch(request);}};
