import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function checkToolchain(root=process.cwd()){
  const read=name=>readFileSync(resolve(root,name),'utf8');
  const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'));
  const node=read('.node-version').trim(),npm=pkg.packageManager?.match(/^npm@(\d+\.\d+\.\d+)$/)?.[1];
  assert.match(node,/^\d+\.\d+\.\d+$/,'pin .node-version');assert.ok(npm,'pin packageManager to npm@x.y.z');
  for(const [name,version] of Object.entries({node,npm}))assert.equal(pkg.engines[name],`>=${version} <${Number(version.split('.')[0])+1}`,`${name} engine must match its pin`);
  assert.deepEqual(lock.packages[''].engines,pkg.engines,'lockfile engines');
  assert.equal(lock.version,pkg.version,'lockfile product version');
  assert.equal(lock.packages[''].version,pkg.version,'lockfile root version');
  const netlify=read('netlify.toml');
  const environment=netlify.split(/^\[build\.environment\]\s*$/m)[1]?.split(/^\[/m)[0]??'';
  assert.match(environment,new RegExp(`^\\s*NPM_VERSION\\s*=\\s*["']${npm.replaceAll('.','\\.')}["']\\s*$`,'m'),'Netlify must select npm before dependency installation');
  for(const match of netlify.matchAll(/^\s*NPM_VERSION\s*=\s*["']([^"']+)["']/gm))assert.equal(match[1],npm,'Netlify context npm override');
  const docker=read('Dockerfile'),workflow=read('.github/workflows/verify.yml');
  const images=[...docker.matchAll(/^FROM node:([^\s]+).*$/gm)];
  assert.equal(images.length,2,'check both Docker stages');
  for(const image of images)assert.equal(image[1],`${node}-bookworm-slim`,'Docker Node pin');
  for(const [name,source] of [['Dockerfile',docker],['GitHub Actions',workflow]])assert.ok(source.includes(`npm install --global npm@${npm}`),`${name} npm pin`);
  assert.match(workflow,/node-version-file:\s*\.node-version/,'CI Node source');
  assert.match(read('.npmrc'),/^engine-strict=true\s*$/m,'retain strict engine validation');
  assert.match(read('.npmrc'),/^strict-allow-scripts=true\s*$/m,'retain install script restrictions');
  return {node,npm,version:pkg.version};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(checkToolchain()));
