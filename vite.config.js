import {defineConfig} from 'vite';
import {securityHeaders,contentSecurityPolicy} from './server/http/security-headers.js';

// Static HTML may bypass the Worker; emit the same policy for the asset service.
export default defineConfig({plugins:[{
 name:'static-security-headers',
 generateBundle(){
  const headers={...securityHeaders,'Content-Security-Policy':contentSecurityPolicy};
  this.emitFile({type:'asset',fileName:'_headers',source:'/*\n'+Object.entries(headers).map(([name,value])=>`  ${name}: ${value}`).join('\n')+'\n'});
 },
}]});
