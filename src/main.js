import { mainArt } from './ui/main-art.js';
import { APP_VERSION } from './version.js';
import './style.css';
import { SlotScene } from './ui/scene.js';
import { Sound } from './ui/audio.js';
import { connectActivity } from './platform/discord-activity.js';
import { createLoadingScreen } from './ui/loading.js';
import { BigWinPresentation } from './ui/big-win.js';
import { winTier } from './game/win-tier.js';
import { createGameRules } from './ui/game-rules.js';
import { SpinControls } from './ui/spin-controls.js';
import { roundFeedbackTiming } from './ui/presentation.js';
import { setBitmapNumber } from './ui/bitmap-number.js';
import { installResponsiveLayout } from './ui/responsive-layout.js';
import { createWalletClient } from './platform/wallet-client.js';
import { BETS, LEGACY_MODELS, SYMBOL_NAMES, SYMBOL_CODES, MODEL_VERSION, INITIAL_STOPS, drawStops, restoredStops, freshState, readState, createRound } from './game/index.js';

const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString('en-US');
const icon = (name) => {
  const paths={moon:'<path d="M19 14.3A8 8 0 0 1 9.7 5 8 8 0 1 0 19 14.3Z"/>',sound:'<path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',muted:'<path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="m16 9 6 6m0-6-6 6"/>',spin:'<path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6"/>',star:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',coin:'<circle cx="12" cy="12" r="9"/><path d="m12 6 4 6-4 6-4-6 4-6Z"/>',arrow:'<path d="m9 5 7 7-7 7"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',check:'<path d="m5 12 4 4L19 6"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>'};
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.star}</svg>`;
};
$('#app').innerHTML = `
  <header class="header"><nav class="header-right" aria-label="遊戲工具"><span class="test-label"><i></i>內部試玩</span><span class="game-version" aria-label="遊戲版本 ${APP_VERSION}">v${APP_VERSION}</span><button id="all-history" class="utility" aria-label="遊玩紀錄" title="遊玩紀錄" aria-haspopup="dialog">${icon('clock')}<span>遊玩紀錄</span></button><button id="sound" class="icon-button" aria-label="開啟音效" aria-pressed="false">${icon('muted')}</button><button id="help" class="utility" aria-label="遊戲規則" title="遊戲規則" aria-haspopup="dialog">${icon('info')}<span>遊戲規則</span></button></nav></header>
  <main>
    <section class="game-panel" aria-label="Joker’s Circus：五軸三列老虎機">
      <h1 class="sr-only">Joker’s Circus</h1>
      <div class="game-composition">
      <div class="game-stage"><div id="canvas-host"></div>
        <div id="celebration" aria-hidden="true"><span id="celebration-kicker">JOKER’S CIRCUS</span><strong id="celebration-title">馬戲團大獎</strong><b id="celebration-amount">+2,000</b><span id="celebration-note">聚光燈下，精彩即將揭曉。</span></div>
      </div>
      <div class="control-deck">
      <output id="payout-result" class="payout-result" aria-live="polite" aria-label="本局中獎得分"></output>
        <div class="bet-group"><label>BET <span>每次下注</span></label><div class="bets">${BETS.map(b=>'<button data-bet="'+b+'" aria-pressed="'+(b===100)+'">'+fmt(b)+'</button>').join('')}</div></div>
        <button id="auto-spin" class="gold-button" aria-label="自動旋轉" aria-pressed="false"><span>AUTO SPIN</span><small>自動旋轉</small></button>
        <button id="spin" class="spin" aria-label="旋轉一次" aria-keyshortcuts="Space" title="旋轉一次（空白鍵）" disabled>${mainArt('spin-button.png','spin-art')}</button>
        <button id="max-bet" class="gold-button"><span>MAX BET</span><small>最大下注</small></button>
        <div class="wallet"><span>COINS <small>測試籌碼</small></span><strong id="balance">10,000</strong></div>
      </div>
      <div id="game-status" class="sr-only" role="status" aria-live="polite"></div>
      </div>
    </section>
  </main>
  <dialog id="dialog" aria-labelledby="dialog-title"><div class="dialog-head"><h2 id="dialog-title"></h2><button id="close-dialog" class="icon-button" aria-label="關閉視窗">${icon('close')}</button></div><div id="dialog-body"></div></dialog>`;

installResponsiveLayout($('main'));
const KEY='kemet-slot-preview-v2';
let state, storageAvailable=true;
try { state=readState(localStorage.getItem(KEY)); } catch { state=freshState();storageAvailable=false; }
let bet=100, busy=false, presenting=false, ready=false, countAnimation=0, payoutAnimation=0, celebrationTimer=0;
const scene=new SlotScene(), sound=new Sound();
const bigWin=new BigWinPresentation($('#app'));
let activityMode='browser', activityUser=null, walletClient=null;
const controls=new SpinControls({
  isReady:()=>ready&&!document.hidden&&!$('#dialog').open,
  isBusy:()=>busy,
  startSpin:()=>spin(),
  stopReels:()=>scene.requestQuickStop(),
  onAutoChange:enabled=>{
    const button=$('#auto-spin');
    button.setAttribute('aria-pressed',String(enabled));
    button.setAttribute('aria-label',enabled?'停止自動旋轉':'自動旋轉');
    button.innerHTML=enabled?'<span>STOP AUTO</span><small>停止自動</small>':'<span>AUTO SPIN</span><small>自動旋轉</small>';
    setBusy(busy);
  },
});
const motion=matchMedia('(prefers-reduced-motion: reduce)');scene.reduced=motion.matches;motion.addEventListener('change',()=>scene.reduced=motion.matches);
const signed=n=>(n>0?'+':'')+fmt(n);
function save(next) { if(walletClient){if((next.revision||0)>=(state.revision||0))state=next;return;}state=next;try{localStorage.setItem(KEY,JSON.stringify(state));}catch{storageAvailable=false;} }
function showError(title,message){const p=document.createElement('p');p.textContent=message;openDialog(title,p);}
async function refreshWallet(){if(!walletClient||busy||!ready)return;try{const update=await walletClient.state();if(!busy){save(update.state);renderState();}}catch(error){if(error.status===401){ready=false;setBusy(false);showError('請重新登入',error.message);}}}
function historyRow(r,full=false) {
  const row=document.createElement('div');row.className='history-row';
  const mark=document.createElement('span');mark.className=`history-mark ${r.payout>0?'won':''}`;mark.innerHTML=icon(r.payout>0?'star':'moon');
  const content=document.createElement('div'); const title=document.createElement('strong');title.textContent=r.payout>0?`派彩 ${fmt(r.payout)}`:'本局未中獎';
  const caption=document.createElement('small');caption.textContent=`${new Date(r.time).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})} · 下注 ${fmt(r.bet)}`;
  content.append(title,caption);
  if(full){const detail=document.createElement('small');detail.textContent=`${r.symbols.map(s=>SYMBOL_NAMES[s]).join(' / ')} · 餘額 ${fmt(r.after)} · 局號 ${r.id.slice(0,8)}`;content.append(detail);
    const rules=document.createElement('small');rules.textContent=(r.rules===MODEL_VERSION||LEGACY_MODELS[r.rules]) ? `${r.rules===MODEL_VERSION?'目前 243 路':r.unitBet?'舊版 243 路':'舊版 20 線'} · ${r.rules} · 停點（從 0 起）${r.stops.join(' / ')} · 計價單位 ${fmt(r.unitBet??r.lineBet)}` : '舊展示規則';content.append(rules);
    if(r.wins?.length){const lines=document.createElement('small');lines.textContent=r.wins.map(w=>w.ways?`${SYMBOL_NAMES[w.symbol]} ${w.count} 連・${w.ways} 組 ×${w.multiplier} ×${r.unitBet} = ${fmt(w.payout)}`:`第 ${w.line} 線：${SYMBOL_CODES[w.symbol]} ${w.count} 連 ×${w.multiplier} = ${fmt(w.payout)}`).join('；');content.append(lines);}
  }
  const net=document.createElement('b');net.className=r.net>0?'positive':'neutral';net.textContent=signed(r.net);row.append(mark,content,net);return row;
}
function renderState() {
  setBitmapNumber($('#balance'),fmt(state.balance));

}
function setBusy(value) {
  busy=value;
  ['#spin','#max-bet'].forEach(s=>$(s).disabled=value||!ready);
  $('#max-bet').disabled=value||!ready||controls.auto;
  $('#auto-spin').disabled=!ready;
  if($('#reset'))$('#reset').disabled=value||!ready;
  document.querySelectorAll('[data-bet]').forEach(b=>b.disabled=value||controls.auto);
  $('#spin').setAttribute('aria-label',value?(presenting?'中獎演出中':'轉動中'):'旋轉一次');
  $('#spin').setAttribute('aria-busy',String(value));
  $('#spin').classList.toggle('spinning',value&&!presenting);
}
function result(title,detail) {
  $('#game-status').textContent=`${title} ${detail}`;
}
function showPayout(payout, animate=false) {
  cancelAnimationFrame(payoutAnimation);
  payoutAnimation=0;
  const output=$('#payout-result');
  output.setAttribute('aria-busy','false');
  output.setAttribute('aria-label',`本局中獎得分 ${fmt(payout)}`);
  if(payout<=0){setBitmapNumber(output,'');return;}
  if(!animate||scene.reduced){setBitmapNumber(output,signed(payout));return;}
  output.setAttribute('aria-busy','true');
  setBitmapNumber(output,'+0');
  const start=performance.now();
  const frame=now=>{
    const progress=scene.reduced?1:Math.min(Math.max((now-start)/1200,0),1);
    const value=progress===1?payout:Math.floor(payout*(1-(1-progress)**3));
    setBitmapNumber(output,`+${fmt(value)}`);
    if(progress<1)payoutAnimation=requestAnimationFrame(frame);
    else {payoutAnimation=0;output.setAttribute('aria-busy','false');}
  };
  payoutAnimation=requestAnimationFrame(frame);
}
function animateBalance(from,to) {
  cancelAnimationFrame(countAnimation);
  if(scene.reduced){setBitmapNumber($('#balance'),fmt(to));return;}
  const start=performance.now();
  const frame=now=>{const p=Math.min((now-start)/900,1);setBitmapNumber($('#balance'),fmt(from+(to-from)*(1-(1-p)**3)));if(p<1)countAnimation=requestAnimationFrame(frame);};countAnimation=requestAnimationFrame(frame);
}
function hideCelebration(){bigWin.hide();scene.clearCelebration();clearTimeout(celebrationTimer);$('#celebration').classList.remove('show');$('.game-panel').classList.remove('big-win');}
function clearWinReadout(){scene.clearWins();}
function presentWins(round){scene.showWins(round.wins);}
function celebrate(kind,amount) {
  hideCelebration();
  const milestone=kind==='milestone';
  if(!milestone){
    bigWin.show(amount,scene.reduced,kind);
    scene.celebrate(true,true);sound.win(true);
    celebrationTimer=setTimeout(hideCelebration,4500);
    return;
  }
  $('#celebration').classList.toggle('milestone',milestone);
  $('#celebration-kicker').textContent=milestone?'A NEW CHAPTER':'JOKER’S CIRCUS';
  $('#celebration-title').textContent=milestone?'馬戲團里程碑':'馬戲團大獎';
  $('#celebration-amount').textContent=milestone?'12,000':`+${fmt(amount)}`;
  $('#celebration-note').textContent=milestone?'第一枚馬戲團徽章，已為你收藏。':'這一刻，傳說再次閃耀。';
  $('#celebration').classList.add('show');$('.game-panel').classList.add('big-win');
  scene.celebrate(!milestone,!milestone);sound.win(true);
  celebrationTimer=setTimeout(hideCelebration,4500);
}
async function spin() {
  if(busy||!controls.isReady())return;
  controls.beginRound();
  setBusy(true);result('轉輪準備中，請稍候。','');let nextDelay=650,settledRound;
  try{
    const update=walletClient?await walletClient.spin(bet):createRound(state,bet,drawStops(),crypto.randomUUID());
    const r=update.round;save(update.state);settledRound=r;
    // Keep the previous round's effects visible during wallet/network waits.
    showPayout(0);cancelAnimationFrame(countAnimation);hideCelebration();clearWinReadout();
    if(r.rules!==MODEL_VERSION){
      controls.stopAuto();renderState();showPayout(r.payout);
      result('已取回舊版本的已結算回合',`派彩 ${fmt(r.payout)}，未重複下注。可在遊玩紀錄查看。`);
      return;
    }
    sound.tone(220,.2);
    setBitmapNumber($('#balance'),fmt(r.before-r.bet));
    result('轉輪啟動，讓寶藏慢慢揭曉。',`本次下注 ${fmt(r.bet)} · 正在播放本局演出`);
    const animation=scene.spin(r.stops,i=>sound.stop(i));
    controls.animationStarted();
    if(document.hidden)scene.finish();
    await animation;
    presenting=true;setBusy(true);
    renderState();animateBalance(r.before-r.bet,state.balance);presentWins(r);showPayout(r.payout,true);
    const symbols=r.wins.length?r.wins.map(w=>`${SYMBOL_NAMES[w.symbol]} ${w.count} 連・${w.ways} 組`).join('、'):'未形成由左起連續三軸的得獎組合';
    result(r.label,`${symbols}｜派彩 ${fmt(r.payout)} · 淨損益 ${signed(r.net)}`);
    const tier=winTier(r.payout,r.bet);
    if(tier)celebrate(tier,r.payout);
    else if(r.payout>r.bet){scene.celebrate();sound.win(false);}
    const timing=roundFeedbackTiming(r,tier);nextDelay=timing.autoDelay;
    if(r.milestone){clearTimeout(celebrationTimer);celebrationTimer=setTimeout(()=>celebrate('milestone',12000),tier?4500:1800);}
    // Space can shorten reel travel, but cannot cut off the resulting win.
    if(timing.hold&&!document.hidden)await new Promise(resolve=>setTimeout(resolve,timing.hold));
  }catch(error){
    controls.stopAuto();renderState();
    if(settledRound)showPayout(settledRound.payout);
    showError('無法完成本局',settledRound?'本局已結算並保存在遊玩紀錄，自動旋轉已停止。':error.message||'請再試一次。');
  }finally{
    presenting=false;setBusy(false);controls.endRound(nextDelay);
  }
}
function openDialog(title,body,variant='') {
  controls.stopAuto();
  $('#dialog').classList.toggle('rules-dialog',variant==='rules');
  $('#dialog-title').textContent=title;
  $('#dialog-body').replaceChildren();
  if(typeof body==='string')$('#dialog-body').innerHTML=body;
  else $('#dialog-body').append(body);
  if(!$('#dialog').open)$('#dialog').showModal();
  $('#dialog-body').scrollTop=0;
}
function showRules(){
  const rules=createGameRules(bet);
  openDialog('遊戲規則',rules,'rules');
  const account=rules.querySelector('#rules-account-content');
  if(activityUser){
    const identity=document.createElement('p');
    identity.textContent=`已登入 Discord：${activityUser.global_name || activityUser.username}。${walletClient?`目前使用本伺服器的${state.environment==='test'?'測試':'正式'}錢包，跨裝置同步。`:'目前使用此瀏覽器的試玩帳本，尚未同步到帳號。'}`;
    account.append(identity);
  }else{
    const info=document.createElement('p');
    info.textContent=storageAvailable?'目前使用此瀏覽器的試玩帳本，餘額與紀錄保存在本機。':'瀏覽器儲存不可用，關閉後不會保留本次試玩資料。';
    account.append(info);
  }
  if(walletClient){
    const info=document.createElement('p');info.textContent=`每日簽到 ${state.daily} 籌碼，台灣時間 00:00 換日。也可在 Discord 使用 /簽到、/籌碼。帳號餘額不可自行重設。`;
    const check=document.createElement('button');check.className='confirm-reset';check.textContent=state.claimed?'今日已簽到':'領取今日簽到';check.disabled=busy||state.claimed;
    check.addEventListener('click',async()=>{check.disabled=true;try{const r=await walletClient.checkin();save(r.state);renderState();check.textContent='今日已簽到';}catch(error){check.disabled=false;showError('簽到未完成',error.message);}});
    const log=document.createElement('button');log.className='confirm-reset';log.textContent='籌碼收支';
    log.addEventListener('click',async()=>{try{const {entries}=await walletClient.ledger();const body=document.createElement('div');for(const e of entries){const p=document.createElement('p');p.textContent=`#${e.id} ${new Date(e.time).toLocaleString('zh-TW')}｜${signed(e.delta)}｜${e.before} → ${e.after}｜${e.reason}`;body.append(p);}if(!entries.length)body.textContent='尚無收支紀錄。';openDialog('最近 50 筆籌碼收支',body);}catch(error){showError('無法取得收支',error.message);}});
    const actions=document.createElement('div');actions.className='wallet-actions';actions.append(check,log);account.append(info,actions);
  }else{
    const reset=document.createElement('button');reset.id='reset';reset.className='confirm-reset';reset.textContent='重設試玩';reset.disabled=busy||!ready;
    account.append(reset);
  }
}
$('#max-bet').addEventListener('click',()=>{if(!busy)document.querySelector('[data-bet="500"]').click();});
$('#spin').addEventListener('click',()=>spin());
// Pointer interaction has no persistent ring; Tab navigation keeps a gold cue.
document.addEventListener('pointerdown',()=>{document.documentElement.dataset.input='pointer';},true);
document.addEventListener('keydown',event=>{
  if(event.key==='Tab')document.documentElement.dataset.input='keyboard';
  if(event.code!=='Space'&&event.key!==' ')return;
  if(event.defaultPrevented||event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||document.hidden||$('#dialog').open)return;
  // Space is the game shortcut even after clicking a bet or toolbar button.
  // Editable fields and dialogs retain normal typing / keyboard behavior.
  if(event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))return;
  event.preventDefault();
  if(!event.repeat)controls.space();
});
$('#auto-spin').addEventListener('click',()=>controls.toggleAuto());
document.querySelectorAll('[data-bet]').forEach(b=>b.addEventListener('click',()=>{if(busy)return;bet=Number(b.dataset.bet);document.querySelectorAll('[data-bet]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));}));
$('#sound').addEventListener('click',async()=>{
  if(sound.enabled)sound.enabled=false;else await sound.enable();
  $('#sound').innerHTML=icon(sound.enabled?'sound':'muted');$('#sound').setAttribute('aria-pressed',String(sound.enabled));$('#sound').setAttribute('aria-label',sound.enabled?'關閉音效':'開啟音效');if(sound.enabled)sound.tone(659,.2);
});
$('#help').addEventListener('click',showRules);
$('#all-history').addEventListener('click',()=>{const body=document.createElement('div');if(state.history.length)state.history.forEach(r=>body.append(historyRow(r,true)));else body.textContent='還沒有紀錄。完成第一局後再來看看。';const note=document.createElement('p');note.className='history-note';note.textContent=walletClient?'本伺服器最近 100 局 · 帳號同步':storageAvailable?'最近 100 局 · 僅保存在此瀏覽器':'瀏覽器儲存不可用 · 本次關閉後不保留';body.prepend(note);openDialog('遊玩紀錄',body);});
$('#close-dialog').addEventListener('click',()=>$('#dialog').close());
$('#dialog').addEventListener('click',e=>{if(e.target===$('#dialog')){const r=$('#dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#dialog').close();}});
$('#dialog-body').addEventListener('click',e=>{
  if(!e.target.closest('#reset')||busy||!ready||walletClient)return;
  openDialog('重新開始試玩', '<p>將恢復 10,000 測試籌碼，並清除這個瀏覽器中的試玩紀錄與里程碑。</p><button class="confirm-reset" id="confirm-reset">確認重設</button>');
  $('#confirm-reset').addEventListener('click',()=>{cancelAnimationFrame(countAnimation);hideCelebration();clearWinReadout();save(freshState());renderState();showPayout(0);scene.setStops(INITIAL_STOPS);result('新的馬戲團旅程，準備開始。','測試籌碼已恢復為 10,000。');$('#dialog').close();});
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){controls.stopAuto();controls.stopCurrent();scene.finish();if(ready)scene.app.stop();sound.context?.suspend();}
  else {if(ready)scene.app.start();if(sound.enabled)sound.context?.resume().catch(()=>{});refreshWallet();}
});
renderState();
// History restores the wallet and reels, but a new visit has no current win.
showPayout(0);
setBusy(false);
async function startGame() {
  const loading = createLoadingScreen();
  loading.update(8, '正在喚醒馬戲團');
  try {
    const activity=await connectActivity();
    activityMode=activity.mode;
    activityUser=activity.user || null;
    if(activity.session){walletClient=createWalletClient(activity.session);state=(await walletClient.state()).state;renderState();}
    if(activityMode==='discord'&&import.meta.env.VITE_DISCORD_WALLET_ENABLED==='true'&&!walletClient)throw new Error('帳號錢包尚未連接，請重新開啟活動。');
    if(activityMode==='discord'){
      const label=$('.test-label');
      label.replaceChildren(document.createElement('i'),document.createTextNode(activityUser?'Discord 已登入':'Discord 試玩'));
      if(activityUser)label.title=`${activityUser.global_name || activityUser.username} · ${activityUser.id}`;
    }
    loading.update(20, '正在展開馬戲團的舞台');
  } catch(error) {
    console.error(error);
    loading.fail(error.message);
    result('Discord 尚未連接',error.message);
    return;
  }
  try {
    await Promise.all([scene.init($('#canvas-host'),loading.update),bigWin.prepare()]);
    renderState();
    scene.setStops(restoredStops(state));
    scene.app.render();
    await loading.finish();
    ready=true;setBusy(false);
  } catch(error) {
    console.error(error);loading.fail('請確認網路連線，並使用支援 WebGL、已開啟硬體加速的瀏覽器後重試。');result('遊戲尚未就緒','重新載入後再試，或更換瀏覽器。');
  }
}
startGame();
setInterval(()=>{if(!document.hidden)refreshWallet();},15000);
