export class HerdLogicDemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.timeouts = [];

    // 가상 봇 전용 답변 매핑 사전 (알파/베타는 다수파 동조, 감마는 고독한 핑크카우 유발자)
    this.answerSets = {
      '가장 인기 있는 과일은?': { bot_alpha: '사과', bot_beta: '사과', bot_gamma: '바나나' },
      '가장 해롭다고 생각하는 야식 메뉴는?': { bot_alpha: '치킨', bot_beta: '치킨', bot_gamma: '피자' },
      '여름 휴가로 가장 가고 싶은 나라는?': { bot_alpha: '일본', bot_beta: '일본', bot_gamma: '미국' },
      '가장 대표적인 애완동물은?': { bot_alpha: '강아지', bot_beta: '강아지', bot_gamma: '고양이' },
      '한국인들이 가장 자주 마시는 음료는?': { bot_alpha: '커피', bot_beta: '커피', bot_gamma: '녹차' },
      '일주일 중 가장 피곤한 요일은?': { bot_alpha: '월요일', bot_beta: '월요일', bot_gamma: '금요일' },
      '눈이 오면 가장 먼저 하고 싶은 일은?': { bot_alpha: '눈사람', bot_beta: '눈사람', bot_gamma: '눈싸움' },
      '가장 먼저 떠오르는 초능력은?': { bot_alpha: '비행', bot_beta: '비행', bot_gamma: '순간이동' },
      '학창 시절 가장 싫어했던 과목은?': { bot_alpha: '수학', bot_beta: '수학', bot_gamma: '영어' },
      '가장 맛있는 라면 브랜드는?': { bot_alpha: '신라면', bot_beta: '신라면', bot_gamma: '진라면' }
    };
  }

  startDemo() {
    this.isDemo = true;
    this.game._isDemo = true;

    const bots = [
      { id: 'bot_alpha', nickname: '🤖 알파 조종사', color: '#00f3ff' },
      { id: 'bot_beta', nickname: '🤖 베타 조종사', color: '#ff3c3c' },
      { id: 'bot_gamma', nickname: '🤖 감마 조종사', color: '#39ff14' }
    ];

    this.game.players.clear();
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
    this.game.players.clear();
    this.game.sdk._players.clear();
    this.game._playerNicknames.clear();
  }

  queueBotAnswers(question) {
    if (!this.isDemo) return;

    const bots = ['bot_alpha', 'bot_beta', 'bot_gamma'];
    const set = this.answerSets[question] || { bot_alpha: '동일', bot_beta: '동일', bot_gamma: '독특' };

    bots.forEach(botId => {
      const delay = 800 + Math.random() * 1200; // 0.8초 ~ 2초
      const tid = setTimeout(() => {
        if (!this.game._gameActive || this.game._roundPhase !== 'writing') return;

        const botObj = this.game.getPlayer(botId) || { id: botId };
        const handler = this.game.sdk._messageHandlers.get('submitAnswer');
        if (handler) {
          handler(botObj, { answer: set[botId] });
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
