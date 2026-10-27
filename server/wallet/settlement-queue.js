import {problem} from './wallet-common.js';

// Only the authoritative transaction is queued. Reads, login and rendering are
// independent. A timeout never cancels a transaction that may have committed.
export class SettlementQueue {
  constructor({limit=32,waitMs=10000}={}){this.limit=limit;this.waitMs=waitMs;this.waiting=[];this.running=false;}
  run(task){
    if(this.waiting.length+Number(this.running)>=this.limit)return Promise.reject(this.busy());
    return new Promise((resolve,reject)=>{
      const item={task,resolve,reject};
      item.timer=setTimeout(()=>{const i=this.waiting.indexOf(item);if(i>=0){this.waiting.splice(i,1);reject(this.busy());}},this.waitMs);
      this.waiting.push(item);this.next();
    });
  }
  busy(){return Object.assign(problem(429,'目前操作較多，請稍後以原請求重試。','SETTLEMENT_BUSY'),{retryAfterMs:1000});}
  next(){
    if(this.running)return;
    const item=this.waiting.shift();if(!item)return;
    clearTimeout(item.timer);this.running=true;
    Promise.resolve().then(item.task).then(item.resolve,item.reject).finally(()=>{this.running=false;this.next();});
  }
}
