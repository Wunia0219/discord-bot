import {AnimatedSprite,Assets,Sprite,Spritesheet} from 'pixi.js';
import standinUrl from '../../../images/dealer/dealer-standin.webp';
import {dealerPlacement,dealerFrameSequence} from './dealer-motion.js';

const permanent=new Set(['idle']);
let nextDealerId=0;

export class Dealer {
  cache=new Map();pending=new Map();releasing=new Map();
  releaseTimers=new Map();cacheGraceMs=30000;
  request=0;action='idle';desired='idle';future=null;elapsed=0;disposed=false;
  visible=true;

  constructor({resolvePage=page=>page.file,resolution=1,motionManifest=null,uploadTextures=async()=>{},canRelease=()=>true}={}){
    Object.assign(this,{resolvePage,resolution,motionManifest,uploadTextures,canRelease});
    this.cacheId=++nextDealerId;
    this.standin={url:standinUrl,status:'idle',texture:null,task:null,scale:1,error:null};
  }

  async prepare(name){
    if(!this.motionManifest)return null;
    this.cancelRelease(name);
    await this.releasing.get(name);
    if(this.disposed)throw new Error('Dealer disposed');
    if(this.cache.has(name))return this.cache.get(name);
    if(this.pending.has(name))return this.pending.get(name);
    const clip=this.motionManifest.clips[name];
    if(!clip)throw new Error('Unknown dealer motion');
    const task=(async()=>{
      const loaded=[];
      try{
        // Wait for every page before cleanup, including pages finishing after a failure.
        const pages=await Promise.allSettled(clip.pages.map(async(page,index)=>{
          const url=this.resolvePage(page);
          if(!url)throw new Error('Missing dealer atlas');
          const texture=await Assets.load(url);
          const resource={url,sheet:null};loaded.push(resource);
          const factor=this.resolution;
          const scaled=value=>Object.fromEntries(Object.entries(value).map(([key,v])=>[key,v*factor]));
          const frames=Object.fromEntries(Object.entries(page.frames).map(([key,value])=>[key,{frame:scaled(value.frame),sourceSize:scaled(value.sourceSize),spriteSourceSize:scaled(value.spriteSourceSize)}]));
          const sheet=new Spritesheet({texture,data:{frames,meta:{...page.meta,size:scaled(page.meta.size),scale:String(factor),image:page.file}},cachePrefix:`dealer-${this.cacheId}-${factor}-${name}-${index}-`});
          resource.sheet=sheet;
          await sheet.parse();return {sheet,url};
        }));
        const failed=pages.find(page=>page.status==='rejected');
        if(failed)throw failed.reason;
        const sheets=pages.map(page=>page.value);
        const textures=dealerFrameSequence(clip,this.motionManifest.fps).map(({key,pageIndex,durationMs})=>({texture:sheets[pageIndex].sheet.textures[key],time:durationMs}));
        await this.uploadTextures(textures.map(frame=>frame.texture));
        const result={...clip,frames:textures.length,durationMs:textures.reduce((sum,frame)=>sum+frame.time,0),sheets,textures};
        if(this.disposed)throw new Error('Dealer disposed');
        this.cache.set(name,result);
        return result;
      }catch(error){
        await this.unload(loaded).catch(cleanup=>console.warn('Dealer resource cleanup unavailable:',cleanup.message));
        throw error;
      }
    })();
    this.pending.set(name,task);
    try{return await task;}finally{this.pending.delete(name);}
  }

  async init(){
    if(this.disposed)throw new Error('Dealer disposed');
    if(!this.motionManifest){
      this.standin.status='loading';
      const task=Assets.load(this.standin.url);this.standin.task=task;
      try{
        const texture=await task;this.standin.texture=texture;
        if(this.disposed)throw new Error('Dealer disposed');
        // Fit the artwork without changing its aspect ratio.
        this.standin.scale=Math.min(256/texture.width,384/texture.height);
        this.sprite=new Sprite({texture});
        this.sprite.anchor.set(.5,636/672);this.sprite.scale.set(this.standin.scale);
        this.sprite.label='命運荷官（靜態原畫）';this.sprite.eventMode='none';this.sprite.visible=this.visible;
        this.standin.status='ready';return this.sprite;
      }catch(error){
        this.standin.error=error.message;
        if(!this.disposed)this.standin.status='failed';
        throw error;
      }finally{this.standin.task=null;}
    }
    const idle=await this.prepare('idle');
    this.sprite=new AnimatedSprite({textures:idle.textures,autoUpdate:false,loop:true,animationSpeed:1});
    this.sprite.anchor.set(...this.motionManifest.anchor);
    this.sprite.label='命運荷官';this.sprite.eventMode='none';
    this.sprite.visible=this.visible;
    this.sprite.play();
    return this.sprite;
  }

