import {resolve,relative,isAbsolute,sep} from 'node:path';
import {readFileSync} from 'node:fs';

function limit(env,key,fallback,max){const value=env[key]===undefined?fallback:Number(env[key]);if(!Number.isSafeInteger(value)||value<1||value>max)throw new Error(`Invalid ${key}`);return value;}
export function firestoreSettings(env=process.env){
  const projectId=env.FIRESTORE_PROJECT_ID,environment=env.APP_ENV;
  if(!['test','production'].includes(environment))throw new Error('Explicit Firestore APP_ENV required');
  if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId||''))throw new Error('Explicit FIRESTORE_PROJECT_ID required');
  const namespace=env.FIRESTORE_NAMESPACE||`jokers-circus-${environment}`;
  if(!/^[a-z][a-z0-9-]{2,79}$/.test(namespace)||!namespace.endsWith('-'+environment))throw new Error('FIRESTORE_NAMESPACE must end with its environment');
  const emulator=env.FIRESTORE_EMULATOR_HOST;
  let credentials;
  if(emulator){
    if(!/^127\.0\.0\.1:\d{2,5}$/.test(emulator)||Number(emulator.split(':')[1])>65535||environment!=='test'||!projectId.startsWith('demo-'))throw new Error('Firestore emulator requires loopback, test environment and demo project');
  }else{
    if(env.FIRESTORE_LIVE_ENABLED!=='true')throw new Error('Set FIRESTORE_LIVE_ENABLED=true explicitly for cloud access');
    if(!env.GOOGLE_APPLICATION_CREDENTIALS||!isAbsolute(env.GOOGLE_APPLICATION_CREDENTIALS))throw new Error('An absolute server credential path outside this project is required');
    const keyRelative=relative(resolve('.'),resolve(env.GOOGLE_APPLICATION_CREDENTIALS));
    if(!isAbsolute(keyRelative)&&keyRelative!=='..'&&!keyRelative.startsWith('..'+sep))throw new Error('Store Google credentials outside the project directory');
    try{credentials=JSON.parse(readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'));}catch{throw new Error('A server-only Google service account credential file is required');}
    if(credentials.type!=='service_account'||credentials.project_id!==projectId||!credentials.client_email||!credentials.private_key)throw new Error('Google credential project does not match FIRESTORE_PROJECT_ID');
  }
  return {projectId,environment,namespace,emulator,credentials:credentials?{client_email:credentials.client_email,private_key:credentials.private_key}:undefined,
    quota:{filename:resolve(env.FIRESTORE_QUOTA_PATH||`data/firestore-usage-${projectId}.sqlite`),projectId,
      reads:limit(env,'FIRESTORE_READ_BUDGET',40000,40000),writes:limit(env,'FIRESTORE_WRITE_BUDGET',15000,15000),
      egressBytes:limit(env,'FIRESTORE_EGRESS_MB',128,256)*1024**2,storageBytes:limit(env,'FIRESTORE_STORAGE_MB',128,256)*1024**2}};
}
