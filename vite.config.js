import {defineConfig} from 'vite';
import {securityHeaders,contentSecurityPolicy} from './server/http/security-headers.js';

// Static HTML may bypass the Worker; emit the same policy for the asset service.
export default defineConfig({plugins:[{
 name:'static-security-headers',
 generateBundle(_,bundle){
  const headers={...securityHeaders,'Content-Security-Policy':contentSecurityPolicy};
  const assets=Object.keys(bundle).filter(file=>/^assets\/[\w.-]+-[\w-]{8}\.[a-z0-9]+$/.test(file)).sort();
  if(assets.length>99)throw new Error('Static asset policies exceed the 100-rule header limit');
  const cache=assets.map(file=>`/${file}\n  Cache-Control: public, max-age=31536000, immutable\n`).join('\n');
  this.emitFile({type:'asset',fileName:'_headers',source:'/*\n'+Object.entries(headers).map(([name,value])=>`  ${name}: ${value}`).join('\n')+'\n\n'+cache});
 },
}]});
