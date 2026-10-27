import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WalletStore } from '../server/wallet/wallet.js';
import { Highlights, highlightsConfig } from '../server/discord/highlights.js';
import { highlightCard, highlightTier, HIGHLIGHT_WINDOW_MS, HIGHLIGHT_INTERVAL_MS, HIGHLIGHT_MAX_AGE_MS } from '../server/discord/highlight-card.js';
import { roundFromStops } from '../src/game/index.js';
import { readFileSync } from 'node:fs';

const guild = '100000000000000001', user = '100000000000000002', otherGuild = '100000000000000003';
const channel = '100000000000000004', messageId = '100000000000000005';
const webhookUrl = 'https://discord.com/api/webhooks/100000000000000006/fake-test-webhook';
const examples = JSON.parse(readFileSync(new URL('../docs/data/math-report.json', import.meta.url))).examples;

function fixture(t, options = {}) {
  let now = Date.parse('2026-10-19T08:00:00Z');
  const store = new WalletStore({ guildIds: [guild, otherGuild], clock: () => now, spinDelay: 0 });
  const calls = [], warnings = [];
  const fetchImpl = async (url, opts = {}) => {
    if (!opts.method) return Response.json({ type: 1, guild_id: guild, channel_id: channel });
    calls.push({ url, method: opts.method, payload: JSON.parse(opts.body) });
    return options.send ? options.send(url, opts) : Response.json({ id: messageId });
  };
  const highlights = new Highlights(store, { guild, webhookUrl, clock: () => now, fetchImpl, warn: text => warnings.push(text) });
  t.after(async () => { await highlights.close(); store.close(); });
  const session = { guild, user, profile: { name: '霓妮亞' } };
  const result = (tier = 'super', overrides = {}) => {
    const id = randomUUID(), round = { ...roundFromStops(20, examples[tier].stops), id, bet: 20, time: new Date(now).toISOString(), ...overrides };
    // Seed a committed, audited result; never alter RNG to create public test wins.
    store.db.prepare('INSERT INTO rounds VALUES(?,?,?,?,?)').run(guild, user, id, JSON.stringify(round), now);
    return round;
  };
  return { store, highlights, calls, warnings, session, result, advance: value => { now += value; } };
}

test('highlights follow 30/100 total-bet thresholds and publish only the highest tier', () => {
  for (const bet of [20, 100, 200, 500]) {
    for (const [multiple, tier] of [[0, null], [10, null], [29.99, null], [30, 'super'], [99.99, 'super'], [100, 'mega'], [2700, 'mega']]) {
      assert.equal(highlightTier(bet * multiple, bet), tier);
    }
  }
});

test('cards show names and multipliers without amounts, mentions, IDs, or expanded text', () => {
  const payload = highlightCard([
    { name: '**玩家** <@123> @everyone\n\u202e', tier: 'mega', multiplier: 125.5, bet: 500, payout: 62750 },
    ...Array.from({ length: 10 }, () => ({ name: '名'.repeat(100), tier: 'super', multiplier: 30 })),
  ], 11);
  assert.equal(payload.flags, 4096);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  const embed = payload.embeds[0];
  assert.equal(embed.title, 'MEGA WIN · 這局太猛了');
  assert.equal(embed.color, 0xc85c76);
  assert.equal(embed.fields.length, 5);
  assert.match(embed.fields[0].value, /125.5×/);
  assert.match(embed.footer.text, /11 次大獎/);
  const raw = JSON.stringify(payload);
  assert.doesNotMatch(raw, /62750|戲籌|餘額|<@|@everyone|\u202e|payout|bet|12750/);
  assert.ok(embed.fields.every(field => field.name.length <= 256 && field.value.length <= 1024));
  assert.match(embed.fields[0].name, /^\\\*\\\*/);
  assert.equal(highlightCard([{ name: '玩家', tier: 'super', multiplier: 30 }]).embeds[0].color, 0xd6b775);
});

test('only committed rounds for the authenticated account/guild enqueue, with durable deduplication', async t => {
  const { store, highlights, session, result, calls } = fixture(t);
  const round = result('mega');
  assert.equal(highlights.enqueue({ ...session, user: '100000000000000099' }, round.id), false);
  assert.equal(highlights.enqueue({ ...session, guild: otherGuild }, round.id), false);
  assert.equal(highlights.enqueue(session, 'forged-round'), false);
  assert.equal(highlights.enqueue(session, result('big').id), false);
  assert.equal(highlights.enqueue(session, round.id), true);
  assert.equal(highlights.enqueue(session, round.id), false);
  await Promise.all(Array.from({ length: 20 }, () => highlights.flush()));
  assert.equal(calls.length, 1);
  assert.match(calls[0].payload.embeds[0].fields[0].value, /MEGA WIN/);
  assert.equal(store.db.prepare('SELECT COUNT(*) count FROM highlight_events').get().count, 1);
  const restarted = new Highlights(store, { guild, webhookUrl, fetchImpl: () => assert.fail('delivered round must stay deduplicated') });
  assert.equal(restarted.enqueue(session, round.id), false);
  await restarted.flush();
});

