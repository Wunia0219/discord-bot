// Compare the whole round's payout with the TOTAL paid bet.
export function winTier(payout,bet){if(!Number.isFinite(payout)||!Number.isFinite(bet)||bet<=0)return null;return payout>=bet*200?'mega':payout>=bet*50?'super':payout>=bet*20?'big':null;}
export const WIN_TITLES=Object.freeze({big:'BIG WIN',super:'SUPER WIN',mega:'MEGA WIN'});
