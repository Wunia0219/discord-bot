// Preview-only transport controls. Dealer keeps its normal game completion rules.
export class DealerPreviewControls {
  paused=false;repeat=true;selected='idle';loading=false;
  _selection=0;_seekMiddle=false;

  constructor(dealer,clips,onChange=()=>{}){
    Object.assign(this,{dealer,clips,onChange});
  }

  async select(name){
    if(!this.clips[name])throw new RangeError('Unknown dealer preview motion: '+name);
    const request=++this._selection;
    this.selected=name;this.paused=false;this.loading=true;this._seekMiddle=false;
    this.onChange();
    try{
      await this.dealer.play(name,{reduced:false,restart:true});
      if(request!==this._selection)return false;
      // Dealer intentionally logs game asset failures instead of rejecting.
      // Do not relabel or restart the old sprite when activation did not happen.
      if(this.dealer.action!==name)throw new Error('Dealer motion was not activated: '+name);
      this.loading=false;
      const sprite=this.dealer.sprite;
      sprite.loop=this.clips[name].loop||this.repeat;
      sprite.gotoAndPlay(0);
      // A pause or middle-frame request made while loading takes precedence.
      if(this.paused)sprite.gotoAndStop(this._seekMiddle?Math.floor(sprite.totalFrames/2):0);
      this.onChange();
      return true;
    }catch(error){
      if(request!==this._selection)return false;
      if(this.clips[this.dealer.action])this.selected=this.dealer.action;
      this.loading=false;this.onChange();
      throw error;
    }
  }

  setPaused(value){
    this.paused=Boolean(value);
    if(this.paused)this.dealer.sprite.stop();
    else {this._seekMiddle=false;this.dealer.sprite.play();}
    this.onChange();
  }

  togglePaused(){this.setPaused(!this.paused);}

  showMiddle(){
    this.paused=true;this._seekMiddle=true;
    const sprite=this.dealer.sprite;
    sprite.gotoAndStop(Math.floor(sprite.totalFrames/2));
    this.onChange();
  }

  setRepeat(value){
    this.repeat=Boolean(value);
    const clip=this.clips[this.dealer.action??this.selected];
    if(!this.loading&&clip)this.dealer.sprite.loop=clip.loop||this.repeat;
    this.onChange();
  }

  tick(ticker){
    if(!this.paused&&!this.loading)this.dealer.update(ticker,false);
  }
}
