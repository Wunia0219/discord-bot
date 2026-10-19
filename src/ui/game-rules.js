import './game-rules.css';
import { mainArt } from './main-art.js';
import symbolsUrl from '../../images/symbols.webp';
import atlas from '../../images/symbols.json';
import { SYMBOLS, SYMBOL_FRAMES, SYMBOL_NAMES, PAYTABLE, BET_DIVISOR, BETS, THEORETICAL_RTP, MAXIMUM_MULTIPLIER, MODEL_VERSION } from '../game/index.js';
import { WIN_THRESHOLDS, WIN_TITLES } from '../game/win-tier.js';
import { rulesExample } from './rules-example.js';
import { APP_VERSION } from '../version.js';

const fmt = value => value.toLocaleString('en-US');
const sections = [
  ['symbols', '圖標賠率'],
  ['ways', '得獎方式'],
  ['play', '操作與演出'],
  ['account', '試玩資訊'],
];

function symbolArt(symbol, className = '') {
  const { x, y, w, h } = atlas.frames[SYMBOL_FRAMES[symbol]].frame;
  return `<span class="rules-symbol ${className}" aria-hidden="true"><span class="rules-symbol-crop" style="aspect-ratio:${w}/${h}"><img src="${symbolsUrl}" alt="" style="width:${atlas.meta.size.w / w * 100}%;left:${-x / w * 100}%;top:${-y / h * 100}%" /></span></span>`;
}

function symbolCard(symbol) {
  return `<article class="rules-pay-card"><div class="rules-pay-symbol">${symbolArt(symbol)}<h4>${SYMBOL_NAMES[symbol]}</h4></div><table aria-label="${SYMBOL_NAMES[symbol]}賠率"><thead><tr><th scope="col">連數</th><th scope="col">倍率</th></tr></thead><tbody>${[5, 4, 3].map(count => `<tr><th scope="row">${count} 連</th><td>${fmt(PAYTABLE[symbol][count - 3])}<small>×</small></td></tr>`).join('')}</tbody></table></article>`;
}

function symbolsPanel(bet) {
  return `<h3 class="sr-only">圖標與賠率</h3><div class="rules-rate-note"><strong>派彩 ＝ 圖標倍率 × 得獎組合數 × 計價單位</strong><span class="rules-rate-context"><span>計價單位 ＝ 總下注 ÷ ${BET_DIVISOR}。</span><span>目前下注 ${fmt(bet)}，計價單位為 ${fmt(bet / BET_DIVISOR)}。</span></span></div>
    <section class="rules-cast"><div class="rules-section-heading"><h4>皇家圖標</h4><span>HIGH SYMBOLS</span></div><div class="rules-pay-grid">${SYMBOLS.slice(0, 4).map(symbolCard).join('')}</div></section>
    <section class="rules-cast"><div class="rules-section-heading"><h4>花色圖標</h4><span>LOW SYMBOLS</span></div><div class="rules-pay-grid">${SYMBOLS.slice(4, 8).map(symbolCard).join('')}</div></section>
    <aside class="rules-wild">${symbolArt('wild')}<div><span class="rules-kicker">THE MAGIC HAT</span><h4>WILD · 魔術帽</h4><p>替代所有一般圖標，依被替代圖標的倍率計分。只出現在第 3、4、5 軸，不形成獨立的 WILD 獎。</p></div></aside>
    <p class="rules-footnote">表中的倍率以「計價單位」計算，並非總下注的倍數。前往「得獎方式」查看完整範例。</p>`;
}

