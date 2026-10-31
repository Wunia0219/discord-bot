import {DurableObject} from 'cloudflare:workers';
import {CloudState} from '../../cloud/storage.js';
import {CloudQuota,QUOTA_LIMITS} from '../../cloud/quota.js';

export class QuotaRowsFixture extends DurableObject {
  async fetch(request){
    let rows=0;const original=this.ctx.storage.sql;
    const storage={sql:{exec:(query,...args)=>{const cursor=original.exec(query,...args);rows+=cursor.rowsWritten;return cursor;}},transactionSync:fn=>this.ctx.storage.transactionSync(fn)};
    const state=new CloudState(storage),q=new CloudQuota(storage,state),now=Date.now();
    q.seed({projectId:'demo-jokers-circus',exportedAt:now,scopes:Object.fromEntries(Object.entries(QUOTA_LIMITS).map(([scope,limits])=>[scope,{limits,growth:0,usage:[],documents:[]}]))},'demo-jokers-circus');
    const requests=['a','b','c','d'].map(c=>({cost:{writes:2},document:{key:c.repeat(64),bytes:400}}));
    rows=0;
    if(new URL(request.url).pathname==='/batch')q.reserveBatch(requests);
    else for(const {cost,document} of requests)q.reserve(cost,document);
    return Response.json({rowsWritten:rows,used:q.status().used,documents:q.export().scopes.global.documents});
  }
}
export default {fetch(request,env){return env.QUOTA.get(env.QUOTA.idFromName(new URL(request.url).pathname)).fetch(request);}};
