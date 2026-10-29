import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {checkToolchain} from '../scripts/qa/check-toolchain.js';

test('Node/npm pins agree across local setup, lockfile, Netlify, Docker and CI',()=>{
  assert.equal(checkToolchain().version,JSON.parse(readFileSync('package.json','utf8')).version);
});

test('toolchain guard rejects missing or stale deployment pins and disabled engine checks',t=>{
  const prefix=join(tmpdir(),'circus-toolchain-'),root=mkdtempSync(prefix);
  assert.ok(resolve(root).startsWith(resolve(prefix))&&!root.slice(prefix.length).includes(sep));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'.github/workflows'),{recursive:true});
  const files=['package.json','package-lock.json','.node-version','.npmrc','netlify.toml','Dockerfile','.github/workflows/verify.yml'];
  for(const file of files)writeFileSync(join(root,file),readFileSync(file));
  const npm=checkToolchain(root).npm;
  for(const [file,change,reason] of [
    ['netlify.toml',text=>text.replace(/NPM_VERSION[^\n]+/,''),/Netlify must select/],
    ['netlify.toml',text=>text.replace(npm,'0.0.0'),/Netlify must select/],
    ['netlify.toml',text=>text+'\n[context.deploy-preview.environment]\nNPM_VERSION = "0.0.0"\n',/Netlify context/],
    ['Dockerfile',text=>text.replace(/FROM node:[^\s]+/,'FROM node:0.0.0-bookworm-slim'),/Docker Node/],
    ['.github/workflows/verify.yml',text=>text.replace(`npm@${npm}`,'npm@0.0.0'),/GitHub Actions npm/],
    ['package-lock.json',text=>{const lock=JSON.parse(text);lock.packages[''].engines.npm='*';return JSON.stringify(lock);},/lockfile engines/],
    ['.npmrc',text=>text.replace('engine-strict=true','engine-strict=false'),/strict engine/],
  ]){
    const original=readFileSync(join(root,file),'utf8');writeFileSync(join(root,file),change(original));
    assert.throws(()=>checkToolchain(root),reason,file);writeFileSync(join(root,file),original);
  }
});
