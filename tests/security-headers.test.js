import test from 'node:test';
import assert from 'node:assert/strict';
import {secureResponse} from '../server/http/security-headers.js';

test('HTML permits Discord embedding while blocking injected scripts and unexpected origins', async()=>{
  const response=secureResponse(new Response('<html>game</html>',{headers:{'Content-Type':'text/html; charset=utf-8'}}));
  const csp=response.headers.get('Content-Security-Policy');
  assert.match(csp,/script-src 'self';/);
  assert.doesNotMatch(csp,/unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.match(csp,/frame-ancestors[^;]*https:\/\/discord.com/);
  assert.match(csp,/base-uri 'none'/);
  assert.match(csp,/form-action 'none'/);
  assert.equal(response.headers.get('X-Frame-Options'),null);
  assert.equal(await response.text(),'<html>game</html>');
});

test('security headers preserve private API caching, audio ranges and response bodies',async()=>{
  for(const [status,headers,body] of [
    [401,{'Content-Type':'application/json','Cache-Control':'no-store'},'{"error":"denied"}'],
    [206,{'Content-Type':'audio/mpeg','Content-Range':'bytes 2-4/10','Cache-Control':'public, max-age=31536000, immutable'},'abc'],
  ]){
    const response=secureResponse(new Response(body,{status,headers}));
    assert.equal(response.status,status);
    for(const [key,value] of Object.entries(headers))assert.equal(response.headers.get(key),value);
    assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
    assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
    assert.match(response.headers.get('Permissions-Policy'),/microphone=\(\)/);
    assert.equal(response.headers.get('Content-Security-Policy'),null);
    assert.equal(await response.text(),body);
  }
});
