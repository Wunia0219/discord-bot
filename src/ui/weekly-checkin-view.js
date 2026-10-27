import {DEFAULT_CHECKIN_REWARDS} from '../game/checkin-rewards.js';

export function weeklyCheckinView(state,{ready=true,busy=false,claiming=false}={}){
  const progress=state.weeklyCheckin,rewards=progress?.rewards||DEFAULT_CHECKIN_REWARDS;
  const day=progress?.day??1,legacy=state.claimed&&day===0,current=legacy?0:Math.min(7,Math.max(1,day));
  const completed=state.claimed?current:current-1;
  return {rewards,total:rewards.reduce((n,value)=>n+value,0),day:current,completed,claimed:!!state.claimed,legacy,
    today:state.daily??rewards[Math.max(0,current-1)],nextDay:progress?.nextDay??(current%7+1),
    nextReward:progress?.nextReward??rewards[current%7],disabled:claiming||state.claimed||!ready||busy,claiming,
    days:rewards.map((reward,i)=>({day:i+1,reward,status:i<completed?'complete':i+1===current&&!state.claimed?'today':'future'}))};
}
