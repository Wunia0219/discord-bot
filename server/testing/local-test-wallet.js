import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { WalletStore, problem } from '../wallet/wallet.js';
import { APP_VERSION } from '../../src/version.js';
import { LOCAL_TEST_CASES } from './local-test-plan.js';

const guild='100000000000000001', user='100000000000000002';
const hash=token=>createHash('sha256').update(token).digest('hex');
export const LOCAL_TEST_PROFILES=[
  {key:'qa-a',user:'100000000000000011',name:'測試玩家 A',balance:10000,purpose:'簽到、下注、重新整理與快停'},
  {key:'qa-b',user:'100000000000000012',name:'測試玩家 B',balance:10000,purpose:'確認不同帳號的餘額與紀錄分開'},
  {key:'qa-low',user:'100000000000000013',name:'低餘額玩家',balance:50,purpose:'餘額不足時拒絕下注'},
  {key:'qa-zero',user:'100000000000000014',name:'零餘額玩家',balance:0,purpose:'無戲籌時的提示與簽到恢復'},
];
const defaultProfile={key:'default',user,name:'本機錢包測試',balance:10000};

// A separate identity provider for loopback development. It cannot create Discord sessions.
export class LocalTestSessions {
  constructor(store){this.store=store;this.sessions=new Map();}
  createLocal(profileKey='default'){
    const profile=profileKey==='default'?defaultProfile:LOCAL_TEST_PROFILES.find(profile=>profile.key===profileKey);
    if(!profile)throw problem(400,'找不到這個測試帳號，請從測試頁開啟。');
    // Create only the selected player; opening the QA overview never seeds wallets.
    this.store.tx(()=>{
      this.store.ensure(guild,profile.user);
      if(profile.balance!==10000)this.store.once(guild,`local-fixture:${profile.key}`,String(profile.balance),()=>({
        entry:this.store.credit(guild,profile.user,profile.balance-10000,'test_fixture',null,'本機驗收情境初始餘額'),
      }));
    });
    const now=Date.now();
    for(const [key,session] of this.sessions)if(session.expires<=now)this.sessions.delete(key);
    if(this.sessions.size>=128)throw problem(429,'測試登入過於頻繁，請稍後重試。');
    const token=randomBytes(32).toString('base64url'), expires=now+3600000;
    this.sessions.set(hash(token),{guild,user:profile.user,expires,count:0,window:now});
    return {
      mode:'local',user:{id:profile.user,username:profile.key,global_name:profile.name,avatar:null},
      session:{token,expiresAt:new Date(expires).toISOString(),userId:profile.user,guildId:guild,environment:'test',walletEpoch:this.store.walletEpoch},
    };
  }
  async authorize(header){
    const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(header||'')?.[1];
    const session=token&&this.sessions.get(hash(token)), now=Date.now();
    if(!session||session.expires<=now){if(token)this.sessions.delete(hash(token));throw problem(401,'登入已過期，請重新開啟遊戲。');}
    this.store.validate(session.guild,session.user);
    if(now-session.window>=60000){session.window=now;session.count=0;}
    if(++session.count>120)throw problem(429,'操作過於頻繁，請稍後再試。');
    return session;
  }
}

export function localTestWalletConfig(env){
  if(env.APP_ENV!=='test'||env.HOST!=='127.0.0.1'||env.WALLET_ENABLED!=='true'||!env.DATABASE_PATH?.trim()){
    throw new Error('Local wallet testing requires APP_ENV=test, HOST=127.0.0.1, WALLET_ENABLED=true and an explicit DATABASE_PATH');
  }
  const filename=resolve(env.DATABASE_PATH);
  mkdirSync(dirname(filename),{recursive:true});
  const store=new WalletStore({filename,environment:'test',guildIds:[guild],weeklyRewards:env.WEEKLY_CHECKIN_REWARDS});
  try {
    store.db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES ('wallet_epoch',?)").run(randomBytes(16).toString('hex'));
    store.walletEpoch=store.db.prepare("SELECT value FROM settings WHERE key='wallet_epoch'").get().value;
    const localOverview=()=>({
      ok:store.isReady(),environment:'test',version:APP_VERSION,runId:hash(filename).slice(0,16),
      weeklyRewards:store.weeklyRewards,cases:LOCAL_TEST_CASES,
      profiles:LOCAL_TEST_PROFILES.map(profile=>{
        const exists=!!store.db.prepare('SELECT 1 FROM wallets WHERE guild=? AND user=?').get(guild,profile.user);
        const state=exists?store.state(guild,profile.user):{balance:profile.balance,claimed:false,history:[]};
        return {key:profile.key,name:profile.name,created:exists,initialBalance:profile.balance,purpose:profile.purpose,
          balance:state.balance,claimed:state.claimed,rounds:state.history.length,
          url:`/?wallet=local&player=${profile.key}`};
      }),
    });
    return {store,service:new LocalTestSessions(store),adminRoles:[],localTest:true,localOverview};
  } catch(error) {store.close();throw error;}
}

export {isLocalTestRequest} from './local-test-request.js';
