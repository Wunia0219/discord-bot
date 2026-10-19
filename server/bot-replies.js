export const BOT_COLORS = Object.freeze({ info: 0xd6b775, success: 0x68a880, warning: 0xc99456, error: 0xc85c76 });

export function privateReply(environment, description, title = '你的籌碼', tone = 'info', fields = []) {
  return { type: 4, data: {
    embeds: [{ author: { name: 'Joker’s Circus' }, title, description, color: BOT_COLORS[tone], fields,
      footer: { text: `只有你看得到${environment === 'test' ? ' · 試玩籌碼' : ''}` } }],
    flags: 64, allowed_mentions: { parse: [] },
  } };
}

// Translate known failures at the Discord boundary. Provider/database details stay internal.
export function commandError(error, { store, subcommand } = {}) {
  const number = value => value.toLocaleString('en-US');
  const messages = {
    COMMAND_SCOPE: ['回到群裡再試試', '請到有開放遊戲的群組頻道，使用這個指令。'],
    GUILD_CLOSED: ['這個群還沒開放遊戲', '換到有開放遊戲的群再試試，或找群裡的管理員問問。'],
    PLAYER_INVALID: ['重新開啟 Discord 再試試', '這次沒能認出你的帳號，重新開啟 Discord 後再試一次。'],
    COMMAND_UNKNOWN: ['這個指令還不能用', '想看籌碼可以輸入 /籌碼，想領今天的籌碼就輸入 /簽到。'],
    COMMAND_ADMIN: ['這個指令要請管理員幫忙', '發放、收回或查詢別人的籌碼，需要管理員或籌碼管理員的權限。\n想看自己的籌碼，輸入 /籌碼 就好。'],
    COMMAND_MEMBER: ['先選一位群裡的玩家', '「成員」要選這個群裡的真人玩家，機器人不能領籌碼。'],
    SUMMARY_CURSOR: ['看單局紀錄要換個分類', '「遊戲摘要」會把整段時間加總，不用填「早於編號」。\n想一局一局看，把分類改成「遊戲明細」就好。'],
    AUDIT_FILTER: ['查詢條件再選一次吧', '請從指令選單重新選好分類、期間或紀錄編號，再查一次。'],
    REQUEST_CONFLICT: ['這次操作和上一筆對不上', '請重新輸入指令再送一次，剛剛那筆不會被改動。'],
    REQUEST_INVALID: ['這次沒有送成功', '重新輸入指令再試一次，這次還沒有更動籌碼。'],
    REASON_REQUIRED: ['幫這筆留個原因吧', '請填 1～200 字，之後查紀錄時才知道為什麼發放或收回。'],
    GRANT_MISSING: ['找不到這筆發放', '確認一下「紀錄編號」，也要在當初發放的群裡操作。'],
    GRANT_REVERSED: ['這筆發放已經收回了', '這筆已經更正過，不能再收回一次。想確認的話，可以用 /籌碼管理 紀錄 看看。'],
  };
  if (error?.code === 'GRANT_AMOUNT') return { title: '籌碼數量再確認一下', message: `一次可以發 **1～${number(store.grantMax)} 籌碼**，請填整數。` };
  if (error?.code === 'GRANT_DAILY') return { title: '這筆會超過今天的額度', message: `你一天最多能發 **${number(store.grantDaily)} 籌碼**。這次少發一點試試，或台灣時間過午夜再來。` };
  if (error?.code === 'BALANCE_LIMIT') return subcommand === '更正'
    ? { title: '對方的籌碼不夠收回這一筆', message: '這筆還沒有收回，先確認對方目前的籌碼，再決定怎麼處理。' }
    : { title: '對方的籌碼快到上限了', message: '這次先不要再加了，請確認對方的籌碼後再試。' };
  const [title, message] = messages[error?.code] || ['剛剛卡住了', '過一會兒再試一次。如果一直卡住，請找管理員幫忙看看。'];
  return { title, message };
}
