import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyRewardView, playerError, ledgerLabel } from '../src/ui/player-copy.js';

test('daily reward keeps a clear, disabled state during a claim and after it is claimed', () => {
  assert.deepEqual(dailyRewardView({ready:true,daily:500}), {title:'每日簽到',detail:'領取 500 戲籌',disabled:false});
  assert.equal(dailyRewardView({ready:true,busy:true}).disabled,true);
  assert.equal(dailyRewardView({ready:false}).disabled,true);
  assert.deepEqual(dailyRewardView({ready:true,claiming:true}), {title:'領取中…',detail:'馬上就好',disabled:true});
  assert.deepEqual(dailyRewardView({ready:true,claimed:true}), {title:'今日已領取',detail:'明天再領 500 戲籌',disabled:true});
});

test('player errors never expose raw server/SDK details and give an action appropriate to the operation', () => {
  const raw=new Error('SQLITE_FAILURE /private/session-token URL Mapping VITE_DISCORD_CLIENT_ID');
  for (const context of ['game','load','connect','checkin','ledger']) {
    const copy=playerError(raw,{context});
    assert.doesNotMatch(copy.message,/SQLITE|session-token|Mapping|VITE|後端/);
    assert.ok(copy.title.length>0 && copy.message.length>0);
  }
  const offline=new Error('網路中斷');
  assert.match(playerError(offline).message,/上一局/);
  assert.doesNotMatch(playerError(offline,{context:'checkin'}).message,/SPIN|上一局/);
  assert.equal(playerError({status:401}).reconnect,true);
  assert.match(playerError(new Error('戲籌不足'),{canClaim:true}).message,/今日簽到/);
  assert.match(playerError(new Error('戲籌不足'),{canClaim:false}).message,/明天/);
});

test('ledger labels describe player actions without internal transaction names', () => {
  assert.equal(ledgerLabel({kind:'test_seed'}),'歡迎戲籌');
  assert.equal(ledgerLabel({kind:'spin'}),'戲籌變化');
  assert.equal(ledgerLabel({kind:'grant'}),'收到戲籌');
  assert.equal(ledgerLabel({kind:'reversal'}),'戲籌調整');
});
