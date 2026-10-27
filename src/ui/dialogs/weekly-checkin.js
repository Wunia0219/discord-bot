import {weeklyCheckinView} from './weekly-checkin-view.js';
import {icon} from '../shared/icons.js';
import './weekly-checkin.css';

const fmt=n=>n.toLocaleString('en-US');
const node=(tag,className,text)=>{
  const el=document.createElement(tag);el.className=className;if(text!==undefined)el.textContent=text;return el;
};

export function createWeeklyCheckin({onClaim}){
  const element=node('section','weekly-checkin');
  const intro=node('div','checkin-intro'),copy=node('div','checkin-intro-copy');
  copy.append(node('span','checkin-eyebrow','JOKER’S CIRCUS'),node('h3','','連續簽到，天天有禮'),node('p','','每天回來簽到，累積七日獎勵。'));
  const total=node('div','checkin-total');total.append(node('span','','七日總獎勵'),node('strong','',''),node('small','','戲籌'));
  intro.append(copy,total);
  const progress=node('div','checkin-progress'),progressText=node('div','checkin-progress-text'),count=node('strong',''),hint=node('span','');
  progressText.append(count,hint);const track=node('div','checkin-track');track.setAttribute('role','progressbar');track.setAttribute('aria-label','本輪簽到進度');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','7');
  for(let i=0;i<7;i++)track.append(node('span',''));
  progress.append(progressText,track);
  const list=node('ol','checkin-days');list.setAttribute('aria-label','七日簽到獎勵');
  const cards=Array.from({length:7},(_,i)=>{
    const card=node('li',i===6?'checkin-day is-finale':'checkin-day'),heading=node('div','checkin-day-heading'),label=node('span','',`第 ${i+1} 天`),status=node('span','checkin-day-status');
    heading.append(label,status);const gift=node('span','checkin-day-icon');gift.innerHTML=icon(i===6?'gift':'coin');
    const amount=node('div','checkin-day-amount');amount.append(node('strong','',''),node('span','','戲籌'));
    card.append(heading,gift,amount);list.append(card);return {card,status,amount,gift};
  });
  const rules=node('p','checkin-rules','每天限領一次，台灣時間 00:00 更新。連續簽滿 7 天，隔天開啟新一輪；漏簽一天，從第 1 天開始。');
  const message=node('p','checkin-message');message.setAttribute('role','status');message.setAttribute('aria-live','polite');message.setAttribute('aria-atomic','true');message.hidden=true;
  const action=node('button','checkin-claim');action.type='button';action.addEventListener('click',()=>onClaim());
  const next=node('p','checkin-next');element.append(intro,progress,list,rules,message,action,next);
  let progressKey=null;
  return {element,
    message(text,tone='info'){message.textContent=text;message.dataset.tone=tone;message.hidden=!text;},
    update(state,options){
      const view=weeklyCheckinView(state,options);total.querySelector('strong').textContent=fmt(view.total);
      const nextKey=`${state.nextCheckin}:${view.day}:${view.claimed}`;
      if(progressKey!==nextKey){message.hidden=true;message.textContent='';progressKey=nextKey;}
      count.textContent=`已簽到 ${view.completed} / 7 天`;
      hint.textContent=view.claimed?'今日簽到完成':`今日第 ${view.day} 天`;
      track.setAttribute('aria-valuenow',String(view.completed));track.setAttribute('aria-valuetext',`本輪已完成 ${view.completed} 天簽到，7 天為一輪`);
      [...track.children].forEach((tick,i)=>tick.classList.toggle('is-complete',i<view.completed));
      cards.forEach(({card,status,amount,gift},i)=>{
        const day=view.days[i];card.classList.toggle('is-complete',day.status==='complete');card.classList.toggle('is-today',day.status==='today');
        if(day.status==='today')card.setAttribute('aria-current','step');else card.removeAttribute('aria-current');
        status.textContent=day.status==='complete'?'已領取':day.status==='today'?'今日可領':'未解鎖';
        gift.innerHTML=icon(day.status==='complete'?'check':i===6?'gift':'coin');amount.querySelector('strong').textContent=fmt(day.reward);
      });
      action.disabled=view.disabled;action.setAttribute('aria-busy',String(view.claiming));
      action.textContent=view.claiming?'正在領取獎勵…':view.claimed?'今日獎勵已領取':`領取 ${fmt(view.today)} 戲籌`;
      next.textContent=view.claimed?`明天第 ${view.nextDay} 天，可領 ${fmt(view.nextReward)} 戲籌。`:`完成今日簽到，明天第 ${view.nextDay} 天可領 ${fmt(view.nextReward)} 戲籌。`;
      if(view.legacy)next.textContent='今天的獎勵已領取，明天開始累積七日簽到。';
      else if(view.claimed&&view.today!==view.rewards[view.day-1])next.textContent=`今日已按原獎勵金額領取 ${fmt(view.today)} 戲籌；明天第 ${view.nextDay} 天可領 ${fmt(view.nextReward)} 戲籌。`;
    },
  };
}
