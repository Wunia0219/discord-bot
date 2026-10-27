import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createActivityServer } from '../server/app.js';
import { WalletStore } from '../server/wallet.js';

const app = '100000000000000001';
const guild = '100000000000000002';
const otherGuild = '100000000000000003';
const member = '100000000000000004';
const recipient = '100000000000000005';
const adminRole = '100000000000000006';
let interactionId = 200000000000000000n;

function command(name, overrides = {}) {
  return {
    id: String(++interactionId), type: 2, application_id: app, guild_id: guild,
    member: { user: { id: member, bot: false }, permissions: '0', roles: [] },
    data: { name }, ...overrides,
  };
}

function management(name, args = {}, overrides = {}) {
  return command('戲籌管理', {
    member: { user: { id: member, bot: false }, permissions: '8', roles: [] },
    data: {
      name: '戲籌管理',
      resolved: { members: { [recipient]: {} }, users: { [recipient]: { bot: false } } },
      options: [{ name, options: Object.entries(args).map(([name, value]) => ({ name, value })) }],
    },
    ...overrides,
  });
}

function card(response, tone = 'info') {
  assert.equal(response.type, 4);
  assert.equal(response.data.flags, 64, 'command responses must be private');
  assert.deepEqual(response.data.allowed_mentions, { parse: [] });
  assert.equal(response.data.embeds.length, 1);
  const embed = response.data.embeds[0];
  assert.equal(embed.color, { info: 0xd6b775, success: 0x68a880, warning: 0xc99456, error: 0xc85c76 }[tone]);
  return embed;
}

