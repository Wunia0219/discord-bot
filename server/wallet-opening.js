export const INITIAL_BALANCE=10000;
export const WELCOME_REASON='新玩家起始戲籌';
export const openingKind=environment=>environment==='test'?'test_seed':'welcome';
export const isOpeningKind=kind=>kind==='test_seed'||kind==='welcome';
export const openingReason=environment=>environment==='test'?'測試環境首次戲籌':WELCOME_REASON;
export const validWelcomeEntry=entry=>entry.before===0&&entry.after===INITIAL_BALANCE&&entry.delta===INITIAL_BALANCE
  &&entry.actor===null&&entry.reference===null&&entry.reason===WELCOME_REASON;
