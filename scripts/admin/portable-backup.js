import {resolve} from 'node:path';
import {createBackupKey,exportPortableBackup,verifyPortableBackup,restorePortableBackup} from '../../server/portable-backup.js';

const usage='Usage: backup:portable -- keygen --key-file <private file> | export --from <sqlite> --to <archive> --key-file <file> --environment test|production | verify --from <archive> --key-file <file> --environment test|production | restore --from <archive> --to <new sqlite> --key-file <file> --environment test|production';
try{
  const [action,...args]=process.argv.slice(2),options={};
  if(!['keygen','export','verify','restore'].includes(action))throw new Error(usage);
  const allowed=action==='keygen'?['--key-file']:action==='verify'?['--from','--key-file','--environment','--work-directory']:['--from','--to','--key-file','--environment','--work-directory'];
  for(let i=0;i<args.length;i+=2){if(!allowed.includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||options[args[i]])throw new Error(usage);options[args[i]]=args[i+1];}
  if(!options['--key-file']||(action!=='keygen'&&(!options['--from']||!options['--environment']))||(['export','restore'].includes(action)&&!options['--to']))throw new Error(usage);
  const config={source:options['--from'],target:options['--to'],keyFile:options['--key-file'],environment:options['--environment'],workDirectory:resolve(options['--work-directory']||'data/portable-backup-work')};
  const result=action==='keygen'?createBackupKey(config.keyFile):action==='export'?exportPortableBackup(config):action==='verify'?verifyPortableBackup(config):restorePortableBackup(config);
  console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error.message===usage?usage:'Portable backup failed; no destination was overwritten. Check source, key, environment, disk space and filesystem hard-link support.');process.exitCode=1;}
