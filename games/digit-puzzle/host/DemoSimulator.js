export class DemoSimulator {
  constructor(game) {
    this.game = game;
    this.demoInterval = null;
    this.demoTimeouts = [];
    this.active = false;
  }

  get isDemo() {
    return this.active;
  }

  canStartDemo() {
    const realPlayers = [...this.game.players.values()].filter(p => !p.id.startsWith('bot_'));
    return realPlayers.length === 0;
  }

  startDemo() {
    if (this.active) return;
    if (!this.canStartDemo()) {
      alert("현재 대기실에 실제 플레이어가 접속해 있어 데모를 시작할 수 없습니다.");
      return;
    }

    this.active = true;
    this.game.enterDemoLobby([
      { id: 'bot_amy', nickname: '🤖 에이미', color: '#EF4444' },
      { id: 'bot_bob', nickname: '🤖 밥', color: '#10B981' },
      { id: 'bot_charles', nickname: '🤖 찰리', color: '#3B82F6' }
    ]);

    this._showQROverlay();
    this._showDemoBanner();

    this.game._startGame();
    this.game._broadcastPlayerList();
  }

  stopDemo() {
    if (!this.active) return;
    this.active = false;

    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }

    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];

    this._hideQROverlay();
    this._hideDemoBanner();

    this.game.exitDemoMode();
  }

  _showQROverlay() {
    const qrWrap = document.querySelector('.qr-container') || document.querySelector('game-lobby')?.parentNode;
    if (qrWrap) {
      qrWrap.style.filter = 'blur(8px)';
      qrWrap.style.pointerEvents = 'none';

      let overlayText = document.getElementById('demoQROverlay');
      if (!overlayText) {
        overlayText = document.createElement('div');
        overlayText.id = 'demoQROverlay';
        overlayText.style.position = 'absolute';
        overlayText.style.inset = '0';
        overlayText.style.display = 'flex';
        overlayText.style.flexDirection = 'column';
        overlayText.style.alignItems = 'center';
        overlayText.style.justifyContent = 'center';
        overlayText.style.background = 'rgba(0,0,0,0.72)';
        overlayText.style.color = '#F59E0B';
        overlayText.style.fontWeight = 'bold';
        overlayText.style.fontSize = '1.1rem';
        overlayText.style.textAlign = 'center';
        overlayText.style.padding = '10px';
        overlayText.style.borderRadius = '8px';
        overlayText.style.boxSizing = 'border-box';
        overlayText.style.zIndex = '100';
        overlayText.innerHTML = '<span>🤖 데모 플레이 진행 중...</span><br><small style="font-size:0.78rem;color:#bbb;margin-top:4px;">데모 모드에서는 신규 접속이 불가합니다.</small>';
        qrWrap.parentNode.style.position = 'relative';
        qrWrap.parentNode.appendChild(overlayText);
      }
    }
  }

  _hideQROverlay() {
    const overlay = document.getElementById('demoQROverlay');
    overlay?.parentNode?.removeChild(overlay);
    const qrWrap = document.querySelector('.qr-container') || document.querySelector('game-lobby')?.parentNode;
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }
  }

  _showDemoBanner() {
    let banner = document.getElementById('demoActiveBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'demoActiveBanner';
      banner.className = 'dp-demo-active-banner';
      banner.innerHTML = `
        <span>🤖 데모 시뮬레이션 모드 작동 중</span>
        <button id="btnStopDemo" class="dp-btn-stop-demo">시뮬레이션 종료</button>
      `;
      document.body.appendChild(banner);

      document.getElementById('btnStopDemo').onclick = (e) => {
        e.stopPropagation();
        this.stopDemo();
      };
    }
    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.textContent = '🤖 데모 플레이 중단';
      demoPlayBtn.style.background = 'linear-gradient(135deg, #ef4444, #b91c1c)';
      demoPlayBtn.style.color = '#ffffff';
    }
  }

  _hideDemoBanner() {
    const banner = document.getElementById('demoActiveBanner');
    banner?.parentNode?.removeChild(banner);

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.textContent = '🤖 데모 플레이 실행';
      demoPlayBtn.style.background = 'linear-gradient(135deg, var(--lobby-accent, #f59e0b), #d97706)';
      demoPlayBtn.style.color = '#000000';
    }
  }

  onPhaseChange(phase) {
    if (!this.active) return;

    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }

    if (phase === 'playing') {
      const bots = [
        { id: 'bot_amy', speed: 1.3, errorRate: 0.1 },
        { id: 'bot_bob', speed: 0.8, errorRate: 0.02 },
        { id: 'bot_charles', speed: 0.6, errorRate: 0.08 }
      ];

      bots.forEach(b => {
        b.correctCount = 0;
        b.moves = 0;
        b.board = [...Array(15).keys()].map(i => i + 1);
        b.board.push(0);
        for (let i = 0; i < 30; i++) {
          const idx1 = Math.floor(Math.random() * 16);
          const idx2 = Math.floor(Math.random() * 16);
          [b.board[idx1], b.board[idx2]] = [b.board[idx2], b.board[idx1]];
        }
      });

      this.demoInterval = setInterval(() => {
        if (!this.game._gameStarted || this.game._winner) return;

        const seconds = Math.floor((Date.now() - this.game._gameStartTime) / 1000);

        bots.forEach(bot => {
          if (bot.correctCount >= 15) return;

          let currentSpeed = bot.speed;
          if (bot.id === 'bot_charles' && bot.correctCount >= 6) {
            currentSpeed = 2.2; // 초고속 후반 가속
          }

          if (Math.random() > 0.4 * currentSpeed) return;

          const newMoves = bot.moves + Math.floor(Math.random() * 2) + 1;
          
          let newCorrect = bot.correctCount;
          if (Math.random() > bot.errorRate) {
            newCorrect = Math.min(15, bot.correctCount + (Math.random() < 0.3 ? 2 : 1));
          } else {
            newCorrect = Math.max(0, bot.correctCount - (Math.random() < 0.3 ? 1 : 0));
          }

          bot.moves = newMoves;
          bot.correctCount = newCorrect;
          bot.board = this._generateDummyBoard(newCorrect);

          if (newCorrect === 15) {
            this.game.applyDemoProgress(bot.id, { correctCount: 15, progress: 100, moves: newMoves, seconds, board: bot.board });
            this.game.finishDemoRound(bot.id, { moves: newMoves, seconds });
          } else {
            this.game.applyDemoProgress(bot.id, { correctCount: newCorrect, progress: Math.round((newCorrect / 15) * 100), moves: newMoves, seconds, board: bot.board });
          }
        });
      }, 500); // 500ms 간격으로 빠르게 시뮬레이션
    }

    if (phase === 'result') {
      const timeout = setTimeout(() => {
        const restartBtn = document.getElementById('btn-restart-result');
        if (restartBtn) {
          restartBtn.click();
        }
      }, 8000);
      this.demoTimeouts.push(timeout);
    }
  }

  _generateDummyBoard(correctCount) {
    const board = Array(16).fill(0);
    for (let i = 0; i < correctCount; i++) {
      board[i] = i + 1;
    }
    const remainingValues = [];
    for (let v = 1; v <= 15; v++) {
      if (v > correctCount) {
        remainingValues.push(v);
      }
    }
    remainingValues.push(0);

    for (let i = remainingValues.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remainingValues[i], remainingValues[j]] = [remainingValues[j], remainingValues[i]];
    }

    let remIdx = 0;
    for (let i = correctCount; i < 16; i++) {
      board[i] = remainingValues[remIdx++];
    }
    return board;
  }
}
