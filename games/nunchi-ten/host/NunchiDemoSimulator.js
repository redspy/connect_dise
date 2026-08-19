const BOT_DEFS = [
  { id: 'bot_amy', nickname: '🤖 에이미 봇', color: '#EF4444', avatarId: 3 },
  { id: 'bot_bob', nickname: '🤖 밥 봇', color: '#10B981', avatarId: 5 },
  { id: 'bot_charles', nickname: '🤖 찰리 봇', color: '#3B82F6', avatarId: 8 },
];
const BOT_IDS = BOT_DEFS.map(b => b.id);

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

    // 1. 게임 시작/재개용 스칼라 상태만 스냅샷 저장 (players/profiles/data는 저장하지
    // 않음 — 통째로 복원하면 데모 도중 실제로 join한 플레이어까지 지워지는 문제가
    // 있었음. 봇은 아래에서 기존 맵에 추가만 하고, 종료 시 봇 id만 제거한다).
    this.snapshot = {
      readyCount: this.game._readyCount,
      gameStarted: this.game._gameStarted,
      phase: this.game.phase,
    };

    // 2. 가상 봇 3명을 기존 맵에 "추가"(clear 안 함 — 로비에 이미 대기 중인 실제
    // 플레이어가 있어도 지워지지 않도록).
    BOT_DEFS.forEach(b => {
      this.game._profiles.set(b.id, { nickname: b.nickname, avatarId: b.avatarId });
      this.game._players.set(b.id, { id: b.id, color: b.color });
      this.game._initPlayerData(b.id);
    });

    this.game.renderLobbyPlayers(this.game._getLobbyProfiles());
    this.game.updateLobbyReady(this.game.playerCount);

    // QR 블러 및 안내 오버레이 노출
    // dead-selector 수정(2026-08-19, dixit 검수에서 발견된 크로스게임 패턴): <game-lobby>
    // 공통 컴포넌트의 실제 QR 클래스는 .lobby-qr-box임(.qr-container는 이 DOM에 없어
    // 항상 null — 블러 가드가 조용히 무력화돼 있었음).
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

    BOT_IDS.forEach(botId => {
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
    const qrWrap = document.querySelector('.lobby-qr-box');
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }

    const demoBanner = document.getElementById('demo-banner');
    if (demoBanner) {
      demoBanner.classList.add('hidden');
    }

    // 3. 봇 엔트리만 제거 — 데모 도중 실제 플레이어가 join했다면(onPlayerJoin→
    // stopDemo 경로) this.game._players/_profiles/_data에 이미 정상 추가돼 있으므로
    // 그대로 보존해야 한다. (과거엔 시작 시점 스냅샷으로 맵을 통째로 덮어써서, 데모
    // 도중 합류한 실제 플레이어가 로비 UI에서 유령처럼 사라지는 버그가 있었음 —
    // Claude CLI 리뷰로 발견.)
    this.game._isDemo = false;
    for (const id of BOT_IDS) {
      this.game._players.delete(id);
      this.game._profiles.delete(id);
      this.game._data.delete(id);
    }

    if (this.snapshot) {
      this.game._readyCount = this.snapshot.readyCount;
      this.game._gameStarted = this.snapshot.gameStarted;
      const prevPhase = this.snapshot.phase;
      this.snapshot = null;
      this.game.setPhase(prevPhase || 'lobby');
    } else {
      this.game._readyCount = 0;
      this.game._gameStarted = false;
      this.game.setPhase('lobby');
    }
    this.game.renderLobbyPlayers(this.game._getLobbyProfiles());
    this.game.updateLobbyReady(this.game._readyCount);
  }
}
