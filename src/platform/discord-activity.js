import { authenticateActivity } from './discord-auth.js';
// OAuth is activated only after the local backend credentials are configured.
export function isDiscordActivity(location) {
  return new URLSearchParams(location.search).has('frame_id')
    || /^\d+\.discordsays\.com$/.test(location.hostname);
}

export async function connectActivity({
  location = window.location,
  clientId = import.meta.env?.VITE_DISCORD_CLIENT_ID,
  loadSdk = () => import('@discord/embedded-app-sdk'),
  timeoutMs = 15000,
  authEnabled = import.meta.env?.VITE_DISCORD_AUTH_ENABLED === 'true',
  fetchImpl = globalThis.fetch,
  walletEnabled = import.meta.env?.VITE_DISCORD_WALLET_ENABLED === 'true',
} = {}) {
  if (!isDiscordActivity(location)) return { mode: 'browser' };
  if (!/^\d{17,20}$/.test(clientId || '')) {
    throw new Error('尚未設定 Discord Application ID。請設定 VITE_DISCORD_CLIENT_ID，重新建置，再重新開啟 Activity。');
  }
  const params = new URLSearchParams(location.search);
  if (!params.get('frame_id') || !params.get('instance_id') || !['desktop', 'mobile'].includes(params.get('platform'))) {
    throw new Error('缺少 Discord 啟動資訊，請從 Discord 的應用程式啟動器開啟遊戲。');
  }
  const { DiscordSDK, Common } = await loadSdk();
  const sdk = new DiscordSDK(clientId, { disableConsoleLogOverride: true });
  let timer;
  try {
    await Promise.race([
      sdk.ready(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Discord 連線逾時。請確認 Application ID 與 URL Mapping，關閉 Activity 後重新啟動。')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  // Mobile uses the portrait composition in every Discord presentation mode.
  // Older clients may reject this optional command; that must not block startup.
  if (sdk.commands?.setOrientationLockState) {
    const orientation = params.get('platform') === 'mobile'
      ? Common.OrientationLockStateTypeObject.PORTRAIT
      : Common.OrientationLockStateTypeObject.UNLOCKED;
    sdk.commands.setOrientationLockState({
      lock_state: orientation,
      picture_in_picture_lock_state: orientation,
      grid_lock_state: orientation,
    }).catch(error => console.warn('Discord orientation remains client-controlled:', error.message));
  }
  const identity = authEnabled ? await authenticateActivity(sdk, clientId, fetchImpl,walletEnabled) : null;
  return { mode: 'discord', sdk, user:walletEnabled?identity?.user:identity,session:walletEnabled?identity?.session:null };
}
