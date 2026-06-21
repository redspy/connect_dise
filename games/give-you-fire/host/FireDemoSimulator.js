export class FireDemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.demoInterval = null;
    this.demoTimeouts = [];
  }

  startDemo() {
    if (this.isDemo) return;
    this.isDemo = true;

    // 1. 가상 봇 3명 등록
    const bots = [
      { id: 'bot_amy', nickname: '🤖 에이미', color: '#EF4444' },
      { id: 'bot_bob', nickname: '🤖 밥', color: '#10B981' },
      { id: 'bot_charles', nickname: '🤖 찰리', color: '#3B82F6' }
    ];

    bots.forEach(b => {
      const pObj = { id: b.id, color: b.color };
      this.game.players.set(b.id, pObj);
      this.game.sdk._players.set(b.id, pObj);
      this.game._profiles.set(b.id, { nickname: b.nickname });
      this.game._playerData.set(b.id, { level: 1, lines: 0, board: null, alive: true, rank: null });
    });

    this.game._renderLobby();
    this.game._updateReadyStatus();
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
    if (!this.isDemo) return;
    this.isDemo = false;

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
    this.game._playerData.clear();
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

  generateSimulatedBoard(level) {
    const board = Array.from({ length: 20 }, () => Array(10).fill(0));
    // 레벨에 맞게 블록 높이 설정
    const fillRows = Math.min(17, Math.floor(3 + level * 0.15));
    for (let r = 20 - fillRows; r < 20; r++) {
      for (let c = 0; c < 10; c++) {
        if (Math.random() < 0.7) {
          board[r][c] = Math.floor(Math.random() * 7) + 1;
        }
      }
    }
    return board;
  }

  onPhaseChange(phase) {
    if (!this.isDemo) return;

    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }

    if (phase === 'playing') {
      const bots = ['bot_amy', 'bot_bob', 'bot_charles'];

      this.demoInterval = setInterval(() => {
        if (!this.game._gameStarted) return;

        bots.forEach(botId => {
          const data = this.game._playerData.get(botId);
          if (!data || !data.alive) return;

          // 1. 레벨 증가 및 보드 업데이트
          const levelUpProb = Math.random();
          let levelDelta = 0;
          if (levelUpProb < 0.15) {
            levelDelta = 1;
          }

          const newLevel = Math.min(100, data.level + levelDelta);
          let newLines = data.lines;

          // 20% 확률로 라인 클리어 시뮬레이션
          if (Math.random() < 0.2) {
            const clearCount = Math.floor(Math.random() * 4) + 1;
            newLines += clearCount;
            this.mockMessageFromPlayer(botId, 'linesCleared', { count: clearCount });
          }

          // 보드 생성
          const board = this.generateSimulatedBoard(newLevel);
          this.mockMessageFromPlayer(botId, 'boardUpdate', { board, level: newLevel, lines: newLines });

          // 2. 레벨 100 도달 시 클리어
          if (newLevel >= 100) {
            this.mockMessageFromPlayer(botId, 'soloClear', {});
            return;
          }

          // 3. 3% 확률로 자연사(게임 오버) 시뮬레이션 (레벨이 15 이상일 때만)
          if (newLevel >= 15 && Math.random() < 0.03) {
            this.mockMessageFromPlayer(botId, 'gameOver', {});
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
