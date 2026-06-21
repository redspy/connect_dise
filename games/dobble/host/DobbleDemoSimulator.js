export class DobbleDemoSimulator {
  constructor(game) {
    this.game = game;
    this.botTimers = new Map(); // botId -> timerId
  }

  startDemo() {
    this.game._isDemo = true;

    // 1. 가상 봇 3명 등록
    const bots = [
      { id: 'bot_amy', nickname: '🤖 에이미 봇', color: '#EF4444' },
      { id: 'bot_bob', nickname: '🤖 밥 봇', color: '#10B981' },
      { id: 'bot_charles', nickname: '🤖 찰리 봇', color: '#3B82F6' }
    ];

    bots.forEach(b => {
      this.game._profiles.set(b.id, { nickname: b.nickname });
      this.game.players.set(b.id, { id: b.id, color: b.color });
      this.game._scores.set(b.id, 0);
    });

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

    // 게임 즉시 기동
    this.game._startGame();
    this.scheduleNextTaps();
  }

  scheduleNextTaps() {
    this.clearAllBotTimers();

    if (!this.game._gameStarted) return;

    const bots = [
      { id: 'bot_amy', minDelay: 1200, maxDelay: 2500 },
      { id: 'bot_bob', minDelay: 1800, maxDelay: 3500 },
      { id: 'bot_charles', minDelay: 2500, maxDelay: 4800 }
    ];

    bots.forEach(bot => {
      // 봇이 페널티 중이면 탭을 예약하지 않음
      if (this.game._frozen.has(bot.id)) return;

      const myCard = this.game._playerCards.get(bot.id);
      const center = this.game._centerCard;
      if (!myCard || !center) return;

      // 공통 심볼 찾기
      const correctSymbol = myCard.find(s => center.includes(s));
      if (correctSymbol === undefined) return;

      const delay = bot.minDelay + Math.random() * (bot.maxDelay - bot.minDelay);

      const t = setTimeout(() => {
        // 탭 실행
        this.game._onTapSymbol(bot.id, correctSymbol);
        
        // 탭 완료 후 다음 탭 스케줄링 (탭 성공 시 centerCard가 갱신되어 scheduleNextTaps가 다시 불릴 것임)
        if (this.game._gameStarted) {
          this.scheduleNextTaps();
        }
      }, delay);

      this.botTimers.set(bot.id, t);
    });
  }

  clearAllBotTimers() {
    for (const t of this.botTimers.values()) {
      clearTimeout(t);
    }
    this.botTimers.clear();
  }

  stopDemo() {
    this.clearAllBotTimers();

    const overlay = document.getElementById('demoQROverlay');
    overlay?.parentNode?.removeChild(overlay);
    const qrWrap = document.querySelector('.qr-container');
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }

    this.game._isDemo = false;
  }
}
