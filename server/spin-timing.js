// Aggregate timings only: no player identity, bets, outcomes or persistent writes.
// The sample window restarts when the Worker instance is reconstructed.
export class SpinTimings {
  samples=[];
  record({requestMs,settlementMs,duplicate}={}){
    if(duplicate||![requestMs,settlementMs].every(ms=>Number.isFinite(ms)&&ms>=0))return;
    this.samples.push({requestMs,settlementMs});
    if(this.samples.length>50)this.samples.shift();
  }
  snapshot(){
    const count=this.samples.length,round=ms=>Math.round(ms*10)/10;
    const stats=key=>{
      if(!count)return null;
      const values=this.samples.map(sample=>sample[key]).sort((a,b)=>a-b);
      return {meanMs:round(values.reduce((a,b)=>a+b,0)/count),p95Ms:round(values[Math.ceil(count*.95)-1]),lastMs:round(this.samples.at(-1)[key])};
    };
    return {samples:count,maximumSamples:50,persistent:false,handler:stats('requestMs'),settlement:stats('settlementMs')};
  }
}
