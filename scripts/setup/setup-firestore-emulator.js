import {mkdirSync,existsSync,createReadStream,createWriteStream,renameSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const version='1.22.0',sha256='9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c';
const target=resolve(`.tools/cloud-firestore-emulator-v${version}.jar`);
async function check(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')===sha256;}
if(!existsSync(target)||!await check(target)){
  mkdirSync(dirname(target),{recursive:true});const temporary=target+'.download';
  try{
    const response=await fetch(`https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v${version}.jar`);
    if(!response.ok)throw new Error('Firestore emulator download failed');
    await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary));
    if(!await check(temporary))throw new Error('Firestore emulator checksum mismatch');
    renameSync(temporary,target);
  }catch(error){try{unlinkSync(temporary);}catch{}throw error;}
}
console.log('Official Firestore emulator verified. Install Java 21 or set FIRESTORE_JAVA_PATH before npm run test:firestore.');