function waysPanel(bet) {
  const example = rulesExample(bet), win = example.wins[0];
  const counts = example.grid.map((_, col) => win.cells.filter(cell => cell[0] === col).length);
  return `<div class="rules-intro"><span class="rules-kicker">243 WAYS TO WIN</span><h3>由左起連續 3 軸以上，即可得獎</h3><p>5 軸 × 3 列，243 路全部啟用。同圖標須從第 1 軸開始，連續出現在至少 3 軸；每軸可在任意一列，不必排成直線。</p></div>
    <figure class="rules-example"><figcaption><strong>紅心 3 連 · ${win.ways} 組得獎</strong><span>示意盤面 · 下注 ${fmt(bet)}</span></figcaption><div class="rules-example-grid" role="img" aria-label="前三軸分別有兩個、一個、三個紅心，第四軸沒有紅心或 WILD，因此形成六組三連得獎。">${example.grid.map((col, i) => `<div class="rules-example-reel ${i < win.count ? 'is-winning' : ''}"><span class="rules-reel-label">第 ${i + 1} 軸</span>${col.map((symbol, row) => `<span class="rules-example-cell ${win.cells.some(cell => cell[0] === i && cell[1] === row) ? 'is-hit' : ''}">${symbolArt(symbol)}</span>`).join('')}<strong>${counts[i] ? `× ${counts[i]}` : '—'}</strong></div>`).join('')}</div><div class="rules-example-caption"><span>由左向右計算</span><span>第 4 軸中斷，後面的圖標不再加入</span></div></figure>
    <div class="rules-calculation"><div><span>得獎組合</span><strong>2 × 1 × 3 ＝ ${win.ways} 組</strong></div><div><span>本例派彩</span><strong>${win.multiplier} × ${win.ways} × ${fmt(example.unitBet)} ＝ <em>${fmt(example.payout)}</em></strong></div><p>紅心 3 連倍率 ${win.multiplier} × ${win.ways} 組 × 計價單位 ${fmt(example.unitBet)}。扣除本局下注 ${fmt(bet)}，淨增加 ${fmt(example.payout - bet)} 籌碼。</p></div>
    <div class="rules-principles"><article><b>01</b><div><h4>同圖標只計最長連續獎</h4><p>例如形成 5 連，只按 5 連倍率計分，不再加上 3 連與 4 連。</p></div></article><article><b>02</b><div><h4>不同圖標的派彩相加</h4><p>同一局可同時有多種圖標得獎。未參與得獎的後方轉輪，不會放大組合數。</p></div></article><article><b>03</b><div><h4>WILD 也算一個符合圖標</h4><p>WILD 可補上第 3～5 軸的連續組合，同一格也可參與不同一般圖標的得獎。</p></div></article></div>
    <div class="rules-callout"><strong>派彩與淨損益，是兩個不同的數字</strong><span>淨損益 ＝ 本局派彩 − 總下注。派彩不另外返還本金；有得分時，籌碼仍可能減少。</span></div>`;
}

