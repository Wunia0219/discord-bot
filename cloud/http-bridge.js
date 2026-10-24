import {EventEmitter} from 'node:events';
// Reuse the Node API handler, including byte limits and private Discord replies.
// Static assets are handled by the outer Worker and never reach filesystem routes.
export function handleFetch(handler,request){
  return new Promise((resolve,reject)=>{
    const headers=Object.fromEntries(request.headers),url=new URL(request.url);
    const req={headers,method:request.method,url:url.pathname+url.search,socket:{localPort:4188,remoteAddress:'cloud',localAddress:'cloud'},async *[Symbol.asyncIterator](){if(!request.body)return;const reader=request.body.getReader();try{for(;;){const {value,done}=await reader.read();if(done)break;yield Buffer.from(value);}}finally{reader.releaseLock();}}};
    const responseHeaders=new Headers(),res=new EventEmitter();let ended=false;
    Object.assign(res,{headersSent:false,statusCode:200,setHeader:(k,v)=>responseHeaders.set(k,String(v)),writeHead:(status,h={})=>{res.statusCode=status;for(const [k,v] of Object.entries(h))responseHeaders.set(k,String(v));res.headersSent=true;},end:body=>{if(ended)return;ended=true;res.headersSent=true;resolve(new Response(request.method==='HEAD'?null:body??null,{status:res.statusCode,headers:responseHeaders}));res.emit('finish');}});
    Promise.resolve(handler(req,res)).catch(reject);
  });
}
