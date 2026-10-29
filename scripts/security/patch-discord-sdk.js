import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('./discord-sdk-patch.json',import.meta.url),'utf8'));
const hash=source=>createHash('sha256').update(source).digest('hex');

// Backport the upstream size-before-elements fix, retaining the SDK's Zod 3 API.
export function patchSource(source){
  for(const [field,replacement] of [
    ['exactLength','if (tooBig) return INVALID;\n                status.dirty();'],
    ['maxLength','return INVALID;'],
    ['maxSize','return INVALID;'],
  ]){
    const before=`message: def.${field}.message,\n                });\n                status.dirty();`;
    if(source.split(before).length!==2)throw new Error(`Unexpected Discord Zod ${field} implementation`);
    source=source.replace(before,`message: def.${field}.message,\n                });\n                ${replacement}`);
  }
  return source;
}

export function checkDiscordSdk({apply=false,sdkFile=require.resolve('@discord/embedded-app-sdk/package.json')}={}){
  const root=dirname(sdkFile);
  const sdk=JSON.parse(readFileSync(sdkFile,'utf8'));
  const sdkRequire=createRequire(sdkFile);
  const zod=JSON.parse(readFileSync(sdkRequire.resolve('zod/package.json'),'utf8'));
  if(sdk.version!==manifest.sdkVersion||zod.version!==manifest.zodVersion)throw new Error('Discord/Zod versions changed; review the security backport before building');
  const writes=[];
  for(const [file,digests] of Object.entries(manifest.files)){
    const path=join(root,file),source=readFileSync(path,'utf8'),digest=hash(source);
    if(digest===digests.patched)continue;
    if(!apply||digest!==digests.original)throw new Error(`Discord security patch missing or unexpected source: ${file}; run npm ci`);
    const patched=patchSource(source);
    if(hash(patched)!==digests.patched)throw new Error('Discord security patch digest mismatch');
    writes.push([path,patched]);
  }
  // Declarations must still describe the SDK's legacy API, not Zod 4's root API.
  const output=join(root,'output');
  for(const file of readdirSync(output,{recursive:true}).filter(file=>file.endsWith('.d.ts'))){
    const path=join(output,file),source=readFileSync(path,'utf8');
    const patched=source.replace(/(['"])zod\1/g,'$1zod/v3$1');
    if(source===patched)continue;
    if(!apply)throw new Error(`Discord legacy declaration mapping missing: ${file}; run npm ci`);
    writes.push([path,patched]);
  }
  // Validate every runtime file before writing any changes. Unknown releases fail closed.
  for(const [path,source] of writes)writeFileSync(path,source);
  return {sdk:sdk.version,zod:zod.version,patchedRuntimeFiles:Object.keys(manifest.files).length};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--check'))throw new Error('Only --check is supported');
  console.log('Discord security backport verified:',checkDiscordSdk({apply:!args.includes('--check')}));
}
