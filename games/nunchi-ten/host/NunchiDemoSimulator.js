export class NunchiDemoSimulator {
  constructor(game) {
    this.game = game;
    this.demoTimeouts = [];
  }

  startDemo() {
    this.game._isDemo = true;

    // 1. 가상 봇 3명 등록
    const bots = [
      { id: 'bot_amy', nickname: '🤖 에이미 봇', color: '#EF4444', avatarId: 3 },
      { id: 'bot_bob', nickname: '🤖 밥 봇', color: '#10B981', avatarId: 5 },
      { id: 'bot_charles', nickname: '🤖 찰리 봇', color: '#3B82F6', avatarId: 8 }
    ];

    bots.forEach(b => {
      this.game._profiles.set(b.id, { nickname: b.nickname, avatarId: b.avatarId });
      this.game.players.set(b.id, { id: b.id, color: b.color });
      this.game._initPlayerData(b.id);
    });

    this.game.renderLobbyPlayers(this.game._getLobbyProfiles());
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
  }

  simulateChoices() {
    if (this.game.phase !== 'round_input') return;

    const bots = ['bot_amy', 'bot_bob', 'bot_charles'];
    bots.forEach(botId => {
      const data = this.game._data.get(botId);
      if (!data || data.remainingCards.length === 0) return;

      // 봇 카드 랜덤 선택
      const cards = data.remainingCards;
      const card = cards[Math.floor(Math.random() * cards.length)];
      
      // 더블 아이템 사용 유무 (20% 확률로 사용)
      const useDouble = data.doublesLeft > 0 && Math.random() < 0.2;

      // 제출
      this.game._handleSubmission(botId, card, useDouble);
    });
  }

  stopDemo() {
    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];

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
