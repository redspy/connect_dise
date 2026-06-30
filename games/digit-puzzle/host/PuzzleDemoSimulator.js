export class PuzzleDemoSimulator {
  constructor(game) {
    this.game = game;
    this.demoInterval = null;
    this.demoTimeouts = [];
  }

  get isDemo() {
    return this.game._isDemo;
  }

  startDemo() {
    if (this.game._isDemo) return;
    this.game._isDemo = true;

    // 1. 가상 봇 3명 등록
    const bots = [
      { id: 'bot_amy', nickname: '🤖 에이미', color: '#EF4444' },
      { id: 'bot_bob', nickname: '🤖 밥', color: '#10B981' },
      { id: 'bot_charles', nickname: '🤖 찰리', color: '#3B82F6' }
    ];

    bots.forEach(b => {
      this.game._profiles.set(b.id, { nickname: b.nickname });
      this.game.players.set(b.id, { id: b.id, color: b.color });
      this.game.sdk._players.set(b.id, { id: b.id, color: b.color });
    });

    this.game._renderLobby();
    this.game.updateLobbyReady(3);

    // QR 블러 가드
    const qrWrap = document.querySelector('.qr-container') || document.querySelector('game-lobby')?.parentNode;
    if (qrWrap) {
      qrWrap.style.filter = 'blur(8px)';
      qrWrap.style.pointerEvents = 'none';

      const overlayText = document.createElement('div');
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

    // 게임 시작
    this.game._startGame();
    this.game._broadcastPlayerList();
  }

  stopDemo() {
    if (!this.game._isDemo) return;
    this.game._isDemo = false;

    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }

    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];

    const overlay = document.getElementById('demoQROverlay');
    overlay?.parentNode?.removeChild(overlay);
    const qrWrap = document.querySelector('.qr-container') || document.querySelector('game-lobby')?.parentNode;
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }

    this.game._profiles.clear();
    this.game._progress.clear();
    this.game._players.clear();
    this.game.sdk._players.clear();
  }

  mockMessageFromPlayer(playerId, type, payload) {
    const handler = this.game.sdk._messageHandlers.get(type);
    if (handler) {
      const player = this.game.getPlayer(playerId) || { id: playerId };
      handler(player, payload);
    }
  }

  onPhaseChange(phase) {
    if (!this.game._isDemo) return;

    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }

    // playing phase starts immediately when phase goes hidden (lobby hidden)
    // in PuzzleGame.js, playing screen is the default background board
    if (phase === 'playing' || phase === 'lobby' === false && phase === 'result' === false) {
      const bots = ['bot_amy', 'bot_bob', 'bot_charles'];

      this.demoInterval = setInterval(() => {
        if (!this.game._gameStarted || this.game._winner) return;

        bots.forEach(botId => {
          const prog = this.game._progress.get(botId) || { correctCount: 0, moves: 0, seconds: 0 };
          if (prog.correctCount >= 15) return;

          // 40% 확률로 퍼즐 상태 진전
          if (Math.random() > 0.4) return;

          const seconds = Math.floor((Date.now() - this.game._gameStartTime) / 1000);
          const newMoves = prog.moves + Math.floor(Math.random() * 3) + 1;
          const newCorrect = Math.min(15, prog.correctCount + (Math.random() < 0.2 ? 2 : 1));

          if (newCorrect === 15) {
            this.mockMessageFromPlayer(botId, 'puzzleComplete', { moves: newMoves, seconds });
          } else {
            this.mockMessageFromPlayer(botId, 'progressUpdate', { correctCount: newCorrect, moves: newMoves, seconds });
          }
        });
      }, 1500);
    }

    if (phase === 'result') {
      const timeout = setTimeout(() => {
        const restartBtn = document.getElementById('btn-restart-result');
        if (restartBtn) {
          restartBtn.click();
        }
      }, 6000);
      this.demoTimeouts.push(timeout);
    }
  }
}
