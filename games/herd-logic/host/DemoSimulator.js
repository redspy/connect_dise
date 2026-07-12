export class HerdLogicDemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.timeouts = [];
  }

  startDemo() {
    // 실제 접속한 유저가 있을 경우 데모를 실행하지 못하게 가드
    const realPlayers = [...this.game.players.values()].filter(p => !p.id.startsWith('bot_'));
    if (realPlayers.length > 0) {
      alert('현재 로비에 실제 플레이어가 접속해 있어 데모를 실행할 수 없습니다.');
      return;
    }

    this.isDemo = true;
    this.game._isDemo = true;

    // 데모 배너 활성화
    const demoBanner = document.getElementById('demo-indicator-banner');
    if (demoBanner) {
      demoBanner.classList.remove('hidden');
      const timeSpan = document.getElementById('demo-step-time');
      if (timeSpan) timeSpan.textContent = '(초기화 중...)';
    }

    const bots = [
      { id: 'bot_alpha', nickname: '🤖 알파 조종사', color: '#00f3ff' },
      { id: 'bot_beta', nickname: '🤖 베타 조종사', color: '#ff3c3c' },
      { id: 'bot_gamma', nickname: '🤖 감마 조종사', color: '#39ff14' }
    ];

    this.game.players.clear();
    this.game.sdk._players.clear();
    this.game._playerNicknames.clear();

    bots.forEach(b => {
      this.game._playerNicknames.set(b.id, b.nickname);
      this.game.players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
      this.game.sdk._players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
    });

    this.game._startGame();
  }

  stopDemo() {
    this.isDemo = false;
    this.game._isDemo = false;
    this.clearTimeouts();

    // 호스트 인스턴스에 걸린 비동기 진행 타이머들도 해제
    if (this.game._demoNextRoundTimer) {
      clearTimeout(this.game._demoNextRoundTimer);
      this.game._demoNextRoundTimer = null;
    }
    if (this.game._demoResetTimer) {
      clearTimeout(this.game._demoResetTimer);
      this.game._demoResetTimer = null;
    }

    // 데모 배너 감춤
    const demoBanner = document.getElementById('demo-indicator-banner');
    if (demoBanner) demoBanner.classList.add('hidden');

    this.game.players.clear();
    this.game.sdk._players.clear();
    this.game._playerNicknames.clear();
  }

  queueBotAnswers(question) {
    if (!this.isDemo) return;

    const round = this.game._round;
    const bots = ['bot_alpha', 'bot_beta', 'bot_gamma'];
    
    // 라운드에 따른 결정론적 시연 시나리오
    // Round 1: 알파/베타 '사과' (다수파), 감마 '바나나' (소수파 -> 핑크카우 분배)
    // Round 2: 알파/베타 '치킨' (다수파), 감마 '피자' (소수파 -> 핑크카우 유지)
    // Round 3: 알파/베타/감마 모두 '일본' (전원 합의 다수파)
    // Round 4: 알파 '강아지', 베타 '고양이', 감마 '토끼' (모두 불일치 -> 복수 고유답)
    let answers = { bot_alpha: '사과', bot_beta: '사과', bot_gamma: '바나나' };
    
    if (round === 1) {
      answers = { bot_alpha: '사과', bot_beta: '사과', bot_gamma: '바나나' };
    } else if (round === 2) {
      answers = { bot_alpha: '치킨', bot_beta: '치킨', bot_gamma: '피자' };
    } else if (round === 3) {
      answers = { bot_alpha: '일본', bot_beta: '일본', bot_gamma: '일본' };
    } else if (round === 4) {
      answers = { bot_alpha: '강아지', bot_beta: '고양이', bot_gamma: '토끼' };
    }

    const timeSpan = document.getElementById('demo-step-time');
    if (timeSpan) {
      timeSpan.textContent = `(라운드 ${round} 진행 중...)`;
    }

    bots.forEach(botId => {
      const delay = 800 + Math.random() * 1200; // 0.8초 ~ 2초
      const tid = setTimeout(() => {
        if (!this.game._gameActive || this.game._roundPhase !== 'writing') return;

        const botObj = this.game.getPlayer(botId) || { id: botId };
        const handler = this.game.sdk._messageHandlers.get('submitAnswer');
        if (handler) {
          handler(botObj, { answer: answers[botId] });
        }

        // 모든 봇이 답변 제출 완료 시 자동 답변 공개 이행
        const submittedAll = bots.every(bid => this.game._playerAnswers.has(bid));
        if (submittedAll) {
          const autoRevealId = setTimeout(() => {
            if (this.game._gameActive && this.game._roundPhase === 'writing') {
              this.game._revealAnswers();
            }
          }, 1500);
          this.timeouts.push(autoRevealId);
        }
      }, delay);

      this.timeouts.push(tid);
    });
  }

  clearTimeouts() {
    this.timeouts.forEach(tid => clearTimeout(tid));
    this.timeouts = [];
  }
}