  preload(name){
    if(this.disposed||!this.motionManifest||!this.visible&&name!=='idle')return;
    if(!permanent.has(name))this.future=name;
    this.prepare(name).then(()=>this.prune()).catch(error=>{if(!this.disposed)console.warn('Dealer motion unavailable:',name,error.message);});
  }

  async play(name,{reduced=this.reduced,restart=false}={}){
    if(this.disposed)return;
    if(!this.motionManifest){
      this.action=this.desired='idle';this.future=null;this.reduced=reduced;return;
    }
    if(this.disposed||!this.visible&&name!=='idle')return;
    // Repeated events must not rewind an active idle loop.
    if(!restart&&name==='idle'&&this.action==='idle'&&this.desired==='idle'&&this.sprite?.playing&&this.sprite.loop&&this.visible&&this.reduced===reduced)return;
    const request=++this.request;this.desired=name;
    try{
      const clip=await this.prepare(name);
      if(request!==this.request||this.disposed){this.prune();return;}
      this.action=name;this.elapsed=0;this.reduced=reduced;
      if(this.future===name)this.future=null;
      this.sprite.stop();this.sprite.textures=clip.textures;this.sprite.loop=clip.loop;
      this.sprite.onComplete=()=>{if(request===this.request&&!this.disposed)this.play('idle');};
      if(reduced||!this.visible)this.sprite.gotoAndStop(clip.loop?0:Math.floor(clip.frames/2));
      else this.sprite.gotoAndPlay(0);
      this.prune();
    }catch(error){if(!this.disposed)console.warn('Dealer animation unavailable:',name,error.message);}
  }

  update(ticker,reduced){
    if(this.disposed)return;
    if(!this.motionManifest){this.reduced=reduced;return;}
    if(!this.sprite||this.disposed||!this.visible)return;
    if(this.reduced!==reduced){this.play(this.action,{reduced});return;}
    if(!reduced){this.sprite.update(ticker);return;}
    this.elapsed+=Math.max(0,ticker.deltaMS);
    const clip=this.cache.get(this.action)??this.motionManifest.clips[this.action];
    if(!clip.loop&&this.elapsed>=clip.durationMs)this.play('idle',{reduced:true});
  }

  layout(width){
    if(!this.sprite||this.disposed)return;
    const {x,y,scale}=dealerPlacement(width);
    const assetScale=this.motionManifest?256/(this.motionManifest.frameSize[0]*this.resolution):this.standin.scale;
    this.sprite.position.set(x,y);this.sprite.scale.set(scale*assetScale);
  }

  setVisible(visible){
    if(this.disposed)return;
    this.visible=visible;this.future=null;
    if(this.sprite)this.sprite.visible=visible;
    this.play('idle',{restart:true});
  }

  prune(){
    if(this.disposed)return;
    for(const name of this.cache.keys()){
      if(this.retained(name))this.cancelRelease(name);
      else if(!this.visible)this.release(name).catch(error=>console.warn('Dealer resource release unavailable:',error.message));
      else if(!this.releaseTimers.has(name))this.scheduleRelease(name,this.cacheGraceMs);
    }
  }

  retained(name){return permanent.has(name)||[this.action,this.desired,this.future].includes(name);}

  cancelRelease(name){clearTimeout(this.releaseTimers.get(name));this.releaseTimers.delete(name);}

  scheduleRelease(name,delay){
    const timer=setTimeout(()=>{
      this.releaseTimers.delete(name);
      if(this.disposed||this.retained(name)||!this.cache.has(name))return;
      // Reuse recent gestures, then release only outside reel travel/landing.
      if(this.visible&&!this.canRelease()){this.scheduleRelease(name,250);return;}
      this.release(name).catch(error=>console.warn('Dealer resource release unavailable:',error.message));
    },delay);
    this.releaseTimers.set(name,timer);
  }

  async unload(resources){
    const results=await Promise.allSettled(resources.map(async({sheet,url})=>{
      try{sheet?.destroy(false);}finally{await Assets.unload(url);}
    }));
    const failed=results.find(result=>result.status==='rejected');
    if(failed)throw failed.reason;
  }

  async release(name){
    this.cancelRelease(name);
    const clip=this.cache.get(name);if(!clip)return;
    this.cache.delete(name);
    const task=this.unload(clip.sheets);
    this.releasing.set(name,task);
    try{await task;}finally{this.releasing.delete(name);}
  }

  async destroy(){
    if(this.destroyTask)return this.destroyTask;
    this.disposed=true;++this.request;this.sprite?.destroy();
    for(const name of this.releaseTimers.keys())this.cancelRelease(name);
    this.destroyTask=(async()=>{
      await Promise.allSettled([...this.pending.values(),this.standin.task].filter(Boolean));
      await Promise.all([...this.cache.keys()].map(name=>this.release(name)));
      await Promise.all([...this.releasing.values()]);
      if(this.standin.texture){
        await Assets.unload(this.standin.url);this.standin.texture=null;
      }
      this.standin.status='released';
    })();
    return this.destroyTask;
  }
}
