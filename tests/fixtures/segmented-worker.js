import {DurableObject} from 'cloudflare:workers';
import {CloudState,Sealer} from '../../cloud/storage.js';
import {SnapshotVault} from '../../cloud/snapshot.js';
export class BackupFixture extends DurableObject {
  async fetch(request){
    const state=new CloudState(this.ctx.storage),vault=new SnapshotVault(this.ctx.storage,state,new Sealer('a'.repeat(64))),path=new URL(request.url).pathname;
    if(path==='/seed'){vault.save('large',await request.json());return Response.json({saved:true});}
    if(path==='/audit'){const before=this.ctx.storage.sql.databaseSize,result=vault.audit('large');vault.publish('large');return Response.json({...result,before,manifest:vault.manifest('large')});}
    const {start,limit}=await request.json(),m=vault.manifest('large');
    return Response.json({chunks:Array.from({length:Math.min(limit,m.parts-start)},(_,i)=>vault.part('large',start+i,m))});
  }
}
export default {fetch(request,env){return env.BACKUP.get(env.BACKUP.idFromName('isolated-backup')).fetch(request);}};
