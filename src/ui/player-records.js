import { SYMBOL_NAMES } from '../game/symbols.js';
import { changeLabel, ledgerLabel } from './player-copy.js';

const fmt = n => Math.round(n).toLocaleString('en-US');
const date = time => new Date(time).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const node = (tag, className, text) => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

export function emptyRecords(message, detail) {
  const body = node('div', 'records-empty');
  body.append(node('strong', '', message), node('p', '', detail));
  return body;
}

export function roundRecords(history) {
  if (!history.length) return emptyRecords('第一場表演，等你開場', '按下 SPIN，這裡就會留下每一局的獎勵與戲籌變化。');
  const body = node('div', 'player-records');
  body.append(node('p', 'records-caption', '最近 100 局 · 點開一局查看得獎組合'));
  for (const round of history) {
    const card = node('details', 'play-record');
    const summary = node('summary', 'record-summary');
    const title = node('div', 'record-title');
    title.append(node('time', '', date(round.time)), node('strong', '', round.payout ? `獲得 ${fmt(round.payout)} 戲籌` : '這局沒有得獎'));
    const change = node('div', `record-change ${round.net > 0 ? 'is-positive' : ''}`);
    change.append(node('span', '', '戲籌變化'), node('strong', '', `${round.net > 0 ? '+' : ''}${fmt(round.net)}`));
    summary.append(title, change, node('span', 'record-chevron', ''));
    const detail = node('div', 'record-detail');
    detail.append(node('p', 'record-balance', `下注 ${fmt(round.bet)} · 結束餘額 ${fmt(round.after)}`));
    if (round.wins?.length) {
      const list = node('ul', 'record-wins');
      for (const win of round.wins) {
        const item = node('li', '');
        item.append(node('span', '', `${SYMBOL_NAMES[win.symbol] || '中獎圖標'} ${win.count} 連${win.ways ? ` · ${win.ways} 組` : ''}`), node('b', '', `+${fmt(win.payout)}`));
        list.append(item);
      }
      detail.append(list);
    } else detail.append(node('p', '', '這局沒有連出中獎組合。'));
    detail.append(node('p', 'record-outcome', round.net === 0 ? '這局的戲籌沒有變化。' : `這局${changeLabel(round.net)}戲籌。`));
    card.append(summary, detail);
    body.append(card);
  }
  return body;
}

export function ledgerRecords(entries) {
  if (!entries.length) return emptyRecords('還沒有戲籌收支', '領取每日簽到或開始遊戲後，就能在這裡查看。');
  const body = node('div', 'player-records');
  body.append(node('p', 'records-caption', '最近 50 筆 · 所有時間皆為台灣時間'));
  for (const entry of entries) {
    const card = node('article', 'ledger-record');
    const description = node('div', '');
    description.append(node('time', '', date(entry.time)), node('h3', '', ledgerLabel(entry)));
    // Staff-written reasons are useful; internal seed/spin strings are not UI copy.
    if (['grant', 'reversal'].includes(entry.kind) && entry.reason) description.append(node('p', 'ledger-reason', entry.reason));
    description.append(node('p', 'ledger-balance', `餘額 ${fmt(entry.after)}`));
    const amount = node('strong', `ledger-amount ${entry.delta > 0 ? 'is-positive' : ''}`, `${entry.delta > 0 ? '+' : ''}${fmt(entry.delta)}`);
    card.append(description, amount);
    body.append(card);
  }
  return body;
}
