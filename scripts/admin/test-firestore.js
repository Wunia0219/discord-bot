import {spawn} from 'node:child_process';
import {existsSync,readdirSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
const jar=resolve('.tools/cloud-firestore-emulator-v1.22.0.jar');
if(!existsSync(jar))throw new Error('Run npm run firestore:emulator:setup first');
let java=process.env.FIRESTORE_JAVA_PATH;
if(!java&&process.env.JAVA_HOME)java=join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java');
const bundled=resolve('.tools/firestore-java21');
if(!java&&existsSync(bundled))java=readdirSync(bundled).map(name=>join(bundled,name,'bin','java.exe')).find(existsSync);
java ||= 'java';
mkdirSync('test-results',{recursive:true});const fd=openSync('test-results/firestore-emulator.log','w');
const emulator=spawn(java,['-jar',jar,'--host','127.0.0.1','--port','8787','--project_id','demo-jokers-circus',
  '--single_project_mode','--single_project_mode_error','--rules',resolve('deploy/firestore.rules')],{stdio:['ignore',fd,fd],windowsHide:true});
let spawnError;emulator.on('error',error=>{spawnError=error;});
try{
  let started=false;
  for(let attempt=0;attempt<100;attempt++){
    if(spawnError)throw new Error('Java 21 could not start; set FIRESTORE_JAVA_PATH');
    if(emulator.exitCode!==null)throw new Error('Firestore emulator stopped; see test-results/firestore-emulator.log');
    try{await fetch('http://127.0.0.1:8787/',{signal:AbortSignal.timeout(500)});started=true;break;}catch{}
    await delay(200);
  }
  if(!started)throw new Error('Firestore emulator did not become ready');
  const test=spawn(process.execPath,['--test','--test-concurrency=1','tests/firestore.integration.js'],{
    env:{...process.env,FIRESTORE_EMULATOR_HOST:'127.0.0.1:8787',GCLOUD_PROJECT:'demo-jokers-circus'},stdio:'inherit',windowsHide:true});
  const [code]=await once(test,'exit');process.exitCode=code??1;
}finally{
  if(emulator.exitCode===null){emulator.kill();await Promise.race([once(emulator,'exit'),delay(5000)]);}
  closeSync(fd);
}
