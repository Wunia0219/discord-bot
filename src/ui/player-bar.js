import './player-ui.css';
import { dailyRewardView } from './player-copy.js';
import { discordAvatarUrl } from '../platform/discord-avatar.js';

export function createPlayerBar({ icon, version, onCheckin, onHistory, onRules, onSound, avatarUrlForUser = discordAvatarUrl }) {
  const element = document.createElement('div');
  element.className = 'player-bar';
  element.innerHTML = `<div class="player-identity" role="group" aria-label="玩家資訊"><span class="player-avatar" aria-hidden="true"><span class="player-avatar-fallback">${icon('user')}</span><img class="player-avatar-image" alt="" decoding="async" referrerpolicy="no-referrer" hidden /><i></i></span><div class="player-identity-text"><strong id="player-name">歡迎來到馬戲團</strong><span id="player-id">正在準備遊戲</span></div></div>
    <button id="daily-checkin" class="daily-checkin" hidden disabled>${icon('gift')}<span><strong>每日簽到</strong><small>領取今日籌碼</small></span></button>
    <nav class="player-tools" aria-label="遊戲工具"><span class="game-version" aria-label="遊戲版本 ${version}">v${version}</span><button id="all-history" class="utility" aria-label="遊玩紀錄" title="遊玩紀錄" aria-haspopup="dialog">${icon('clock')}<span>遊玩紀錄</span></button><button id="sound" class="icon-button" aria-label="開啟音效" title="開啟音效" aria-pressed="false">${icon('muted')}</button><button id="help" class="utility" aria-label="遊戲規則" title="遊戲規則" aria-haspopup="dialog">${icon('info')}<span>遊戲規則</span></button></nav>`;
  for (const [id, handler] of [['daily-checkin', onCheckin], ['all-history', onHistory], ['help', onRules], ['sound', onSound]]) element.querySelector(`#${id}`).addEventListener('click', handler);
  const avatarImage = element.querySelector('.player-avatar-image');
  const avatarFallback = element.querySelector('.player-avatar-fallback');
  let avatarUrl = null;
  avatarImage.addEventListener('load', () => {
    if (avatarImage.currentSrc !== avatarUrl) return;
    avatarImage.hidden = false;
    avatarFallback.hidden = true;
  });
  avatarImage.addEventListener('error', () => {
    avatarImage.hidden = true;
    avatarFallback.hidden = false;
  });
  return {
    element,
    update({ user, connected = false, ready = false, busy = false, claiming = false, claimed = false, daily = 500, storageAvailable = true }) {
      const name = user ? user.global_name || user.username : '訪客玩家';
      const nameNode = element.querySelector('#player-name');
      nameNode.textContent = name;
      nameNode.title = user ? `${name} (@${user.username})` : name;
      const idNode = element.querySelector('#player-id');
      idNode.textContent = user ? `ID ${user.id}` : storageAvailable ? '進度保存在這台裝置' : '離開後不會保留進度';
      element.querySelector('.player-identity').classList.toggle('is-connected', !!user);
      const nextAvatarUrl = avatarUrlForUser(user);
      if (nextAvatarUrl !== avatarUrl) {
        avatarUrl = nextAvatarUrl;
        avatarImage.hidden = true;
        avatarFallback.hidden = false;
        if (avatarUrl) avatarImage.src = avatarUrl;
        else avatarImage.removeAttribute('src');
      }
      const button = element.querySelector('#daily-checkin');
      button.hidden = !connected;
      const view = dailyRewardView({ ready, busy, claiming, claimed, daily });
      button.querySelector('strong').textContent = view.title;
      button.querySelector('small').textContent = view.detail;
      button.disabled = view.disabled;
      button.setAttribute('aria-busy', String(claiming));
      button.classList.toggle('is-claimed', claimed && !claiming);
      button.classList.toggle('is-loading', claiming);
      button.title = '每日可領取一次，台灣時間凌晨 00:00 更新';
    },
    sound(enabled) {
      const button = element.querySelector('#sound');
      const text = enabled ? '關閉音效' : '開啟音效';
      button.innerHTML = icon(enabled ? 'sound' : 'muted');
      button.setAttribute('aria-pressed', String(enabled));
      button.setAttribute('aria-label', text);
      button.title = text;
    },
  };
}
