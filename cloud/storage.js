import {createCipheriv,createDecipheriv,randomBytes,createHmac} from 'node:crypto';
import {LoginRateLimit} from '../server/http/login-rate-limit.js';

export class CloudState {
  constructor(storage){this.storage=storage;this.sql=storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS cloud_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)');}
  get(key){const row=[...this.sql.exec('SELECT value FROM cloud_state WHERE key=?',key)][0];return row?JSON.parse(row.value):null;}
  set(key,value){this.sql.exec('INSERT INTO cloud_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE cloud_state.value<>excluded.value',key,JSON.stringify(value));}
}
export class Sealer {
  constructor(key){if(typeof key!=='string'||!/^[a-f0-9]{64}$/i.test(key))throw new Error('A separate 32-byte cloud encryption key is required');this.key=Buffer.from(key,'hex');}
  authenticate(value,aad){const key=createHmac('sha256',this.key).update('circus-backup-manifest-key-v2').digest();return createHmac('sha256',key).update(aad+'\0'+JSON.stringify(value)).digest('hex');}
  seal(value,aad){const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key,nonce);c.setAAD(Buffer.from(aad));const body=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return Buffer.concat([nonce,c.getAuthTag(),body]).toString('base64');}
  open(value,aad){const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));d.setAAD(Buffer.from(aad));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8'));}
}
export class CloudSessions {
  constructor(storage,sealer){this.sql=storage.sql;this.sealer=sealer;this.sql.exec('CREATE TABLE IF NOT EXISTS sessions(key TEXT PRIMARY KEY,expires INTEGER NOT NULL,value TEXT NOT NULL)');this.sql.exec('CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires)');}
  get size(){return [...this.sql.exec('SELECT COUNT(*) count FROM sessions')][0].count;}
  get(key){const row=[...this.sql.exec('SELECT value FROM sessions WHERE key=?',key)][0];return row?this.sealer.open(row.value,'session:'+key):undefined;}
  set(key,value){
    const previous=this.get(key);
    // A membership HTTP check may finish after another authorized request. Never
    // overwrite that newer request's persistent rate-limit window or count.
    if(previous?.window>value.window){value.window=previous.window;value.count=previous.count;}
    else if(previous&&previous.window===value.window)value.count=Math.max(previous.count||0,value.count||0);
    // Ordinary authorization persists its rate counter before continuing, then
    // saves the same session again. Keep that durable counter; avoid encrypting
    // and rewriting an identical second save or touching the unchanged TTL index.
    if(previous&&JSON.stringify(previous)===JSON.stringify(value))return;
    const sealed=this.sealer.seal(value,'session:'+key);
    if(previous&&previous.expires===value.expires)this.sql.exec('UPDATE sessions SET value=? WHERE key=?',sealed,key);
    else this.sql.exec('INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires,value=excluded.value',key,value.expires,sealed);
  }
  delete(key){this.sql.exec('DELETE FROM sessions WHERE key=?',key);}
  prune(now){this.sql.exec('DELETE FROM sessions WHERE expires<=?',now);}
}
export class CloudLoginLimit extends LoginRateLimit {
  constructor(state){super({clock:Date.now});this.state=state;Object.assign(this,state.get('login-limit')||{});}
  save(){this.state.set('login-limit',{attempts:this.attempts,failures:this.failures,blockedUntil:this.blockedUntil});}
  take(){const result=super.take();this.save();return result;}
  failed(){super.failed();this.save();}
  defer(ms){super.defer(ms);this.save();}
}
