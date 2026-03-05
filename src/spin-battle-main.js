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

  // QR codes at all four corners
  for (const id of ['qr-tl', 'qr-tr', 'qr-bl', 'qr-br']) {
    const container = document.getElementById(id);
    if (!container) continue;
    container.innerHTML = '';
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    await QRCode.toCanvas(canvas, mobileUrl, {
      width: 120,
      margin: 1,
      color: { dark: '#1C5435', light: '#FFFFFF' },
    });
    const label = document.createElement('p');
    label.textContent = 'Spin Battle';
    container.appendChild(label);
  }

  // Initialize the game (renderer + physics + socket listeners)
  const canvas = document.getElementById('spin-canvas');
  game = new SpinGame(socket, canvas);
  game.sessionId = sid;
});

// ─── Player management ────────────────────────────────────────────────────────
socket.on('spinPlayerJoined', ({ id, color }) => {
  players.set(id, color);
  playerCount = players.size;
  _renderPlayerList();
  _updateStartButton();
});

socket.on('spinPlayerLeft', ({ id }) => {
  players.delete(id);
  playerCount = players.size;
  _renderPlayerList();
  _updateStartButton();
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
  document.getElementById('player-count-display').textContent =
    playerCount >= 1
      ? `${playerCount}명 준비완료! 시작하세요.`
      : '접속 중인 플레이어가 없습니다';
}

function _updateStartButton() {
  document.getElementById('btn-start').disabled = playerCount < 1;
}

// ─── Start & Restart ──────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
  if (!sessionId) return;
  socket.emit('spinStartGame', { sessionId });
});

document.getElementById('btn-restart').addEventListener('click', () => {
  if (!sessionId) return;
  // 서버 라운드트립 기다리지 않고 즉시 호스트 화면 리셋
  if (game) game.reset();
  _renderPlayerList();
  _updateStartButton();
  // 서버에 알려서 모바일 클라이언트도 로비로 복귀시킴
  socket.emit('spinResetGame', { sessionId });
});

// 서버가 spinGameReset을 보내면 플레이어 목록만 동기화 (화면은 이미 전환됨)
socket.on('spinGameReset', ({ players: serverPlayers }) => {
  players.clear();
  for (const p of serverPlayers) players.set(p.id, p.color);
  playerCount = players.size;
  _renderPlayerList();
  _updateStartButton();
});
