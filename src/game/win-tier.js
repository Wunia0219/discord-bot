// Compare the whole round's payout with the TOTAL paid bet.
export const WIN_THRESHOLDS=Object.freeze({big:10,super:30,mega:100});
export function winTier(payout,bet){if(!Number.isFinite(payout)||!Number.isFinite(bet)||bet<=0)return null;return payout>=bet*WIN_THRESHOLDS.mega?'mega':payout>=bet*WIN_THRESHOLDS.super?'super':payout>=bet*WIN_THRESHOLDS.big?'big':null;}
export const WIN_TITLES=Object.freeze({big:'BIG WIN',super:'SUPER WIN',mega:'MEGA WIN'});