test('busy groups batch into one card, throttle edits, cap visible rows and rotate after ten minutes', async t => {
  const { highlights, session, result, calls, advance } = fixture(t);
  for (let i = 0; i < 8; i++) highlights.enqueue({ ...session, profile: { name: `玩家 ${i}` } }, result(i === 7 ? 'mega' : 'super').id);
  await highlights.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].payload.username, 'Joker’s Circus');
  assert.equal(calls[0].payload.embeds[0].fields.length, 5);
  assert.equal(calls[0].payload.embeds[0].fields[0].name, '玩家 7');
  assert.match(calls[0].payload.embeds[0].footer.text, /中了 8 次/);
  highlights.enqueue(session, result().id);
  await highlights.flush(); assert.equal(calls.length, 1);
  advance(HIGHLIGHT_INTERVAL_MS);
  await highlights.flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].payload.flags, undefined, 'edits omit creation-only notification flags');
  assert.equal(calls[1].payload.username, undefined, 'edits use only supported fields');
  assert.equal(calls[1].url, `${webhookUrl}/messages/${messageId}`);
  assert.match(calls[1].payload.embeds[0].footer.text, /中了 9 次/);
  advance(HIGHLIGHT_WINDOW_MS);
  highlights.enqueue(session, result('mega').id);
  await highlights.flush();
  assert.equal(calls[2].method, 'POST');
  assert.match(calls[2].payload.embeds[0].footer.text, /中了 1 次/);
});

test('rate limits retain the pending announcement and respect Retry-After', async t => {
  let sent = 0;
  const { highlights, session, result, calls, advance } = fixture(t, { send: () => ++sent === 1 ? Response.json({ retry_after: 45 }, { status: 429 }) : Response.json({ id: messageId }) });
  highlights.enqueue(session, result().id);
  await highlights.flush(); assert.equal(calls.length, 1);
  advance(44000); await highlights.flush(); assert.equal(calls.length, 1);
  advance(1000); await highlights.flush(); assert.equal(calls.length, 2);
  await highlights.flush(); assert.equal(calls.length, 2);
});

test('ambiguous sends and process restarts do not duplicate public cards', async t => {
  const { store, highlights, session, result, calls, advance } = fixture(t, { send: () => { throw new Error('contains-secret-webhook'); } });
  const round = result(); highlights.enqueue(session, round.id);
  await highlights.flush();
  advance(60000); highlights.enqueue(session, result().id); await highlights.flush();
  assert.equal(calls.length, 1);
  assert.equal(highlights.enqueue(session, round.id), false);
  assert.equal(store.db.prepare('SELECT status FROM highlight_events WHERE round_id=?').get(round.id).status, 'uncertain');
  store.db.prepare("UPDATE highlight_events SET status='sending' WHERE status='pending'").run();
  new Highlights(store, { guild, webhookUrl, fetchImpl: () => assert.fail('must not post') });
  assert.equal(store.db.prepare("SELECT COUNT(*) count FROM highlight_events WHERE status='sending'").get().count, 0);
});

test('expired announcements are skipped and a deleted board can recover on the next tick', async t => {
  let sent = 0;
  const { highlights, session, result, calls, advance } = fixture(t, { send: () => ++sent === 2 ? Response.json({}, { status: 404 }) : Response.json({ id: messageId }) });
  const stale = result(); advance(HIGHLIGHT_MAX_AGE_MS + 1);
  assert.equal(highlights.enqueue(session, stale.id), false);
  highlights.enqueue(session, result().id); await highlights.flush();
  advance(HIGHLIGHT_INTERVAL_MS); highlights.enqueue(session, result().id); await highlights.flush();
  assert.equal(calls[1].method, 'PATCH');
  advance(HIGHLIGHT_INTERVAL_MS); await highlights.flush();
  assert.equal(calls[2].method, 'POST');
  assert.match(calls[2].payload.embeds[0].footer.text, /中了 1 次/);
});

test('webhook configuration is explicit, constrained to Discord and isolated by guild', async t => {
  const { store, session, result } = fixture(t);
  assert.equal(highlightsConfig({}, store), null);
  for (const url of ['https://other.example/api/webhooks/100000000000000006/token', webhookUrl + '?thread_id=123', 'file:///secret', 'not-a-url']) {
    assert.throws(() => highlightsConfig({ DISCORD_HIGHLIGHTS_GUILD_ID: guild, DISCORD_HIGHLIGHTS_WEBHOOK_URL: url }, store), /Invalid/);
  }
  assert.throws(() => highlightsConfig({ DISCORD_HIGHLIGHTS_WEBHOOK_URL: webhookUrl }, store), /尚未開放/);
  const safe = highlightsConfig({ DISCORD_HIGHLIGHTS_GUILD_ID: guild, DISCORD_HIGHLIGHTS_WEBHOOK_URL: webhookUrl }, store, {
    fetchImpl: async (url, opts) => {
      assert.equal(opts.method, undefined, 'cross-guild webhook must never receive a POST');
      return Response.json({ type: 1, guild_id: otherGuild, channel_id: channel });
    }, warn: () => {}, clock: () => Date.parse('2026-10-19T08:00:00Z'),
  });
  safe.enqueue(session, result().id); await safe.flush();
  assert.equal(store.db.prepare("SELECT status FROM highlight_events").get().status, 'pending');
});
