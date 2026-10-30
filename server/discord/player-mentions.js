const snowflake=value=>typeof value==='string'&&/^\d{17,20}$/.test(value);
export const playerMention=user=>snowflake(user)?`<@${user}>`:null;
// IDs come only from verified sessions or the committed announcement outbox.
// Never enable broad users/roles/everyone parsing from display names.
export function playerMentions(users=[]){
  const selected=[...new Set((Array.isArray(users)?users:[]).filter(snowflake))].slice(0,100);
  return selected.length?{parse:[],users:selected}:{parse:[]};
}
