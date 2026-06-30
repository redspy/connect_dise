import { MobileSDK } from '../../../platform/client/MobileSDK.js';

const mobile = new MobileSDK();
const BOARD_SIZE = 13;

const connectionStatus = document.getElementById('connection-status');
const roleDisplay = document.getElementById('role-display');
const readyStatusText = document.getElementById('ready-status-text');

// Screens
const screens = {
  waiting: document.getElementById('phase-lobby'), // fallback to data-screen
  myTurn: document.querySelector('[data-screen="my-turn"]'),
  opponentTurn: document.querySelector('[data-screen="opponent-turn"]'),
  result: document.querySelector('[data-screen="result"]'),
};

const selectionInfo = document.getElementById('selection-info');
const btnPlayStone = document.getElementById('btn-play-stone');
const btnReady = document.getElementById('btn-ready');

if (btnReady) {
  btnReady.addEventListener('click', () => {
    btnReady.disabled = true;
    btnReady.textContent = '준비완료 ✓';
    mobile.ready();
  });
}

let myColor = null; // 'black' or 'white'
let localBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
let selectedCell = null; // { r, c }

// ─── Screen Transition Helper ──────────────────────────────────────────────

function showScreen(name) {
  document.querySelectorAll('.omok-screen').forEach(el => {
    el.classList.toggle('hidden', el.dataset.screen !== name);
  });
}

// ─── SDK Handlers ──────────────────────────────────────────────────────────

mobile.on('join', () => {
  connectionStatus.classList.add('connected');
  showScreen('waiting');
  readyStatusText.textContent = '방에 입장했습니다. 대기 중...';
});

mobile.on('rejoin', () => {
  connectionStatus.classList.add('connected');
});

mobile.on('reset', () => {
  myColor = null;
  selectedCell = null;
  roleDisplay.classList.add('hidden');
  roleDisplay.className = 'role-badge hidden';
  roleDisplay.textContent = '';
  localBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
  
  if (btnReady) {
    btnReady.disabled = false;
    btnReady.textContent = '준비하기';
  }

  showScreen('waiting');
  readyStatusText.textContent = '세션이 리셋되었습니다. 대기 중...';
});

mobile.on('hostDisconnect', () => {
  connectionStatus.classList.remove('connected');
  alert('호스트와 연결이 끊어졌습니다.');
});

// ─── Game Message Listeners ────────────────────────────────────────────────

mobile.onMessage('roleAssign', ({ color, opponentNickname }) => {
  myColor = color;
  roleDisplay.classList.remove('hidden');
  roleDisplay.className = `role-badge ${color === 'black' ? 'black-role' : 'white-role'}`;
  roleDisplay.textContent = color === 'black' ? '흑돌 (선공)' : '백돌 (후공)';
  readyStatusText.textContent = `대전 상대: ${opponentNickname || '익명'}`;
});

mobile.onMessage('turnUpdate', ({ currentPlayerId, currentPlayerColor, board }) => {
  localBoard = board;
  const isMyTurn = currentPlayerId === mobile.getMyPlayer()?.id;

  if (isMyTurn) {
    selectedCell = null;
    btnPlayStone.disabled = true;
    selectionInfo.textContent = '선택된 좌표: 없음';
    
    _renderMobileBoard('mobile-board', true);
    showScreen('my-turn');
  } else {
    _renderMobileBoard('mobile-board-disabled', false);
    showScreen('opponent-turn');
  }
});

mobile.onMessage('rejoinState', ({ phase, color, opponentNickname, board, currentTurn }) => {
  myColor = color;
  localBoard = board;

  roleDisplay.classList.remove('hidden');
  roleDisplay.className = `role-badge ${color === 'black' ? 'black-role' : 'white-role'}`;
  roleDisplay.textContent = color === 'black' ? '흑돌 (선공)' : '백돌 (후공)';
  readyStatusText.textContent = `대전 상대: ${opponentNickname || '익명'}`;

  const isMyTurn = currentTurn === myColor;

  if (isMyTurn) {
    selectedCell = null;
    btnPlayStone.disabled = true;
    selectionInfo.textContent = '선택된 좌표: 없음';

    _renderMobileBoard('mobile-board', true);
    showScreen('my-turn');
  } else {
    _renderMobileBoard('mobile-board-disabled', false);
    showScreen('opponent-turn');
  }
});

mobile.onMessage('gameFinished', ({ winnerId, winnerColor, message }) => {
  const isWinner = winnerId === mobile.getMyPlayer()?.id;

  document.getElementById('result-icon').textContent = isWinner ? '🏆' : '💀';
  document.getElementById('result-title').textContent = isWinner ? '승리!' : '패배...';
  document.getElementById('result-desc').textContent = message;

  showScreen('result');
  mobile.vibrate(isWinner ? [100, 50, 100, 50, 300] : [200, 100, 200]);
});

// ─── Board Rendering ───────────────────────────────────────────────────────

function _renderMobileBoard(containerId, interactive) {
  const boardEl = document.getElementById(containerId);
  if (!boardEl) return;
  boardEl.innerHTML = '';

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = document.createElement('div');
      cell.classList.add('mobile-cell');
      cell.dataset.row = r;
      cell.dataset.col = c;

      if (_isHoshi(r, c)) {
        cell.classList.add('hoshi');
      }

      // 기존 돌 렌더링
      const stoneColor = localBoard[r][c];
      if (stoneColor) {
        const stone = document.createElement('div');
        stone.classList.add('stone-piece', stoneColor);
        cell.appendChild(stone);
      } else if (interactive) {
        // 착수 가능한 빈 셀 터치 바인딩
        cell.addEventListener('click', () => {
          _selectCell(r, c);
        });
      }

      boardEl.appendChild(cell);
    }
  }
}

function _isHoshi(r, c) {
  const points = [3, 9, 6];
  return points.includes(r) && points.includes(c);
}

function _selectCell(r, c) {
  // 이전 선택 표시 제거
  document.querySelectorAll('.mobile-cell.selected').forEach(el => {
    el.classList.remove('selected');
  });

  // 새 선택 등록
  const cell = document.querySelector(`.mobile-board .mobile-cell[data-row='${r}'][data-col='${c}']`);
  if (cell) {
    cell.classList.add('selected');
    selectedCell = { r, c };

    // 좌표 문자로 치환 (예: 1행 2열 -> B3)
    const colChar = String.fromCharCode(65 + c); // A ~ M
    const rowNum = r + 1;
    selectionInfo.textContent = `선택된 좌표: ${colChar}${rowNum}`;
    btnPlayStone.disabled = false;

    // 미세한 햅틱 진동 제공
    mobile.vibrate('light');
  }
}

// ─── 착수하기 액션 버튼 ──────────────────────────────────────────────────

btnPlayStone.addEventListener('click', () => {
  if (!selectedCell || !myColor) return;

  // 강력한 충격 진동 피드백
  mobile.vibrate('heavy');

  // 호스트로 돌 놓기 전송
  mobile.sendToHost('makeMove', { r: selectedCell.r, c: selectedCell.c });

  // 버튼 비활성화로 연속 클릭 방지
  btnPlayStone.disabled = true;
});
