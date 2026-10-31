import {DEFAULT_CHECKIN_REWARDS} from '../../game/checkin-rewards.js';
const fmt = n => n.toLocaleString('en-US');

export function dailyRewardView({ daily = DEFAULT_CHECKIN_REWARDS[0], weeklyCheckin, claimed = false, claiming = false, busy = false, ready = false }) {
  if (claiming) return { title: '領取中…', detail: '馬上就好', disabled: true };
  const day=weeklyCheckin?.day||1;
  if (claimed) return { title: '週簽到・已領取', detail: `明日 ${fmt(weeklyCheckin?.nextReward??DEFAULT_CHECKIN_REWARDS[0])} 戲籌`, disabled: busy || !ready };
  return { title: `週簽到・第 ${day} 天`, detail: `可領 ${fmt(daily)} 戲籌`, disabled: busy || !ready };
}

// Display a useful next step, never an unfiltered server/SDK exception.
export function playerError(error, { context = 'game', canClaim = false } = {}) {
  const message = String(error?.message || '');
  if (error?.status === 401) return { title: '重新連線就能繼續', message: '登入已過期，請重新開啟遊戲。', reconnect: true };
  if (error?.status === 503 && error?.code === 'FIRESTORE_BUDGET') return { title: '遊戲暫時休息中', message: '服務使用量已達保護上限，暫時無法操作戲籌。請等候管理員處理，重新開啟遊戲無法解除。' };
  if (/戲籌不足|戲籌不夠/.test(message)) return { title: '戲籌不夠這次下注', message: canClaim ? '可先領今日簽到，或調低下注額。' : '請調低下注額，或明天簽到後再玩。' };
  if (context === 'load') return { title: '遊戲還沒準備好', message: '請重新開啟遊戲；仍無法載入時，試著更新 Discord 或瀏覽器。' };
  if (/私訊|伺服器頻道/.test(message) || error?.status === 403) return { title: '換個入口再試試', message: '請到已開放的群組頻道，重新開啟遊戲。' };
  if (/授權/.test(message)) return { title: '還差一步就能開始', message: '請重新開啟遊戲並完成 Discord 授權。' };
  if (context === 'checkin') return { title: '簽到獎勵尚未確認', message: '請稍後再試，已領取的獎勵不會重複發放。' };
  if (context === 'ledger') return { title: '暫時看不到收支紀錄', message: '請稍後再開啟紀錄，不影響戲籌。' };
  if (context === 'connect') return { title: '暫時連不上遊戲', message: '請稍後重新開啟遊戲。' };
  if (error?.status === 429) return { title: '稍等一下', message: '請稍候幾秒再試。' };
  if (/網路|中斷|逾時/.test(message)) return { title: '連線不太穩', message: '請稍後再按 SPIN，會先確認上一局，不重複扣款。' };
  return { title: '剛剛沒有順利完成', message: '請稍後再試一次。' };
}

export function ledgerLabel(entry) {
  if(entry.kind==='reset')return '餘額重設';
  return { checkin: '週簽到', test_seed: '歡迎戲籌', welcome: '新手戲籌', spin: '戲籌變化', grant: '收到戲籌', reversal: '戲籌調整' }[entry.kind] || '戲籌變化';
}

export function changeLabel(value) {
  return value > 0 ? `增加 ${fmt(value)}` : value < 0 ? `減少 ${fmt(-value)}` : '戲籌不變';
}
