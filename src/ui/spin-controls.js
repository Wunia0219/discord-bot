// One owner for queued automatic spins and a stop request made during network
// settlement. Stopping presentation never starts or resettles a round.
export class SpinControls {
  auto=false;
  quickStop=false;
  timer=null;
  constructor({isReady,isBusy,startSpin,stopReels,onAutoChange,schedule=setTimeout,cancel=clearTimeout}){
    Object.assign(this,{isReady,isBusy,startSpin,stopReels,onAutoChange,schedule,cancel});
  }
  clearTimer(){if(this.timer!==null){this.cancel(this.timer);this.timer=null;}}
  beginRound(){this.clearTimer();this.quickStop=false;}
  stopCurrent(){if(this.isBusy()){this.quickStop=true;this.stopReels();}}
  space(){
    if(!this.isReady())return;
    if(this.isBusy()){this.stopCurrent();return;}
    this.clearTimer();this.startSpin();
  }
  animationStarted(){if(this.quickStop)this.stopReels();}
  toggleAuto(){
    if(this.auto){this.stopAuto();return;}
    if(!this.isReady())return;
    this.auto=true;this.onAutoChange(true);
    if(!this.isBusy())this.startSpin();
  }
  stopAuto(){this.clearTimer();if(this.auto){this.auto=false;this.onAutoChange(false);}}
  endRound(delay=650){
    this.clearTimer();
    if(!this.auto)return;
    this.timer=this.schedule(()=>{
      this.timer=null;
      if(!this.isReady()){this.stopAuto();return;}
      if(!this.isBusy())this.startSpin();
    },delay);
  }
}
