import { highlightTier, highlightCard, highlightAnnouncement, HIGHLIGHT_WINDOW_MS, HIGHLIGHT_INTERVAL_MS, HIGHLIGHT_MAX_AGE_MS, HIGHLIGHT_VISIBLE } from './highlight-card.js';
import {casinoBotSettings,CasinoBot} from './casino-bot.js';

const snowflake = value => /^\d{17,20}$/.test(value || '');

export function highlightSettings(env, store) {
  const bot=casinoBotSettings(env,store);
  if(bot){if(env.DISCORD_HIGHLIGHTS_WEBHOOK_URL?.trim())throw new Error('Choose one casino announcement sender');return {guild:bot.guild,botSettings:bot};}
  const raw = env.DISCORD_HIGHLIGHTS_WEBHOOK_URL?.trim();
  if (!raw) return null;
  const guild = env.DISCORD_HIGHLIGHTS_GUILD_ID?.trim() || (store.guildIds.size === 1 ? [...store.guildIds][0] : '');
  store.assertGuild(guild);
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid DISCORD_HIGHLIGHTS_WEBHOOK_URL'); }
  if (url.origin !== 'https://discord.com' || !/^\/api(?:\/v10)?\/webhooks\/\d{17,20}\/[A-Za-z0-9._-]+$/.test(url.pathname) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid DISCORD_HIGHLIGHTS_WEBHOOK_URL');
  }
  return {guild,webhookUrl:url.href};
}

export function highlightsConfig(env, store, options = {}) {
  const settings=highlightSettings(env,store);
  return settings?new Highlights(store,{...settings,...options}):null;
}

// A separate, persisted notification queue. Sending never participates in settlement.
// No webhook tokens, amounts, balances, bets, or OAuth tokens enter these tables/cards.
export class Highlights {
  constructor(store, { guild, webhookUrl, botSettings, bot, fetchImpl = fetch, clock = Date.now, warn = message => console.warn(message) }) {
    store.assertGuild(guild);
    Object.assign(this, { store, guild, webhookUrl, fetchImpl, clock, warn });
    this.bot=bot||(botSettings?new CasinoBot({...botSettings,fetchImpl,clock}):null);
    this.timer = null;
    this.running = null;
    this.destinationVerified = false;
    this.destinationRetryAt = 0;
    // A process may have stopped after Discord accepted a POST. Do not post it again.
    store.db.prepare("UPDATE highlight_events SET status='uncertain' WHERE guild=? AND status='sending'").run(guild);
  }

  enqueue(session, roundId) {
    if (session.guild !== this.guild) return false;
    // Read the committed result for this verified account. Client result fields are ignored.
    const record = this.store.db.prepare('SELECT data FROM rounds WHERE guild=? AND user=? AND id=?').get(session.guild, session.user, roundId);
    if (!record) return false;
    const round = JSON.parse(record.data), tier = highlightTier(round.payout, round.bet), occurred = Date.parse(round.time);
    if (!tier || !Number.isSafeInteger(round.payout) || !Number.isSafeInteger(round.bet) || !Number.isFinite(occurred) || occurred > this.clock() || this.clock() - occurred > HIGHLIGHT_MAX_AGE_MS) return false;
    return !!this.store.db.prepare('INSERT OR IGNORE INTO highlight_events(guild,round_id,name,tier,multiplier,occurred) VALUES(?,?,?,?,?,?)')
      .run(session.guild, round.id, String(session.profile?.name || '玩家').slice(0, 160), tier, round.payout / round.bet, occurred).changes;
  }

