import { winTier, WIN_TITLES } from '../../src/game/win-tier.js';

export const HIGHLIGHT_WINDOW_MS = 10 * 60 * 1000;
export const HIGHLIGHT_INTERVAL_MS = 10 * 1000;
export const HIGHLIGHT_MAX_AGE_MS = 15 * 60 * 1000;
export const HIGHLIGHT_VISIBLE = 5;

export function highlightTier(payout, bet) {
  const tier = winTier(payout, bet);
  return tier === 'super' || tier === 'mega' ? tier : null;
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
  const multiplier = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  return {
    allowed_mentions: { parse: [] },
    flags: 4096, // SUPPRESS_NOTIFICATIONS: visible in-channel, without push alerts.
    embeds: [{
      author: { name: 'Joker’s Circus · 群友好手氣' },
      color: mega ? 0xc85c76 : 0xd6b775,
      title: mega ? 'MEGA WIN · 這局太猛了' : 'SUPER WIN · 漂亮的一局',
      description: recent.length>1?'這幾局手氣都不錯，恭喜大家！':'恭喜！這次的大獎值得留個紀念。',
      fields: recent.map(entry => ({
        name: playerName(entry.name),
        value: `**${WIN_TITLES[entry.tier]}**　｜　**${multiplier(entry.multiplier)}×**`,
        inline: false,
      })),
      footer: { text: `這 10 分鐘中了 ${total} 次大獎 · 最近 ${recent.length} 次\n倍率以每局的總下注計算` },
    }],
  };
}

export function highlightAnnouncement(entry){
  const payload=highlightCard([entry],1);
  delete payload.flags;
  payload.embeds[0].footer={text:'倍率以本局總下注計算'};
  return payload;
}
