import './game-rules.css';
import { mainArt } from './main-art.js';
import symbolsUrl from '../../images/symbols.webp';
import atlas from '../../images/symbols.json';
import { SYMBOLS, SYMBOL_FRAMES, SYMBOL_NAMES, PAYTABLE, BET_DIVISOR, BETS, THEORETICAL_RTP, MAXIMUM_MULTIPLIER } from '../game/index.js';
import { WIN_THRESHOLDS, WIN_TITLES } from '../game/win-tier.js';
import { rulesExample } from './rules-example.js';
import { APP_VERSION } from '../version.js';

const fmt = value => value.toLocaleString('en-US');
const sections = [
  ['symbols', '圖標獎勵'],
  ['ways', '得獎方式'],
  ['play', '操作說明'],
];

function symbolArt(symbol, className = '') {
  const { x, y, w, h } = atlas.frames[SYMBOL_FRAMES[symbol]].frame;
  return `<span class="rules-symbol ${className}" aria-hidden="true"><span class="rules-symbol-crop" style="aspect-ratio:${w}/${h}"><img src="${symbolsUrl}" alt="" style="width:${atlas.meta.size.w / w * 100}%;left:${-x / w * 100}%;top:${-y / h * 100}%" /></span></span>`;
}

function symbolCard(symbol, bet) {
  return `<article class="rules-pay-card"><div class="rules-pay-symbol">${symbolArt(symbol)}<h4>${SYMBOL_NAMES[symbol]}</h4></div><table aria-label="${SYMBOL_NAMES[symbol]}獎勵"><thead><tr><th scope="col">連數</th><th scope="col">每組籌碼</th></tr></thead><tbody>${[5, 4, 3].map(count => `<tr><th scope="row">${count} 連</th><td>${fmt(PAYTABLE[symbol][count - 3] * bet / BET_DIVISOR)}</td></tr>`).join('')}</tbody></table></article>`;
}

function symbolsPanel(bet) {
  return `<h3 class="sr-only">圖標獎勵</h3><div class="rules-rate-note"><strong>本局下注 ${fmt(bet)} 籌碼</strong><span class="rules-rate-context">以下是每一組中獎可拿到的籌碼；同時中獎多組，獎勵就會加在一起。</span></div>
    <section class="rules-cast"><div class="rules-section-heading"><h4>皇家圖標</h4><span>HIGH SYMBOLS</span></div><div class="rules-pay-grid">${SYMBOLS.slice(0, 4).map(symbol => symbolCard(symbol, bet)).join('')}</div></section>
    <section class="rules-cast"><div class="rules-section-heading"><h4>花色圖標</h4><span>LOW SYMBOLS</span></div><div class="rules-pay-grid">${SYMBOLS.slice(4, 8).map(symbol => symbolCard(symbol, bet)).join('')}</div></section>
    <aside class="rules-wild">${symbolArt('wild')}<div><span class="rules-kicker">THE MAGIC HAT</span><h4>WILD · 魔術帽</h4><p>魔術帽可以當作任何一般圖標，幫你接出連續中獎。它只會出現在第 3～5 軸，獎勵依它替代的圖標計算。</p></div></aside>
    <p class="rules-footnote">換一個下注額，這裡的籌碼數也會跟著變。想知道怎麼加總，可以看看「得獎方式」。</p>`;
}

