import './style.css';
import { SlotScene } from './scene.js';
import { Sound } from './audio.js';
import { connectActivity } from './discord-activity.js';
import { createLoadingScreen } from './loading.js';
import { BigWinPresentation } from './big-win.js';
import { setBitmapNumber } from './bitmap-number.js';
import { installResponsiveLayout } from './responsive-layout.js';
import { createWalletClient } from './wallet-client.js';
import { BETS, SYMBOL_NAMES, SYMBOL_CODES, SYMBOLS, PAYTABLE, PAYLINES, MODEL_VERSION, INITIAL_STOPS, PREVIEW_STOPS, drawStops, roundFromStops, restoredStops, freshState, readState, createRound } from './game.js';

const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString('en-US');
const icon = (name) => {
  const paths={moon:'<path d="M19 14.3A8 8 0 0 1 9.7 5 8 8 0 1 0 19 14.3Z"/>',sound:'<path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',muted:'<path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="m16 9 6 6m0-6-6 6"/>',spin:'<path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6"/>',star:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',coin:'<circle cx="12" cy="12" r="9"/><path d="m12 6 4 6-4 6-4-6 4-6Z"/>',arrow:'<path d="m9 5 7 7-7 7"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',check:'<path d="m5 12 4 4L19 6"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>'};
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.star}</svg>`;
};
$('#app').innerHTML = `
  <header class="header"><nav class="header-right" aria-label="遊戲工具"><span class="test-label"><i></i>內部試玩</span><button id="all-history" class="utility" aria-label="遊玩紀錄" title="遊玩紀錄" aria-haspopup="dialog">${icon('clock')}<span>遊玩紀錄</span></button><button id="sound" class="icon-button" aria-label="開啟音效" aria-pressed="false">${icon('muted')}</button><button id="help" class="utility" aria-label="遊玩介紹" title="遊玩介紹" aria-haspopup="dialog">${icon('info')}<span>遊玩介紹</span></button></nav></header>
  <main>
    <section class="game-panel" aria-label="凱美特之冠：五軸三列老虎機">
      <h1 class="sr-only">CROWNS OF KEMET · 凱美特之冠</h1>
      <div class="game-composition">
      <div class="game-stage"><div id="canvas-host"></div>
        <div id="celebration" aria-hidden="true"><span id="celebration-kicker">PHARAOH’S TREASURE</span><strong id="celebration-title">法老王的寶藏</strong><b id="celebration-amount">+2,000</b><span id="celebration-note">尼羅河畔，傳說再次閃耀。</span></div>
      </div>
      <div class="control-deck">
      <output id="payout-result" class="payout-result" aria-live="polite" aria-label="本局中獎得分"></output>
        <div class="bet-group"><label>BET <span>每次下注</span></label><div class="bets">${BETS.map(b=>'<button data-bet="'+b+'" aria-pressed="'+(b===100)+'">'+fmt(b)+'</button>').join('')}</div></div>
        <button id="preview-win" class="gold-button"><span>BIG WIN</span><small>大獎預覽</small></button>
        <button id="spin" class="spin" aria-label="旋轉一次" aria-keyshortcuts="Space" title="旋轉一次（空白鍵）" disabled>${icon('spin')}<span>SPIN</span></button>
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
let bet=100, busy=false, ready=false, countAnimation=0, payoutAnimation=0, celebrationTimer=0;
const scene=new SlotScene(), sound=new Sound();
const bigWin=new BigWinPresentation($('#app'));
let activityMode='browser', activityUser=null, walletClient=null;
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
    const rules=document.createElement('small');rules.textContent=r.rules===MODEL_VERSION ? `${r.rules} · 停點（從 0 起）${r.stops.join(' / ')} · 單線下注 ${fmt(r.lineBet)}` : '舊展示規則 · 非 96% RTP 模型';content.append(rules);
    if(r.wins?.length){const lines=document.createElement('small');lines.textContent=r.wins.map(w=>`第 ${w.line} 線：${SYMBOL_CODES[w.symbol]} ${w.count} 連 ×${w.multiplier} = ${fmt(w.payout)}`).join('；');content.append(lines);}
  }
  const net=document.createElement('b');net.className=r.net>0?'positive':'neutral';net.textContent=signed(r.net);row.append(mark,content,net);return row;
}
function renderState() {
  setBitmapNumber($('#balance'),fmt(state.balance));

}
function setBusy(value) {
  busy=value;
  ['#spin','#preview-win','#max-bet'].forEach(s=>$(s).disabled=value||!ready);
  if($('#reset'))$('#reset').disabled=value||!ready;
  document.querySelectorAll('[data-bet]').forEach(b=>b.disabled=value);
  $('#spin').innerHTML=icon('spin')+'<span>'+(value?'轉動中':'SPIN')+'</span>';
  $('#spin').setAttribute('aria-label',value?'轉動中':'旋轉一次');
  $('#spin').classList.toggle('spinning',value);
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
function clearLineReadout(){scene.clearWins();}
function presentLines(round){scene.showWins(round.wins);}
function celebrate(kind,amount,preview=false) {
  hideCelebration();
  const milestone=kind==='milestone';
  if(!milestone){
    bigWin.show(amount,scene.reduced);
    scene.celebrate(true,true);sound.win(true);
    celebrationTimer=setTimeout(hideCelebration,4500);
    return;
  }
  $('#celebration').classList.toggle('milestone',milestone);
  $('#celebration-kicker').textContent=milestone?'A NEW CHAPTER':'PHARAOH’S TREASURE';
  $('#celebration-title').textContent=milestone?'法老的眷顧':'法老王的寶藏';
  $('#celebration-amount').textContent=milestone?'12,000':`+${fmt(amount)}`;
  $('#celebration-note').textContent=preview?'演出預覽 · 測試籌碼不變':milestone?'第一枚法老徽章，已為你收藏。':'這一刻，傳說再次閃耀。';
  $('#celebration').classList.add('show');$('.game-panel').classList.add('big-win');
  scene.celebrate(!milestone,!milestone);sound.win(true);
  celebrationTimer=setTimeout(hideCelebration,4500);
}
async function spin(preview=false) {
  if(busy||!ready)return;
  showPayout(0);
  cancelAnimationFrame(countAnimation);hideCelebration();clearLineReadout();
  let r;
  setBusy(true);
  if(preview)r={...roundFromStops(bet,PREVIEW_STOPS),bet};
  else {
    try{
      const update=walletClient?await walletClient.spin(bet):createRound(state,bet,drawStops(),crypto.randomUUID());r=update.round;save(update.state);
    }catch(error){setBusy(false);showError('無法開始本局',walletClient?error.message:'測試籌碼不足，請降低下注，或到「遊玩介紹」重設試玩。');return;}
  }
  setBusy(true);sound.tone(220,.2);
  if(!preview)setBitmapNumber($('#balance'),fmt(r.before-r.bet));
  result(preview?'為你預演一場法老王的寶藏。':'轉輪啟動，讓寶藏慢慢揭曉。',preview?'此演出不影響籌碼與遊戲紀錄。':`本次下注 ${fmt(r.bet)} · 正在播放本局演出`,'SPINNING');
  try {
    await scene.spin(r.stops,i=>sound.stop(i));
    renderState();
    if(!preview)animateBalance(r.before-r.bet,state.balance);
    presentLines(r);
    showPayout(r.payout,true);
    const symbols=r.wins.length ? `線號 ${r.wins.map(w=>w.line).join('、')}` : '20 條線未形成得獎組合';
    result(r.label,preview?`${symbols}｜預覽派彩 ${fmt(r.payout)}，籌碼不變`:`${symbols}｜派彩 ${fmt(r.payout)} · 淨損益 ${signed(r.net)}`,preview?'PREVIEW':r.net>0?'WIN':'FINISHED',r.payout>r.bet);
    if(r.level==='jackpot')celebrate('jackpot',r.payout,preview);
    else if(r.payout>r.bet){scene.celebrate();sound.win(false);}
    if(r.milestone) {
      clearTimeout(celebrationTimer);
      celebrationTimer=setTimeout(()=>celebrate('milestone',12000),r.level==='jackpot'?4500:1800);
    }
  } catch { renderState();if(!preview)showPayout(r.payout);openDialog('本局演出中斷',preview?'<p>請再試一次大獎預覽。</p>':'<p>本局已保存，可在遊玩紀錄中查看結果。</p>'); }
  finally {setBusy(false);}
}
function openDialog(title,body) {$('#dialog-title').textContent=title;$('#dialog-body').replaceChildren();if(typeof body==='string')$('#dialog-body').innerHTML=body;else $('#dialog-body').append(body);if(!$('#dialog').open)$('#dialog').showModal();$('#dialog-body').scrollTop=0;}
function showRules(){
  const table=SYMBOLS.map(s=>'<tr><td>'+SYMBOL_CODES[s]+' · '+SYMBOL_NAMES[s]+'</td>'+PAYTABLE[s].map(p=>'<td>'+fmt(p)+'×</td>').join('')+'</tr>').join('');
  const lines=PAYLINES.map((rows,i)=>'<div class="payline-card"><b>'+String(i+1).padStart(2,'0')+'</b><svg viewBox="0 0 100 60" role="img" aria-label="第 '+(i+1)+' 線，列序 '+rows.map(r=>r+1).join('、')+'"><path d="M0 20H100M0 40H100M20 0V60M40 0V60M60 0V60M80 0V60" stroke="#765067" stroke-width="1"/><polyline points="'+rows.map((r,c)=>(c*20+10)+','+(r*20+10)).join(' ')+'" fill="none" stroke="#ffd57d" stroke-width="3"/>'+rows.map((r,c)=>'<circle cx="'+(c*20+10)+'" cy="'+(r*20+10)+'" r="4" fill="#ffd57d"/>').join('')+'</svg></div>').join('');
  openDialog('20 線遊戲規則',`<p>5 軸 × 3 列，20 條線全部啟用。每軸從固定輪帶獨立等機率抽取停點；理論 RTP 為 96%，代表長期平均，單次或短期結果會波動。規則版本：${MODEL_VERSION}。</p><h3>賠率表</h3><p>下表倍率 × 單線下注。單線下注 = 總下注 ÷ 20；例如下注 100，單線下注為 5。從第一軸向右連續至少 3 個相同符號得獎，每線只付最高獎，不同線相加。W 替代一般符號，也可獨立派彩，取較高者。沒有 Scatter、免費旋轉或額外獎池。</p><table><thead><tr><th>符號</th><th>3 連</th><th>4 連</th><th>5 連</th></tr></thead><tbody>${table}</tbody></table><h3>20 條固定線</h3><div class="payline-grid">${lines}</div><p>派彩不另外返還本金；淨損益 = 派彩 − 總下注。此固定輪帶最高可達 120.65 倍總下注。得獎線每 1.6 秒依序亮出，彩色實線與亮框標示得獎段，淡線標示該線後續路徑。控制框正上方顯示最近一局的中獎總得分（未扣下注），沒有中獎則留白；各線得分與完整明細可在右上角「遊玩紀錄」查看。</p><h3>內部試玩與資料</h3><p>${walletClient?'已連接本伺服器的帳號錢包，餘額及紀錄由後端保存。':activityMode==='discord'?'已連接 Discord Activity，目前使用本機試玩帳本。':'目前是獨立瀏覽器展示模式，不影響 Discord 帳號餘額。'}籌碼僅供測試，不能購買、轉讓或兌現。大獎預覽使用實際可達的停點，但不扣籌碼、不寫紀錄，也不參與 RTP 統計；12,000 里程碑僅為演出。只有派彩大於下注才播放獲利慶祝，20 倍以上播放大獎演出。</p><p>${walletClient?'顯示最近 100 局，後端保留完整帳本及停點、各線獎金與規則版本。':'最近 100 局保存在此瀏覽器，含停點、各線獎金與規則版本。舊展示版紀錄另標示為舊規則；重設試玩會清除餘額與紀錄。'}空白鍵可啟動 SPIN；長按、轉動中或彈出視窗開啟時不會重複下注。音效需手動開啟，系統減少動態效果時會簡化演出。</p><button id="reset" class="confirm-reset" ${busy||!ready?'disabled':''}>重設試玩</button>`);
  if(activityUser){
    const identity=document.createElement('p');
    identity.textContent=`已登入 Discord：${activityUser.global_name || activityUser.username}（${activityUser.id}）。${walletClient?`目前使用本伺服器的${state.environment==='test'?'測試':'正式'}錢包，跨裝置同步。`:'籌碼與紀錄仍為此瀏覽器的測試資料，尚未同步到帳號。'}`;
    $('#dialog-body').prepend(identity);
  }
  if(walletClient){
    $('#reset')?.remove();
    const info=document.createElement('p');info.textContent=`每日簽到 ${state.daily} 籌碼，台灣時間 00:00 換日。也可在 Discord 使用 /簽到、/籌碼。帳號餘額不可自行重設。`;
    const check=document.createElement('button');check.className='confirm-reset';check.textContent=state.claimed?'今日已簽到':'領取今日簽到';check.disabled=busy||state.claimed;
    check.addEventListener('click',async()=>{check.disabled=true;try{const r=await walletClient.checkin();save(r.state);renderState();check.textContent='今日已簽到';}catch(error){check.disabled=false;showError('簽到未完成',error.message);}});
    const log=document.createElement('button');log.className='confirm-reset';log.textContent='籌碼收支';
    log.addEventListener('click',async()=>{try{const {entries}=await walletClient.ledger();const body=document.createElement('div');for(const e of entries){const p=document.createElement('p');p.textContent=`#${e.id} ${new Date(e.time).toLocaleString('zh-TW')}｜${signed(e.delta)}｜${e.before} → ${e.after}｜${e.reason}`;body.append(p);}if(!entries.length)body.textContent='尚無收支紀錄。';openDialog('最近 50 筆籌碼收支',body);}catch(error){showError('無法取得收支',error.message);}});
    const account=document.createElement('section'),actions=document.createElement('div');actions.className='wallet-actions';actions.append(check,log);account.append(info,actions);$('#dialog-body').insertBefore(account,$('#dialog-body').children[1]||null);
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
  if(!event.repeat)spin();
});
$('#preview-win').addEventListener('click',()=>spin(true));
document.querySelectorAll('[data-bet]').forEach(b=>b.addEventListener('click',()=>{if(busy)return;bet=Number(b.dataset.bet);document.querySelectorAll('[data-bet]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));}));
$('#sound').addEventListener('click',async()=>{
  if(sound.enabled)sound.enabled=false;else await sound.enable();
  $('#sound').innerHTML=icon(sound.enabled?'sound':'muted');$('#sound').setAttribute('aria-pressed',String(sound.enabled));$('#sound').setAttribute('aria-label',sound.enabled?'關閉音效':'開啟音效');if(sound.enabled)sound.tone(659,.2);
});
$('#help').addEventListener('click',showRules);
$('#all-history').addEventListener('click',()=>{const body=document.createElement('div');if(state.history.length)state.history.forEach(r=>body.append(historyRow(r,true)));else body.textContent='還沒有紀錄。完成第一局後再來看看。';const note=document.createElement('p');note.className='history-note';note.textContent=walletClient?'本伺服器最近 100 局 · 帳號同步 · 大獎預覽不入帳':storageAvailable?'最近 100 局 · 僅保存在此瀏覽器 · 大獎預覽不影響籌碼與紀錄':'瀏覽器儲存不可用 · 本次關閉後不保留';body.prepend(note);openDialog('遊玩紀錄',body);});
$('#close-dialog').addEventListener('click',()=>$('#dialog').close());
$('#dialog').addEventListener('click',e=>{if(e.target===$('#dialog')){const r=$('#dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#dialog').close();}});
$('#dialog-body').addEventListener('click',e=>{
  if(!e.target.closest('#reset')||busy||!ready||walletClient)return;
  openDialog('重新開始試玩', '<p>將恢復 10,000 測試籌碼，並清除這個瀏覽器中的試玩紀錄與里程碑。</p><button class="confirm-reset" id="confirm-reset">確認重設</button>');
  $('#confirm-reset').addEventListener('click',()=>{cancelAnimationFrame(countAnimation);hideCelebration();clearLineReadout();scene.guardian.idle();save(freshState());renderState();showPayout(0);scene.setStops(INITIAL_STOPS);result('新的神殿旅程，準備開始。','測試籌碼已恢復為 10,000。');$('#dialog').close();});
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){scene.finish();if(ready)scene.app.stop();sound.context?.suspend();}
  else {if(ready)scene.app.start();if(sound.enabled)sound.context?.resume().catch(()=>{});refreshWallet();}
});
renderState();
// History restores the wallet and reels, but a new visit has no current win.
showPayout(0);
setBusy(false);
async function startGame() {
  const loading = createLoadingScreen();
  loading.update(8, '正在喚醒神殿');
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
    loading.update(20, '正在展開尼羅河的風景');
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
