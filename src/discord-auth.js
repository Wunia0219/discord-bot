// Phase 2 authenticates identity only. Wallets and history are still local test data.
export async function authenticateActivity(sdk, clientId, fetchImpl = fetch, walletEnabled=false) {
  if(walletEnabled&&!sdk.guildId)throw new Error('請從伺服器頻道開啟遊戲；伺服器錢包不支援私訊。');
  let code;
  try {
    ({ code } = await sdk.commands.authorize({ client_id:clientId, response_type:'code', state:'', prompt:'none', scope:walletEnabled?['identify','guilds.members.read']:['identify'] }));
  } catch { throw new Error('Discord 授權尚未完成，請重新開啟活動並同意基本身分授權。'); }
  if (!code) throw new Error('Discord 未提供授權碼，請重新開啟活動。');
  let accessToken,session;
  try {
    const response = await fetchImpl('/api/token', {
      method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ code,...(walletEnabled?{guildId:sdk.guildId}:{}) }),
      signal:AbortSignal.timeout(15000), cache:'no-store',
    });
    if (!response.ok) throw new Error('Token exchange failed');
    ({ access_token:accessToken, session } = await response.json());
    if (typeof accessToken !== 'string' || !accessToken) throw new Error('Missing token');
  } catch { throw new Error('登入服務暫時無法使用，請確認後端已啟動，再重新開啟活動。'); }
  try {
    const auth = await sdk.commands.authenticate({ access_token:accessToken });
    if (!/^\d{17,20}$/.test(auth?.user?.id || '') || typeof auth.user.username !== 'string') throw new Error('Missing identity');
    const { id, username, global_name, avatar } = auth.user;
    // Deliberately discard access_token and all unrelated SDK response fields.
    if(walletEnabled&&(!session?.token||session.userId!==id||session.guildId!==sdk.guildId))throw new Error('Invalid wallet session');
    const user={ id, username, global_name:global_name || null, avatar:avatar || null };
    return walletEnabled?{user,session}:user;
  } catch { throw new Error('Discord 身分驗證失敗，請重新開啟活動。'); }
}