  start() {
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), HIGHLIGHT_INTERVAL_MS);
      this.timer.unref();
      void this.flush();
    }
  }

  async close() {
    clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  withRecipient(event){
    const rows=this.store.db.prepare('SELECT user FROM rounds WHERE guild=? AND id=?').all(event.guild,event.round_id);
    if(rows.length!==1||!snowflake(rows[0].user))throw new Error('Announcement round owner is ambiguous');
    return {...event,user:rows[0].user};
  }

  flush() {
    this.running ||= this.deliver().catch(() => this.warn('Discord highlights: queue unavailable')).finally(() => { this.running = null; });
    return this.running;
  }

  async deliver() {
    if(this.bot)return this.deliverBot();
    const { db } = this.store, now = this.clock();
    db.prepare("UPDATE highlight_events SET status='expired' WHERE guild=? AND status='pending' AND occurred<?").run(this.guild, now - HIGHLIGHT_MAX_AGE_MS);
    db.prepare('DELETE FROM highlight_events WHERE guild=? AND occurred<?').run(this.guild, now - 86400000);
    const board = db.prepare('SELECT * FROM highlight_boards WHERE guild=?').get(this.guild);
    if (board?.next_attempt > now) return;
    const pending = db.prepare("SELECT rowid,* FROM highlight_events WHERE guild=? AND status='pending' ORDER BY occurred,rowid LIMIT 500").all(this.guild);
    if (!pending.length) return;
    if (!this.destinationVerified) {
      if (this.destinationRetryAt > now) return;
      this.destinationRetryAt = now + 300000;
      try {
        const destination = await this.fetchImpl(this.webhookUrl, { signal: AbortSignal.timeout(8000), redirect: 'error' });
        const webhook = destination.ok ? await destination.json() : null;
        if (webhook?.type !== 1 || webhook.guild_id !== this.guild || !snowflake(webhook.channel_id)) {
          this.warn('Discord highlights: dedicated channel verification failed');
          return;
        }
        this.destinationVerified = true;
      } catch {
        this.warn('Discord highlights: dedicated channel unavailable');
        return;
      }
    }
    const editing = !!board?.message_id && now - board.started < HIGHLIGHT_WINDOW_MS;
    const entries = [...pending].reverse().map(event=>this.withRecipient(event)).map(({ name, tier, multiplier, user }) => ({ name, tier, multiplier, user }));
    entries.push(...(editing ? JSON.parse(board.entries) : []));
    entries.splice(HIGHLIGHT_VISIBLE);
    const total = pending.length + (editing ? board.total : 0);
    const started = editing ? board.started : now;
    const saveBoard = (messageId, nextAttempt) => db.prepare('INSERT OR REPLACE INTO highlight_boards VALUES(?,?,?,?,?,?)')
      .run(this.guild, messageId, started, total, JSON.stringify(entries), nextAttempt);
    const mark = status => {
      const update = db.prepare('UPDATE highlight_events SET status=? WHERE guild=? AND round_id=?');
      for (const entry of pending) update.run(status, this.guild, entry.round_id);
    };
    if (!editing) this.store.tx(() => { mark('sending'); saveBoard(null, now + HIGHLIGHT_WINDOW_MS); });
    const url = editing ? `${this.webhookUrl}/messages/${board.message_id}` : `${this.webhookUrl}?wait=true`;
    const payload = highlightCard(entries, total);
    // Discord only accepts SUPPRESS_NOTIFICATIONS when creating a message.
    if (editing) delete payload.flags;
    else payload.username = 'Joker’s Circus';
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(8000), redirect: 'error',
      });
    } catch {
      // PATCH is safe to retry; an ambiguous POST is held for this whole window.
      if (editing) db.prepare('UPDATE highlight_boards SET next_attempt=? WHERE guild=?').run(now + 60000, this.guild);
      else mark('uncertain');
      this.warn('Discord highlights: delivery uncertain');
      return;
    }
    if (response.ok) {
      let message;
      try { message = await response.json(); } catch { /* handled as uncertain below */ }
      const messageId = editing ? board.message_id : message?.id;
      if (snowflake(messageId)) {
        this.store.tx(() => { mark('sent'); saveBoard(messageId, now + HIGHLIGHT_INTERVAL_MS); });
        return;
      }
    }
    if (response.status === 429 || [400, 401, 403, 404].includes(response.status)) {
      let delay = 300000;
      if (response.status === 429) {
        let retry;
        try { retry = Number((await response.json()).retry_after); } catch { /* use fallback */ }
        delay = Number.isFinite(retry) && retry > 0 ? Math.min(300000, Math.max(HIGHLIGHT_INTERVAL_MS, retry * 1000)) : 60000;
      }
      this.store.tx(() => {
        mark('pending');
        if (editing && response.status === 404) db.prepare('DELETE FROM highlight_boards WHERE guild=?').run(this.guild);
        else if (editing) db.prepare('UPDATE highlight_boards SET next_attempt=? WHERE guild=?').run(now + delay, this.guild);
        else saveBoard(null, now + delay);
      });
    } else {
      if (editing) db.prepare('UPDATE highlight_boards SET next_attempt=? WHERE guild=?').run(now + 60000, this.guild);
      else mark('uncertain');
    }
    // Provider responses and URLs can contain secrets. Log only a status code.
    this.warn(`Discord highlights: HTTP ${response.status}`);
  }
  async deliverBot(){
    const now=this.clock(),db=this.store.db;
    const board=db.prepare('SELECT * FROM highlight_boards WHERE guild=?').get(this.guild);if(board?.next_attempt>now)return;
    db.prepare("UPDATE highlight_events SET status='expired' WHERE guild=? AND status='pending' AND occurred<?").run(this.guild,now-HIGHLIGHT_MAX_AGE_MS);
    const event=db.prepare("SELECT * FROM highlight_events WHERE guild=? AND status='pending' ORDER BY occurred,round_id LIMIT 1").get(this.guild);if(!event)return;
    db.prepare("UPDATE highlight_events SET status='sending' WHERE guild=? AND round_id=?").run(this.guild,event.round_id);
    const result=await this.bot.send(highlightAnnouncement(this.withRecipient(event)),'win:'+this.guild+':'+event.round_id);
    this.store.tx(()=>{
      db.prepare('UPDATE highlight_events SET status=? WHERE guild=? AND round_id=?').run(result.kind==='retry'?'pending':result.kind,this.guild,event.round_id);
      db.prepare('INSERT OR REPLACE INTO highlight_boards VALUES(?,?,?,?,?,?)').run(this.guild,result.messageId||null,now,1,JSON.stringify([{name:event.name,tier:event.tier,multiplier:event.multiplier}]),now+(result.delay||HIGHLIGHT_INTERVAL_MS));
    });
  }
}
