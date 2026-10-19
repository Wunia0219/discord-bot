// Independent path enumeration: no occurrence-count multiplication or runtime
// scorer calls. Only the best eligible length is paid for each ordinary symbol.
export function waysOracle(grid,symbols,paytable,unitBet=1){
  const wins=[];
  for(const symbol of symbols.filter(s=>s!=='wild')){
    let best;
    for(let count=3;count<=5;count++){
      let ways=0;
      for(let key=0;key<3**count;key++){
        let k=key,match=true;
        for(let col=0;col<count;col++){
          const s=grid[col][k%3];k=Math.floor(k/3);
          if(s!==symbol&&s!=='wild'){match=false;break;}
        }
        if(match)ways++;
      }
      if(ways){const multiplier=paytable[symbol][count-3],payout=ways*multiplier*unitBet;if(!best||payout>best.payout)best={symbol,count,ways,multiplier,payout};}
    }
    if(best)wins.push(best);
  }
  return {wins,payout:wins.reduce((n,w)=>n+w.payout,0)};
}
