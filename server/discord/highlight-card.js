import {winTier,WIN_TITLES} from '../../src/game/win-tier.js';
import {playerName,playerMention,playerMentions} from './player-display.js';

export const HIGHLIGHT_WINDOW_MS=10*60*1000;
export const HIGHLIGHT_INTERVAL_MS=10*1000;
export const HIGHLIGHT_MAX_AGE_MS=15*60*1000;
export const HIGHLIGHT_VISIBLE=5;
export const highlightTier=winTier;

const artOrigin='https://jokers-circus-production.nini900219.workers.dev/announcements/';
const styles={
  big:{
    file:'big-win-22bea6e95a7a.webp',media:'thumbnail',color:0xa88b60,
    greeting:'這局手氣不錯！',description:multiple=>`收下 **${multiple} 倍下注獎金**。`,
  },
  super:{
    file:'super-win-bebd0e262ee5.webp',media:'image',color:0xd6b775,
    greeting:'這局漂亮！',description:multiple=>`一舉拿下 **${multiple} 倍下注獎金**，掌聲送給你。`,
  },
  mega:{
    file:'mega-win-5f0adee4765d.webp',media:'image',color:0xc85c76,
    greeting:'全場為你喝采！',description:multiple=>`**${multiple} 倍下注獎金**，這一局你就是主角。`,
  },
};
// Versioned public assets are fetched by Discord, never by the game preload.
export const HIGHLIGHT_ART=Object.freeze(Object.fromEntries(Object.entries(styles).map(([tier,style])=>[tier,artOrigin+style.file])));
const multiplierFormat=new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
const multiplier=value=>multiplierFormat.format(value);
const artwork=tier=>({[styles[tier].media]:{url:HIGHLIGHT_ART[tier]}});

export function highlightAnnouncement(entry){
  const {tier}=entry,style=styles[tier],name=playerMention(entry.user)||playerName(entry.name);
  return {
    content:`${name}，${style.greeting}`,
    allowed_mentions:playerMentions([entry.user]),
    embeds:[{
      title:WIN_TITLES[tier],color:style.color,
      description:style.description(multiplier(entry.multiplier)),
      ...artwork(tier),
    }],
  };
}

// Legacy webhook mode retains the ten-minute aggregate and silent delivery.
export function highlightCard(entries,total=entries.length){
  const recent=entries.slice(0,HIGHLIGHT_VISIBLE);
  const tier=['mega','super','big'].find(tier=>recent.some(entry=>entry.tier===tier))||'big';
  const style=styles[tier],mentions=[...new Set(recent.map(entry=>playerMention(entry.user)).filter(Boolean))];
  return {
    ...(mentions.length?{content:mentions.join(' ')}:{}),
    allowed_mentions:playerMentions(recent.map(entry=>entry.user)),
    flags:4096,
    embeds:[{
      color:style.color,title:`${WIN_TITLES[tier]}｜${style.greeting}`,
      description:recent.length>1?'大獎接連登場，恭喜各位！':'恭喜贏得大獎，掌聲送給你！',
      ...artwork(tier),
      fields:recent.map(entry=>({
        name:playerName(entry.name),
        value:`**${WIN_TITLES[entry.tier]}**　｜　**${multiplier(entry.multiplier)}×**`,
        inline:false,
      })),
      footer:{text:`近 10 分鐘共 ${total} 次大獎 · 倍率以每局總下注計算`},
    }],
  };
}
