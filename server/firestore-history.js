// Merge existing daily indexes without assuming that ledger IDs follow calendar
// days (a server clock can move backwards). Each query uses the same ID cursor.
export async function readAuditPage({query,category,days,before,limit=11}){
  const collection=category==='all'?'ledger':`entries-${category}`;
  if(!days.length)return query(collection,before,limit);
  if(days.length===1)return query(`entries-${category}-${days[0]}`,before,limit);

  // Most active accounts fit in one lifetime-index page. This is also enough
  // to answer sparse accounts in full, including accounts with no recent rows.
  const recent=await query(collection,before,limit),allowed=new Set(days);
  const rows=recent.filter(row=>allowed.has(row.day));
  if(recent.length<limit||rows.length===limit)return rows;
  const cursor=recent.at(-1).id,streams=[];
  // Bound concurrency and await all in-flight reads before reporting failure.
  for(let start=0;start<days.length;start+=5){
    const batch=await Promise.allSettled(days.slice(start,start+5).map(async day=>{
      const name=`entries-${category}-${day}`;
      return {name,head:(await query(name,cursor,1))[0]};
    }));
    for(const result of batch){if(result.status==='rejected')throw result.reason;streams.push(result.value);}
  }
  while(rows.length<limit){
    streams.sort((a,b)=>(b.head?.id||0)-(a.head?.id||0));
    const stream=streams[0];if(!stream?.head)break;
    const row=stream.head;rows.push(row);
    if(rows.length<limit)stream.head=(await query(stream.name,row.id,1))[0];
  }
  return rows;
}
