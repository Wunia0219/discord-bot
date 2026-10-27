import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, extname, sep, isAbsolute } from 'node:path';
import { validSignature, handleCommand } from './commands.js';
import { privateReply } from './bot-replies.js';
import { MODEL_VERSION } from '../src/game/slot-math.js';
import { isLocalTestRequest } from './local-test-request.js';
import { discordConfigurationReady } from './discord-config.js';
import { LoginRateLimit } from './login-rate-limit.js';
import { randomUUID } from 'node:crypto';
import {completeDeferredCommand,validInteractionToken} from './deferred-command.js';
import {deferWalletInteraction} from './discord-panel.js';

const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.webp':'image/webp', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json', '.woff2':'font/woff2', '.mp3':'audio/mpeg' };
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
export function createActivityHandler({ clientId, clientSecret, publicKey, wallet=null, localPort=4188, distDir = resolve('dist'), fetchImpl = fetch, loginClock, loginLimiter, defer=()=>{}, operations=null } = {}) {
  if(!Number.isInteger(localPort)||localPort<1||localPort>65535)throw new Error('Invalid local port');
  let activeExchanges = 0;
  const loginRate = loginLimiter || new LoginRateLimit({clock:loginClock});
  const deferredCommands=new Set();
  const loginLimited = (res, delay, message='登入嘗試太頻繁，請稍後再試。') => {
    res.setHeader('Retry-After',String(Math.max(1,Math.ceil(delay/1000))));
    return json(res,429,{error:message});
  };
  const allowedOrigins = new Set([`https://${clientId}.discordsays.com`, 'http://127.0.0.1:4187', 'http://127.0.0.1:4188', `http://127.0.0.1:${localPort}`]);
  const handler=async (req, res) => {
    let route='static',errorCode;
    if(operations){
      const started=performance.now(),requestId=randomUUID();res.setHeader('X-Request-Id',requestId);
      res.once('finish',()=>operations.recordRequest({requestId,route,errorCode,
        method:['GET','HEAD','POST','OPTIONS'].includes(req.method)?req.method:'OTHER',status:res.statusCode,durationMs:performance.now()-started}));
    }
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if(['/healthz','/readyz','/api/token','/api/interactions','/api/wallet','/api/spin','/api/checkin','/api/ledger','/api/rounds'].includes(path))route=path;
      else if(path.startsWith('/api/'))route='unknown-api';
      if(wallet?.localTest&&!isLocalTestRequest(req))return json(res,403,{error:'此測試服務只限這台電腦使用。'});
      if(wallet?.localTest&&path==='/'&&['GET','HEAD'].includes(req.method)&&new URL(req.url,'http://localhost').searchParams.get('wallet')!=='local'){
        res.writeHead(302,{Location:'/?wallet=local','Cache-Control':'no-store'});return res.end();
      }
      if(path==='/wallet-test'||path==='/api/local-test'){
        if(!wallet?.localTest)return json(res,404,{error:'找不到此功能。'});
        if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'請使用 GET 或 HEAD。'});
        if(path==='/api/local-test')return json(res,200,await wallet.localOverview());
        const page=await readFile(new URL('./local-test.html',import.meta.url));
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':page.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
        return res.end(req.method==='HEAD'?undefined:page);
      }
      if(path==='/api/local-session'){
        if(!wallet?.localTest)return json(res,404,{error:'找不到此功能。'});
        if(req.method!=='POST')return json(res,405,{error:'請使用 POST。'});
        // Require an exact origin as well as loopback/Host checks for session creation.
        if(req.headers.origin!==`http://127.0.0.1:${req.socket.localPort}`)return json(res,403,{error:'不允許的登入來源。'});
        const body=await readJson(req);
        return json(res,200,wallet.service.createLocal(body?.profile));
      }
      if(wallet?.localTest&&['/api/token','/api/interactions'].includes(path))return json(res,404,{error:'本機測試入口不提供 Discord 登入。'});
      if(path==='/healthz')return json(res,200,{ok:true,model:MODEL_VERSION});
      if(path==='/readyz'){
        if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'請使用 GET 或 HEAD。'});
        const ready=(await wallet?.store.isReady())===true
          && (wallet.localTest===true || discordConfigurationReady({clientId,clientSecret,publicKey}))
          && (!operations||operations.isReady());
        return json(res,ready?200:503,{ok:ready});
      }
      if(path==='/api/interactions'){
        if(req.method!=='POST')return json(res,405,{error:'請使用 POST。'});
        let size=0;const chunks=[];
        for await(const chunk of req){size+=chunk.length;if(size>65536)return json(res,413,{error:'請求過大。'});chunks.push(chunk);}
        const raw=Buffer.concat(chunks);
        if(!validSignature(publicKey,req.headers,raw))return json(res,401,{error:'無效的 Discord 簽章。'});
        let interaction;try{interaction=JSON.parse(raw.toString('utf8'));}catch{return json(res,400,{error:'無效的請求。'});}
        if(interaction.type===1)return json(res,200,{type:1});
        if(interaction.application_id!==clientId)return json(res,403,{error:'應用程式不符。'});
        if(!wallet)return json(res,200,privateReply(null,'過一會兒再試試。如果一直連不上，請找管理員幫忙看看。','戲籌暫時連不上','warning'));
        if(wallet.store.backend==='firestore'&&deferWalletInteraction(interaction)){
          if(!validInteractionToken(interaction.token))return json(res,400,{error:'無效的互動憑證。'});
          json(res,200,interaction.type===3&&((interaction.message?.flags||0)&64)?{type:6}:{type:5,data:{flags:64}});
          const work=completeDeferredCommand(interaction,wallet,{fetchImpl}).catch(()=>console.warn('Discord command reply unavailable'));
          deferredCommands.add(work);defer(work);void work.finally(()=>deferredCommands.delete(work));return;
        }
        return json(res,200,await handleCommand(interaction,wallet.store,wallet.adminRoles,wallet.commandChannelIds));
      }
      if (path === '/api/token') {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error:'請使用 POST。' }); }
        // JSON-only + no CORS prevents third-party browser forms from using this route.
        // Discord's proxy may omit Origin; authorization codes still must belong to our app.
        if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return json(res, 403, { error:'不允許的登入來源。' });
        if (!/^\d{17,20}$/.test(clientId || '') || !clientSecret?.trim()) return json(res, 503, { error:'登入後端尚未設定完成。' });
        if (activeExchanges >= 8) return loginLimited(res,1000,'登入忙碌中，請稍後重試。');
        const retryAfterMs=loginRate.take();
        if(retryAfterMs>0)return loginLimited(res,retryAfterMs);
        activeExchanges++;
        let succeeded=false;
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
          if (!upstream.ok) {
            if(upstream.status===429){
              const seconds=Number(upstream.headers.get('Retry-After'));
              const delay=Number.isFinite(seconds)&&seconds>0&&seconds<=3600?Math.max(1000,Math.ceil(seconds*1000)):60000;
              loginRate.defer(delay);
              return loginLimited(res,delay,'Discord 登入忙碌中，請稍後再試。');
            }
            return json(res,502,{error:'Discord 登入未完成，請關閉活動後重試。'});
          }
          const token = await upstream.json();
          if (typeof token.access_token !== 'string' || !token.access_token || !String(token.scope || '').split(' ').includes('identify')) {
            return json(res, 502, { error:'Discord 未提供有效的身分授權。' });
          }
          // Node keeps membership tokens in memory; cloud sessions use encrypted storage. Never log tokens.
          const session=wallet?await wallet.service.create(token,body.guildId):null;
          succeeded=true;
          return json(res, 200, { access_token:token.access_token,...(session?{session}:{}) });
        } finally { if(!succeeded)loginRate.failed();activeExchanges--; }
      }
      if(['/api/wallet','/api/spin','/api/checkin','/api/ledger','/api/rounds'].includes(path)){
        if(!wallet)return json(res,503,{error:'帳號戲籌尚未開啟。'});
        if(!wallet.localTest&&req.headers.origin&&!allowedOrigins.has(req.headers.origin))return json(res,403,{error:'不允許的來源。'});
        const write=path==='/api/spin'||path==='/api/checkin';
        if(req.method!==(write?'POST':'GET'))return json(res,405,{error:'不支援此操作。'});
        const session=await wallet.service.authorize(req.headers.authorization);
        const {guild,user}=session;
        const view={compact:req.headers['x-wallet-view']==='compact-v1'};
        if(path==='/api/wallet')return json(res,200,{state:await wallet.store.state(guild,user,view)});
        if(path==='/api/rounds'){
          if(wallet.store.schemaVersion!==2)return json(res,400,{error:'請重新開啟遊玩紀錄。'});
          const params=new URL(req.url,'http://localhost').searchParams,options={};
          for(const key of ['after','before','through','limit'])if(params.has(key))options[key]=Number(params.get(key));
          return json(res,200,await wallet.store.rounds(guild,user,options));
        }
        if(path==='/api/ledger')return json(res,200,{entries:await wallet.store.history(guild,user,Number(new URL(req.url,'http://localhost').searchParams.get('before')||Number.MAX_SAFE_INTEGER))});
        const body=await readJson(req);
        if(path==='/api/checkin')return json(res,200,await wallet.store.checkin(guild,user,view));
        const result=await wallet.store.spin(guild,user,body?.bet,body?.requestId,{...view,profileName:session.profile?.name});
        try { wallet.highlights?.enqueue(session,result.round.id,result.round); }
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
      const headers = { 'Content-Type':types[extname(file)] || 'application/octet-stream', 'Content-Length':data.length, 'X-Content-Type-Options':'nosniff', 'Cache-Control':decoded.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
      let status=200,body=data;
      // iOS media playback probes and seeks with single byte-range GETs.
      if(extname(file)==='.mp3'){
        headers['Accept-Ranges']='bytes';
        const range=req.method==='GET'&&!req.headers['if-range']&&/^bytes=(\d*)-(\d*)$/.exec(req.headers.range||'');
        if(range&&(range[1]||range[2])){
          const first=range[1]?Number(range[1]):Math.max(0,data.length-Number(range[2]));
          const last=range[1]&&range[2]?Number(range[2]):data.length-1;
          if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first>=data.length||last<first){
            res.writeHead(416,{...headers,'Content-Range':`bytes */${data.length}`,'Content-Length':0});return res.end();
          }
          const end=Math.min(last,data.length-1);
          body=data.subarray(first,end+1);status=206;
          headers['Content-Range']=`bytes ${first}-${end}/${data.length}`;headers['Content-Length']=body.length;
        }
      }
      res.writeHead(status,headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      errorCode=['SQLITE_ERROR','SQLITE_BUSY','SQLITE_FULL','SQLITE_CORRUPT','EIO','EACCES','ENOSPC','ENOENT','ENOTDIR'].includes(error.code)?error.code:'UNEXPECTED_ERROR';
      // Do not echo provider responses, authorization codes, filesystem paths or secrets.
      const status = error.status || (['ENOENT','ENOTDIR'].includes(error.code) ? 404 : 502);
      const cooldown=status===429&&['SPIN_COOLDOWN','SETTLEMENT_BUSY'].includes(error.code);
      if(cooldown&&!res.headersSent)res.setHeader('Retry-After',String(Math.ceil(error.retryAfterMs/1000)));
      if (!res.headersSent) json(res, status, { error:error.status ? error.message : status === 404 ? '找不到檔案。' : '暫時無法完成請求，請稍後重試。',...(cooldown?{code:error.code,retryAfterMs:error.retryAfterMs}:{}) });
      else res.end();
    }
  };
  handler.drainCommands=()=>Promise.allSettled([...deferredCommands]);
  return handler;
}
