import test from 'node:test';
import assert from 'node:assert/strict';
import { installSpinShortcut } from '../src/ui/spin-shortcut.js';
import { SpinControls } from '../src/ui/spin-controls.js';

function fixture(){
  const target=new EventTarget();target.defaultView=new EventTarget();
  let blocked=false,modal=false,busy=false,starts=0,stops=0;
  const controls=new SpinControls({isReady:()=>!blocked,isBusy:()=>busy,startSpin:()=>{starts++;busy=true;controls.beginRound();},stopReels:()=>{stops++;},onAutoChange:()=>{}});
  const uninstall=installSpinShortcut({target,controls,isBlocked:()=>blocked,isModalOpen:()=>modal});
  const press=(type,source={},properties={})=>{
    const event=new Event(type,{cancelable:true});
    Object.assign(event,{code:'Space',key:' ',repeat:false,...properties});
    Object.defineProperty(event,'target',{value:{closest:()=>null,...source}});
    target.dispatchEvent(event);return event;
  };
  return {target,controls,press,uninstall,get starts(){return starts;},get stops(){return stops;},
    set blocked(value){blocked=value;},set modal(value){modal=value;},finish(){busy=false;controls.endRound();}};
}

test('Space starts the game from focused history, rules, sound and bet controls without activating them',()=>{
  const h=fixture();
  for(const name of ['all-history','help','sound','music','bet','max-bet','auto-spin']){
    const button={name,closest:selector=>selector==='header,summary'?button:null};
    assert.equal(h.press('keydown',button).defaultPrevented,true,name+' must not retain native Space activation');
    assert.equal(h.press('keyup',button).defaultPrevented,true,name+' must not activate on key release');
    h.finish();
  }
  assert.equal(h.starts,7);assert.equal(h.stops,0);
  const enter=h.press('keydown',{}, {key:'Enter',code:'Enter'});
  assert.equal(enter.defaultPrevented,false,'Enter retains native button activation');
});

test('held Space and quick-stop presses start one round and never re-activate a focused button',()=>{
  const h=fixture();
  h.press('keydown');
  for(let i=0;i<20;i++)h.press('keydown',{}, {repeat:true});
  h.press('keyup');
  for(let i=0;i<20;i++){
    assert.equal(h.press('keydown').defaultPrevented,true);
    assert.equal(h.press('keyup').defaultPrevented,true);
  }
  assert.equal(h.starts,1);assert.equal(h.stops,1);
  h.controls.animationStarted();assert.equal(h.stops,2,'pending quick stop reaches the animation after settlement');
  h.finish();h.press('keydown');h.press('keyup');assert.equal(h.starts,2);
});

test('blocked pages, editable controls, composition, modifiers and already-handled events keep their native keys',()=>{
  const h=fixture();
  h.blocked=true;
  assert.equal(h.press('keydown').defaultPrevented,false);assert.equal(h.press('keyup').defaultPrevented,false);
  h.blocked=false;
  for(const name of ['input','textarea','select','contenteditable','textbox','searchbox','combobox']){
    assert.equal(h.press('keydown',{name,closest:()=>({name})}).defaultPrevented,false,name);
    assert.equal(h.press('keyup').defaultPrevented,false,name);
  }
  for(const property of ['isComposing','altKey','ctrlKey','metaKey','shiftKey']){
    assert.equal(h.press('keydown',{}, {[property]:true}).defaultPrevented,false,property);
  }
  const event=new Event('keydown',{cancelable:true});Object.assign(event,{code:'Space',key:' '});event.preventDefault();h.target.dispatchEvent(event);
  assert.equal(h.starts,0);
});

test('modal Space cannot close the window or leak repeated presses into a new spin',()=>{
  const h=fixture();h.modal=true;
  for(let i=0;i<30;i++){
    assert.equal(h.press('keydown',{id:'close-dialog'},{repeat:i>0}).defaultPrevented,true);
    assert.equal(h.press('keyup',{id:'close-dialog'}).defaultPrevented,true);
  }
  assert.equal(h.starts,0);assert.equal(h.stops,0);
  for(const key of ['Enter','Escape']){
    assert.equal(h.press('keydown',{}, {key,code:key}).defaultPrevented,false);
  }
  for(const name of ['summary','tab']){
    const source={closest:selector=>selector==='summary,[role="tab"]'?{name}:null};
    assert.equal(h.press('keydown',source).defaultPrevented,false);
    assert.equal(h.press('keyup',source).defaultPrevented,false);
  }
  h.modal=false;h.press('keydown');h.press('keyup');assert.equal(h.starts,1);
  h.modal=true;h.finish();h.press('keydown');h.press('keyup');assert.equal(h.starts,1,'reopening a modal keeps Space isolated');
});

test('key release cannot activate a newly focused dialog, and teardown removes shortcut ownership',()=>{
  const h=fixture();h.press('keydown');h.blocked=true;
  assert.equal(h.press('keyup').defaultPrevented,true,'a consumed main-screen press stays consumed if a dialog opens');
  assert.equal(h.press('keydown').defaultPrevented,false);assert.equal(h.press('keyup').defaultPrevented,false,'blocked page presses retain native behavior');
  h.blocked=false;h.finish();h.press('keydown');h.target.defaultView.dispatchEvent(new Event('blur'));
  assert.equal(h.press('keyup').defaultPrevented,false);
  h.uninstall();h.finish();assert.equal(h.press('keydown').defaultPrevented,false);assert.equal(h.starts,2);
});
