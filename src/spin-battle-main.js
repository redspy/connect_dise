import { io } from 'socket.io-client';
import QRCode from 'qrcode';
import { SpinGame } from './spin-battle/SpinGame.js';

const socket = io();
let game = null;
let sessionId = null;
let playerCount = 0;
const players = new Map(); // id → color

// ─── Session creation ─────────────────────────────────────────────────────────
socket.on('connect', () => {
  socket.emit('createSpinSession');
});

socket.on('spinSessionCreated', async ({ sessionId: sid, localIp }) => {
  sessionId = sid;
  document.getElementById('session-id-display').textContent = `Session: ${sid}`;

  const scheme = window.location.protocol;
  const port = window.location.port ? `:${window.location.port}` : '';
  const mobileUrl = `${scheme}//${localIp}${port}/spin-battle/mobile.html?session=${sid}`;

  // QR code on the left
  const qrContainer = document.getElementById('qr-main');
  if (qrContainer) {
    qrContainer.innerHTML = '';
    const canvas = document.createElement('canvas');
    qrContainer.appendChild(canvas);
    await QRCode.toCanvas(canvas, mobileUrl, {
      width: 240,
      margin: 2,
      color: { dark: '#1C5435', light: '#FFFFFF' },
    });
    const label = document.createElement('p');
    label.textContent = 'Scan to join';
    qrContainer.appendChild(label);
  }

  // Initialize the game (renderer + physics + socket listeners)
  const canvas = document.getElementById('spin-canvas');
  game = new SpinGame(socket, canvas);
  game.sessionId = sid;
});

let readyCount = 0;

// ─── Player management ────────────────────────────────────────────────────────
socket.on('spinPlayerJoined', ({ id, color }) => {
  players.set(id, color);
  playerCount = players.size;
  _renderPlayerList();
});

socket.on('spinPlayerLeft', ({ id }) => {
  players.delete(id);
  playerCount = players.size;
  _renderPlayerList();
});

socket.on('spinReadyUpdate', ({ readyCount: rc, totalCount }) => {
  readyCount = rc;
  _renderPlayerList();
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
  if (playerCount === 0) {
    countEl.textContent = '접속 중인 플레이어가 없습니다';
  } else {
    countEl.textContent = `${playerCount}명 접속 중 · ${readyCount}명 준비완료`;
  }
}

// ─── Restart ──────────────────────────────────────────────────────────────────
document.getElementById('btn-restart').addEventListener('click', () => {
  if (!sessionId) return;
  if (game) game.reset();
  readyCount = 0;
  _renderPlayerList();
  socket.emit('spinResetGame', { sessionId });
});

// 서버가 spinGameReset을 보내면 플레이어 목록 동기화
socket.on('spinGameReset', ({ players: serverPlayers }) => {
  players.clear();
  for (const p of serverPlayers) players.set(p.id, p.color);
  playerCount = players.size;
  readyCount = 0;
  _renderPlayerList();
  if (game) game.reset();
});
