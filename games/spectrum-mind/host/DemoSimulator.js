const BOT_IDS = ['bot_alpha', 'bot_beta', 'bot_gamma'];

export class SpectrumDemoSimulator {
  constructor(game) {
    this.game = game;
    this.demoTimeouts = [];
    this._snapshot = null;
  }

  get isDemo() {
    return this.game._isDemo;
  }

  startDemo() {
    if (this.game._isDemo) return;

    // 1. 휴먼 플레이어 혼입 방지 및 세션 파괴 예방
    if (this.game.players.size > 0) {
      alert('⚠️ 방에 실제 접속 중인 플레이어가 있어 데모를 시작할 수 없습니다.');
      return;
    }

    this.game._isDemo = true;

    // 2. 현재 상태 스냅샷 저장 (플레이어/닉네임/sdk._players는 getter-only 프로퍼티라
    // 통째로 재대입하면 TypeError가 나고, 그 사이 실제 플레이어가 들어왔을 수도 있으므로
    // 스냅샷·복원 대상에서 제외한다 — 정리는 항상 봇 id만 골라 제거하는 방식으로 처리)
    this._snapshot = {
      round: this.game._round,
      maxRounds: this.game._maxRounds,
      gameActive: this.game._gameActive,
      phase: this.game.phase
    };

    // 데모 모드에서는 3라운드로 설정
    this.game._maxRounds = 3;

    // 가상 봇 3인 구성
    const bots = [
      { id: 'bot_alpha', nickname: '🤖 알파출제자', color: '#10B981' },
      { id: 'bot_beta', nickname: '🤖 베타추측기', color: '#3B82F6' },
      { id: 'bot_gamma', nickname: '🤖 감마추측기', color: '#F59E0B' }
    ];

    // 3. 가상 세션 어댑터: 실제 세션 가입/준비 흐름 모사
    bots.forEach(b => {
      this.game._playerNicknames.set(b.id, b.nickname);
      this.game.sdk._players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
      
      const pObj = { id: b.id, color: b.color, nickname: b.nickname, ready: true };
      this.game.players.set(b.id, pObj);

      // 플랫폼 가입 이벤트 훅 호출
      this.game.onPlayerJoin(pObj);
    });

    // dead-selector 수정(2026-08-19, dixit 검수에서 발견된 크로스게임 패턴): 기존
    // '.qr-container' || 'game-lobby'?.parentNode 폴백은 QR박스가 아닌 로비 패널
    // 전체(설정/규칙 텍스트 포함)를 블러 처리하는 과잉 동작이었음 — .lobby-qr-box로 특정.
    const qrWrap = document.querySelector('.lobby-qr-box');
    if (qrWrap) {
      qrWrap.style.filter = 'blur(8px)';
      qrWrap.style.pointerEvents = 'none';
    }

    // 4. 데모 상태 안내 배너 표시
    this._showDemoBanner();

    // 준비 완료 및 게임 시작
    const t = setTimeout(() => {
      if (this.game._isDemo) {
        this.game.onReadyUpdate({ readyCount: bots.length, total: bots.length });
        this.game._startGame();
        this._showDemoBanner(); // 라운드 번호 업데이트
      }
    }, 1500);
    this.demoTimeouts.push(t);
  }

  stopDemo() {
    if (!this.game._isDemo) return;
    this.game._isDemo = false;

    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];

    this._hideDemoBanner();

