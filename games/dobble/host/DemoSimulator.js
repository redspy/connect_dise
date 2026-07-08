export class DemoSimulator {
  constructor(game) {
    this.game = game;
    this.botTimers = new Map(); // botId -> timerId
    this.state = 'idle'; // 'idle', 'preparing', 'running', 'stopping'
    this.bots = [
      { id: 'bot_amy', nickname: '🤖 에이미 봇', color: '#EF4444' },
      { id: 'bot_bob', nickname: '🤖 밥 봇', color: '#10B981' },
      { id: 'bot_charles', nickname: '🤖 찰리 봇', color: '#3B82F6' }
    ];
  }

  isDemoActive() {
    return this.state === 'running' || this.state === 'preparing';
  }

  startDemo() {
    if (this.isDemoActive()) return;
    this.state = 'preparing';
    this.game._isDemo = true;

    // 1. 가상 봇 3명 등록
    this.game.attachDemoPlayers(this.bots);
    this.game._renderLobby();
    this.game.updateLobbyReady(3);

    // QR 블러 가드
    const qrWrap = document.querySelector('.qr-container');
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

    // 2. 데모 중단 배너 추가
    this.showDemoBanner();

    this.state = 'running';
    // 3. 게임 즉시 기동
    this.game._startGame();
    this.scheduleNextTaps();
  }

  showDemoBanner() {
    this.removeDemoBanner();

    const banner = document.createElement('div');
    banner.id = 'demoStopBanner';
    banner.style.position = 'fixed';
    banner.style.top = '0';
    banner.style.left = '0';
    banner.style.right = '0';
    banner.style.background = 'rgba(239, 68, 68, 0.95)';
    banner.style.color = '#fff';
    banner.style.textAlign = 'center';
    banner.style.padding = '10px 20px';
    banner.style.fontSize = '0.95rem';
    banner.style.fontWeight = 'bold';
    banner.style.zIndex = '9999';
    banner.style.display = 'flex';
    banner.style.justifyContent = 'space-between';
    banner.style.alignItems = 'center';
    banner.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';

    banner.innerHTML = `
      <span>🤖 데모 플레이 시뮬레이션 구동 중 — 실제 플레이어가 접속하거나 중단하면 정지합니다.</span>
      <button id="btnStopDemo" style="background:#fff; color:#EF4444; border:none; padding:6px 14px; font-weight:bold; border-radius:6px; cursor:pointer; font-size:0.85rem; box-shadow:0 2px 5px rgba(0,0,0,0.2);">데모 중단</button>
    `;

    document.body.appendChild(banner);

    const btn = document.getElementById('btnStopDemo');
    if (btn) {
      btn.onclick = () => {
        this.stopDemo();
      };
    }
  }

  removeDemoBanner() {
    const banner = document.getElementById('demoStopBanner');
    banner?.parentNode?.removeChild(banner);
  }

  scheduleNextTaps() {
    this.clearAllBotTimers();

    if (!this.game._gameStarted || this.state !== 'running') return;

    const botDelayConfigs = [
      { id: 'bot_amy', minDelay: 1200, maxDelay: 2500, accuracy: 0.85 },
      { id: 'bot_bob', minDelay: 1800, maxDelay: 3500, accuracy: 0.80 },
      { id: 'bot_charles', minDelay: 2500, maxDelay: 4800, accuracy: 0.75 }
    ];

    botDelayConfigs.forEach(config => {
      // 봇이 페널티 중이면 탭을 예약하지 않음
      if (this.game._frozen.has(config.id)) return;

      const myCard = this.game._playerCards.get(config.id);
      const center = this.game.getCurrentCenterCard();
      const myVersion = this.game.getPlayerCardVersion(config.id);
      const centerVersion = this.game.getCurrentCenterCardVersion();
      if (!myCard || !center) return;

      const delay = config.minDelay + Math.random() * (config.maxDelay - config.minDelay);

      const t = setTimeout(() => {
        if (!this.game._gameStarted || this.state !== 'running') return;

        const currentCenter = this.game.getCurrentCenterCard();
        // 80~85% 확률로 올바른 심볼 탭, 15~20% 확률로 오답 심볼 탭 시뮬레이션
        const isCorrect = Math.random() < config.accuracy;

        if (isCorrect) {
          // 공통 심볼 찾기
          const correctSymbol = myCard.find(s => currentCenter.includes(s));
          if (correctSymbol !== undefined) {
            this.game._onTapSymbol(config.id, correctSymbol, myVersion, centerVersion);
          }
        } else {
          // 오답 심볼 찾기 (중앙에는 없지만 내 카드에는 있는 것 중 하나)
          const wrongSymbol = myCard.find(s => !currentCenter.includes(s));
          if (wrongSymbol !== undefined) {
            this.game._onTapSymbol(config.id, wrongSymbol, myVersion, centerVersion);
          }
        }

        // 탭 완료 후 다음 탭 스케줄링 (탭 성공 시 centerCard가 갱신되어 scheduleNextTaps가 다시 불릴 것임)
        if (this.game._gameStarted) {
          this.scheduleNextTaps();
        }
      }, delay);

      this.botTimers.set(config.id, t);
    });
  }

  clearAllBotTimers() {
    for (const t of this.botTimers.values()) {
      clearTimeout(t);
    }
    this.botTimers.clear();
  }

  stopDemo() {
    if (this.state === 'stopping') return;
    this.state = 'stopping';

    this.clearAllBotTimers();
    this.removeDemoBanner();

    const overlay = document.getElementById('demoQROverlay');
    overlay?.parentNode?.removeChild(overlay);
    const qrWrap = document.querySelector('.qr-container');
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }

    this.game._isDemo = false;

    // 봇 제거
    const botIds = this.bots.map(b => b.id);
    this.game.detachDemoPlayers(botIds);

    this.state = 'idle';

    // 세션 초기화 및 로비로 안전 복귀
    this.game.resetSession();
  }
}
