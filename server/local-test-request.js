export function isLocalTestRequest(req){
  const port=req.socket.localPort, origin=`http://127.0.0.1:${port}`;
  return req.socket.localAddress==='127.0.0.1'&&req.socket.remoteAddress==='127.0.0.1'
    &&req.headers.host===`127.0.0.1:${port}`
    &&(!req.headers.origin||req.headers.origin===origin)
    &&(!req.headers['sec-fetch-site']||req.headers['sec-fetch-site']==='same-origin'||req.headers['sec-fetch-site']==='none')
    &&!Object.keys(req.headers).some(key=>key==='forwarded'||key.startsWith('x-forwarded-')||key==='cf-connecting-ip');
}
