export const problem = (status, message, code) => Object.assign(new Error(message), { status, walletProblem:true, ...(code ? { code } : {}) });
export const taipeiDay = now => new Date(now + 8*3600000).toISOString().slice(0,10);
export const nextCheckin = now => new Date(Date.parse(taipeiDay(now)+'T00:00:00+08:00')+86400000).toISOString();
const MAX_BALANCE = 1_000_000_000_000;
const snowflake = value => /^\d{17,20}$/.test(value || '');

export const walletValidation = {
  assertGuild(guild){if(!this.guildIds.has(guild))throw problem(403,'此伺服器尚未開放遊戲。','GUILD_CLOSED');},
  validate(guild,user){this.assertGuild(guild);if(!snowflake(user))throw problem(400,'無效的玩家。','PLAYER_INVALID');},
  reason(reason){if(typeof reason!=='string'||!reason.trim()||reason.length>200)throw problem(400,'原因必填，最多 200 字。','REASON_REQUIRED');},
  requestId(id){if(!/^[-a-zA-Z0-9]{16,80}$/.test(id||''))throw problem(400,'無效的請求編號。','REQUEST_INVALID');}
};
