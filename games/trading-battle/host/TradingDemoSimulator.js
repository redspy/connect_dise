export class TradingDemoSimulator {
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
      { id: 'bot_amy', nickname: '🤖 에이미', color: '#EF4444', avatarId: 3 },
      { id: 'bot_bob', nickname: '🤖 밥', color: '#10B981', avatarId: 5 },
      { id: 'bot_charles', nickname: '🤖 찰리', color: '#3B82F6', avatarId: 7 }
    ];

    bots.forEach(b => {
      const pObj = { id: b.id, color: b.color };
      this.game.players.set(b.id, pObj);
      this.game.sdk._players.set(b.id, pObj);
      this.game._profiles.set(b.id, { nickname: b.nickname, avatarId: b.avatarId });
      this.game._initPlayerPosition(b.id);
    });

    this.game.renderLobbyPlayers(this.game._getLobbyProfiles());
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

    this.game._players.clear();
    this.game.sdk._players.clear();
    this.game._profiles.clear();
    this.game._positions.clear();
    this.game._pendingOrders.clear();
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

    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }

    if (phase === 'trading') {
      // 봇들의 랜덤 포지션 트레이딩 AI 루프 기동
      const bots = ['bot_amy', 'bot_bob', 'bot_charles'];
      const positions = ['cash', 'long', 'short', 'long2x', 'short2x'];

      this.demoInterval = setInterval(() => {
        bots.forEach(botId => {
          // 이미 대기 중인 주문이 있거나 30% 확률을 뚫지 못하면 패스
          if (this.game._pendingOrders.has(botId)) return;
          if (Math.random() > 0.3) return;

          // 새로운 포지션 결정
          const pos = this.game._positions.get(botId);
          if (!pos) return;

          // 현재와 다른 포지션 중 랜덤 선택
          const available = positions.filter(p => {
            if (p === pos.type) return false;
            if (!this.game._settings.leverageEnabled && (p === 'long2x' || p === 'short2x')) return false;
            return true;
          });

          if (available.length === 0) return;
          const orderType = available[Math.floor(Math.random() * available.length)];

          this.mockMessageFromPlayer(botId, 'placeOrder', { orderType });
        });
      }, 3000); // 3초마다 체크
    } else if (phase === 'game_result') {
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