    const qrWrap = document.querySelector('.lobby-qr-box');
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) demoPlayBtn.textContent = '🤖 데모 플레이 실행';

    // 5. 실제 플레이어까지 지우지 않도록 봇 id만 골라서 정리 (전체 clear()/재대입 금지 —
    // this.game.players는 getter-only라 재대입 시 TypeError가 남)
    BOT_IDS.forEach(id => {
      this.game.players.delete(id);
      this.game.sdk._players.delete(id);
      this.game._playerNicknames.delete(id);
      this.game._scores.delete(id);
    });

    // 라운드/페이즈 등 플레이어와 무관한 게임 진행 상태만 스냅샷으로 복원
    if (this._snapshot) {
      this.game._round = this._snapshot.round;
      this.game._maxRounds = this._snapshot.maxRounds;
      this.game._gameActive = this._snapshot.gameActive;
      this.game.setPhase(this._snapshot.phase);
      this._snapshot = null;
    } else {
      this.game.resetSession();
    }
  }

  triggerGiverClue() {
    if (!this.game._isDemo) return;

    this._showDemoBanner(); // 배너 업데이트

    // 타겟 앵글에 따른 힌트 선택
    const leftConcept = this.game._currentConcept.left;
    const targetAngle = this.game._targetAngle;

    let clue = '어중간한 무언가';

    if (leftConcept.includes('차가움')) {
      if (targetAngle < 60) clue = '남극 삔 빙하 ❄️';
      else if (targetAngle < 120) clue = '미지근한 보리차 🍵';
      else clue = '활활 타는 화덕 🍕';
    } else if (leftConcept.includes('부드러움')) {
      if (targetAngle < 60) clue = '아기 뺨에 닿는 깃털 🪶';
      else if (targetAngle < 120) clue = '약간 말랑한 지우개';
      else clue = '강철 합판 🧱';
    } else if (leftConcept.includes('느림')) {
      if (targetAngle < 60) clue = '달팽이의 산책 🐌';
      else if (targetAngle < 120) clue = '유모차 주행';
      else clue = '빛의 전파 ⚡';
    } else {
      if (targetAngle < 60) clue = '완벽한 부정';
      else if (targetAngle < 120) clue = '그저 그런 중간';
      else clue = '강력한 긍정';
    }

    const t = setTimeout(() => {
      if (this.game._isDemo && this.game.phase === 'clue') {
        const dummyPlayer = this.game._giver;
        this._triggerMessage('submitClue', dummyPlayer, { clue });
      }
    }, 2500);
    this.demoTimeouts.push(t);
  }

  triggerGuesserRotation() {
    if (!this.game._isDemo) return;

    const error = -12 + Math.floor(Math.random() * 25);
    const targetGuess = Math.max(10, Math.min(170, this.game._targetAngle + error));

    let current = this.game._activeAngle;
    const step = () => {
      if (!this.game._isDemo || this.game.phase !== 'guess') return;

      const diff = targetGuess - current;
      if (Math.abs(diff) < 2) {
        current = targetGuess;
        this._triggerMessage('rotateDial', this.game._activeGuesser, { angle: current });

        const t = setTimeout(() => {
          if (this.game._isDemo && this.game.phase === 'guess') {
            this._triggerMessage('submitGuess', this.game._activeGuesser, {});
          }
        }, 1500);
        this.demoTimeouts.push(t);
      } else {
        current += diff > 0 ? 3 : -3;
        this._triggerMessage('rotateDial', this.game._activeGuesser, { angle: current });

        const t = setTimeout(step, 40);
        this.demoTimeouts.push(t);
      }
    };

    const startTimeout = setTimeout(step, 2000);
    this.demoTimeouts.push(startTimeout);
  }

  _triggerMessage(type, player, payload) {
    const handler = this.game.sdk._messageHandlers.get(type);
    if (handler) {
      handler(player, payload);
    }
  }

  _showDemoBanner() {
    let banner = document.getElementById('demo-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'demo-banner';
      banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        background: linear-gradient(90deg, #f59e0b, #d97706);
        color: #000;
        font-weight: bold;
        text-align: center;
        padding: 10px;
        z-index: 9999;
        font-size: 1.1rem;
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 15px;
      `;
      document.body.appendChild(banner);
    }

    banner.innerHTML = `
      <span>🤖 데모 플레이 실행 중 (라운드: ${this.game._round}/${this.game._maxRounds})</span>
      <button id="btn-stop-demo-banner" style="
        background: #000;
        color: #fff;
        border: none;
        padding: 4px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        font-size: 0.9rem;
      ">⏹️ 중지</button>
    `;

    document.getElementById('btn-stop-demo-banner').onclick = () => {
      this.stopDemo();
    };
  }

  _hideDemoBanner() {
    const banner = document.getElementById('demo-banner');
    if (banner) banner.remove();
  }
}
