import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,linkSync,lstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,readSync,rmdirSync,statSync,unlinkSync,writeFileSync,writeSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {copyWalletDatabase} from './database-maintenance.js';
import {inspectWalletDatabase,assertDatabaseEnvironment} from './database.js';
import {checksum} from './automatic-backup.js';

const magic=Buffer.from('JCBAK001'),tagBytes=16,maxBytes=256*1024**2;
function regular(file){const info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink())throw new Error('A regular file is required');return info;}
function keyFrom(file){if(regular(file).size!==32)throw new Error('Backup key must contain exactly 32 random bytes');return readFileSync(file);}
function writeAll(fd,bytes){let offset=0;while(offset<bytes.length){const count=writeSync(fd,bytes,offset,bytes.length-offset);if(!count)throw new Error('Backup write incomplete');offset+=count;}}
function exact(fd,length,position){const bytes=Buffer.alloc(length);let offset=0;while(offset<length){const count=readSync(fd,bytes,offset,length-offset,position+offset);if(!count)throw new Error('Truncated backup');offset+=count;}return bytes;}
function transfer(input,output,transform,start,length){const buffer=Buffer.alloc(65536);let offset=0;while(offset<length){const count=readSync(input,buffer,0,Math.min(buffer.length,length-offset),start+offset);if(!count)throw new Error('Truncated backup');writeAll(output,transform.update(buffer.subarray(0,count)));offset+=count;}writeAll(output,transform.final());}
function temporary(parent,prefix){mkdirSync(parent,{recursive:true});return mkdtempSync(join(resolve(parent),prefix));}
function cleanup(directory){
  // Only these files can be created inside this exclusively owned directory.
  for(const name of ['snapshot.sqlite','snapshot.sqlite-wal','snapshot.sqlite-shm']){try{unlinkSync(join(directory,name));}catch(error){if(error.code!=='ENOENT')throw error;}}
  rmdirSync(directory);
}
function targetPath(target){target=resolve(target);if(existsSync(target))throw new Error('Destination already exists; never overwrite backups or live databases');return target;}
export function createBackupKey(file){file=targetPath(file);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,randomBytes(32),{flag:'wx',mode:0o600});return {created:true,keyFile:file};}

// Random per-file nonce; authenticated header; encrypted SQLite including all tables.
// Publishing is an exclusive hard link after verification, never a replacing rename.
export function exportPortableBackup({source,target,keyFile,environment,workDirectory}){
  assertDatabaseEnvironment(environment);target=targetPath(target);
  if(regular(source).size>maxBytes)throw new Error('Snapshot exceeds portable backup size limit');
  const key=keyFrom(keyFile),work=temporary(workDirectory,'export-'),snapshot=join(work,'snapshot.sqlite');
  let partial,partialCreated=false;
  try{
    const audit=copyWalletDatabase({source,target:snapshot,environment});
    const size=statSync(snapshot).size;if(size>maxBytes)throw new Error('Snapshot exceeds portable backup size limit');
    const header={format:1,algorithm:'aes-256-gcm',environment,createdAt:new Date().toISOString(),size,sha256:checksum(snapshot),iv:randomBytes(12).toString('hex')};
    const json=Buffer.from(JSON.stringify(header)),length=Buffer.alloc(4);length.writeUInt32BE(json.length);
    const aad=Buffer.concat([magic,length,json]);
    mkdirSync(dirname(target),{recursive:true});partial=target+'.'+randomUUID()+'.partial';
    const output=openSync(partial,'wx',0o600);partialCreated=true;
    try{
      writeAll(output,aad);
      const cipher=createCipheriv('aes-256-gcm',key,Buffer.from(header.iv,'hex'),{authTagLength:tagBytes});cipher.setAAD(aad);
      const input=openSync(snapshot,'r');try{transfer(input,output,cipher,0,size);}finally{closeSync(input);}
      writeAll(output,cipher.getAuthTag());fsyncSync(output);
    }finally{closeSync(output);}
    verifyPortableBackup({source:partial,keyFile,environment,workDirectory});
    linkSync(partial,target);
    return {ok:true,format:1,environment,archive:target,archiveSha256:checksum(target),snapshotSha256:header.sha256,bytes:statSync(target).size,counts:audit.counts};
  }finally{key.fill(0);if(partialCreated)unlinkSync(partial);cleanup(work);}
}

function unpack({source,keyFile,environment},snapshot){
  assertDatabaseEnvironment(environment);const info=regular(source);
  if(info.size<28||info.size>maxBytes+4112)throw new Error('Invalid archive size');
  const key=keyFrom(keyFile),input=openSync(source,'r');
  try{
    const prefix=exact(input,12,0);if(!prefix.subarray(0,8).equals(magic))throw new Error('Unknown archive format');
    const length=prefix.readUInt32BE(8);if(length<1||length>4096)throw new Error('Invalid archive header');
    const json=exact(input,length,12),header=JSON.parse(json);
    if(header.format!==1||header.algorithm!=='aes-256-gcm'||header.environment!==environment||!Number.isSafeInteger(header.size)||header.size<1||header.size>maxBytes
      ||!/^\d{4}-\d\d-\d\dT/.test(header.createdAt)||!Number.isFinite(Date.parse(header.createdAt))||!/^[a-f0-9]{24}$/.test(header.iv)||!/^[a-f0-9]{64}$/.test(header.sha256)
      ||12+length+header.size+tagBytes!==info.size)throw new Error('Invalid archive header or environment');
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(header.iv,'hex'),{authTagLength:tagBytes});
    decipher.setAAD(Buffer.concat([prefix,json]));decipher.setAuthTag(exact(input,tagBytes,info.size-tagBytes));
    const output=openSync(snapshot,'wx',0o600);
    try{transfer(input,output,decipher,12+length,header.size);fsyncSync(output);}finally{closeSync(output);}
    if(checksum(snapshot)!==header.sha256)throw new Error('Snapshot checksum mismatch');
    const audit=inspectWalletDatabase(snapshot,environment);if(!audit.ok)throw new Error('Restored snapshot failed verification');
    return {ok:true,format:1,environment,snapshotSha256:header.sha256,createdAt:header.createdAt,counts:audit.counts};
  }finally{closeSync(input);key.fill(0);}
}

export function verifyPortableBackup({workDirectory,...options}){
  const work=temporary(workDirectory,'verify-');
  try{return unpack(options,join(work,'snapshot.sqlite'));}finally{cleanup(work);}
}
export function restorePortableBackup({target,...options}){
  target=targetPath(target);const work=temporary(dirname(target),'.restore-'),snapshot=join(work,'snapshot.sqlite');
  try{const result=unpack(options,snapshot);linkSync(snapshot,target);return {...result,database:target};}
  finally{cleanup(work);}
}
