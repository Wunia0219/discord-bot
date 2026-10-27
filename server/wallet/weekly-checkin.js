import {taipeiDay} from './wallet-common.js';
import {DEFAULT_CHECKIN_REWARDS} from '../../src/game/checkin-rewards.js';

export {DEFAULT_CHECKIN_REWARDS};
const validRewards=value=>Array.isArray(value)&&value.length===7&&[...value].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1_000_000_000_000);
export function checkinRewards(value=DEFAULT_CHECKIN_REWARDS){
  const rewards=typeof value==='string'?value.split(',').map(n=>/^\s*\d+\s*$/.test(n)?Number(n):NaN):value;
  if(!validRewards(rewards))throw new Error('WEEKLY_CHECKIN_REWARDS requires seven positive safe integer amounts');
  return Object.freeze([...rewards]);
}
export const previousDay=day=>{
  const time=Date.parse(day+'T00:00:00+08:00');
  return Number.isFinite(time)?taipeiDay(time-86400000):null;
};
export function validCheckinReceipt(receipt,amount){
  return receipt?.version===1&&Number.isInteger(receipt.cycleDay)&&receipt.cycleDay>=1&&receipt.cycleDay<=7
    &&validRewards(receipt.rewards)&&receipt.rewards[receipt.cycleDay-1]===amount;
}
// The last receipt is a cache on Firestore wallets. The immutable operation
// result is authoritative and survives existing SQLite/cloud backup formats.
export function weeklyCheckinState(lastDay,receipt,day,rewards){
  if(receipt!=null&&!validCheckinReceipt(receipt,receipt.rewards?.[receipt.cycleDay-1]))throw new Error('Invalid weekly checkin receipt');
  const claimed=lastDay===day,cycleDay=receipt?.cycleDay||0;
  const current=claimed?cycleDay:lastDay===previousDay(day)&&cycleDay?cycleDay%7+1:1;
  const nextDay=current%7+1;
  return {claimed,daily:claimed&&receipt?receipt.rewards[current-1]:rewards[Math.max(0,current-1)],
    weeklyCheckin:{day:current,rewards:[...rewards],nextDay,nextReward:rewards[nextDay-1]}};
}
export function checkinReceipt(lastDay,receipt,day,rewards){
  const state=weeklyCheckinState(lastDay,receipt,day,rewards);
  if(state.claimed)throw new Error('Checkin already claimed without original operation');
  return {version:1,cycleDay:state.weeklyCheckin.day,rewards:[...rewards]};
}

// Validate new receipts against their immutable predecessor. Historical flat
// rewards have no receipt and form the boundary where the new cycle starts.
export function validCheckinTransition(result,prior,day){
  if(!Object.hasOwn(result,'checkin'))return !prior?.checkin;
  if(!validCheckinReceipt(result.checkin,result.entry?.delta))return false;
  const expected=prior?.day===previousDay(day)&&prior.checkin?prior.checkin.cycleDay%7+1:1;
  return result.checkin.cycleDay===expected;
}
