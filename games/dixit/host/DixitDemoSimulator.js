export class DixitDemoSimulator {
  constructor(game) {
    this.game = game;
    this.demoTimeouts = [];
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

    // 게임 시작
    this.game._startGame();
    this.game._broadcastPlayerList();
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

  mockMessageFromPlayer(playerId, type, payload) {
    const handler = this.game.sdk._messageHandlers.get(type);
    if (handler) {
      const player = this.game.players.get(playerId) || { id: playerId };
      handler(player, payload);
    }
  }

  onPhaseChange(phase) {
    if (!this.game._isDemo) return;

    // 기존 예약 취소
    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];

    if (phase === 'storytelling') {
      const storytellerId = this.game._storytellerId;
      if (storytellerId && storytellerId.startsWith('bot_')) {
        const timeout = setTimeout(() => {
          const hand = this.game._hands.get(storytellerId) ?? [];
          if (hand.length === 0) return;
          const cardId = hand[Math.floor(Math.random() * hand.length)];
          const clues = ["평화로운 오후", "숨겨진 진실", "모험의 시작", "달콤한 꿈", "끝없는 우주", "신비로운 숲"];
          const clue = clues[Math.floor(Math.random() * clues.length)];
          this.mockMessageFromPlayer(storytellerId, 'submitClue', { cardId, clue });
        }, 3000);
        this.demoTimeouts.push(timeout);
      }
    } else if (phase === 'card-selection') {
      // 비스토리텔러 봇들이 카드 제출
      const storytellerId = this.game._storytellerId;
      this.game.players.forEach(p => {
        if (p.id === storytellerId) return;
        if (p.id.startsWith('bot_')) {
          const delay = 1500 + Math.random() * 2000;
          const timeout = setTimeout(() => {
            const hand = this.game._hands.get(p.id) ?? [];
            if (hand.length === 0) return;
            const cardId = hand[Math.floor(Math.random() * hand.length)];
            this.mockMessageFromPlayer(p.id, 'submitCard', { cardId });
          }, delay);
          this.demoTimeouts.push(timeout);
        }
      });
    } else if (phase === 'voting') {
      // 비스토리텔러 봇들이 투표 제출
      const storytellerId = this.game._storytellerId;
      this.game.players.forEach(p => {
        if (p.id === storytellerId) return;
        if (p.id.startsWith('bot_')) {
          const delay = 2000 + Math.random() * 2500;
          const timeout = setTimeout(() => {
            // 자신의 제출 카드는 투표 제외
            const myCard = this.game._submissions.find(s => s.playerId === p.id)?.cardId;
            const votable = this.game._boardCards.filter(c => c !== myCard);
            if (votable.length === 0) return;
            const cardId = votable[Math.floor(Math.random() * votable.length)];
            this.mockMessageFromPlayer(p.id, 'submitVote', { cardId });
          }, delay);
          this.demoTimeouts.push(timeout);
        }
      });
    } else if (phase === 'round-result') {
      // 다음 라운드 버튼 클릭 시뮬레이션
      const timeout = setTimeout(() => {
        const nextBtn = document.getElementById('next-round-btn');
        if (nextBtn) {
          nextBtn.click();
        }
      }, 5000);
      this.demoTimeouts.push(timeout);
    } else if (phase === 'final') {
      // 재시작 버튼 클릭 시뮬레이션
      const timeout = setTimeout(() => {
        const restartBtn = document.getElementById('restart-btn');
        if (restartBtn) {
          restartBtn.click();
        }
      }, 5000);
      this.demoTimeouts.push(timeout);
    }
  }
}
