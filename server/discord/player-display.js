const snowflake=value=>typeof value==='string'&&/^\d{17,20}$/.test(value);
export const playerMention=user=>snowflake(user)?`<@${user}>`:null;
// Only verified session/outbox IDs may notify; display names never do.
export function playerMentions(users=[]){
  const selected=[...new Set((Array.isArray(users)?users:[]).filter(snowflake))].slice(0,100);
  return selected.length?{parse:[],users:selected}:{parse:[]};
}

export function playerName(value){
  const name=Array.from(String(value||'玩家')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g,'')
    .replace(/@/g,'＠').replace(/</g,'＜').replace(/>/g,'＞').trim()).slice(0,48).join('')||'玩家';
  return name.replace(/[\\`*_{}\[\]()~|]/g,'\\$&');
}
