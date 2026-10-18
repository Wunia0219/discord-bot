import test from 'node:test';
import assert from 'node:assert/strict';
import { WalletStore } from '../server/wallet.js';
import { WalletService } from '../server/wallet-service.js';
const guild='1441097301685698703',user='1561284960986599626';
test('sessions bind identity verified by Discord to an allowed guild, expire and recheck membership',async t=>{
 let now=Date.now(),member=true;
 const store=new WalletStore({guildIds:[guild]});t.after(()=>store.close());
 const service=new WalletService(store,{clock:()=>now,fetchImpl:async url=>url.endsWith('/users/@me')?Response.json({id:user}):member?Response.json({user:{id:user},pending:false}):Response.json({}, {status:404})});
 const token={access_token:'provider-secret',scope:'identify guilds.members.read',expires_in:3600};
 await assert.rejects(service.create(token,'123456789012345678'),/尚未開放/);
 const session=await service.create(token,guild);assert.equal(session.userId,user);assert.equal(session.guildId,guild);assert.ok(!JSON.stringify(session).includes('provider-secret'));
 await assert.rejects(service.authorize('Bearer forged'),/登入已過期/);
 assert.equal((await service.authorize('Bearer '+session.token)).user,user);
 now+=301000;member=false;await assert.rejects(service.authorize('Bearer '+session.token),/無法確認/);
 await assert.rejects(service.authorize('Bearer '+session.token),/登入已過期/);
 member=true;const second=await service.create(token,guild);now+=3600001;await assert.rejects(service.authorize('Bearer '+second.token),/登入已過期/);
});
