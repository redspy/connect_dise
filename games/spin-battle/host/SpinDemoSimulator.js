export class SpinDemoSimulator {
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
      this.game._players.set(b.id, pObj);
      this.game.sdk._players.set(b.id, pObj);
      this.game._playerNicknames.set(b.id, b.nickname);
    });

    this.game.renderLobbyPlayers();
    this.game.updateLobbyReady(3);

    // QR 블러 가드
    const qrContainers = document.querySelectorAll('.qr-container');
    qrContainers.forEach(container => {
      container.style.filter = 'blur(8px)';
      container.style.pointerEvents = 'none';

      // 오버레이 텍스트 추가
      if (!container.querySelector('.demo-qr-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'demo-qr-overlay';
        overlay.style.position = 'absolute';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,0.7)';
        overlay.style.color = '#F59E0B';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.fontSize = '0.8rem';
        overlay.style.fontWeight = 'bold';
        overlay.style.borderRadius = '8px';
        overlay.style.zIndex = '10';
        overlay.textContent = '🤖 데모 중';
        container.style.position = 'relative';
        container.appendChild(overlay);
      }
    });

    // 2. 가상 런칭 충전 시뮬레이션
    const launchHandler = this.game.sdk._messageHandlers.get('launchSpin');
    if (launchHandler) {
      bots.forEach(b => {
        launchHandler({ id: b.id }, { rpm: 2200 + Math.random() * 800 });
      });
    }

    // 3. 게임 시작
    this.game._launchRpms.clear();
    bots.forEach(b => {
      this.game._launchRpms.set(b.id, 2000 + Math.random() * 1000);
    });
    this.game.setPhase('launching');
    this.game._startLaunchCountdown();
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

    // QR 복구
    const qrContainers = document.querySelectorAll('.qr-container');
    qrContainers.forEach(container => {
      container.style.filter = '';
      container.style.pointerEvents = '';
      const overlay = container.querySelector('.demo-qr-overlay');
      if (overlay) {
        overlay.parentNode.removeChild(overlay);
      }
    });

    this.game._players.clear();
    this.game.sdk._players.clear();
    this.game._playerNicknames.clear();
  }

  mockMessageFromPlayer(playerId, type, payload) {
    const handler = this.game.sdk._messageHandlers.get(type);
    if (handler) {
      const player = this.game.getPlayer(playerId) || { id: playerId };
      handler(player, payload);
    }
  }

  onPhaseChange(phase) {
    if (!this.isDemo) return;

    if (phase === 'battle') {
      // 봇들의 실시간 AI 스티어링 루프 기동
      this.demoInterval = setInterval(() => {
        if (!this.game.physics) return;

        const bots = ['bot_amy', 'bot_bob', 'bot_charles'];
        bots.forEach(botId => {
          const botSpinner = this.game.physics.spinners.get(botId);
          if (!botSpinner || botSpinner.eliminated) return;

          // 목표 찾기: 아이템이 있으면 가장 가까운 아이템, 없으면 가장 가까운 적
          let target = { x: 0, z: 0 };
          const activeItems = this.game.physics.items;

          if (activeItems.length > 0) {
            let minDistance = Infinity;
            activeItems.forEach(item => {
              const dist = Math.hypot(item.x - botSpinner.x, item.z - botSpinner.z);
              if (dist < minDistance) {
                minDistance = dist;
                target = item;
              }
            });
          } else {
            // 다른 활성 스피너 타겟
            let minDistance = Infinity;
            this.game.physics.spinners.forEach((s, otherId) => {
              if (otherId === botId || s.eliminated) return;
              const dist = Math.hypot(s.x - botSpinner.x, s.z - botSpinner.z);
              if (dist < minDistance) {
                minDistance = dist;
                target = s;
              }
            });
          }

          // 스티어링 방향 벡터 계산
          const dx = target.x - botSpinner.x;
          const dz = target.z - botSpinner.z;
          const dist = Math.hypot(dx, dz);

          let tiltX = 0;
          let tiltZ = 0;
          if (dist > 0) {
            // 경계선(BOARD_RADIUS = 5.5) 밖으로 밀려나지 않으려는 본능 추가
            const r = Math.hypot(botSpinner.x, botSpinner.z);
            if (r > 3.8) {
              // 경기장 바깥이면 무조건 중심으로 복귀하는 힘
              const toCenterDist = Math.hypot(-botSpinner.x, -botSpinner.z);
              tiltX = -botSpinner.x / toCenterDist;
              tiltZ = -botSpinner.z / toCenterDist;
            } else {
              tiltX = dx / dist;
              tiltZ = dz / dist;
            }
          }

          // 약간의 무작위 흔들림 추가
          tiltX += (Math.random() - 0.5) * 0.2;
          tiltZ += (Math.random() - 0.5) * 0.2;

          // 클램핑
          tiltX = Math.max(-1, Math.min(1, tiltX));
          tiltZ = Math.max(-1, Math.min(1, tiltZ));

          this.mockMessageFromPlayer(botId, 'tiltInput', { tiltX, tiltZ });
        });
      }, 100);
    } else {
      if (this.demoInterval) {
        clearInterval(this.demoInterval);
        this.demoInterval = null;
      }
    }

    if (phase === 'result') {
      // 다시하기 자동 시뮬레이션
      const timeout = setTimeout(() => {
        const restartBtn = document.getElementById('btn-restart');
        if (restartBtn) {
          restartBtn.click();
        }
      }, 6000);
      this.demoTimeouts.push(timeout);
    }
  }
}
