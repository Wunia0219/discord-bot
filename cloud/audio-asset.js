// Workers Static Assets may ignore Range. Supply byte ranges for mobile audio.
export async function audioAsset(request,assets){
  if(request.method==='HEAD')return assets.fetch(request);
  const incoming=request.headers,headers=new Headers(incoming);
  headers.delete('range');headers.delete('if-range');
  const asset=await assets.fetch(new Request(request,{method:'GET',headers}));
  if(asset.status!==200)return asset;
  const data=new Uint8Array(await asset.arrayBuffer()),out=new Headers(asset.headers);
  out.set('Accept-Ranges','bytes');out.set('Content-Length',String(data.length));
  let status=200,body=data;
  const validator=incoming.get('if-range');
  const range=request.method==='GET'&&(!validator||validator===out.get('etag')||validator===out.get('last-modified'))&&/^bytes=(\d*)-(\d*)$/.exec(incoming.get('range')||'');
  if(range&&(range[1]||range[2])){
    const first=range[1]?Number(range[1]):Math.max(0,data.length-Number(range[2]));
    const last=range[1]&&range[2]?Number(range[2]):data.length-1;
    if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first>=data.length||last<first){
      out.set('Content-Range',`bytes */${data.length}`);out.set('Content-Length','0');
      return new Response(null,{status:416,headers:out});
    }
    const end=Math.min(last,data.length-1);body=data.subarray(first,end+1);status=206;
    out.set('Content-Range',`bytes ${first}-${end}/${data.length}`);out.set('Content-Length',String(body.length));
  }
  return new Response(body,{status,headers:out});
}
