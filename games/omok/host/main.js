import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { OmokAI } from './ai.js';
import { OmokDemoSimulator } from './DemoSimulator.js';

const BOARD_SIZE = 13;

export class OmokGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'omok-overlay', qrContainerId: null });

    this._board = null;
    this._currentPlayerColor = 'black'; // 'black' or 'white'
    this._blackPlayer = null;
    this._whitePlayer = null;
    this._gameActive = false;

    this._ai = new OmokAI(BOARD_SIZE);
    this._demoSimulator = new OmokDemoSimulator(this);

    this._wireGameMessages();
  }

  // ─── HostBaseGame Hooks ──────────────────────────────────────────────────

  async onSetup() {
    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.onclick = () => {
        if (!this._isDemo) {
          this._demoSimulator.startDemo();
          demoPlayBtn.textContent = '⏹️ 데모 중지';
        } else {
          this._demoSimulator.stopDemo();
          demoPlayBtn.textContent = '🤖 데모 플레이 실행';
        }
      };
    }

    const restartBtn = document.getElementById('btn-restart-result');
    if (restartBtn) {
      restartBtn.onclick = () => this.resetSession();
    }

    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    // 2인 이상 시 로비 시작 버튼 클릭 대기
    if (this._lobbyEl) {
      this._lobbyEl.onStart = () => {
        if (this.players.size >= 2) this._startGame();
      };
    }
  }

  onPlayerLeave(playerId) {
    // 진행 중 한 명이라도 퇴장하면 게임 폭파
    if (this._gameActive) {
      if (this._blackPlayer?.id === playerId || this._whitePlayer?.id === playerId) {
        console.log('[Omok] Active player left, resetting session.');
        this.resetSession();
      }
    }
  }

  onPlayerRejoin(player) {
    console.log(`[Omok] Player ${player.id} rejoined.`);
    if (!this._gameActive) return;

    let color = null;
    let opponentNickname = '';
    if (this._blackPlayer?.id === player.id) {
      color = 'black';
      opponentNickname = this._whitePlayer?.nickname || '백돌 플레이어';
    } else if (this._whitePlayer?.id === player.id) {
      color = 'white';
      opponentNickname = this._blackPlayer?.nickname || '흑돌 플레이어';
    }

    if (color) {
      this.sendToPlayer(player.id, 'rejoinState', {
        phase: this.phase,
        color,
        opponentNickname,
        board: this._board,
        currentTurn: this._currentPlayerColor
      });
    }
  }

  onAllReady() {
    if (!this._gameActive && this.players.size >= 2) {
      this._startGame();
    }
  }

  onReadyUpdate({ readyCount, total }) {
    this.updateLobbyReady(readyCount);
  }

  onReset() {
    this._demoSimulator.stopDemo();
    this._gameActive = false;
    this._board = null;
    this._blackPlayer = null;
    this._whitePlayer = null;

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) demoPlayBtn.textContent = '🤖 데모 플레이 실행';

    const boardEl = document.getElementById('board');
    if (boardEl) boardEl.innerHTML = '';

    this.setPhase('lobby');
  }

  // ─── Game Flow ───────────────────────────────────────────────────────────

  _startGame() {
    this._gameActive = true;
    this._board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));

    // 플레이어 색상 지정
    if (this._isDemo) {
      // 데모 모드에서는 가상 봇을 지정
      // DemoSimulator.startDemo가 이미 지정해 둠
    } else {
      const plist = [...this.players.values()];
      this._blackPlayer = plist[0];
      this._whitePlayer = plist[1];
    }

    // 이름 표시
    document.getElementById('name-black').textContent = this._blackPlayer.nickname || '흑돌 플레이어';
    document.getElementById('name-white').textContent = this._whitePlayer.nickname || '백돌 플레이어';

    this._renderBoard();

    // 롤 전송
    if (!this._isDemo) {
      this.sendToPlayer(this._blackPlayer.id, 'roleAssign', { color: 'black', opponentNickname: this._whitePlayer.nickname });
      this.sendToPlayer(this._whitePlayer.id, 'roleAssign', { color: 'white', opponentNickname: this._blackPlayer.nickname });
    }

    this.setPhase('playing');
    this._currentPlayerColor = 'black';
    this._updateTurnState();
  }

  _renderBoard() {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;
    boardEl.innerHTML = '';

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.dataset.row = r;
        cell.dataset.col = c;
        if (this._isHoshi(r, c)) {
          cell.classList.add('hoshi');
        }
        boardEl.appendChild(cell);
      }
    }
  }

  _isHoshi(r, c) {
    const points = [3, 9, 6];
    return points.includes(r) && points.includes(c);
  }

  _updateTurnState() {
    if (!this._gameActive) return;

    // 인디케이터 표시
    document.getElementById('player-black').classList.toggle('current', this._currentPlayerColor === 'black');
    document.getElementById('player-white').classList.toggle('current', this._currentPlayerColor === 'white');

    const currentPlayer = this._currentPlayerColor === 'black' ? this._blackPlayer : this._whitePlayer;

    // 모바일에 턴 업데이트 전송
    if (!this._isDemo) {
      this.broadcast('turnUpdate', {
        currentPlayerId: currentPlayer.id,
        currentPlayerColor: this._currentPlayerColor,
        board: this._board
      });
    } else {
      // 데모 모드에서는 봇의 연산 착수
      this._demoSimulator.triggerBotMove();
    }
  }

  _placeStone(r, c) {
    this._board[r][c] = this._currentPlayerColor;

    const cell = document.querySelector(`.cell[data-row='${r}'][data-col='${c}']`);
    if (cell) {
      document.querySelectorAll('.stone-piece').forEach(el => el.classList.remove('last-move'));
      const stone = document.createElement('div');
      stone.classList.add('stone-piece', this._currentPlayerColor, 'last-move');
      cell.appendChild(stone);
    }

    if (this._ai.checkWin(this._board, r, c, this._currentPlayerColor)) {
      const winnerName = this._currentPlayerColor === 'black' ? '흑돌(검은색)' : '백돌(흰색)';
      this._endGame(`${winnerName} 승리!`);
    } else {
      this._currentPlayerColor = this._currentPlayerColor === 'black' ? 'white' : 'black';
      this._updateTurnState();
    }
  }

  _endGame(message) {
    this._gameActive = false;
    document.getElementById('modal-message').textContent = message;

    if (!this._isDemo) {
      const winnerId = this._currentPlayerColor === 'black' ? this._blackPlayer.id : this._whitePlayer.id;
      this.broadcast('gameFinished', { winnerId, winnerColor: this._currentPlayerColor, message });
    }

    this.setPhase('result');

    if (this._isDemo) {
      this._demoSimulator.demoTimeouts.push(setTimeout(() => {
        if (this._isDemo) this._startGame();
      }, 5000));
    }
  }

  // ─── Messaging ───────────────────────────────────────────────────────────

  _wireGameMessages() {
    this.onMessage('makeMove', (player, { r, c }) => {
      if (!this._gameActive || this._isDemo) return;

      const expectedPlayer = this._currentPlayerColor === 'black' ? this._blackPlayer : this._whitePlayer;
      if (player.id !== expectedPlayer.id) return; // 턴 위반

      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return;
      if (this._board[r][c] !== null) return;

      this._placeStone(r, c);
    });
  }
}

// ─── Main Instantiate ───────────────────────────────────────────────────────
import { HostSDK } from '../../../platform/client/HostSDK.js';
const sdk = new HostSDK({ gameId: 'omok' });
new OmokGame(sdk);
