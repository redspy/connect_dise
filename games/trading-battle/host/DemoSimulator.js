export class DemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.demoTimeouts = [];
    this.candleCount = 0;
    this.bannerEl = null;
  }

  startDemo() {
    if (this.isDemo) return;
    this.isDemo = true;
    this.candleCount = 0;

    // 1. 가상 봇 3명 등록
    const bots = [
      { id: 'bot_amy', nickname: '🤖 에이미', color: '#EF4444', avatarId: 3 },
      { id: 'bot_bob', nickname: '🤖 밥', color: '#10B981', avatarId: 5 },
      { id: 'bot_charles', nickname: '🤖 찰리', color: '#3B82F6', avatarId: 7 }
    ];

    bots.forEach(b => {
      const pObj = { id: b.id, color: b.color, ready: true };
      this.game.players.set(b.id, pObj);
      this.game.sdk._players.set(b.id, pObj);
      this.game._profiles.set(b.id, { nickname: b.nickname, avatarId: b.avatarId });
      this.game._initPlayerPosition(b.id);
    });

    this.game.renderLobbyPlayers(this.game._getLobbyProfiles());
    this.game.updateLobbyReady(3);

    // 2. QR 블러 가드 오버레이
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

    // 3. 데모 중단용 상시 탑 배너 생성
    this._createDemoBanner();

    // 4. 게임 시작
    this.game._startGame();
    this.game._broadcastPlayerList();
  }

  stopDemo() {
    if (!this.isDemo) return;
    this.isDemo = false;

    // 타이머 정리
    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];

    // QR 오버레이 정리
    const overlay = document.getElementById('demoQROverlay');
    overlay?.parentNode?.removeChild(overlay);
    const qrWrap = document.querySelector('.lobby-qr-box');
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }

    // 데모 배너 정리
    this._removeDemoBanner();

    // 호스트 세션 완전 리셋 (데이터 맵 클리어 및 원상복구)
    this.game.resetSession();
  }

  _createDemoBanner() {
    this._removeDemoBanner();

    const banner = document.createElement('div');
    banner.id = 'demo-control-banner';
    banner.style.position = 'fixed';
    banner.style.top = '10px';
    banner.style.left = '50%';
    banner.style.transform = 'translateX(-50%)';
    banner.style.background = 'linear-gradient(135deg, rgba(20, 24, 33, 0.95), rgba(30, 41, 59, 0.95))';
    banner.style.border = '1px solid rgba(245, 158, 11, 0.4)';
    banner.style.color = '#F59E0B';
    banner.style.padding = '8px 24px';
    banner.style.borderRadius = '30px';
    banner.style.display = 'flex';
    banner.style.alignItems = 'center';
    banner.style.gap = '16px';
    banner.style.zIndex = '9999';
    banner.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(245, 158, 11, 0.2)';
    banner.style.fontFamily = "'Inter', sans-serif";
    banner.style.fontSize = '0.95rem';
    banner.style.fontWeight = '600';

    banner.innerHTML = `
      <span style="display: flex; align-items: center; gap: 6px;">
        <span style="display:inline-block; width: 8px; height: 8px; background-color: #F59E0B; border-radius: 50%; animation: pulse 1.5s infinite;"></span>
        🤖 데모 시뮬레이션 동작 중
      </span>
      <button id="btn-stop-demo" style="background: #F59E0B; color: #000; border: none; padding: 4px 12px; border-radius: 20px; font-weight: bold; cursor: pointer; font-size: 0.8rem; transition: background 0.2s;">
        데모 중단
      </button>
    `;

    document.body.appendChild(banner);
    this.bannerEl = banner;

    // 중단 버튼 클릭 이벤트 바인딩
    document.getElementById('btn-stop-demo').onclick = () => {
      this.stopDemo();
    };

    // 애니메이션 스타일 동적 주입
    if (!document.getElementById('demo-animation-style')) {
      const style = document.createElement('style');
      style.id = 'demo-animation-style';
      style.innerHTML = `
        @keyframes pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  _removeDemoBanner() {
    if (this.bannerEl) {
      this.bannerEl.parentNode?.removeChild(this.bannerEl);
      this.bannerEl = null;
    }
    const banner = document.getElementById('demo-control-banner');
    banner?.parentNode?.removeChild(banner);
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

    if (phase === 'game_result') {
      // 6초 후 자동으로 로비 복귀
      const timeout = setTimeout(() => {
        const restartBtn = document.getElementById('btn-restart');
        if (restartBtn) {
          restartBtn.click();
        }
      }, 6000);
      this.demoTimeouts.push(timeout);
    }
  }

  // 매 캔들이 갱신될 때마다 봇들의 행동을 지시
  onCandleRevealed(candle) {
    if (!this.isDemo || this.game.phase !== 'trading') return;
    this.candleCount++;

    const bots = ['bot_amy', 'bot_bob', 'bot_charles'];
    const positions = ['cash', 'long', 'short', 'long2x', 'short2x'];

    bots.forEach((botId, index) => {
      // 이미 대기 중인 주문이 있다면 무시
      if (this.game._pendingOrders.has(botId)) return;

      const pos = this.game._positions.get(botId);
      if (!pos) return;

      // 시나리오형 데모: 초반에는 확실히 다른 포지션으로 유도하여 랭킹 격차 생성
      if (this.candleCount <= 3) {
        let targetPos = 'cash';
        if (index === 0) targetPos = 'long';
        if (index === 1) targetPos = 'short';
        
        if (pos.type !== targetPos) {
          this.mockMessageFromPlayer(botId, 'placeOrder', { orderType: targetPos });
        }
        return;
      }

      // 중반부 2배 레버리지 역전 연출 (일부러 2배를 침)
      if (this.candleCount === 8 && index === 1) {
        const trend = candle.close >= candle.open ? 'long2x' : 'short2x';
        this.mockMessageFromPlayer(botId, 'placeOrder', { orderType: trend });
        return;
      }

      // 평시에는 35% 확률로 봇들이 추세 또는 반대 포지션을 취하도록 행동
      if (Math.random() > 0.35) return;

      const available = positions.filter(p => {
        if (p === pos.type) return false;
        if (!this.game._settings.leverageEnabled && (p === 'long2x' || p === 'short2x')) return false;
        return true;
      });

      if (available.length === 0) return;
      const orderType = available[Math.floor(Math.random() * available.length)];
      this.mockMessageFromPlayer(botId, 'placeOrder', { orderType });
    });
  }
}
