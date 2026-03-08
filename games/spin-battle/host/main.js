import { HostSDK } from '../../../platform/client/HostSDK.js';
import { SpinGame } from './SpinGame.js';
import { renderQR } from '../../../platform/client/shared/QRDisplay.js';
import { DevPanel } from './DevPanel.js';

const IS_DEV = new URLSearchParams(location.search).has('dev');

const host = new HostSDK({ gameId: 'spin-battle' });
let game = null;
const players = new Map(); // id → color
let readyCount = 0;

host.on('sessionReady', async ({ qrUrl }) => {
  document.getElementById('session-id-display').textContent = host.getSessionId();

  const qrContainer = document.getElementById('qr-main');
  await renderQR(qrContainer, qrUrl, { width: 200 });

  const canvas = document.getElementById('spin-canvas');
  game = new SpinGame(host, canvas, { devMode: IS_DEV });

  if (IS_DEV) {
    new DevPanel({
      onSpawnIntervalChange: (ms) => game?.setItemSpawnInterval(ms),
      onVisualParamChange: (key, value) => game?.setVisualParam(key, value),
      onVisualReset: () => game?.resetVisualParams(),
      getVisualState: () => game?.getVisualState() || {},
    });
  }
});

host.on('playerJoin', (player) => {
  players.set(player.id, player.color);
  _renderPlayerList();
});

host.on('playerLeave', (playerId) => {
  players.delete(playerId);
  _renderPlayerList();
});

host.on('readyUpdate', ({ readyCount: rc }) => {
  readyCount = rc;
  _renderPlayerList();
});

host.on('reset', () => {
  readyCount = 0;
  players.clear();
  for (const p of host.getPlayers()) players.set(p.id, p.color);
  _renderPlayerList();
  if (game) game.reset();
});

function _renderPlayerList() {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  for (const [, color] of players) {
    const dot = document.createElement('div');
    dot.className = 'player-dot';
    dot.style.background = color;
    list.appendChild(dot);
  }
  const countEl = document.getElementById('player-count-display');
  if (players.size === 0) {
    countEl.textContent = '접속 중인 플레이어가 없습니다';
  } else {
    countEl.textContent = `${players.size}명 접속 중 · ${readyCount}명 준비완료`;
  }
}

document.getElementById('btn-restart').addEventListener('click', () => {
  readyCount = 0;
  _renderPlayerList();
  host.resetSession();
});
