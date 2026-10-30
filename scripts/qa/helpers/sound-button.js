import assert from 'node:assert/strict';

export async function clickSoundButton(page,{timeout}={}){
  // This header control must be reachable without scrolling. Keep Playwright's
  // actionability and hit-target checks, avoiding the CDP scroll command that
  // stalled before the click was dispatched in the Windows Chromium run.
  await page.locator('#sound').click({scroll:'none',...(timeout===undefined?{}:{timeout})});
}

export async function verifySoundButtonInput(browser){
  const context=await browser.newContext({viewport:{width:640,height:480}});
  const page=await context.newPage(),checks=[];
  const fixture=async({attributes='',style='',overlay=''}={})=>{
    await page.setContent(`<style>
      html,body{margin:0}button{position:absolute;top:16px;left:16px;width:48px;height:48px}
      ${style}
    </style><button id="sound" ${attributes}>音效</button>${overlay}`);
    await page.evaluate(()=>{
      window.soundClicks=[];
      document.addEventListener('click',event=>{if(event.target.closest('#sound'))soundClicks.push(event.isTrusted);},true);
      // Match the real handler: temporarily disabling the button must not hide
      // the input from the capture-phase observer.
      const button=document.querySelector('#sound');
      button.addEventListener('click',()=>{button.disabled=true;});
    });
  };
  try{
    await fixture();await clickSoundButton(page);
    assert.deepEqual(await page.evaluate(()=>soundClicks),[true],'one trusted pointer click');
    checks.push('visible sound control receives one trusted click');
    for(const [name,setup,reason] of [
      ['disabled',{attributes:'disabled'},/element is not enabled/],
      ['covered',{overlay:'<div style="position:fixed;inset:0;z-index:10"></div>'},/intercepts pointer events/],
      ['outside viewport',{style:'#sound{top:1000px}'},/outside of the viewport/],
      ['hidden',{style:'#sound{visibility:hidden}'},/element is not visible/],
      ['moving',{style:'@keyframes slide{from{left:16px}to{left:400px}}#sound{animation:slide 1s linear infinite alternate}'},/element is not stable/],
    ]){
      await fixture(setup);
      await assert.rejects(clickSoundButton(page,{timeout:500}),error=>error.name==='TimeoutError'&&reason.test(error.message),name+' must reject the click');
      assert.deepEqual(await page.evaluate(()=>soundClicks),[],name+' must not receive input');
      assert.deepEqual(await page.evaluate(()=>[scrollX,scrollY]),[0,0],name+' must not scroll the page');
      checks.push(name+' control is rejected');
    }
    await fixture({attributes:'disabled'});
    await page.evaluate(()=>{
      const button=document.querySelector('#sound');
      setTimeout(()=>{window.soundBecameEnabled=performance.now();button.disabled=false;},100);
      button.addEventListener('click',()=>{window.soundClickedAt=performance.now();});
    });
    await clickSoundButton(page);
    assert.deepEqual(await page.evaluate(()=>soundClicks),[true]);
    assert.equal(await page.evaluate(()=>soundClickedAt>=soundBecameEnabled),true,'wait for enabled before dispatching input');
    checks.push('delayed enable waits for actionability before one trusted click');
    return checks;
  }finally{await context.close();}
}
