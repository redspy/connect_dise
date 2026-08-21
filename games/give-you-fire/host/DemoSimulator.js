export class DemoSimulator {
  constructor(game) {
    this.game = game;
    this.state = 'idle'; // 'idle' | 'running' | 'cleanup'
    this.demoInterval = null;
    this.demoTimeouts = [];
    this.backupState = null;
    this.botIds = ['bot_amy', 'bot_bob', 'bot_charles'];
  }

  startDemo() {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.game._isDemo = true;

    // 1. 기존 상태 백업 (봇 id만 골라 제거하는 방식으로 복원하므로, 플레이어 Map
    // 스냅샷 자체는 더 이상 필요 없음 — 아래 readyCount/aliveCount/phase만 사용)
    this.backupState = {
      readyCount: this.game._readyCount,
      aliveCount: this.game._aliveCount,
      phase: this.game.phase
    };

    // 2. 가상 봇 3명 등록 (id는 this.botIds와 반드시 일치해야 stopDemo()에서 정리됨)
    const bots = [
      { id: this.botIds[0], nickname: '🤖 에이미', color: '#EF4444' },
      { id: this.botIds[1], nickname: '🤖 밥', color: '#10B981' },
      { id: this.botIds[2], nickname: '🤖 찰리', color: '#3B82F6' }
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
    // dead-selector 수정(2026-08-19, dixit 검수에서 발견된 크로스게임 패턴): 기존
    // '.qr-container' || 'game-lobby'?.parentNode 폴백은 QR박스가 아닌 로비 패널
    // 전체(설정/규칙 텍스트 포함)를 블러 처리하는 과잉 동작이었음 — .lobby-qr-box로 특정.
    const qrWrap = document.querySelector('.lobby-qr-box');
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
    const qrWrap = document.querySelector('.lobby-qr-box');
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

    // 봇만 골라서 제거 — game._players/sdk._players를 백업 스냅샷으로 통째로 교체하지
    // 않는다. onPlayerJoin()이 데모 중 실제 접속을 감지하면 stopDemo()→resetSession()
    // 순으로 호출하는데(TetrisGame.js 참고), 그 실제 플레이어는 이 시점에 이미
    // game._players/sdk._players 둘 다에 봇과 함께 섞여 들어가 있다. 여기서 통째로
    // 데모 시작 이전 스냅샷(그 실제 플레이어가 join하기 전 상태)으로 되돌리면, 특히
    // sdk._players가 비면 뒤이은 resetSession()의 'reset' 핸들러(HostBaseGame)가
    // sdk.getPlayers()로 game._players를 재구성할 때 그 실제 플레이어가 통째로
    // 증발해버린다(서버·본인 폰은 연결된 채로 착각하는 유령 상태) — AGENTS.md의
    // "전체 교체보다 골라서 추가/제거" 원칙을 sdk._players에도 동일 적용.
    this.botIds.forEach(id => {
      this.game._players.delete(id);
      this.game.sdk._players.delete(id);
      this.game._profiles.delete(id);
      this.game._playerData.delete(id);
    });

    // 나머지 상태(준비 인원 수 등)는 데모 시작 전 값으로 복원
    if (this.backupState) {
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
      const bots = this.botIds;
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
