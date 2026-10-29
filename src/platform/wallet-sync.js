// Session-only history cache, rebuilt from server rounds; never authorizes wagers.
export function createWalletSync(loadRounds){
  let latest=null,records=[];
  return async function apply(data){
    const state=data?.state;if(!state)return data;
    if(latest&&state.revision<latest.revision)return {...data,state:latest};
    if(Array.isArray(state.history)||!Object.hasOwn(state,'historyRevision')){latest=state;records=[];return data;}
    const target=state.historyRevision;
    if(!Number.isSafeInteger(target)||target<0)throw new Error('遊玩紀錄尚未同步，請稍後再試。');
    const previous=records;let merged=previous;
    // Rebuild sequence tracking when full responses switch back to compact.
    const known=previous.length?(latest?.historyRevision??0):0;
    if(target===0)merged=[];
    else if(target!==known){
      if(data.round&&data.historyBase===known&&data.historyRevision===target){
        merged=[{sequence:target,round:data.round},...previous].slice(0,100);
      }else{
        // Match history to this snapshot, excluding newer cross-device activity.
        let page;
        try{page=await loadRounds({after:known<target?known:0,through:target,limit:100});}
        catch{throw new Error('遊玩紀錄尚未同步，請稍後再試；上一筆操作會沿用原請求確認。');}
        if(!Array.isArray(page.rows)||page.rows[0]?.sequence!==target)throw new Error('遊玩紀錄尚未同步，請稍後再試。');
        merged=[...page.rows,...(known<target?previous:[])].slice(0,100);
      }
    }
    // A slower refresh/history fetch must not replace a more recent settlement.
    if(latest&&state.revision<latest.revision)return {...data,state:latest};
    records=merged;latest={...state,history:records.map(row=>row.round),historyBefore:records.at(-1)?.sequence||0};
    return {...data,state:latest};
  };
}
