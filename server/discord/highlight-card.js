import { winTier, WIN_TITLES } from '../../src/game/win-tier.js';
import {playerMention,playerMentions} from './player-mentions.js';

export const HIGHLIGHT_WINDOW_MS = 10 * 60 * 1000;
export const HIGHLIGHT_INTERVAL_MS = 10 * 1000;
export const HIGHLIGHT_MAX_AGE_MS = 15 * 60 * 1000;
export const HIGHLIGHT_VISIBLE = 5;
// Public, versioned artwork; Discord fetches it without wallet credentials.
export const HIGHLIGHT_ART = Object.freeze({
  big:'https://jokers-circus-production.nini900219.workers.dev/announcements/big-win-22bea6e95a7a.webp',
  super:'https://jokers-circus-production.nini900219.workers.dev/announcements/super-win-bebd0e262ee5.webp',
  mega:'https://jokers-circus-production.nini900219.workers.dev/announcements/mega-win-5f0adee4765d.webp',
});
const multiplier = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);

export function highlightTier(payout, bet) {
  return winTier(payout, bet);
}

// Names come from Discord, but are still untrusted Markdown, never mentions.
export function playerName(value) {
  const name = Array.from(String(value || '玩家')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '')
    .replace(/@/g, '＠').replace(/</g, '＜').replace(/>/g, '＞').trim()).slice(0, 48).join('') || '玩家';
  return name.replace(/[\\`*_{}\[\]()~|]/g, '\\$&');
}

export function highlightCard(entries, total = entries.length) {
  const recent = entries.slice(0, HIGHLIGHT_VISIBLE);
  const mega = recent.some(entry => entry.tier === 'mega');
  const big = !mega && !recent.some(entry => entry.tier === 'super');
  return {
    ...((recent.some(entry=>playerMention(entry.user)))?{content:[...new Set(recent.map(entry=>playerMention(entry.user)).filter(Boolean))].join(' ')}:{}),
    allowed_mentions: playerMentions(recent.map(entry=>entry.user)),
    flags: 4096, // SUPPRESS_NOTIFICATIONS: visible in-channel, without push alerts.
    embeds: [{
      color: mega ? 0xc85c76 : big ? 0xa88b60 : 0xd6b775,
      title: mega ? 'MEGA WIN｜全場為你喝采！' : big ? 'BIG WIN｜這局手氣不錯！' : 'SUPER WIN｜這局漂亮！',
      description: recent.length>1?'大獎接連登場，恭喜各位！':'恭喜贏得大獎，掌聲送給你！',
      ...(big?{thumbnail:{url:HIGHLIGHT_ART.big}}:{image:{url:HIGHLIGHT_ART[mega?'mega':'super']}}),
      fields: recent.map(entry => ({
        name: playerName(entry.name),
        value: `**${WIN_TITLES[entry.tier]}**　｜　**${multiplier(entry.multiplier)}×**`,
        inline: false,
      })),
      footer: { text: `近 10 分鐘共 ${total} 次大獎 · 倍率以每局總下注計算` },
    }],
  };
}

export function highlightAnnouncement(entry){
  const mega=entry.tier==='mega',big=entry.tier==='big',name=playerMention(entry.user)||playerName(entry.name),multiple=multiplier(entry.multiplier);
  return {
    content:mega?`${name}，全場為你喝采！`:big?`${name}，這局手氣不錯！`:`${name}，這局漂亮！`,
    allowed_mentions:playerMentions([entry.user]),
    embeds:[{
      title:WIN_TITLES[entry.tier],
      color:mega?0xc85c76:big?0xa88b60:0xd6b775,
      description:mega
        ?`**${multiple} 倍下注獎金**，這一局你就是主角。`
        :big?`收下 **${multiple} 倍下注獎金**。`:`一舉拿下 **${multiple} 倍下注獎金**，掌聲送給你。`,
      ...(big?{thumbnail:{url:HIGHLIGHT_ART.big}}:{image:{url:HIGHLIGHT_ART[entry.tier]}}),
    }],
  };
}
