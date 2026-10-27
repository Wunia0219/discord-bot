import test from 'node:test';
import assert from 'node:assert/strict';
import {bindSpinButton} from '../src/ui/reels/spin-button.js';
import {SpinControls} from '../src/ui/reels/spin-controls.js';

class Button extends EventTarget{
  disabled=true;attributes={};classList={toggle(){}};
  setAttribute(key,value){this.attributes[key]=value;}
  click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
}
test('repeated pointer clicks during settlement quick-stop one round and preserve its result',async()=>{
  const button=new Button();let busy=false,starts=0,stops=0,release,pending,balance=1000,history=[];
  const response=new Promise(resolve=>release=resolve);
  const controls=new SpinControls({isReady:()=>true,isBusy:()=>busy,onAutoChange(){},stopReels(){stops++;},startSpin(){
    starts++;busy=true;controls.beginRound();render();
    pending=(async()=>{const result=await response;controls.animationStarted();balance=result.balance;history.push(result);busy=false;render();})();
  }});
  const update=bindSpinButton(button,controls),render=()=>update({busy,presenting:false,claiming:false,ready:true});render();
  button.click();assert.equal(button.disabled,false);assert.equal(button.attributes['aria-label'],'快速停輪');
  for(let i=0;i<10;i++)button.click();
  assert.equal(starts,1);assert.equal(stops,1);assert.equal(balance,1000);
  release({balance:920,id:'original-round'});await pending;
  assert.equal(stops,2);assert.equal(starts,1);assert.deepEqual(history,[{balance:920,id:'original-round'}]);assert.equal(balance,920);
});
test('pointer cannot start or skip during loading, checkin or the win presentation',()=>{
  const button=new Button();let activations=0;const update=bindSpinButton(button,{space(){activations++;}});
  for(const state of [{ready:false},{ready:true,claiming:true},{ready:true,busy:true,presenting:true}]){update(state);button.click();}
  assert.equal(activations,0);
  update({ready:true,busy:false,presenting:false,claiming:false});button.click();assert.equal(activations,1);
});
