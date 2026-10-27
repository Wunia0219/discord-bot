import {readFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {checkDiscordReadiness} from '../../server/discord/discord-readiness.js';
const args=process.argv.slice(2);let offline=false,discord=false,origin,cloud=false;
for(let i=0;i<args.length;i++){
  if(args[i]==='--offline')offline=true;
  else if(args[i]==='--discord')discord=true;
  else if(args[i]==='--cloud')cloud=true;
  else if(args[i]==='--public-origin'&&args[i+1])origin=args[++i];
  else throw new Error('Usage: discord:check -- [--offline | --discord] [--public-origin https://host]');
}
const frontend=existsSync('.env.local')?parseEnv(readFileSync('.env.local','utf8')):{};
const result=await checkDiscordReadiness({env:process.env,frontend,built:existsSync('dist/index.html'),offline,discord,origin,cloud});
console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
