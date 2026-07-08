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
    this._isDemo = false;

    // 템포 설정 (0: 무제한, 15: 15초 제한)
    this._timeLimit = 0;
    this._turnTimeLeft = 0;
    this._turnTimerInterval = null;

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
        } else {
          this._demoSimulator.stopDemo();
        }
      };
    }

    const restartBtn = document.getElementById('btn-restart-result');
    if (restartBtn) {
      restartBtn.onclick = () => this.resetSession();
    }

    // 프리셋 버튼 바인딩
    const modeClassic = document.getElementById('btn-mode-classic');
    const modeQuick = document.getElementById('btn-mode-quick');
    if (modeClassic && modeQuick) {
      modeClassic.onclick = () => {
        if (this._isDemo) return; // 데모 진행 중에는 변경 불가
        this._timeLimit = 0;
        modeClassic.classList.add('active');
        modeClassic.style.borderColor = '#00eeff';
        modeClassic.style.background = 'rgba(255,255,255,0.1)';
        modeClassic.style.color = '#fff';
        
        modeQuick.classList.remove('active');
        modeQuick.style.borderColor = 'transparent';
        modeQuick.style.background = 'rgba(255,255,255,0.05)';
        modeQuick.style.color = '#888';
      };

      modeQuick.onclick = () => {
        if (this._isDemo) return;
        this._timeLimit = 15;
        modeQuick.classList.add('active');
        modeQuick.style.borderColor = '#00eeff';
        modeQuick.style.background = 'rgba(255,255,255,0.1)';
        modeQuick.style.color = '#fff';
        
        modeClassic.classList.remove('active');
        modeClassic.style.borderColor = 'transparent';
        modeClassic.style.background = 'rgba(255,255,255,0.05)';
        modeClassic.style.color = '#888';
      };
    }

    this.setPhase('lobby');
    this.renderLobbyPlayers();
  }

  onPlayerJoin(player) {
    // 실플레이어 입장 시 데모 자동 중단
    if (this._isDemo) {
      console.log('[Omok] Real player joined during demo. Stopping demo match.');
      this._demoSimulator.stopDemo();
    }
    this.renderLobbyPlayers();
  }

  onPlayerLeave(playerId) {
    // 진행 중 한 명이라도 퇴장하면 게임 폭파
    if (this._gameActive) {
      if (this._blackPlayer?.id === playerId || this._whitePlayer?.id === playerId) {
        console.log('[Omok] Active player left, resetting session.');
        this.resetSession();
      }
    } else {
      this.renderLobbyPlayers();
    }
  }

  onPlayerRejoin(player) {
    console.log(`[Omok] Player ${player.id} rejoined.`);
    
    // 게임이 진행 중일 때
    if (this._gameActive) {
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
          currentTurn: this._currentPlayerColor,
          timeLimit: this._timeLimit,
          turnTimeLeft: this._turnTimeLeft
        });
      }
    } else {
      // 로비 재연결 프리징 가드
      this.renderLobbyPlayers();
      
      this.sendToPlayer(player.id, 'lobbyState', {
        phase: 'lobby',
        readyCount: [...this.players.values()].filter(p => p.ready).length,
        total: this.players.size
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
    this.renderLobbyPlayers();
  }

  onReset() {
    this._stopTurnTimer();
    this._demoSimulator.clearDemoTimeouts();
    this._gameActive = false;
    this._board = null;
    this._blackPlayer = null;
    this._whitePlayer = null;

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) demoPlayBtn.textContent = '🤖 데모 플레이 실행';

    const boardEl = document.getElementById('board');
    if (boardEl) boardEl.innerHTML = '';

    const timerText = document.getElementById('vs-or-timer');
    if (timerText) {
      timerText.textContent = 'VS';
      timerText.style.color = '';
    }

    this.setPhase('lobby');
    this.renderLobbyPlayers();
  }

  // ─── Game Flow ───────────────────────────────────────────────────────────

  _startGame() {
    this._gameActive = true;
    this._board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));

    // 플레이어 색상 지정
    if (this._isDemo) {
      // 데모 모드에서는 데모 시뮬레이터가 이미 플레이어를 할당해둠
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
      this.sendToPlayer(this._blackPlayer.id, 'roleAssign', { color: 'black', opponentNickname: this._whitePlayer.nickname || '백돌 플레이어' });
      this.sendToPlayer(this._whitePlayer.id, 'roleAssign', { color: 'white', opponentNickname: this._blackPlayer.nickname || '흑돌 플레이어' });
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

    this._playAudio('turn');

    const currentPlayer = this._currentPlayerColor === 'black' ? this._blackPlayer : this._whitePlayer;

    // 타이머 갱신
    this._stopTurnTimer();
    this._startTurnTimer();

    // 모바일에 턴 업데이트 전송
    if (!this._isDemo) {
      this.broadcast('turnUpdate', {
        currentPlayerId: currentPlayer.id,
        currentPlayerColor: this._currentPlayerColor,
        board: this._board,
        timeLimit: this._timeLimit,
        turnTimeLeft: this._timeLimit
      });
    } else {
      // 데모 모드에서는 봇의 연산 착수
      this._demoSimulator.triggerBotMove();
    }
  }

  _startTurnTimer() {
    if (this._timeLimit <= 0) return;

    this._turnTimeLeft = this._timeLimit;
    const timerText = document.getElementById('vs-or-timer');
    if (timerText) {
      timerText.textContent = this._turnTimeLeft;
      timerText.style.color = '';
    }

    this._turnTimerInterval = setInterval(() => {
      this._turnTimeLeft--;
      if (timerText) {
        timerText.textContent = this._turnTimeLeft;
      }

      if (this._turnTimeLeft <= 3 && this._turnTimeLeft > 0) {
        this._playAudio('warning');
        if (timerText) {
          timerText.style.color = '#ff4444';
          // 미세하게 깜빡이는 애니메이션
          timerText.style.opacity = timerText.style.opacity === '0.5' ? '1' : '0.5';
        }
        if (!this._isDemo) {
          this.broadcast('timerWarning', {});
        }
      } else if (timerText) {
        timerText.style.opacity = '1';
      }

      if (this._turnTimeLeft <= 0) {
        this._stopTurnTimer();
        this._handleTimeOut();
      }
    }, 1000);
  }

  _stopTurnTimer() {
    if (this._turnTimerInterval) {
      clearInterval(this._turnTimerInterval);
      this._turnTimerInterval = null;
    }
    const timerText = document.getElementById('vs-or-timer');
    if (timerText) {
      timerText.textContent = 'VS';
      timerText.style.color = '';
      timerText.style.opacity = '1';
    }
  }

  _handleTimeOut() {
    if (!this._gameActive) return;
    // 기권패 처리
    const loserColor = this._currentPlayerColor === 'black' ? '흑돌(검은색)' : '백돌(흰색)';
    const winnerColor = this._currentPlayerColor === 'black' ? '백돌(흰색) 승리!' : '흑돌(검은색) 승리!';
    this._endGame(`시간 초과! ${winnerColor} (기권패)`);
  }

  _placeStone(r, c) {
    this._board[r][c] = this._currentPlayerColor;

    this._playAudio('stone');

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
    this._stopTurnTimer();

    this._playAudio('win');

    document.getElementById('modal-message').textContent = message;

    // 결과 창 승자 맞춤 글로우 효과 추가
    const resultPanel = document.querySelector('.omok-result-panel');
    if (resultPanel) {
      if (this._currentPlayerColor === 'black') {
        resultPanel.style.boxShadow = '0 0 60px rgba(0, 0, 0, 0.8), 0 0 30px rgba(255, 255, 255, 0.2)';
      } else {
        resultPanel.style.boxShadow = '0 0 60px rgba(255, 255, 255, 0.8), 0 0 30px rgba(0, 0, 0, 0.2)';
      }
    }

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

    this.onMessage('requestLobbyOrGameState', (player) => {
      this.onPlayerRejoin(player);
    });
  }

  // ─── Demo Mode Implementation ─────────────────────────────────────────────

  setDemoMode(enabled) {
    this._isDemo = enabled;

    // 배너 토글
    const banner = document.getElementById('demo-banner');
    if (banner) {
      banner.classList.toggle('hidden', !enabled);
    }

    // 로비 버튼 라벨 토글
    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.textContent = enabled ? '⏹️ 데모 중지' : '🤖 데모 플레이 실행';
    }

    // QR 블러 가드
    const qrWrap = this._lobbyEl?.qrContainer;
    if (qrWrap) {
      qrWrap.style.filter = enabled ? 'blur(8px)' : '';
      qrWrap.style.pointerEvents = enabled ? 'none' : '';
    }
  }

  beginDemoMatch(bots) {
    // 봇 등록
    this.players.clear();
    bots.forEach(b => {
      this._playerNicknames.set(b.id, b.nickname);
      this.players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
    });

    this._blackPlayer = bots[0];
    this._whitePlayer = bots[1];

    this._startGame();
  }

  endDemoMatch({ resetToLobby }) {
    this._demoSimulator.clearDemoTimeouts();
    this.players.delete('bot_black');
    this.players.delete('bot_white');
    this._gameActive = false;

    if (resetToLobby) {
      this.resetSession();
    }
  }

  forceDemoMove(r, c) {
    if (this._isDemo && this._gameActive) {
      this._placeStone(r, c);
    }
  }

  // ─── Sound Synthesizer (Web Audio API) ───────────────────────────────────

  _playAudio(type) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      if (type === 'stone') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(350, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.8, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === 'turn') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.07); // E5
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else if (type === 'warning') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === 'win') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08); // E5
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.16); // G5
        osc.frequency.setValueAtTime(1046.50, ctx.currentTime + 0.24); // C6
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      }
    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  }
}

// ─── Main Instantiate ───────────────────────────────────────────────────────
import { HostSDK } from '../../../platform/client/HostSDK.js';
const sdk = new HostSDK({ gameId: 'omok' });
new OmokGame(sdk);
