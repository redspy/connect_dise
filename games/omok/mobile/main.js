import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';

const BOARD_SIZE = 13;

class OmokMobileGame extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'omok-screen' });

    this.connectionStatus = document.getElementById('connection-status');
    this.roleDisplay = document.getElementById('role-display');
    this.readyStatusText = document.getElementById('ready-status-text');
    this.selectionInfo = document.getElementById('selection-info');
    this.btnPlayStone = document.getElementById('btn-play-stone');
    this.btnReady = document.getElementById('btn-ready');

    this.myColor = null; // 'black' or 'white'
    this.localBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
    this.selectedCell = null; // { r, c }
    this.timerInterval = null;

    this._initElements();
    this._bindEvents();
    this._registerMessageHandlers();
  }

  _initElements() {
    if (this.btnReady) {
      this.btnReady.addEventListener('click', () => {
        this.btnReady.disabled = true;
        this.btnReady.textContent = '준비완료 ✓';
        this.ready();
      });
    }

    if (this.btnPlayStone) {
      this.btnPlayStone.addEventListener('click', () => {
        if (!this.selectedCell || !this.myColor) return;
        this.vibrate('heavy');
        this.sendToHost('makeMove', { r: this.selectedCell.r, c: this.selectedCell.c });
        this.btnPlayStone.disabled = true;
      });
    }
  }

  _bindEvents() {
    // MobileBaseGame hooks are registered automatically via _wireSDK
  }

  _registerMessageHandlers() {
    this.onMessage('roleAssign', ({ color, opponentNickname }) => {
      this.myColor = color;
      this.roleDisplay.classList.remove('hidden');
      this.roleDisplay.className = `role-badge ${color === 'black' ? 'black-role' : 'white-role'}`;
      this.roleDisplay.textContent = color === 'black' ? '흑돌 (선공)' : '백돌 (후공)';
      this.readyStatusText.textContent = `대전 상대: ${opponentNickname || '익명'}`;
    });

    this.onMessage('turnUpdate', ({ currentPlayerId, currentPlayerColor, board, timeLimit, turnTimeLeft }) => {
      this.localBoard = board;
      const isMyTurn = currentPlayerId === this.playerId;

      this.stopTimer();

      if (isMyTurn) {
        this.selectedCell = null;
        this.btnPlayStone.disabled = true;
        this.selectionInfo.textContent = '선택된 좌표: 없음';
        
        this._renderMobileBoard('mobile-board', true);
        this.showScreen('my-turn');

        if (timeLimit && timeLimit > 0) {
          const limit = turnTimeLeft !== undefined ? turnTimeLeft : timeLimit;
          this.startTimer(limit);
        }
      } else {
        this._renderMobileBoard('mobile-board-disabled', false);
        this.showScreen('opponent-turn');
      }
    });

    this.onMessage('rejoinState', ({ phase, color, opponentNickname, board, currentTurn, timeLimit, turnTimeLeft }) => {
      this.myColor = color;
      this.localBoard = board;

      this.roleDisplay.classList.remove('hidden');
      this.roleDisplay.className = `role-badge ${color === 'black' ? 'black-role' : 'white-role'}`;
      this.roleDisplay.textContent = color === 'black' ? '흑돌 (선공)' : '백돌 (후공)';
      this.readyStatusText.textContent = `대전 상대: ${opponentNickname || '익명'}`;

      const isMyTurn = currentTurn === this.myColor;
      this.stopTimer();

      if (isMyTurn) {
        this.selectedCell = null;
        this.btnPlayStone.disabled = true;
        this.selectionInfo.textContent = '선택된 좌표: 없음';

        this._renderMobileBoard('mobile-board', true);
        this.showScreen('my-turn');

        if (timeLimit && timeLimit > 0 && turnTimeLeft > 0) {
          this.startTimer(turnTimeLeft);
        }
      } else {
        this._renderMobileBoard('mobile-board-disabled', false);
        this.showScreen('opponent-turn');
      }
    });

    this.onMessage('lobbyState', ({ phase, isReady, readyCount, total }) => {
      this.myColor = null;
      this.selectedCell = null;
      this.roleDisplay.classList.add('hidden');
      this.roleDisplay.className = 'role-badge hidden';
      this.roleDisplay.textContent = '';
      this.localBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));

      if (this.btnReady) {
        if (isReady) {
          this.btnReady.disabled = true;
          this.btnReady.textContent = '준비완료 ✓';
        } else {
          this.btnReady.disabled = false;
          this.btnReady.textContent = '준비하기';
        }
      }

      this.showScreen('waiting');
      this.readyStatusText.textContent = `준비 상태: ${readyCount} / ${total}명 준비 완료`;
    });

    this.onMessage('gameFinished', ({ winnerId, winnerColor, message }) => {
      this.stopTimer();
      const isWinner = winnerId === this.playerId;

      const iconEl = document.getElementById('result-icon');
      if (iconEl) iconEl.textContent = isWinner ? '🏆' : '💀';

      const titleEl = document.getElementById('result-title');
      if (titleEl) titleEl.textContent = isWinner ? '승리!' : '패배...';

      const descEl = document.getElementById('result-desc');
      if (descEl) descEl.textContent = message;

      this.showScreen('result');
      this.vibrate(isWinner ? 'double' : 'heavy');
    });

    // 시간 부족 경고
    this.onMessage('timerWarning', () => {
      this.vibrate('light');
      const turnTitle = document.querySelector('[data-screen="my-turn"] .turn-title');
      if (turnTitle) {
        turnTitle.style.color = '#ff4444';
        turnTitle.style.textShadow = '0 0 10px rgba(255, 0, 0, 0.8)';
        setTimeout(() => {
          turnTitle.style.color = '';
          turnTitle.style.textShadow = '';
        }, 300);
      }
    });
  }

  startTimer(timeLeft) {
    let currentLeft = timeLeft;
    this.updateTimerUI(currentLeft);

    this.timerInterval = setInterval(() => {
      currentLeft--;
      if (currentLeft < 0) {
        this.stopTimer();
        return;
      }
      this.updateTimerUI(currentLeft);
      if (currentLeft <= 3 && currentLeft > 0) {
        this.vibrate('light');
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    const title = document.querySelector('[data-screen="my-turn"] .turn-title');
    if (title) {
      title.textContent = '내 차례입니다!';
      title.style.color = '';
    }
  }

  updateTimerUI(seconds) {
    const title = document.querySelector('[data-screen="my-turn"] .turn-title');
    if (title) {
      title.innerHTML = `내 차례입니다! <span style="color:#ff4444; font-size:1.4rem; margin-left:10px;">${seconds}초</span>`;
    }
  }

  // ─── MobileBaseGame Lifecycle Hooks ────────────────────────────────────────

  onJoin(player) {
    this.connectionStatus.classList.add('connected');
    this.showScreen('waiting');
    this.readyStatusText.textContent = '방에 입장했습니다. 대기 중...';
  }

  onRejoin(player) {
    this.connectionStatus.classList.add('connected');
    this.sendToHost('requestLobbyOrGameState', {});
  }

  onReset() {
    this.stopTimer();
    this.myColor = null;
    this.selectedCell = null;
    this.roleDisplay.classList.add('hidden');
    this.roleDisplay.className = 'role-badge hidden';
    this.roleDisplay.textContent = '';
    this.localBoard = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
    
    if (this.btnReady) {
      this.btnReady.disabled = false;
      this.btnReady.textContent = '준비하기';
    }

    this.showScreen('waiting');
    this.readyStatusText.textContent = '세션이 리셋되었습니다. 대기 중...';
  }

  onHostDisconnect() {
    this.stopTimer();
    this.connectionStatus.classList.remove('connected');
    alert('호스트와 연결이 끊어졌습니다.');
  }

  // ─── Board Rendering ───────────────────────────────────────────────────────

  _renderMobileBoard(containerId, interactive) {
    const boardEl = document.getElementById(containerId);
    if (!boardEl) return;
    boardEl.innerHTML = '';

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = document.createElement('div');
        cell.classList.add('mobile-cell');
        cell.dataset.row = r;
        cell.dataset.col = c;

        if (this._isHoshi(r, c)) {
          cell.classList.add('hoshi');
        }

        const stoneColor = this.localBoard[r][c];
        if (stoneColor) {
          const stone = document.createElement('div');
          stone.classList.add('stone-piece', stoneColor);
          cell.appendChild(stone);
        } else if (interactive) {
          cell.addEventListener('click', () => {
            this._selectCell(r, c);
          });
        }

        boardEl.appendChild(cell);
      }
    }
  }

  _isHoshi(r, c) {
    const points = [3, 9, 6];
    return points.includes(r) && points.includes(c);
  }

  _selectCell(r, c) {
    document.querySelectorAll('.mobile-cell.selected').forEach(el => {
      el.classList.remove('selected');
    });

    const cell = document.querySelector(`.mobile-board .mobile-cell[data-row='${r}'][data-col='${c}']`);
    if (cell) {
      cell.classList.add('selected');
      this.selectedCell = { r, c };

      const colChar = String.fromCharCode(65 + c);
      const rowNum = r + 1;
      this.selectionInfo.textContent = `선택된 좌표: ${colChar}${rowNum}`;
      this.btnPlayStone.disabled = false;

      this.vibrate('light');
    }
  }
}

const sdk = new MobileSDK();
new OmokMobileGame(sdk);
