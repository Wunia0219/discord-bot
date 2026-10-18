import './style.css';
import { SlotScene } from './scene.js';
import { Sound } from './audio.js';
import { BETS, OUTCOMES, SYMBOL_NAMES, freshState, readState, createRound } from './game.js';

const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString('en-US');
const icon = (name) => {
  const paths={moon:'<path d="M19 14.3A8 8 0 0 1 9.7 5 8 8 0 1 0 19 14.3Z"/>',sound:'<path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',muted:'<path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="m16 9 6 6m0-6-6 6"/>',spin:'<path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6"/>',star:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/>',coin:'<circle cx="12" cy="12" r="9"/><path d="m12 6 4 6-4 6-4-6 4-6Z"/>',arrow:'<path d="m9 5 7 7-7 7"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',check:'<path d="m5 12 4 4L19 6"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>'};
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.star}</svg>`;
};
$('#app').innerHTML = `
  <header class="header"><a class="brand" href="#" aria-label="Luna 月光遊藝室首頁"><span class="brand-mark">${icon('moon')}</span><span>LUNA<span class="brand-sub">月光遊藝室</span></span></a><div class="header-right"><span class="test-label"><i></i>內部試玩</span><button id="sound" class="icon-button" aria-label="開啟音效" aria-pressed="false">${icon('muted')}</button><button id="help" class="icon-button" aria-label="試玩說明">${icon('info')}</button><div class="avatar" title="本機訪客">L</div></div></header>
  <main>
    <section class="intro"><div><div class="eyebrow">THE MOONLIGHT COLLECTION · 01</div><h1>讓幸運，在月光下轉動。</h1><p>一點期待，一場屬於你的星光演出。</p></div><div class="wallet"><span class="wallet-icon">${icon('coin')}</span><div><span class="muted">我的測試籌碼</span><strong id="balance">10,000</strong></div></div></section>
    <div class="layout">
      <section class="game-panel" aria-label="月光拉霸遊戲">
        <div class="machine-top"><span class="tiny-stars">✦ &nbsp; ✧ &nbsp; ✦</span><div class="machine-title">MOONLIGHT</div><div class="machine-subtitle"><span></span> 月 光 拉 霸 <span></span></div><div class="machine-series">EST. 2026<br>VOL. 001</div></div>
        <div class="game-stage"><div class="arc arc-one"></div><div class="arc arc-two"></div><div id="canvas-host"><div id="loading">正在點亮遊藝室…</div></div><div class="payline-label">中央連線 · 三個相同符號</div><div id="celebration" aria-hidden="true"><span id="celebration-kicker">MOONLIGHT JACKPOT</span><strong id="celebration-title">月光大獎</strong><b id="celebration-amount">+2,000</b><span id="celebration-note">這一刻，星光為你而亮。</span></div></div>
        <div class="result" role="status" aria-live="polite"><span id="result-icon">${icon('star')}</span><div><strong id="result-title">今晚的第一份幸運，等你開啟。</strong><span id="result-detail">選擇下注額，開始你的月光旅程。</span></div><span class="result-tag" id="result-tag">READY</span></div>
        <div class="controls"><div class="bet-group"><label>每次下注 <span>籌碼</span></label><div class="bets">${BETS.map(b=>`<button data-bet="${b}" aria-pressed="${b===100}">${fmt(b)}</button>`).join('')}</div></div><button id="spin" class="spin" disabled>${icon('spin')}<span>旋轉一次<small>SPIN THE MOMENT</small></span></button></div>
        <div class="machine-footer"><span>純娛樂 · 測試籌碼無現金價值</span><button id="rules">查看試玩規則 ${icon('arrow')}</button></div>
      </section>
      <aside>
        <section class="journey"><div class="section-kicker">YOUR NEXT CHAPTER</div><div class="journey-head"><h2>下一個里程碑</h2><span>${icon('moon')}</span></div><div class="medal"><div>${icon('moon')}</div><span class="medal-star">✦</span></div><h3>月光收藏家</h3><p>首次達到 12,000 測試籌碼</p><div class="progress"><span id="progress"></span></div><div class="progress-caption"><span id="progress-current">10,000</span><span>12,000</span></div><div class="journey-note" id="journey-note">收藏下一段閃耀時刻。</div></section>
        <section class="history-panel"><div class="section-heading"><h2>${icon('clock')}最近紀錄</h2><button id="all-history">查看全部 ${icon('arrow')}</button></div><div id="history"></div><p class="history-note">僅保存在此瀏覽器 · 最近 100 局</p></section>
      </aside>
    </div>
    <section class="preview-bar"><div><span class="preview-icon">${icon('star')}</span><div><strong>先看一場精彩演出</strong><span>自由預覽，不扣除或增加籌碼。</span></div></div><div class="preview-buttons"><button id="preview-win">預覽大獎 ${icon('arrow')}</button><button id="preview-milestone">預覽里程碑 ${icon('arrow')}</button></div></section>
    <footer class="page-footer"><span>LUNA ARCADE <span>／</span> PRIVATE PREVIEW</span><span>本機動畫樣品 · 尚未連接 Discord</span><button id="reset">重設試玩</button></footer>
  </main>
  <dialog id="dialog"><div class="dialog-head"><h2 id="dialog-title"></h2><button id="close-dialog" class="icon-button" aria-label="關閉視窗">${icon('close')}</button></div><div id="dialog-body"></div></dialog>`;

const KEY='luna-arcade-preview-v1';
let state, storageAvailable=true;
try { state=readState(localStorage.getItem(KEY)); } catch { state=freshState();storageAvailable=false; }
let bet=100, busy=false, ready=false, countAnimation=0, celebrationTimer=0;
const scene=new SlotScene(), sound=new Sound();
const motion=matchMedia('(prefers-reduced-motion: reduce)');scene.reduced=motion.matches;motion.addEventListener('change',()=>scene.reduced=motion.matches);
const signed=n=>(n>0?'+':'')+fmt(n);
function save(next) { state=next;try{localStorage.setItem(KEY,JSON.stringify(state));}catch{storageAvailable=false;} }
function historyRow(r,full=false) {
  const row=document.createElement('div');row.className='history-row';
  const mark=document.createElement('span');mark.className=`history-mark ${r.payout>0?'won':''}`;mark.innerHTML=icon(r.payout>0?'star':'moon');
  const content=document.createElement('div'); const title=document.createElement('strong');title.textContent=r.payout>0?`派彩 ${fmt(r.payout)}`:'本局未中獎';
  const caption=document.createElement('small');caption.textContent=`${new Date(r.time).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})} · 下注 ${fmt(r.bet)}`;
  content.append(title,caption);
  if(full){const detail=document.createElement('small');detail.textContent=`${r.symbols.map(s=>SYMBOL_NAMES[s]).join(' / ')} · 餘額 ${fmt(r.after)} · 局號 ${r.id.slice(0,8)}`;content.append(detail);}
  const net=document.createElement('b');net.className=r.net>0?'positive':'neutral';net.textContent=signed(r.net);row.append(mark,content,net);return row;
}
function renderState() {
  $('#balance').textContent=fmt(state.balance);
  $('#progress').style.width=`${Math.min(state.balance/12000*100,100)}%`;
  $('#progress-current').textContent=fmt(state.balance);
  $('#journey-note').textContent=state.milestones.includes(12000)?'已收藏 · 月光收藏家':`距離下一段星光，還差 ${fmt(Math.max(0,12000-state.balance))} 籌碼。`;
  $('#history').replaceChildren(...state.history.slice(0,4).map(r=>historyRow(r)));
  if(!state.history.length)$('#history').innerHTML='<div class="empty-history"><span>每一段幸運，都值得留下。</span><small>完成第一局後，紀錄會出現在這裡。</small></div>';
  if(!storageAvailable)$('.history-note').textContent='瀏覽器儲存不可用 · 本次關閉後不保留';
}
function setBusy(value) {
  busy=value;
  ['#spin','#reset','#preview-win','#preview-milestone'].forEach(s=>$(s).disabled=value||!ready);
  document.querySelectorAll('[data-bet]').forEach(b=>b.disabled=value);
  $('#spin').innerHTML=value?`${icon('spin')}<span>星光轉動中<small>THE MOMENT IS COMING</small></span>`:`${icon('spin')}<span>旋轉一次<small>SPIN THE MOMENT</small></span>`;
  $('#spin').classList.toggle('spinning',value);
}
function result(title,detail,tag='READY',win=false) {
  $('#result-title').textContent=title;$('#result-detail').textContent=detail;$('#result-tag').textContent=tag;$('.result').classList.toggle('winning',win);
}
function animateBalance(from,to) {
  cancelAnimationFrame(countAnimation);
  if(scene.reduced){$('#balance').textContent=fmt(to);return;}
  const start=performance.now();
  const frame=now=>{const p=Math.min((now-start)/900,1);$('#balance').textContent=fmt(from+(to-from)*(1-(1-p)**3));if(p<1)countAnimation=requestAnimationFrame(frame);};countAnimation=requestAnimationFrame(frame);
}
function hideCelebration(){clearTimeout(celebrationTimer);$('#celebration').classList.remove('show');$('.game-panel').classList.remove('big-win');}
function celebrate(kind,amount,preview=false) {
  hideCelebration();
  const milestone=kind==='milestone';
  $('#celebration-kicker').textContent=milestone?'A NEW CHAPTER':'MOONLIGHT JACKPOT';
  $('#celebration-title').textContent=milestone?'月光收藏家':'月光大獎';
  $('#celebration-amount').textContent=milestone?'12,000':`+${fmt(amount)}`;
  $('#celebration-note').textContent=preview?'演出預覽 · 測試籌碼不變':milestone?'第一枚月光徽章，已為你收藏。':'這一刻，星光為你而亮。';
  $('#celebration').classList.add('show');$('.game-panel').classList.add('big-win');
  scene.celebrate(true);sound.win(true);
  celebrationTimer=setTimeout(hideCelebration,4500);
}
async function spin(preview=false) {
  if(busy||!ready)return;
  $('.game-panel').scrollIntoView({behavior:scene.reduced?'instant':'smooth',block:'start'});
  cancelAnimationFrame(countAnimation);hideCelebration();
  let r;
  if(preview)r={...OUTCOMES[3],payout:bet*20,bet};
  else {
    try{
      const random=crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;
      const update=createRound(state,bet,random,crypto.randomUUID());r=update.round;save(update.state);
    }catch(error){result(error.message,'可以使用「重設試玩」補回測試籌碼。','NOTICE');return;}
  }
  setBusy(true);sound.tone(220,.2);
  if(!preview)$('#balance').textContent=fmt(r.before-bet);
  result(preview?'為你預演一場月光大獎。':'轉輪啟動，讓星光慢慢揭曉。',preview?'此演出不影響籌碼與遊戲紀錄。':`本次下注 ${fmt(bet)} · 正在播放本局演出`,'SPINNING');
  try {
    await scene.spin(r.symbols,i=>sound.stop(i));
    renderState();
    if(!preview)animateBalance(r.before-bet,r.after);
    const symbols=r.symbols.map(s=>SYMBOL_NAMES[s]).join(' · ');
    result(r.label,preview?`${symbols}｜預覽派彩 ${fmt(r.payout)}，籌碼不變`:`${symbols}｜派彩 ${fmt(r.payout)} · 淨損益 ${signed(r.net)}`,preview?'PREVIEW':r.payout?'WIN':'FINISHED',r.payout>0);
    if(r.level==='jackpot')celebrate('jackpot',r.payout,preview);
    else if(r.payout>0){scene.celebrate();sound.win(false);}
    if(r.milestone) {
      clearTimeout(celebrationTimer);
      celebrationTimer=setTimeout(()=>celebrate('milestone',12000),r.level==='jackpot'?4500:1800);
    }
  } catch { renderState(); result('本局已保存','演出暫時中斷，可在紀錄中查看結果。','SAVED'); }
  finally {setBusy(false);}
}
function openDialog(title,body) {$('#dialog-title').textContent=title;$('#dialog-body').replaceChildren();if(typeof body==='string')$('#dialog-body').innerHTML=body;else $('#dialog-body').append(body);$('#dialog').showModal();}
function showRules(){openDialog('關於這次內部試玩',`<p>這是動畫與操作樣品，還沒有連接 Discord。所有籌碼僅供測試，不能購買、轉讓或兌現。</p><h3>試玩方式</h3><p>選擇下注額後旋轉，中央三個相同符號會派彩。大獎與里程碑預覽不影響餘額、不寫入紀錄。</p><table><thead><tr><th>結果</th><th>測試機率</th><th>派彩</th></tr></thead><tbody><tr><td>未中獎</td><td>50%</td><td>0 倍</td></tr><tr><td>三顆櫻桃</td><td>30%</td><td>2 倍</td></tr><tr><td>三顆寶石</td><td>15%</td><td>5 倍</td></tr><tr><td>三個幸運 7</td><td>5%</td><td>20 倍</td></tr></tbody></table><p>派彩含本金；淨損益 = 派彩 − 下注。以上為方便觀察演出的測試分布，理論回饋率 235%，不是正式遊戲機率。月亮、星星與皇冠目前只作轉輪裝飾。</p><h3>資料保存</h3><p>最近 100 局保存在目前瀏覽器。清除瀏覽器資料或按「重設試玩」會清除紀錄，不支援跨裝置同步。正式版將改由後端管理帳本。</p><p>音效需手動開啟。若系統設定減少動態效果，演出會自動簡化。</p>`);}
$('#spin').addEventListener('click',()=>spin());
$('#preview-win').addEventListener('click',()=>spin(true));
$('#preview-milestone').addEventListener('click',()=>{if(busy||!ready)return;$('.game-panel').scrollIntoView({behavior:scene.reduced?'instant':'smooth',block:'start'});hideCelebration();celebrate('milestone',12000,true);result('里程碑演出預覽','月光收藏家 · 示範達成 12,000 籌碼的演出；實際籌碼不變。','PREVIEW',true);});
document.querySelectorAll('[data-bet]').forEach(b=>b.addEventListener('click',()=>{if(busy)return;bet=Number(b.dataset.bet);document.querySelectorAll('[data-bet]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));}));
$('#sound').addEventListener('click',async()=>{
  if(sound.enabled)sound.enabled=false;else await sound.enable();
  $('#sound').innerHTML=icon(sound.enabled?'sound':'muted');$('#sound').setAttribute('aria-pressed',String(sound.enabled));$('#sound').setAttribute('aria-label',sound.enabled?'關閉音效':'開啟音效');if(sound.enabled)sound.tone(659,.2);
});
$('#rules').addEventListener('click',showRules);$('#help').addEventListener('click',showRules);
$('#all-history').addEventListener('click',()=>{const body=document.createElement('div');if(state.history.length)state.history.forEach(r=>body.append(historyRow(r,true)));else body.textContent='還沒有紀錄。完成第一局後再來看看。';openDialog('我的試玩紀錄',body);});
$('#close-dialog').addEventListener('click',()=>$('#dialog').close());
$('#dialog').addEventListener('click',e=>{if(e.target===$('#dialog')){const r=$('#dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#dialog').close();}});
$('#reset').addEventListener('click',()=>{
  openDialog('重新開始試玩', '<p>將恢復 10,000 測試籌碼，並清除這個瀏覽器中的試玩紀錄與里程碑。</p><button class="confirm-reset" id="confirm-reset">確認重設</button>');
  $('#confirm-reset').addEventListener('click',()=>{cancelAnimationFrame(countAnimation);hideCelebration();save(freshState());renderState();scene.current=['moon','seven','gem'];scene.setStatic(scene.current);result('新的月光旅程，準備開始。','測試籌碼已恢復為 10,000。');$('#dialog').close();});
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){scene.finish();if(ready)scene.app.stop();sound.context?.suspend();}
  else {if(ready)scene.app.start();if(sound.enabled)sound.context?.resume().catch(()=>{});}
});
renderState();
setBusy(false);
scene.init($('#canvas-host')).then(()=>{ $('#loading').remove();ready=true;setBusy(false); }).catch(error=>{
  console.error(error);$('#loading').textContent='無法啟動圖形引擎，請使用支援 WebGL 的瀏覽器，並開啟硬體加速。';result('圖形引擎尚未就緒','重新整理後再試，或更換瀏覽器。','ERROR');
});
