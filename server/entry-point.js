// Only update the existing global Activity entry. Other commands remain intact.
export async function configureQuietLaunch({ clientId, clientSecret, fetchImpl = fetch }) {
  if (!/^\d{17,20}$/.test(clientId || '') || !clientSecret?.trim()) throw new Error('請設定 Application ID 與後端密鑰。');
  const auth = await fetchImpl('https://discord.com/api/v10/oauth2/token', {
    method: 'POST', headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'applications.commands.update' }),
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (!auth.ok) throw new Error(`指令授權失敗（HTTP ${auth.status}）`);
  const { access_token: token } = await auth.json();
  if (!token) throw new Error('Discord 未提供指令授權。');
  const base = `https://discord.com/api/v10/applications/${clientId}/commands`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const get = () => fetchImpl(base, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
  const listed = await get();
  if (!listed.ok) throw new Error(`讀取啟動入口失敗（HTTP ${listed.status}）`);
  const entries = (await listed.json()).filter(command => command.type === 4);
  if (entries.length !== 1 || !/^\d{17,20}$/.test(entries[0].id)) throw new Error('找不到唯一的 Activity 啟動入口，請確認 Activities 已啟用。');
  const entry = entries[0];
  if (entry.handler !== 1) {
    const updated = await fetchImpl(`${base}/${entry.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ handler: 1 }),
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!updated.ok) throw new Error(`更新啟動入口失敗（HTTP ${updated.status}）`);
  }
  const verified = await get();
  if (!verified.ok || !(await verified.json()).some(command => command.id === entry.id && command.type === 4 && command.handler === 1)) throw new Error('尚未確認啟動入口更新成功。');
  return { id: entry.id, name: entry.name, handler: 1, changed: entry.handler !== 1 };
}
