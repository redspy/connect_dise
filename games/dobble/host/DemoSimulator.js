const BOT_DELAY_CONFIGS = [
  { id: 'bot_amy', minDelay: 1200, maxDelay: 2500, accuracy: 0.85 },
  { id: 'bot_bob', minDelay: 1800, maxDelay: 3500, accuracy: 0.80 },
  { id: 'bot_charles', minDelay: 2500, maxDelay: 4800, accuracy: 0.75 }
];
const FREEZE_RECHECK_MS = 300; // 페널티 중인 봇의 재시도 재확인 간격

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
    // dead-selector 수정(2026-08-19, dixit 검수에서 발견된 크로스게임 패턴): 이 게임은
    // <game-lobby> 공통 컴포넌트를 쓰는데 그 QR 실제 클래스는 .lobby-qr-box임
    // (.qr-container는 구버전 수동 QR 패턴 잔재로 이 DOM에 존재하지 않아 항상 null —
    // "데모 중 신규 접속 불가" 블러 가드가 조용히 무력화돼 있었음).
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

    // game-appbar의 '다시하기' 버튼이 이 fixed 배너(95% 불투명)와 같은 상단 위치에
    // 겹쳐 유령처럼 비쳐 보이는 버그가 있었음(agy 비주얼 검증으로 실측 발견,
    // 2026-08-20). 데모 중엔 정식 '데모 중단' 버튼이 그 역할을 대신하므로,
    // 혼동을 주는 appbar 버튼은 데모 동안 숨긴다.
    document.querySelector('.appbar-btn-restart')?.classList.add('hidden');
  }

  removeDemoBanner() {
    const banner = document.getElementById('demoStopBanner');
    banner?.parentNode?.removeChild(banner);
    document.querySelector('.appbar-btn-restart')?.classList.remove('hidden');
  }

  // 데모 시작(또는 데모 재개) 시 3명 전원의 탭 스케줄을 처음 세팅함.
  // ⚠️ 개별 봇 탭 이후의 "다음 탭 예약"은 여기가 아니라 _scheduleBotTap() 자기 자신 재호출로 처리함 —
  // 과거엔 아무 봇이나 탭할 때마다 clearAllBotTimers()로 전원 타이머를 리셋했는데, 그러면 가장 느린 봇
  // (찰리, 2.5~4.8s)은 더 빠른 봇들(에이미/밥)이 먼저 탭할 때마다 예약이 계속 취소되어 사실상 영원히
  // 탭할 기회를 못 얻는 "타이머 기아" 버그가 있었음. 개별 봇 단위로만 재예약하도록 수정함.
  scheduleNextTaps() {
    this.clearAllBotTimers();
    if (!this.game._gameStarted || this.state !== 'running') return;
    BOT_DELAY_CONFIGS.forEach(config => this._scheduleBotTap(config));
  }

  _scheduleBotTap(config) {
    if (!this.game._gameStarted || this.state !== 'running') return;

    // 페널티 중이면 실제 탭을 예약하지 않고, 해제 여부만 짧은 주기로 재확인함
    // (재확인하지 않으면 이 봇은 페널티가 풀려도 영원히 다시 탭하지 않게 됨).
    if (this.game._frozen.has(config.id)) {
      const t = setTimeout(() => this._scheduleBotTap(config), FREEZE_RECHECK_MS);
      this.botTimers.set(config.id, t);
      return;
    }

    const myCard = this.game._playerCards.get(config.id);
    const center = this.game.getCurrentCenterCard();
    if (!myCard || !center) return;

    const delay = config.minDelay + Math.random() * (config.maxDelay - config.minDelay);

    const t = setTimeout(() => {
      if (!this.game._gameStarted || this.state !== 'running') return;

      // 실제 탭 시점 기준 최신 카드/버전을 다시 읽어 판정(예약 시점 값은 쓰지 않음)
      const currentCard = this.game._playerCards.get(config.id);
      const currentCenter = this.game.getCurrentCenterCard();
      const myVersion = this.game.getPlayerCardVersion(config.id);
      const centerVersion = this.game.getCurrentCenterCardVersion();
      if (!currentCard || !currentCenter) return;

      // 80~85% 확률로 올바른 심볼 탭, 15~20% 확률로 오답 심볼 탭 시뮬레이션
      const isCorrect = Math.random() < config.accuracy;

      if (isCorrect) {
        const correctSymbol = currentCard.find(s => currentCenter.includes(s));
        if (correctSymbol !== undefined) {
          this.game._onTapSymbol(config.id, correctSymbol, myVersion, centerVersion);
        }
      } else {
        const wrongSymbol = currentCard.find(s => !currentCenter.includes(s));
        if (wrongSymbol !== undefined) {
          this.game._onTapSymbol(config.id, wrongSymbol, myVersion, centerVersion);
        }
      }

      // 이 봇 자신만 다음 탭을 재예약 — 다른 봇들의 대기 중인 타이머는 건드리지 않음
      if (this.game._gameStarted) {
        this._scheduleBotTap(config);
      }
    }, delay);

    this.botTimers.set(config.id, t);
  }

  clearAllBotTimers() {
    for (const t of this.botTimers.values()) {
      clearTimeout(t);
    }
    this.botTimers.clear();
  }

  /**
   * @param {boolean} emitReset 세션 리셋(resetSession)까지 함께 트리거할지 여부.
   *   기본 true(직접 "데모 중단" 클릭, 실제 플레이어 접속 등 데모를 "그만둬야 해서" 부르는 경로).
   *   onReset()에서는 반드시 false로 호출해야 함 — onReset() 자체가 이미 resetSession()의
   *   결과로 실행되는 콜백이라, 여기서 다시 resetSession()을 부르면 onReset()이 한 번 더
   *   호출되는 불필요한 왕복이 생김(과거엔 이 가드 자체가 없어 onReset↔stopDemo↔resetSession이
   *   무한 재귀에 빠져 재대결/재시작마다 서버에 reset 이벤트가 수만 회씩 재귀 전송되는 심각한
   *   버그였음 — isDemoActive() 가드로 무한루프는 막되, emitReset로 불필요한 1회 왕복도 없앰).
   */
  stopDemo(emitReset = true) {
    if (!this.isDemoActive()) return; // 데모가 실행 중이 아니면 아무 것도 하지 않음
    this.state = 'stopping';

    this.clearAllBotTimers();
    this.removeDemoBanner();

    const overlay = document.getElementById('demoQROverlay');
    overlay?.parentNode?.removeChild(overlay);
    const qrWrap = document.querySelector('.lobby-qr-box');
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
      if (qrWrap.parentNode) qrWrap.parentNode.style.position = '';
    }

    this.game._isDemo = false;

    // 봇 제거
    const botIds = this.bots.map(b => b.id);
    this.game.detachDemoPlayers(botIds);

    this.state = 'idle';

    if (emitReset) {
      // 세션 초기화 및 로비로 안전 복귀
      this.game.resetSession();
    }
  }
}
