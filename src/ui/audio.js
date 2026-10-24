import {cueVoices,EFFECTS_VOLUME} from './audio-cues.js';

const defaultContext=()=>{
  const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
  return Audio?new Audio():null;
};

export class Sound {
  enabled=false;
  musicEnabled=false;
  context=null;
  effectsGain=null;
  voices=new Set();
  suspended=false;
  effectsRequest=0;
  musicRequest=0;

  constructor({contextFactory=defaultContext,musicUrl=null,musicFactory=url=>new globalThis.Audio(url),isHidden=()=>globalThis.document?.hidden===true,onStateChange=()=>{}}={}){
    Object.assign(this,{contextFactory,isHidden,onStateChange});
    this.music=musicUrl?musicFactory(musicUrl):null;
    if(this.music){
      this.music.loop=true;this.music.preload='none';this.music.volume=.16;
      this.music.addEventListener('error',()=>{this.musicEnabled=false;this.music.pause();this.changed();});
    }
  }
  get musicAvailable(){return !!this.music;}
  get state(){return {effectsEnabled:this.enabled,musicEnabled:this.musicEnabled,musicAvailable:this.musicAvailable};}
  changed(){this.onStateChange(this.state);}
  async prepareContext(){
    this.context ||= this.contextFactory();
    if(!this.context)return false;
    if(!this.effectsGain){this.effectsGain=this.context.createGain();this.effectsGain.gain.value=0;this.effectsGain.connect(this.context.destination);}
    await this.context.resume();
    return this.context.state==='running';
  }
  async setEffectsEnabled(enabled){
    const request=++this.effectsRequest;
    if(!enabled){this.enabled=false;this.stopEffects();this.changed();return false;}
    try{
      const ready=await this.prepareContext();
      if(request!==this.effectsRequest)return this.enabled;
      this.enabled=ready;
      if(ready)this.effectsGain.gain.setValueAtTime(EFFECTS_VOLUME,this.context.currentTime);
    }catch{if(request===this.effectsRequest)this.enabled=false;}
    if(request===this.effectsRequest&&!this.enabled)this.stopEffects();
    this.changed();return this.enabled;
  }
  enable(){return this.setEffectsEnabled(true);}
  async setMusicEnabled(enabled){
    const request=++this.musicRequest;
    if(!enabled||!this.music){this.musicEnabled=false;this.music?.pause();this.changed();return false;}
    this.musicEnabled=true;
    if(this.suspended||this.isHidden()){this.changed();return true;}
    try{
      await this.music.play();
      if(!this.musicEnabled||this.suspended||this.isHidden())this.music.pause();
    }catch{if(request===this.musicRequest)this.musicEnabled=false;}
    this.changed();return this.musicEnabled;
  }
  stopEffects(){
    const now=this.context?.currentTime||0;
    if(this.effectsGain){this.effectsGain.gain.cancelScheduledValues(now);this.effectsGain.gain.setTargetAtTime(0,now,.004);}
    this.cancelCues();
  }
  cancelCues(){for(const voice of [...this.voices])voice.stop();}
  play(kind,index=0){
    if(!this.enabled||!this.context||this.context.state!=='running'||this.suspended||this.isHidden())return;
    const context=this.context;
    for(const voice of cueVoices(kind,index)){
      while(this.voices.size>=96)this.voices.values().next().value.stop();
      const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+voice.at;
      oscillator.type='sine';oscillator.frequency.setValueAtTime(voice.frequency,start);
      oscillator.frequency.exponentialRampToValueAtTime(voice.frequencyEnd,start+voice.duration);
      gain.gain.setValueAtTime(0,start);
      gain.gain.linearRampToValueAtTime(voice.volume,start+voice.attack);
      gain.gain.setValueAtTime(voice.volume,start+voice.attack+voice.hold);
      gain.gain.exponentialRampToValueAtTime(.00001,start+voice.duration);
      const panner=context.createStereoPanner?.();
      oscillator.connect(gain);
      if(panner){panner.pan.setValueAtTime(voice.pan,start);gain.connect(panner);panner.connect(this.effectsGain);}
      else gain.connect(this.effectsGain);
      let stopped=false;
      const handle={stop:()=>{
        if(stopped)return;stopped=true;this.voices.delete(handle);
        gain.gain.cancelScheduledValues(context.currentTime);
        gain.gain.setTargetAtTime(0,context.currentTime,.004);
        try{oscillator.stop(context.currentTime+(this.suspended?0:.015));}catch{ /* An ended voice is already silent. */ }
      }};
      oscillator.onended=()=>{this.voices.delete(handle);oscillator.disconnect();gain.disconnect();panner?.disconnect();};
      this.voices.add(handle);
      oscillator.start(start);oscillator.stop(start+voice.duration+.005);
    }
  }
  spin(){this.play('spin');}
  stop(index){this.play('stop',index);}
  win(kind='small'){this.play(kind===true?'big':kind===false?'small':kind);}
  async setVisible(visible){
    this.suspended=!visible;
    if(!visible){
      this.stopEffects();this.music?.pause();
      try{await this.context?.suspend();}catch{ /* Visibility must never interrupt the game. */ }
      return;
    }
    if(this.enabled)await this.setEffectsEnabled(true);
    if(this.musicEnabled)await this.setMusicEnabled(true);
  }
  dispose(){
    ++this.effectsRequest;++this.musicRequest;
    this.enabled=false;this.musicEnabled=false;this.stopEffects();this.music?.pause();
    this.context?.close().catch(()=>{});
  }
}
