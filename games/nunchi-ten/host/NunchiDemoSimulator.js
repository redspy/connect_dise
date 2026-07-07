export class NunchiDemoSimulator {
  constructor(game) {
    this.game = game;
    this.demoTimeouts = [];
    this.state = 'idle'; // 'idle' or 'running'
    this.snapshot = null;
  }

  // 타이머를 예약하고 추적할 수 있도록 하는 헬퍼
  schedule(fn, delay) {
    if (this.state !== 'running') return;
    const t = setTimeout(() => {
      const idx = this.demoTimeouts.indexOf(t);
      if (idx > -1) this.demoTimeouts.splice(idx, 1);
      fn();
    }, delay);
    this.demoTimeouts.push(t);
    return t;
  }

  startDemo() {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.game._isDemo = true;

    // 1. 현재 로비 상태 스냅샷 저장
    this.snapshot = {
      players: new Map(this.game.players),
      profiles: new Map(this.game._profiles),
      data: new Map(this.game._data),
      readyCount: this.game._readyCount,
      gameStarted: this.game._gameStarted,
      phase: this.game.phase
    };

    // 2. 가상 봇 3명 등록
    const bots = [
      { id: 'bot_amy', nickname: '🤖 에이미 봇', color: '#EF4444', avatarId: 3 },
      { id: 'bot_bob', nickname: '🤖 밥 봇', color: '#10B981', avatarId: 5 },
      { id: 'bot_charles', nickname: '🤖 찰리 봇', color: '#3B82F6', avatarId: 8 }
    ];

    // 기존 데이터 초기화 (데모용)
    this.game.players.clear();
    this.game._profiles.clear();
    this.game._data.clear();

    bots.forEach(b => {
      this.game._profiles.set(b.id, { nickname: b.nickname, avatarId: b.avatarId });
      this.game.players.set(b.id, { id: b.id, color: b.color });
      this.game._initPlayerData(b.id);
    });

    this.game.renderLobbyPlayers(this.game._getLobbyProfiles());
    this.game.updateLobbyReady(3);

    // QR 블러 및 안내 오버레이 노출
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
      overlayText.innerHTML = '<span>🤖 데모 플레이 진행 중...</span><br><small style="font-size:0.78rem;color:#bbb;margin-top:4px;">실제 플레이어가 참가하면 종료됩니다.</small>';
      qrWrap.parentNode.style.position = 'relative';
      qrWrap.parentNode.appendChild(overlayText);
    }

    // 데모 배너 및 중단 버튼 활성화
    const demoBanner = document.getElementById('demo-banner');
    if (demoBanner) {
      demoBanner.classList.remove('hidden');
      const stopBtn = document.getElementById('demo-stop-btn');
      if (stopBtn) {
        stopBtn.onclick = () => this.stopDemo();
      }
    }

    // 게임 즉시 기동
    this.game._startGame();
  }

  simulateChoices() {
    if (this.state !== 'running' || this.game.phase !== 'round_input') return;

    const bots = ['bot_amy', 'bot_bob', 'bot_charles'];
    bots.forEach(botId => {
      const data = this.game._data.get(botId);
      if (!data || data.remainingCards.length === 0) return;

      this.schedule(() => {
        if (this.state !== 'running' || this.game.phase !== 'round_input') return;
        const cards = data.remainingCards;
        const card = cards[Math.floor(Math.random() * cards.length)];
        const useDouble = data.doublesLeft > 0 && Math.random() < 0.25;
        this.game._handleSubmission(botId, card, useDouble);
      }, 1000 + Math.random() * 1500); // 1.0 ~ 2.5초 지연 제출
    });
  }

  stopDemo() {
    if (this.state === 'idle') return;
    this.state = 'idle';

    // 1. 모든 예약된 데모 타이머 제거
    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];

    // 2. UI 정리
    const overlay = document.getElementById('demoQROverlay');
    overlay?.parentNode?.removeChild(overlay);
    const qrWrap = document.querySelector('.qr-container');
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }

    const demoBanner = document.getElementById('demo-banner');
    if (demoBanner) {
      demoBanner.classList.add('hidden');
    }

    // 3. 스냅샷 복원
    this.game._isDemo = false;
    if (this.snapshot) {
      this.game.players = this.snapshot.players;
      this.game._profiles = this.snapshot.profiles;
      this.game._data = this.snapshot.data;
      this.game._readyCount = this.snapshot.readyCount;
      this.game._gameStarted = this.snapshot.gameStarted;
      
      const prevPhase = this.snapshot.phase;
      this.snapshot = null;

      // 4. 로비 혹은 이전 페이즈 상태 복구
      this.game.setPhase(prevPhase || 'lobby');
      this.game.renderLobbyPlayers(this.game._getLobbyProfiles());
      this.game.updateLobbyReady(this.game._readyCount);
    } else {
      this.game.players.clear();
      this.game._profiles.clear();
      this.game._data.clear();
      this.game._readyCount = 0;
      this.game._gameStarted = false;
      this.game.setPhase('lobby');
      this.game.renderLobbyPlayers(this.game._getLobbyProfiles());
      this.game.updateLobbyReady(0);
    }
  }
}