function waysPanel(bet) {
  const example = rulesExample(bet), win = example.wins[0];
  const counts = example.grid.map((_, col) => win.cells.filter(cell => cell[0] === col).length);
  return `<div class="rules-intro"><span class="rules-kicker">243 WAYS TO WIN</span><h3>由左起連續 3 軸以上，即可得獎</h3><p>同一個圖標從最左邊開始，連續出現在 3 軸以上就能得獎。每軸出現在哪一列都算，不用排成一直線。</p></div>
    <figure class="rules-example"><figcaption><strong>紅心 3 連 · ${win.ways} 組得獎</strong><span>示意盤面 · 下注 ${fmt(bet)}</span></figcaption><div class="rules-example-grid" role="img" aria-label="前三軸分別有兩個、一個、三個紅心，第四軸沒有紅心或 WILD，因此形成六組三連得獎。">${example.grid.map((col, i) => `<div class="rules-example-reel ${i < win.count ? 'is-winning' : ''}"><span class="rules-reel-label">第 ${i + 1} 軸</span>${col.map((symbol, row) => `<span class="rules-example-cell ${win.cells.some(cell => cell[0] === i && cell[1] === row) ? 'is-hit' : ''}">${symbolArt(symbol)}</span>`).join('')}<strong>${counts[i] ? `× ${counts[i]}` : '—'}</strong></div>`).join('')}</div><div class="rules-example-caption"><span>由左向右計算</span><span>第 4 軸中斷，後面的圖標不再加入</span></div></figure>
    <div class="rules-calculation"><div><span>得獎組合</span><strong>2 × 1 × 3 ＝ ${win.ways} 組</strong></div><div><span>這局可得籌碼</span><strong>${fmt(win.multiplier * example.unitBet)} × ${win.ways} ＝ <em>${fmt(example.payout)}</em></strong></div><p>紅心 3 連，每組可得 ${fmt(win.multiplier * example.unitBet)} 籌碼；一共 ${win.ways} 組，可拿到 ${fmt(example.payout)}。扣掉這局下注的 ${fmt(bet)}，實際多了 ${fmt(example.payout - bet)} 籌碼。</p></div>
    <div class="rules-principles"><article><b>01</b><div><h4>同圖標，算連得最長的那一種</h4><p>例如連到 5 軸，就拿 5 連的獎勵，不會再把 3 連、4 連加一次。</p></div></article><article><b>02</b><div><h4>不同圖標得獎，全部加在一起</h4><p>同一局可以同時中好幾種圖標。連續中斷後，後面轉輪的圖標就不再加入這組計算。</p></div></article><article><b>03</b><div><h4>魔術帽幫你補上圖標</h4><p>魔術帽能接上第 3～5 軸的中獎組合。同一頂帽子，也可以幫不同圖標一起得獎。</p></div></article></div>
    <div class="rules-callout"><strong>有得獎，籌碼也可能變少</strong><span>每局會先扣下注，再加上獎勵。如果獎勵少於下注，籌碼餘額就會減少；紀錄裡的「籌碼變化」會幫你算好。</span></div>`;
}