async function fixture(t, { walletEnabled = true, environment = 'test', ...storeOptions } = {}) {
  let now = Date.parse('2026-10-18T15:59:59Z');
  const store = new WalletStore({ guildIds: [guild, otherGuild], environment, clock: () => now, ...storeOptions });
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const server = createActivityServer({
    clientId: app, publicKey,
    wallet: walletEnabled ? { store, adminRoles: [adminRole] } : null,
    fetchImpl: () => assert.fail('bot tests must never contact Discord'),
  });
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    store.close();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/api/interactions`;

  async function send(interaction, {
    body = JSON.stringify(interaction), signedBody = body,
    timestamp = String(Math.floor(Date.now() / 1000)), signingKey = keys.privateKey,
    method = 'POST', headers = {},
  } = {}) {
    const signature = sign(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(signedBody)]), signingKey).toString('hex');
    return fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-signature-timestamp': timestamp, 'x-signature-ed25519': signature, ...headers },
      ...(method === 'POST' ? { body } : {}),
    });
  }

  async function invoke(interaction) {
    const response = await send(interaction);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  }

  return { store, send, invoke, advance: milliseconds => { now += milliseconds; } };
}

test('Discord PING verifies its signature and works before the wallet is enabled', async t => {
  const { invoke, store } = await fixture(t, { walletEnabled: false });
  assert.deepEqual(await invoke({ type: 1 }), { type: 1 });
  const response = await invoke(command('戲籌'));
  assert.equal(response.data.flags, 64);
  assert.match(card(response,'warning').description, /找管理員/);
  assert.equal(store.history(guild, member).length, 0);
});

test('signed Activity entry opens quietly, without a public invite, and still enforces the guild allowlist', async t => {
  const { invoke, store } = await fixture(t);
  const entry = command('啟動', { data: { name: '啟動', type: 4 } });
  assert.deepEqual(await invoke(entry), { type: 12 });
  assert.equal(store.db.prepare('SELECT COUNT(*) count FROM wallets').get().count, 0);
  assert.match(card(await invoke({ ...entry, guild_id: '100000000000000099' }), 'error').description, /有開放遊戲的群/);
  assert.match(card(await invoke({ ...entry, member: { user: { id: member, bot: true } } }), 'error').description, /群組頻道/);
});

test('interaction HTTP authentication rejects forged, expired and malformed requests before writing wallets', async t => {
  const { send, store } = await fixture(t);
  const interaction = command('簽到');
  const seconds = Math.floor(Date.now() / 1000);
  const cases = [
    ['missing signature', {}, { headers: { 'x-signature-ed25519': '' } }, 401],
    ['malformed signature', {}, { headers: { 'x-signature-ed25519': 'xyz' } }, 401],
    ['tampered body', interaction, { signedBody: JSON.stringify({ type: 1 }) }, 401],
    ['wrong key', interaction, { signingKey: generateKeyPairSync('ed25519').privateKey }, 401],
    ['expired timestamp', interaction, { timestamp: String(seconds - 600) }, 401],
    ['future timestamp', interaction, { timestamp: String(seconds + 600) }, 401],
    ['malformed timestamp', interaction, { timestamp: 'invalid' }, 401],
    ['signed invalid JSON', interaction, { body: '{' }, 400],
    ['wrong application', { ...interaction, application_id: recipient }, {}, 403],
    ['missing application', { ...interaction, application_id: undefined }, {}, 403],
    ['wrong HTTP method', interaction, { method: 'GET' }, 405],
    ['oversized request', interaction, { body: 'x'.repeat(65537) }, 413],
  ];
  for (const [name, payload, options, status] of cases) {
    await t.test(name, async () => {
      assert.equal((await send(payload, options)).status, status);
      assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM wallets').get().count, 0);
    });
  }
});

test('balance seeds once and retired checkin commands never award chips, even after midnight', async t => {
  const { invoke, store, advance } = await fixture(t);
  for (let i = 0; i < 2; i++) {
    const balance = card(await invoke(command('戲籌')));
    assert.match(balance.description, /10,000/);
    assert.match(balance.footer.text, /試玩戲籌/);
  }
  // Use different interaction IDs, as repeated clicks do, rather than replaying one request.
  const responses = await Promise.all(Array.from({ length: 8 }, () => invoke(command('簽到'))));
  for (const response of responses) {
    assert.equal(card(response).title,'請在遊戲內簽到');
    assert.equal(response.data.components[0].components[0].label,'開啟遊戲');
  }
  assert.equal(store.history(guild, member).filter(entry => entry.kind === 'test_seed').length, 1);
  assert.equal(store.history(guild, member).filter(entry => entry.kind === 'checkin').length, 0);
  advance(2000);
  assert.equal(card(await invoke(command('簽到'))).title,'請在遊戲內簽到');
  assert.equal(store.state(guild,member).balance,10000);
  assert.equal(store.history(guild, member).filter(entry => entry.kind === 'checkin').length, 0);
});

test('bot balances and daily claims stay separate for each member and guild', async t => {
  const { invoke, store } = await fixture(t);
  store.checkin(guild,member);
  const secondMember = command('戲籌', { member: { user: { id: recipient }, permissions: '0' } });
  assert.match(card(await invoke(secondMember)).description, /10,000/);
  assert.match(card(await invoke(command('戲籌', { guild_id: otherGuild }))).description, /10,000/);
  store.checkin(otherGuild,member);
  assert.match(card(await invoke(command('戲籌', { guild_id: otherGuild }))).description, /10,500/);
  assert.match(card(await invoke(command('戲籌'))).description, /10,500/);
});

test('production bot wallets receive welcome chips without a test-environment label', async t => {
  const { invoke, store } = await fixture(t, { environment: 'production' });
  const balance = card(await invoke(command('戲籌')));
  assert.match(balance.description, /\*\*10,000 戲籌\*\*/);
  assert.doesNotMatch(JSON.stringify(balance), /測試環境|試玩戲籌/);
  assert.equal(card(await invoke(command('簽到'))).title,'請在遊戲內簽到');
  store.checkin(guild,member);
  assert.match(card(await invoke(command('戲籌'))).description, /\*\*10,500 戲籌/);
  assert.deepEqual(store.history(guild, member).map(entry => entry.kind), ['checkin','welcome']);
});

test('bot rejects DMs, disabled guilds, bot callers and unsupported commands without ledger entries', async t => {
  const { invoke, store } = await fixture(t);
  const cases = [
    ['DM', command('簽到', { guild_id: undefined, member: undefined }), /群組頻道/],
    ['disabled guild', command('簽到', { guild_id: '100000000000000099' }), /有開放遊戲的群/],
    ['bot caller', command('簽到', { member: { user: { id: member, bot: true } } }), /群組頻道/],
    ['missing member identity', command('簽到', { member: {} }), /群組頻道/],
    ['unsupported interaction', command('簽到', { type: 3 }), /重新輸入 \/戲籌管理/],
    ['unknown command', command('不存在的指令'), /\/戲籌.*\/戲籌管理/],
  ];
  for (const [name, interaction, message] of cases) {
    await t.test(name, async () => {
      assert.match(card(await invoke(interaction), 'error').description, message);
      assert.equal(store.history(guild, member).length, 0);
    });
  }
});

test('all management operations reject regular members; a configured role can grant and read history', async t => {
  const { invoke, store } = await fixture(t, { environment: 'production' });
  const regular = { user: { id: member }, permissions: '0', roles: [recipient] };
  for (const [name, args] of [
    ['發放', { 成員: recipient, 數量: 500, 原因: '功能測試' }],
    ['紀錄', { 成員: recipient }],
    ['更正', { 紀錄編號: 1, 原因: '功能測試' }],
  ]) {
    assert.match(card(await invoke(management(name, args, { member: regular })), 'error').description, /需要管理員/);
  }
  assert.equal(store.history(guild, recipient).length, 0);
  const manager = { ...regular, roles: [adminRole] };
  assert.match(card(await invoke(management('發放', { 成員: recipient, 數量: 500, 原因: '功能測試' }, { member: manager })), 'success').description, /500 戲籌/);
  const history = card(await invoke(management('紀錄', { 成員: recipient }, { member: manager })));
  assert.equal(history.fields.length, 1);
  assert.match(history.fields[0].name, /收到戲籌/);
  assert.equal(store.state(guild, recipient).balance, 10500);
});

test('admin grants settle once under concurrent delivery, reject changed retries, and enforce daily limits', async t => {
  const { invoke, store } = await fixture(t, { environment: 'production', grantMax: 1000, grantDaily: 1500 });
  const grant = management('發放', { 成員: recipient, 數量: 1000, 原因: '活動測試' });
  const responses = await Promise.all(Array.from({ length: 6 }, () => invoke(grant)));
  assert.equal(responses.filter(response => response.data.embeds[0].color === 0x68a880).length, 1);
  assert.equal(responses.filter(response => response.data.embeds[0].color === 0xc99456).length, 5);
  for (const response of responses) {
    card(response, response.data.embeds[0].color === 0x68a880 ? 'success' : 'warning');
  }
  const changed = structuredClone(grant);
  changed.data.options[0].options.find(option => option.name === '數量').value = 500;
  assert.match(card(await invoke(changed), 'error').description, /剛剛那筆不會被改動/);
  const overLimit = management('發放', { 成員: recipient, 數量: 600, 原因: '超過當日額度' });
  assert.match(card(await invoke(overLimit), 'error').description, /1,500 戲籌/);
  assert.equal(store.state(guild, recipient).balance, 11000);
  assert.equal(store.history(guild, recipient).length, 2);
});

test('invalid grant amounts, reasons and recipients return private errors without crediting chips', async t => {
  const { invoke, store } = await fixture(t, { environment: 'production' });
  const valid = { 成員: recipient, 數量: 500, 原因: '功能測試' };
  const cases = [
    ...[0, -1, 100001, 1.5].map(amount => [`amount ${amount}`, management('發放', { ...valid, 數量: amount }), /1～100,000 戲籌.*整數/]),
    ['empty reason', management('發放', { ...valid, 原因: ' ' }), /請填 1～200 字/],
    ['long reason', management('發放', { ...valid, 原因: '測'.repeat(201) }), /請填 1～200 字/],
    ['invalid request ID', management('發放', valid, { id: 'bad' }), /重新輸入指令/],
  ];
  const outsider = management('發放', valid);
  outsider.data.resolved.members = {};
  cases.push(['nonmember recipient', outsider, /真人玩家/]);
  const bot = management('發放', valid);
  bot.data.resolved.users[recipient].bot = true;
  cases.push(['bot recipient', bot, /真人玩家/]);
  for (const [name, interaction, message] of cases) {
    await t.test(name, async () => {
      assert.match(card(await invoke(interaction), 'error').description, message);
      assert.equal(store.history(guild, recipient).length, 0);
    });
  }
});

test('correction commands link the original grant, deduplicate retries and reject cross-guild reversals', async t => {
  const { invoke, store } = await fixture(t, { environment: 'production' });
  await invoke(management('發放', { 成員: recipient, 數量: 500, 原因: '誤發測試' }));
  const original = store.history(guild, recipient)[0];
  const correction = management('更正', { 紀錄編號: original.id, 原因: '撤銷測試發放' });
  const crossGuild = { ...correction, guild_id: otherGuild };
  assert.match(card(await invoke(crossGuild), 'error').description, /當初發放的群/);
  assert.equal(store.state(guild, recipient).balance, 10500);
  assert.match(card(await invoke(correction), 'warning').description, /收回 \*\*500 戲籌/);
  assert.match(card(await invoke(correction), 'warning').description, /沒有再扣一次/);
  assert.match(card(await invoke({ ...correction, id: String(++interactionId) }), 'error').description, /已經更正過/);
  const history = card(await invoke(management('紀錄', { 成員: recipient })));
  assert.equal(history.fields.length, 2);
  assert.match(history.fields[0].value, new RegExp(`對應發放：#${original.id}`));
  assert.match(history.fields[1].value, /已收回/);
  assert.equal(store.state(guild, recipient).balance, 10000);
  assert.deepEqual(store.history(guild, recipient).map(entry => entry.kind), ['reversal', 'grant','welcome']);
});

