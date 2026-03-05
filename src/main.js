import { io } from 'socket.io-client';
import QRCode from 'qrcode';
import DiceBox from '@3d-dice/dice-box';

// Socket connects using current origin (proxied to node)
const socket = io();

// Initialize 3D Dice with local assets
// v1.1.0+ API uses a single config object
const diceBox = new DiceBox({
  container: '#dice-box',
  assetPath: '/assets/dice-box/',
  origin: window.location.origin,
  theme: 'default',
  themeColor: '#FFD700',
  offscreen: false,
  spinForce: 10, // 회전력 증가
  throwForce: 20, // 던지는 힘 증가
  gravity: 1.5, // 중력 약간 증가 (바닥에 더 세게 부딪혀 튕김)
  linearDamping: 0.3, // 공기 저항 감소 (기본 ~0.5) → 더 오래 굴러다님
  angularDamping: 0.2, // 회전 저항 감소 → 더 오래 회전
  restitution: 0.5, // 탄성 증가 (기본 ~0.3) → 더 잘 튕김
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

// Update UI elements
const sessionInfo = document.getElementById('session-info');
const playerStatus = document.getElementById('player-status');
const qrContainers = [
  document.getElementById('qr-top-left'),
  document.getElementById('qr-top-right'),
  document.getElementById('qr-bottom-left'),
  document.getElementById('qr-bottom-right'),
];

let currentSession = null;
let playerCount = 0;

socket.on('connect', () => {
  console.log('Connected to server, requesting session...');
  socket.emit('createSession');
});

socket.on('sessionCreated', async ({ sessionId, localIp }) => {
  currentSession = sessionId;
  sessionInfo.innerHTML = `Session ID<br><strong>${sessionId}</strong>`;

  // Mobile Network URL utilizes the backend resolved IP to bypass localhost bindings
  const scheme = window.location.protocol;
  // Keep the port the same as where the Vite app is running (e.g. 5173)
  const port = window.location.port ? `:${window.location.port}` : '';
  const mobileUrl = `${scheme}//${localIp}${port}/mobile.html?session=${sessionId}`;

  // Generate QRs
  for (const container of qrContainers) {
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    await QRCode.toCanvas(canvas, mobileUrl, {
      width: 120,
      margin: 1,
      color: { dark: '#1C5435', light: '#FFFFFF' },
    });

    const text = document.createElement('p');
    text.textContent = 'Scan to Join';
    container.appendChild(text);
  }
});

socket.on('playerJoined', (playerId) => {
  playerCount++;
  updatePlayerStatus();
});

socket.on('playerLeft', (playerId) => {
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

// Test button to verify engine independently
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

// Listen for remote throw from the server (which forwards it from mobile)
socket.on('remoteThrow', ({ playerId, strength, color }) => {
  console.log(`Player ${playerId} threw the dice with color ${color}!`);

  // UI Feedback that event was received
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
    console.warn('3D Dice engine is not loaded yet! Queueing roll...');
    // Optionally wait and retry once
    setTimeout(() => {
      if (isDiceReady) diceBox.roll('2d6');
    }, 1000);
    return;
  }

  console.log('Executing diceBox.roll...');
  const canvas = document.querySelector('#dice-box canvas');
  if (canvas) {
    canvas.style.filter = `drop-shadow(0 0 30px ${color || '#FFFFFF'})`;
  }

  // Roll single dice (1d6) to match mobile, and apply the player's color
  diceBox
    .roll('1d6', {
      themeColor: color || '#FFD700',
    })
    .then((results) => {
      console.log('Roll animation success:', results);
      // Fade out glow after some time
      setTimeout(() => {
        if (canvas)
          canvas.style.filter =
            'drop-shadow(0 0 15px rgba(255, 255, 255, 0.5))';
      }, 3000);
    })
    .catch((err) => {
      console.error('Dice roll failed:', err);
      // Fallback: try simple string notation
      diceBox.roll('1d6');
    });
});