function playPanel(bet) {
  return `<div class="rules-intro"><span class="rules-kicker">LET THE SHOW BEGIN</span><h3>準備好，讓表演開始</h3><p>選好下注額，按下中央的旋轉按鈕。每一局拿到多少、籌碼多了還是少了，都能在右上角的「遊玩紀錄」查看。</p></div>
    <ol class="rules-steps"><li><span class="rules-step-number">01</span><div><h4>選擇下注</h4><p>${BETS.map(fmt).join('／')} 籌碼。按 MAX BET 會幫你選好 ${fmt(BETS.at(-1))}，再按 SPIN 才會開始。</p></div></li><li><span class="rules-step-art">${mainArt('spin-button.png', 'rules-spin-art')}</span><div><h4>按下 SPIN</h4><p>轉輪停下後，亮框會指出中獎的圖標，機台上方會顯示這局拿到的籌碼。</p></div></li><li><span class="rules-step-number">03</span><div><h4>AUTO SPIN 連續旋轉</h4><p>想連續玩就按 AUTO SPIN；想停下來，再按 STOP AUTO。這局會先玩完，看到得獎結果後才會接著轉。</p></div></li></ol>
    <aside class="rules-keyboard"><kbd>SPACE</kbd><div><h4>電腦快捷鍵</h4><p>主畫面的空白鍵固定用來開轉或快停，點過紀錄、規則或其他按鈕也一樣。轉動中再按一次，只會讓轉輪早一點停下，結果和獎勵不變。紀錄／規則視窗開啟時，空白鍵不關閉視窗也不開轉；關閉請按右上角或 Esc。用鍵盤操作工具按鈕可按 Enter。</p></div></aside>
    <div class="rules-section-heading"><h4>聚光燈下的大獎演出</h4><span>WIN CELEBRATIONS</span></div><p class="rules-tier-explanation">這局拿到的籌碼越多，慶祝也越熱鬧。以下倍數都以這局的總下注計算，只會播放最高的一種。</p><div class="rules-tier-grid">${['big', 'super', 'mega'].map((tier, i, tiers) => `<article class="rules-tier" data-win-tier="${tier}"><div role="img" aria-label="${WIN_TITLES[tier]}">${mainArt(`${tier}-win.png`, 'rules-win-art')}</div><strong>${WIN_THRESHOLDS[tier]}<small>${tiers[i + 1] ? `～不足 ${WIN_THRESHOLDS[tiers[i + 1]]} 倍` : ' 倍以上'}</small></strong><span>下注 ${fmt(bet)} · 獲得 ${fmt(bet * WIN_THRESHOLDS[tier])} 起</span></article>`).join('')}</div><p class="rules-footnote">這些都是得獎後的慶祝，不會再把籌碼乘一次。餘額第一次達到 12,000 時，也會有里程碑慶祝。</p>
    <div class="rules-callout"><strong>暫停一下，隨時再回到舞台</strong><span>打開規則或紀錄、離開遊戲，或籌碼不夠時，自動旋轉就會暫停。回來後再按 AUTO SPIN 即可繼續。想聽音效，可以按右上角的喇叭。</span></div>${gameFacts()}`;
}

function gameFacts() {
  return `<section class="rules-basics" aria-labelledby="rules-basics-title"><h4 id="rules-basics-title">遊戲基本資訊</h4><div class="rules-facts"><article><span>理論返還率</span><strong>${Number((THEORETICAL_RTP * 100).toFixed(4))}<small>%</small></strong><p>這是長期平均值，不代表每次都能拿回 ${Number((THEORETICAL_RTP * 100).toFixed(4))}% 的籌碼。</p></article><article><span>最高倍率</span><strong>${fmt(MAXIMUM_MULTIPLIER)}<small>倍</small></strong><p>以這局的總下注計算，實際拿到多少，要看中獎圖標和組合。</p></article></div><p>籌碼是遊戲裡用的，不能購買、轉讓，也不能換成現金。</p></section>`;
}

export function createGameRules(bet) {
  const root = document.createElement('div');
  root.className = 'game-rules';
  const panels = [symbolsPanel(bet), waysPanel(bet), playPanel(bet)];
  root.innerHTML = `<div class="rules-masthead">${mainArt('logo-long.png', 'rules-logo')}<span>5 軸 × 3 列 <i>◆</i> 243 路 <i>◆</i> 由左至右</span></div><div class="rules-tabs" role="tablist" aria-label="遊戲規則章節">${sections.map(([key, title], i) => `<button id="rules-tab-${key}" role="tab" aria-controls="rules-panel-${key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${title}</button>`).join('')}</div>${sections.map(([key], i) => `<section id="rules-panel-${key}" class="rules-panel" role="tabpanel" aria-labelledby="rules-tab-${key}" tabindex="0" ${i ? 'hidden' : ''}>${panels[i]}</section>`).join('')}<nav class="rules-legal" aria-label="服務與隱私"><a href="/terms.html">服務條款</a><a href="/privacy.html">隱私權政策</a></nav><footer class="rules-version"><span>JOKER’S CIRCUS</span><span>v${APP_VERSION}</span></footer>`;

  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const select = index => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      root.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden = i !== index;
    });
    root.closest('#dialog-body').scrollTop = 0;
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      select(next);
      tabs[next].focus();
    });
  });
  return root;
}
