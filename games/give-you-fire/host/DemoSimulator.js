export class DemoSimulator {
  constructor(game) {
    this.game = game;
    this.state = 'idle'; // 'idle' | 'running' | 'cleanup'
    this.demoInterval = null;
    this.demoTimeouts = [];
    this.backupState = null;
  }

  startDemo() {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.game._isDemo = true;

    // 1. 기존 상태 백업
    this.backupState = {
      players: new Map(this.game.players),
      sdkPlayers: new Map(this.game.sdk._players),
      profiles: new Map(this.game._profiles),
      playerData: new Map(this.game._playerData),
      readyCount: this.game._readyCount,
      aliveCount: this.game._aliveCount,
      phase: this.game.phase
    };

    // 2. 가상 봇 3명 등록
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
      this.game._playerData.set(b.id, { level: this.game._gameMode === 'quick' ? 5 : 1, lines: 0, board: null, alive: true, rank: null, engineState: null });
    });

    this.game._renderLobby();
    this.game._updateReadyStatus();
    this.game.updateLobbyReady(3);

    // 3. QR 및 로비 상단에 데모 중단 배너 UI 표시
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
      overlayText.style.background = 'rgba(0,0,0,0.78)';
      overlayText.style.color = '#F59E0B';
      overlayText.style.fontWeight = 'bold';
      overlayText.style.fontSize = '1.1rem';
      overlayText.style.textAlign = 'center';
      overlayText.style.padding = '10px';
      overlayText.style.borderRadius = '8px';
      overlayText.style.boxSizing = 'border-box';
      overlayText.style.zIndex = '100';
      overlayText.innerHTML = `
        <span>🤖 데모 플레이 진행 중...</span><br>
        <button id="btn-stop-demo-overlay" style="margin-top:8px;padding:4px 12px;background:#ff2244;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.8rem;font-weight:bold;">데모 중단</button>
      `;
      qrWrap.parentNode.style.position = 'relative';
      qrWrap.parentNode.appendChild(overlayText);

      // 데모 중단 버튼 리스너 바인딩
      document.getElementById('btn-stop-demo-overlay').onclick = (e) => {
        e.stopPropagation();
        this.stopDemo();
      };
    }

    // 데모 실행 시 실행 버튼 텍스트 변경
    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.textContent = '⏹ 데모 플레이 중단';
      demoPlayBtn.style.background = 'linear-gradient(135deg, #EF4444, #DC2626)';
      demoPlayBtn.style.color = '#FFFFFF';
    }

    // 4. 로비 시작
    this.game._startCountdown();
    this.game._broadcastPlayerList();
  }

  stopDemo() {
    if (this.state === 'idle') return;
    this.state = 'cleanup';
    this.game._isDemo = false;

    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }

    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];

    // UI 복구
    const overlay = document.getElementById('demoQROverlay');
    overlay?.parentNode?.removeChild(overlay);
    const qrWrap = document.querySelector('.qr-container') || document.querySelector('game-lobby')?.parentNode;
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.textContent = '🤖 데모 플레이 실행';
      demoPlayBtn.style.background = 'linear-gradient(135deg, var(--lobby-accent, #f59e0b), #d97706)';
      demoPlayBtn.style.color = '#000000';
    }

    // 백업 상태 복원
    if (this.backupState) {
      this.game._players = this.backupState.players;
      this.game.sdk._players = this.backupState.sdkPlayers;
      this.game._profiles = this.backupState.profiles;
      this.game._playerData = this.backupState.playerData;
      this.game._readyCount = this.backupState.readyCount;
      this.game._aliveCount = this.backupState.aliveCount;
      this.game._gameStarted = false;
      this.game._stopElapsedTimer();
      
      this.game._renderLobby();
      this.game._updateReadyStatus();
      this.game._broadcastPlayerList();
      this.game.setPhase(this.backupState.phase);
    }

    this.state = 'idle';
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
    if (this.state !== 'running') return;

    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }

    if (phase === 'playing') {
      const bots = ['bot_amy', 'bot_bob', 'bot_charles'];
      const maxLvl = this.game._gameMode === 'quick' ? 40 : 100;

      this.demoInterval = setInterval(() => {
        if (!this.game._gameStarted) return;

        bots.forEach(botId => {
          const data = this.game._playerData.get(botId);
          if (!data || !data.alive) return;

          // 1. 레벨 증가 및 보드 업데이트
          const levelUpProb = Math.random();
          let levelDelta = 0;
          if (levelUpProb < 0.2) {
            levelDelta = 1;
          }

          const newLevel = Math.min(maxLvl, data.level + levelDelta);
          let newLines = data.lines;

          // 25% 확률로 라인 클리어 시뮬레이션
          if (Math.random() < 0.25) {
            const clearCount = Math.floor(Math.random() * 4) + 1;
            newLines += clearCount;
            this.mockMessageFromPlayer(botId, 'linesCleared', { count: clearCount });
          }

          // 보드 생성
          const board = this.generateSimulatedBoard(newLevel);
          this.mockMessageFromPlayer(botId, 'boardUpdate', { board, level: newLevel, lines: newLines, engineState: null });

          // 2. 목표 레벨 도달 시 클리어
          if (newLevel >= maxLvl) {
            this.mockMessageFromPlayer(botId, 'soloClear', {});
            return;
          }

          // 3. 5% 확률로 자연사(게임 오버) 시뮬레이션 (레벨이 15 이상일 때만)
          if (newLevel >= 15 && Math.random() < 0.05) {
            this.mockMessageFromPlayer(botId, 'gameOver', {});
          }
        });
      }, 1500);
    }

    if (phase === 'result') {
      // 결과 화면에서 6초 후 자동으로 데모 종료 및 복원
      const timeout = setTimeout(() => {
        this.stopDemo();
      }, 6000);
      this.demoTimeouts.push(timeout);
    }
  }
}
