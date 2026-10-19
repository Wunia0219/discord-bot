import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, extname, sep, isAbsolute } from 'node:path';
import { validSignature, handleCommand } from './commands.js';
import { privateReply } from './bot-replies.js';
import { MODEL_VERSION } from '../src/game/slot-math.js';

const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.webp':'image/webp', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2' };
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(JSON.stringify(data));
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const inside = (root, path) => {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
};

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw fail(415, '需要 JSON 格式。');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw fail(413, '登入請求過大。');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail(400, '登入請求格式錯誤。'); }
  return body;
}

// Only built game files are served. Project sources and .env files are never exposed.
export function createActivityServer({ clientId, clientSecret, publicKey, wallet=null, distDir = resolve('dist'), fetchImpl = fetch } = {}) {
  let activeExchanges = 0;
  const allowedOrigins = new Set([`https://${clientId}.discordsays.com`, 'http://127.0.0.1:4187', 'http://127.0.0.1:4188']);
  return createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if(path==='/healthz')return json(res,200,{ok:true,model:MODEL_VERSION});
      if(path==='/api/interactions'){
        if(req.method!=='POST')return json(res,405,{error:'請使用 POST。'});
        let size=0;const chunks=[];
        for await(const chunk of req){size+=chunk.length;if(size>65536)return json(res,413,{error:'請求過大。'});chunks.push(chunk);}
        const raw=Buffer.concat(chunks);
        if(!validSignature(publicKey,req.headers,raw))return json(res,401,{error:'無效的 Discord 簽章。'});
        let interaction;try{interaction=JSON.parse(raw.toString('utf8'));}catch{return json(res,400,{error:'無效的請求。'});}
        if(interaction.type===1)return json(res,200,{type:1});
        if(interaction.application_id!==clientId)return json(res,403,{error:'應用程式不符。'});
        if(!wallet)return json(res,200,privateReply(null,'過一會兒再試試。如果一直連不上，請找管理員幫忙看看。','籌碼暫時連不上','warning'));
        return json(res,200,handleCommand(interaction,wallet.store,wallet.adminRoles));
      }
      if (path === '/api/token') {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error:'請使用 POST。' }); }
        // JSON-only + no CORS prevents third-party browser forms from using this route.
        // Discord's proxy may omit Origin; authorization codes still must belong to our app.
        if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return json(res, 403, { error:'不允許的登入來源。' });
        if (!/^\d{17,20}$/.test(clientId || '') || !clientSecret?.trim()) return json(res, 503, { error:'登入後端尚未設定完成。' });
        if (activeExchanges >= 8) return json(res, 429, { error:'登入忙碌中，請稍後重試。' });
        activeExchanges++;
        try {
          const body = await readJson(req);
          const code=body?.code;
          if(typeof code!=='string'||!/^[A-Za-z0-9_-]{1,512}$/.test(code))throw fail(400,'缺少有效的 Discord 授權碼。');
          if(wallet)wallet.store.assertGuild(body.guildId);
          const upstream = await fetchImpl('https://discord.com/api/oauth2/token', {
            method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
            body:new URLSearchParams({ client_id:clientId, client_secret:clientSecret, grant_type:'authorization_code', code }),
            signal:AbortSignal.timeout(12000), redirect:'error',
          });
          if (!upstream.ok) return json(res, upstream.status === 429 ? 429 : 502, { error:'Discord 登入未完成，請關閉活動後重試。' });
          const token = await upstream.json();
          if (typeof token.access_token !== 'string' || !token.access_token || !String(token.scope || '').split(' ').includes('identify')) {
            return json(res, 502, { error:'Discord 未提供有效的身分授權。' });
          }
          // Access token exists only for the SDK authentication step; never log or persist it.
          const session=wallet?await wallet.service.create(token,body.guildId):null;
          return json(res, 200, { access_token:token.access_token,...(session?{session}:{}) });
        } finally { activeExchanges--; }
      }
      if(['/api/wallet','/api/spin','/api/checkin','/api/ledger'].includes(path)){
        if(!wallet)return json(res,503,{error:'帳號籌碼尚未開啟。'});
        if(req.headers.origin&&!allowedOrigins.has(req.headers.origin))return json(res,403,{error:'不允許的來源。'});
        const write=path==='/api/spin'||path==='/api/checkin';
        if(req.method!==(write?'POST':'GET'))return json(res,405,{error:'不支援此操作。'});
        const session=await wallet.service.authorize(req.headers.authorization);
        const {guild,user}=session;
        if(path==='/api/wallet')return json(res,200,{state:wallet.store.state(guild,user)});
        if(path==='/api/ledger')return json(res,200,{entries:wallet.store.history(guild,user,Number(new URL(req.url,'http://localhost').searchParams.get('before')||Number.MAX_SAFE_INTEGER))});
        const body=await readJson(req);
        if(path==='/api/checkin')return json(res,200,wallet.store.checkin(guild,user));
        const result=wallet.store.spin(guild,user,body?.bet,body?.requestId);
        try { wallet.highlights?.enqueue(session,result.round.id); }
        catch { console.warn('Discord highlights: could not queue result'); }
        return json(res,200,result);
      }
      if (path.startsWith('/api/')) return json(res, 404, { error:'找不到此功能。' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error:'不支援此操作。' });
      let decoded;
      try { decoded = decodeURIComponent(path); } catch { return json(res, 400, { error:'無效的路徑。' }); }
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(p => p.startsWith('.'))) return json(res, 404, { error:'找不到檔案。' });
      const root = await realpath(distDir);
      const candidate = resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded));
      if (!inside(root, candidate)) return json(res, 404, { error:'找不到檔案。' });
      const file = await realpath(candidate);
      if (!inside(root, file) || !(await stat(file)).isFile()) return json(res, 404, { error:'找不到檔案。' });
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type':types[extname(file)] || 'application/octet-stream', 'Content-Length':data.length, 'X-Content-Type-Options':'nosniff', 'Cache-Control':decoded.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      // Do not echo provider responses, authorization codes, filesystem paths or secrets.
      const status = error.status || (['ENOENT','ENOTDIR'].includes(error.code) ? 404 : 502);
      const cooldown=status===429&&error.code==='SPIN_COOLDOWN';
      if(cooldown&&!res.headersSent)res.setHeader('Retry-After',String(Math.ceil(error.retryAfterMs/1000)));
      if (!res.headersSent) json(res, status, { error:error.status ? error.message : status === 404 ? '找不到檔案。' : '暫時無法完成請求，請稍後重試。',...(cooldown?{code:error.code,retryAfterMs:error.retryAfterMs}:{}) });
      else res.end();
    }
  });
}