test('audit commands paginate rewards without duplicates and expose daily and empty game summaries', async t => {
  const { invoke, store } = await fixture(t, { environment: 'production' });
  const empty = card(await invoke(management('紀錄', { 成員: recipient })));
  assert.equal(empty.fields.length, 0);
  assert.match(empty.description, /還沒有發放或收回/);
  for (let i = 0; i < 12; i++) {
    card(await invoke(management('發放', { 成員: recipient, 數量: 1, 原因: `分頁測試 ${i}` })), 'success');
  }
  const first = card(await invoke(management('紀錄', { 成員: recipient })));
  assert.equal(first.fields.length, 10);
  const cursor = Number(first.description.match(/填入 (\d+)/)[1]);
  const second = card(await invoke(management('紀錄', { 成員: recipient, 早於編號: cursor })));
  assert.equal(second.fields.length, 2);
  assert.equal(new Set([...first.fields, ...second.fields].map(field => field.name)).size, 12);
  assert.match(second.description, /最早一筆/);

  store.checkin(guild,recipient);
  const daily = card(await invoke(management('紀錄', { 成員: recipient, 分類: 'checkin', 期間: 1 })));
  assert.match(daily.description, /簽到 1 天.*500 戲籌/);
  assert.equal(daily.fields.length, 1);
  const summary = card(await invoke(management('紀錄', { 成員: recipient, 分類: 'summary', 期間: 1 })));
  assert.deepEqual(summary.fields.map(field => field.value), ['0', '0', '0', '+0']);
  assert.match(card(await invoke(management('紀錄', { 成員: recipient, 分類: 'summary', 早於編號: cursor })), 'error').description, /不用填「早於編號」/);
});
