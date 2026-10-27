import { winTier } from '../../game/win-tier.js';

// Called after all reels finish landing, with the authoritative whole-round payout.
// Start the matching visuals and cue together; the highest tier plays only once.
export function presentRoundWin(round,{sound,celebrate,celebrateSmall}){
  const tier=winTier(round.payout,round.bet);
  if(tier){celebrate(tier,round.payout);sound.win('big');}
  else if(round.payout>round.bet){celebrateSmall();sound.win('small');}
  else if(round.payout>0)sound.win('return');
  return tier;
}
