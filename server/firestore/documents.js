export const unpack=doc=>doc.exists?JSON.parse(doc.get('json')):null;
export const zeroSummary=()=>({checkin:{days:0,total:0},game:{rounds:0,bet:0,payout:0,net:0}});
