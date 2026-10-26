const fmt = n => n.toLocaleString('en-US');

export function dailyRewardView({ daily = 100, weeklyCheckin, claimed = false, claiming = false, busy = false, ready = false }) {
  if (claiming) return { title: '領取中…', detail: '馬上就好', disabled: true };
  const day=weeklyCheckin?.day||1;
  if (claimed) return { title: '今日已領取', detail: `明天 ${fmt(weeklyCheckin?.nextReward??100)} 戲籌`, disabled: true };
  return { title: `週簽到・第 ${day} 天`, detail: `領取 ${fmt(daily)} 戲籌`, disabled: busy || !ready };
}

// Display a useful next step, never an unfiltered server/SDK exception.
export function playerError(error, { context = 'game', canClaim = false } = {}) {
  const message = String(error?.message || '');
  if (error?.status === 401) return { title: '重新連線就能繼續', message: '連線已中斷，請重新開啟遊戲。你的戲籌和紀錄都還在。', reconnect: true };
  if (/戲籌不足|戲籌不夠/.test(message)) return { title: '戲籌不夠這次下注', message: canClaim ? '先領取今日簽到的戲籌，再回來玩吧。也可以選擇較小的下注額。' : '試試較小的下注額，或明天簽到領取戲籌後再來玩。' };
  if (context === 'load') return { title: '遊戲還沒準備好', message: '請重新開啟遊戲。如果還是無法載入，試著更新 Discord 或瀏覽器後再玩。' };
  if (/私訊|伺服器頻道/.test(message) || error?.status === 403) return { title: '換個入口再試試', message: '請回到 Discord 的伺服器頻道，從應用程式選單重新開啟遊戲。' };
  if (/授權/.test(message)) return { title: '還差一步就能開始', message: '請重新開啟遊戲，允許 Discord 確認你的身分。' };
  if (context === 'checkin') return { title: '這次沒領取成功', message: '請稍後再按一次。今天的簽到只會領取一次，不會重複計算。' };
  if (context === 'ledger') return { title: '暫時看不到收支紀錄', message: '請稍後再打開看看，你的戲籌不會受到影響。' };
  if (context === 'connect') return { title: '暫時連不上遊戲', message: '請稍後重新開啟遊戲，再試一次。' };
  if (error?.status === 429) return { title: '稍等一下', message: '轉輪還在準備中，過幾秒再按一次就好。' };
  if (/網路|中斷|逾時/.test(message)) return { title: '連線不太穩', message: '請稍後再按 SPIN，我們會先確認上一局的結果，不會重複扣除下注。' };
  return { title: '剛剛沒有順利完成', message: '請稍後再試一次。' };
}

export function ledgerLabel(entry) {
  return { checkin: '週簽到', test_seed: '歡迎戲籌', spin: '戲籌變化', grant: '收到戲籌', reversal: '戲籌調整' }[entry.kind] || '戲籌變化';
}

export function changeLabel(value) {
  return value > 0 ? `增加 ${fmt(value)}` : value < 0 ? `減少 ${fmt(-value)}` : '戲籌不變';
}
