import { HostSDK } from '../../../platform/client/HostSDK.js';
import { renderQR } from '../../../platform/client/shared/QRDisplay.js';
import DiceBox from '@3d-dice/dice-box';

const host = new HostSDK({ gameId: 'dice' });
let playerCount = 0;
let uiRestoreTimer = null;

const sessionInfo = document.getElementById('session-info');
const playerStatus = document.getElementById('player-status');
const qrContainers = [
  document.getElementById('qr-top-left'),
  document.getElementById('qr-top-right'),
  document.getElementById('qr-bottom-left'),
  document.getElementById('qr-bottom-right'),
];

const diceBox = new DiceBox({
  container: '#dice-box',
  assetPath: '/assets/dice-box/',
  origin: window.location.origin,
  theme: 'default',
  themeColor: '#FFD700',
  offscreen: false,
  spinForce: 10,
  throwForce: 20,
  gravity: 1.5,
  linearDamping: 0.3,
  angularDamping: 0.2,
  restitution: 0.5,
  scale: 6,
});

let isDiceReady = false;
diceBox
  .init()
  .then(() => {
    console.log('DiceBox ready');
    isDiceReady = true;
  })
  .catch((err) => {
    console.error('DiceBox init failed:', err);
  });

host.on('sessionReady', async ({ qrUrl }) => {
  sessionInfo.innerHTML = `Session ID<br><strong>${host.getSessionId()}</strong>`;
  for (const container of qrContainers) {
    await renderQR(container, qrUrl, { width: 120 });
    const text = document.createElement('p');
    text.textContent = 'Scan to Join';
    container.appendChild(text);
  }
});

host.on('playerJoin', () => {
  playerCount++;
  updatePlayerStatus();
});

host.on('playerLeave', () => {
  playerCount = Math.max(0, playerCount - 1);
  updatePlayerStatus();
});

function updatePlayerStatus() {
  if (playerCount > 0) {
    playerStatus.textContent = `${playerCount} Player(s) connected and ready!`;
    playerStatus.style.color = '#00C851';
  } else {
    playerStatus.textContent = 'Waiting for players...';
    playerStatus.style.color = '#F0F0F0';
  }
}

function restoreUI() {
  const centerStatus = document.querySelector('.center-status');
  if (centerStatus) centerStatus.classList.remove('hidden');
  
  const qrs = document.querySelectorAll('.qr-container');
  qrs.forEach(qr => qr.classList.remove('hidden'));
}

function hideUI() {
  const centerStatus = document.querySelector('.center-status');
  if (centerStatus) centerStatus.classList.add('hidden');
  
  const qrs = document.querySelectorAll('.qr-container');
  qrs.forEach(qr => qr.classList.add('hidden'));

  if (uiRestoreTimer) {
    clearTimeout(uiRestoreTimer);
  }
  uiRestoreTimer = setTimeout(restoreUI, 10000); // 10초 후 복구
}

host.onMessage('resetDice', () => {
  if (uiRestoreTimer) {
    clearTimeout(uiRestoreTimer);
    uiRestoreTimer = null;
  }
  restoreUI();
});

host.onMessage('throwDice', (player, { strength, color }) => {
  console.log(`Player ${player.id} threw the dice with color ${color}!`);

  hideUI();

  playerStatus.textContent = 'Rolling dice!! 🎲';
  playerStatus.style.color = color || '#FFD700';

  const centerStatus = document.querySelector('.center-status');
  if (centerStatus) {
    centerStatus.style.boxShadow = `inset 0 0 20px rgba(0,0,0,0.5), 0 0 30px ${color || '#FFD700'}`;
    setTimeout(() => {
      updatePlayerStatus();
      centerStatus.style.boxShadow = '';
    }, 3000);
  }

  if (!isDiceReady) {
    setTimeout(() => {
      if (isDiceReady) diceBox.roll('2d6');
    }, 1000);
    return;
  }

  const canvas = document.querySelector('#dice-box canvas');
  if (canvas) {
    canvas.style.filter = `drop-shadow(0 0 30px ${color || '#FFFFFF'})`;
  }

  diceBox
    .roll('1d6', { themeColor: color || '#FFD700' })
    .then(() => {
      setTimeout(() => {
        if (canvas)
          canvas.style.filter = 'drop-shadow(0 0 15px rgba(255, 255, 255, 0.5))';
      }, 3000);
    })
    .catch((err) => {
      console.error('Dice roll failed:', err);
      diceBox.roll('1d6');
    });
});

document.getElementById('test-roll-btn').addEventListener('click', () => {
  console.log('Manual test roll triggered');
  if (isDiceReady) {
    diceBox
      .roll('1d6')
      .then(() => console.log('Roll success'))
      .catch((e) => console.error('Roll error:', e));
  } else {
    console.warn('Dice engine not ready yet');
  }
});