function playPanel(bet) {
  return `<div class="rules-intro"><span class="rules-kicker">LET THE SHOW BEGIN</span><h3>準備好，讓表演開始</h3><p>選擇下注額，再按中央旋轉按鈕。每局結束後，可在「遊玩紀錄」查看派彩與淨損益。</p></div>
    <ol class="rules-steps"><li><span class="rules-step-number">01</span><div><h4>選擇下注</h4><p>${BETS.map(fmt).join('／')} 籌碼。MAX BET 會選取 ${fmt(BETS.at(-1))}，不會直接開轉。</p></div></li><li><span class="rules-step-art">${mainArt('spin-button.png', 'rules-spin-art')}</span><div><h4>按下 SPIN</h4><p>轉輪依序停下後，亮框會標示得獎格子，上方顯示本局總派彩。</p></div></li><li><span class="rules-step-number">03</span><div><h4>AUTO SPIN 連續旋轉</h4><p>再次按下 STOP AUTO，停止後續自動開轉；目前這局仍會完成。自動旋轉會等得分與大獎演出結束後繼續。</p></div></li></ol>
    <aside class="rules-keyboard"><kbd>SPACE</kbd><div><h4>電腦快捷鍵</h4><p>空白鍵開轉；轉動中再按一次，可縮短停輪時間。快停只改變演出速度，不改變結果與派彩。</p></div></aside>
    <div class="rules-section-heading"><h4>聚光燈下的大獎演出</h4><span>WIN CELEBRATIONS</span></div><p class="rules-tier-explanation">以「本局總派彩 ÷ 總下注」判定，只播放符合的最高一級演出。</p><div class="rules-tier-grid">${['big', 'super', 'mega'].map((tier, i, tiers) => `<article class="rules-tier" data-win-tier="${tier}"><div role="img" aria-label="${WIN_TITLES[tier]}">${mainArt(`${tier}-win.png`, 'rules-win-art')}</div><strong>${WIN_THRESHOLDS[tier]}<small>${tiers[i + 1] ? `～不足 ${WIN_THRESHOLDS[tiers[i + 1]]} 倍` : ' 倍以上'}</small></strong><span>下注 ${fmt(bet)} · 派彩 ${fmt(bet * WIN_THRESHOLDS[tier])} 起</span></article>`).join('')}</div><p class="rules-footnote">大獎演出不會再額外加乘派彩。籌碼餘額首次達到 12,000 時的里程碑，也僅為慶祝演出。</p>
    <div class="rules-callout"><strong>暫停一下，隨時再回到舞台</strong><span>開啟規則或紀錄、切換到背景、籌碼不足或遇到錯誤，都會停止自動旋轉。音效需手動開啟；裝置設定減少動態效果時，演出會簡化。</span></div>`;
}

function accountPanel() {
  return `<div class="rules-intro"><span class="rules-kicker">BEHIND THE CURTAIN</span><h3>關於這場試玩</h3><p>了解籌碼保存方式，以及每一局結果如何呈現。</p></div>
    <section class="rules-account"><h4>帳號與籌碼</h4><div id="rules-account-content"></div></section>
    <div class="rules-facts"><article><span>理論返還率</span><strong>${Number((THEORETICAL_RTP * 100).toFixed(4))}<small>%</small></strong><p>長期平均的理論值，不代表單次或短期遊玩的返還。</p></article><article><span>最高可得派彩</span><strong>${fmt(MAXIMUM_MULTIPLIER)}<small>倍</small></strong><p>以總下注計算，取決於實際出現的完整得獎組合。</p></article></div>
    <div class="rules-principles"><article><b>01</b><div><h4>目前的遊戲玩法</h4><p>243 路一般旋轉與 WILD 替代。此版本沒有 Scatter、免費旋轉或額外獎池。</p></div></article><article><b>02</b><div><h4>查看最近 100 局</h4><p>遊玩紀錄包含下注、派彩、得獎組合與淨損益。舊版本的回合保留當時已結算的派彩。</p></div></article><article><b>03</b><div><h4>測試籌碼</h4><p>籌碼僅供測試，不能購買、轉讓或兌現。</p></div></article></div>
    <p class="rules-version"><strong>遊戲版本 v${APP_VERSION}</strong><span>規則資料 ${MODEL_VERSION}</span></p>`;
}

export function createGameRules(bet) {
  const root = document.createElement('div');
  root.className = 'game-rules';
  const panels = [symbolsPanel(bet), waysPanel(bet), playPanel(bet), accountPanel()];
  root.innerHTML = `<div class="rules-masthead">${mainArt('logo-long.png', 'rules-logo')}<span>5 軸 × 3 列 <i>◆</i> 243 路 <i>◆</i> 由左至右</span></div><div class="rules-tabs" role="tablist" aria-label="遊戲規則章節">${sections.map(([key, title], i) => `<button id="rules-tab-${key}" role="tab" aria-controls="rules-panel-${key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${title}</button>`).join('')}</div>${sections.map(([key], i) => `<section id="rules-panel-${key}" class="rules-panel" role="tabpanel" aria-labelledby="rules-tab-${key}" tabindex="0" ${i ? 'hidden' : ''}>${panels[i]}</section>`).join('')}`;

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
