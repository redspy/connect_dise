export class SpectrumDemoSimulator {
  constructor(game) {
    this.game = game;
    this.demoTimeouts = [];
  }

  get isDemo() {
    return this.game._isDemo;
  }

  startDemo() {
    if (this.game._isDemo) return;
    this.game._isDemo = true;

    // 가상 봇 3인 추가
    const bots = [
      { id: 'bot_alpha', nickname: '🤖 알파출제자', color: '#10B981' },
      { id: 'bot_beta', nickname: '🤖 베타추측기', color: '#3B82F6' },
      { id: 'bot_gamma', nickname: '🤖 감마추측기', color: '#F59E0B' }
    ];

    bots.forEach(b => {
      this.game._playerNicknames.set(b.id, b.nickname);
      this.game.players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
      this.game.sdk._players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
    });

    const qrWrap = document.querySelector('.qr-container') || document.querySelector('game-lobby')?.parentNode;
    if (qrWrap) {
      qrWrap.style.filter = 'blur(8px)';
      qrWrap.style.pointerEvents = 'none';
    }

    this.game._startGame();
  }

  stopDemo() {
    if (!this.game._isDemo) return;
    this.game._isDemo = false;

    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];

    const qrWrap = document.querySelector('.qr-container') || document.querySelector('game-lobby')?.parentNode;
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }

    this.game.players.clear();
    this.game.sdk._players.clear();
    this.game.resetSession();
  }

  triggerGiverClue() {
    if (!this.game._isDemo) return;

    // 타겟 앵글에 따른 실감나는 힌트 선택
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
      // 일반 대중적인 폴백 제시어
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

    // 약간의 오차를 둔 가상 정답 각도 설정 (인간미 반영)
    const error = -12 + Math.floor(Math.random() * 25);
    const targetGuess = Math.max(10, Math.min(170, this.game._targetAngle + error));

    let current = this.game._activeAngle;
    const step = () => {
      if (!this.game._isDemo || this.game.phase !== 'guess') return;

      const diff = targetGuess - current;
      if (Math.abs(diff) < 2) {
        current = targetGuess;
        this._triggerMessage('rotateDial', this.game._activeGuesser, { angle: current });

        // 잠시 대기 후 정답 제출
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
}
