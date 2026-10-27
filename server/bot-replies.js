export const BOT_COLORS = Object.freeze({ info: 0xd6b775, success: 0x68a880, warning: 0xc99456, error: 0xc85c76 });

export function privateReply(environment, description, title = '你的戲籌', tone = 'info', fields = []) {
  return { type: 4, data: {
    embeds: [{ author: { name: 'Joker’s Circus' }, title, description, color: BOT_COLORS[tone], fields,
      footer: { text: `只有你看得到${environment === 'test' ? ' · 試玩戲籌' : ''}` } }],
    flags: 64, allowed_mentions: { parse: [] },
  } };
}

// Translate known failures at the Discord boundary. Provider/database details stay internal.
export function commandError(error, { store, subcommand } = {}) {
  const number = value => value.toLocaleString('en-US');
  const messages = {
    PANEL_INVALID: ['請重新開啟面板', '這個操作已無法使用，請重新輸入 /戲籌管理。'],
    PANEL_OWNER: ['請開啟自己的面板', '這張卡片屬於另一位使用者，請自行輸入 /戲籌管理。'],
    PANEL_EXPIRED: ['這張表單已過期', '請重新輸入 /戲籌管理，再開啟新的表單或確認卡。'],
    PANEL_NUMBER: ['數量或編號再確認一下', '請填寫正整數，不需要加逗號或其他符號。'],
    WALLET_CURSOR: ['請重新查詢玩家戲籌', '請返回管理面板，重新選擇「玩家戲籌」。'],
    RESET_CONFIRM: ['確認後才會重設', '這會將本群所有已建立錢包的玩家重設為 **10,000 戲籌**。\n週簽到與遊玩歷史保留；系統會保存每位玩家重設前一刻的實際餘額。\n確定執行時，請將「確認」選為 True。'],
    RESET_PAGE: ['報表頁碼再確認一下', '請使用上次重設報表下方的翻頁按鈕。'],
    RESET_MISSING: ['還沒有重設報表', '本群尚未完成過戲籌重設，完成第一次重設後就能在這裡查看。'],
    RESET_REPLACED: ['已有更新的重設報表', '剛剛又完成了一次重設。請回到管理面板，重新選擇「重設全群」→「上次重設報表」。這次查詢沒有更動戲籌。'],
    RESET_EMPTY: ['本群還沒有玩家錢包', '目前沒有可重設的錢包。玩家開啟遊戲或簽到後，才會建立錢包。'],
    RESET_LIMIT: ['本次重設超出安全範圍', '本群的錢包數量或資料量超出單筆安全交易上限。這次沒有變更任何餘額，請先聯絡維護人員調整容量。'],
    RESET_INVALID: ['錢包資料需要核對', '這次沒有變更任何餘額，請聯絡維護人員核對錢包資料後再操作。'],
    FIRESTORE_BUDGET: ['今天先休息一下', '服務今天的使用量較高，暫時不能操作戲籌。請稍後再試，或找管理員幫忙看看。'],
    COMMAND_SCOPE: ['回到群裡再試試', '請到有開放遊戲的群組頻道，使用這個指令。'],
    GUILD_CLOSED: ['這個群還沒開放遊戲', '換到有開放遊戲的群再試試，或找群裡的管理員問問。'],
    PLAYER_INVALID: ['重新開啟 Discord 再試試', '這次沒能認出你的帳號，重新開啟 Discord 後再試一次。'],
    COMMAND_UNKNOWN: ['請使用目前的指令', '輸入 /戲籌 查看餘額或開啟遊戲；管理員可輸入 /戲籌管理 開啟面板。簽到請在遊戲內領取。'],
    COMMAND_ADMIN: ['這個指令要請管理員幫忙', '發放、收回或查詢別人的戲籌，需要管理員或戲籌管理員的權限。\n想看自己的戲籌，輸入 /戲籌 就好。'],
    COMMAND_MEMBER: ['先選一位群裡的玩家', '「成員」要選這個群裡的真人玩家，機器人不能領戲籌。'],
    SUMMARY_CURSOR: ['看單局紀錄要換個分類', '「遊戲摘要」會把整段時間加總，不用填「早於編號」。\n想一局一局看，把分類改成「遊戲明細」就好。'],
    AUDIT_FILTER: ['查詢條件再選一次吧', '請從管理面板重新查詢紀錄，再使用下方選單選擇分類與期間。'],
    REQUEST_CONFLICT: ['這次操作和上一筆對不上', '請重新輸入指令再送一次，剛剛那筆不會被改動。'],
    REQUEST_INVALID: ['這次沒有送成功', '重新輸入指令再試一次，這次還沒有更動戲籌。'],
    REASON_REQUIRED: ['幫這筆留個原因吧', '請填 1～200 字，之後查紀錄時才知道為什麼發放或收回。'],
    GRANT_MISSING: ['找不到這筆發放', '確認一下「紀錄編號」，也要在當初發放的群裡操作。'],
    GRANT_REVERSED: ['這筆發放已經收回了', '這筆已經更正過，不能再收回一次。請在 /戲籌管理 面板選擇「查詢紀錄」查看。'],
  };
  if(error?.code==='COMMAND_CHANNEL'&&/^\d{17,20}$/.test(error.channel||''))return {title:'請到遊戲頻道操作',message:`請到 <#${error.channel}> 使用指令或開啟遊戲。`};
  if (error?.code === 'GRANT_AMOUNT') return { title: '戲籌數量再確認一下', message: `一次可以發 **1～${number(store.grantMax)} 戲籌**，請填整數。` };
  if (error?.code === 'GRANT_DAILY') return { title: '這筆會超過今天的額度', message: `你一天最多能發 **${number(store.grantDaily)} 戲籌**。這次少發一點試試，或台灣時間過午夜再來。` };
  if (error?.code === 'BALANCE_LIMIT') return subcommand === '更正'
    ? { title: '對方的戲籌不夠收回這一筆', message: '這筆還沒有收回，先確認對方目前的戲籌，再決定怎麼處理。' }
    : { title: '對方的戲籌快到上限了', message: '這次先不要再加了，請確認對方的戲籌後再試。' };
  const [title, message] = messages[error?.code] || ['剛剛卡住了', '過一會兒再試一次。如果一直卡住，請找管理員幫忙看看。'];
  return { title, message };
}
