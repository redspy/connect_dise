export class DemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.demoInterval = null;
    this.demoTimeouts = [];
  }

  startDemo() {
    if (this.isDemo) return;
    this.isDemo = true;

    // 1. 가상 봇 3명 정의
    const bots = [
      { id: 'bot_amy', nickname: '🤖 에이미', color: '#EF4444' },
      { id: 'bot_bob', nickname: '🤖 밥', color: '#10B981' },
      { id: 'bot_charles', nickname: '🤖 찰리', color: '#3B82F6' }
    ];

    // 호스트 게임의 데모 세션 시작 API 호출
    this.game.beginDemoSession(bots);

    // 봇들의 런칭 충전 시뮬레이션
    bots.forEach(b => {
      this.game.injectDemoLaunch(b.id, 2200 + Math.random() * 800);
    });

    // 1초 후 게임 강제 시작
    const startTimeout = setTimeout(() => {
      if (this.isDemo && this.game._lobbyEl?.onStart) {
        this.game._lobbyEl.onStart();
      }
    }, 1000);
    this.demoTimeouts.push(startTimeout);
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

    // 호스트 게임의 데모 세션 종료 API 호출
    this.game.endDemoSession();
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

          this.game.injectDemoTilt(botId, tiltX, tiltZ);
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
