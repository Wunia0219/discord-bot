import test from 'node:test';
import assert from 'node:assert/strict';
import {weeklyCheckinView} from '../src/ui/weekly-checkin-view.js';
import {weeklyCheckinState} from '../server/weekly-checkin.js';
import {DEFAULT_CHECKIN_REWARDS as rewards} from '../src/game/checkin-rewards.js';
import {WalletStore} from '../server/wallet.js';
const receipt=day=>({version:1,cycleDay:day,rewards:[...rewards]});

test('seven-day reward table totals 10000 and progress distinguishes completed, claimable and future days',()=>{
  assert.deepEqual(rewards,[500,500,1000,1000,1000,2000,4000]);
  const state=weeklyCheckinState('2026-10-26',receipt(2),'2026-10-27',rewards),v=weeklyCheckinView(state);
  assert.equal(v.total,10000);assert.equal(v.today,1000);assert.equal(v.completed,2);assert.equal(v.day,3);assert.equal(v.nextReward,1000);
  assert.deepEqual(v.days.map(d=>d.status),['complete','complete','today','future','future','future','future']);assert.equal(v.disabled,false);
  assert.equal(weeklyCheckinView(state,{claiming:true}).disabled,true);assert.equal(weeklyCheckinView(state,{ready:false}).disabled,true);
});

test('claimed seventh day, wrap, missed days and legacy receipts show the actual server progression',()=>{
  const claimed=weeklyCheckinView(weeklyCheckinState('2026-10-27',receipt(7),'2026-10-27',rewards));
  assert.equal(claimed.completed,7);assert.equal(claimed.nextDay,1);assert.equal(claimed.nextReward,500);assert.equal(claimed.disabled,true);
  const wrap=weeklyCheckinView(weeklyCheckinState('2026-10-27',receipt(7),'2026-10-28',rewards));assert.equal(wrap.completed,0);assert.equal(wrap.day,1);assert.equal(wrap.today,500);
  const missed=weeklyCheckinView(weeklyCheckinState('2026-10-25',receipt(5),'2026-10-27',rewards));assert.equal(missed.day,1);assert.equal(missed.completed,0);
  const legacy=weeklyCheckinView(weeklyCheckinState('2026-10-27',null,'2026-10-27',rewards));assert.equal(legacy.legacy,true);assert.equal(legacy.completed,0);assert.equal(legacy.disabled,true);assert.equal(legacy.nextDay,1);
});

test('new defaults do not repay an already claimed old reward, and future claims adopt the new table',t=>{
  let now=Date.parse('2026-10-27T01:00:00Z');const guild='100000000000000001',user='100000000000000002';
  const s=new WalletStore({guildIds:[guild],clock:()=>now,weeklyRewards:[100,200,300,400,500,600,700]});t.after(()=>s.close());
  const old=s.checkin(guild,user);s.weeklyRewards=rewards;const view=weeklyCheckinView(s.state(guild,user));
  assert.equal(old.entry.delta,100);assert.equal(view.today,100);assert.equal(view.rewards[0],500);assert.equal(view.nextReward,500);
  assert.deepEqual(s.checkin(guild,user).entry,old.entry);assert.equal(s.state(guild,user).balance,10100);
  now+=86400000;assert.equal(s.checkin(guild,user).entry.delta,500);assert.equal(s.state(guild,user).balance,10600);
});
