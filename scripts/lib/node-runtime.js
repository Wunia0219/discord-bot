import {spawn} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {readFileSync} from 'node:fs';

export const nodeVersion=readFileSync(new URL('../../.node-version',import.meta.url),'utf8').trim();

export function cloudNode(){
  return process.platform==='win32'&&process.arch==='arm64'
    ?resolve(`.tools/node-x64/node-v${nodeVersion}-win-x64/node.exe`):process.execPath;
}

export function runNode(executable,args,env={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{
      stdio:'inherit',windowsHide:true,
      env:{...process.env,...env,WRANGLER_SEND_METRICS:'false',PATH:dirname(executable)+(process.platform==='win32'?';':':')+process.env.PATH},
    });
    child.once('error',reject);
    child.once('exit',code=>resolve(code??1));
  });
}
