export class TriviaVegasDemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.timeouts = [];

    // 가상 봇 전용 고정 답안 사전
    this.estimateSets = {
      '자이언트 판다가 하루에 먹는 대나무의 평균 무게는 몇 kg일까요?': { bot_alpha: 12, bot_beta: 18, bot_gamma: 25 },
      '에펠탑의 실제 정밀 높이는 몇 미터일까요? (안테나 포함)': { bot_alpha: 280, bot_beta: 320, bot_gamma: 350 },
      '라이트 형제가 최초의 동력 비행을 성공한 연도는 몇 년도일까요?': { bot_alpha: 1895, bot_beta: 1900, bot_gamma: 1910 },
      '달의 평균 표면 온도는 영하 몇 도(°C)일까요?': { bot_alpha: 100, bot_beta: 120, bot_gamma: 150 },
      '모나리자 그림의 세로 정밀 길이는 몇 cm일까요?': { bot_alpha: 60, bot_beta: 75, bot_gamma: 90 },
      '세계에서 가장 깊은 마리아나 해구의 깊이는 몇 미터일까요?': { bot_alpha: 8000, bot_beta: 10000, bot_gamma: 12000 },
      '세계 최초의 상업용 여객기 보잉 707이 첫 비행을 한 연도는?': { bot_alpha: 1950, bot_beta: 1955, bot_gamma: 1960 }
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

  queueBotEstimates(question) {
    if (!this.isDemo) return;

    const bots = ['bot_alpha', 'bot_beta', 'bot_gamma'];
    const set = this.estimateSets[question] || { bot_alpha: 10, bot_beta: 50, bot_gamma: 100 };

    bots.forEach(botId => {
      const delay = 800 + Math.random() * 1200;
      const tid = setTimeout(() => {
        if (!this.game._gameActive || this.game._roundPhase !== 'estimates') return;

        const botObj = this.game.getPlayer(botId) || { id: botId };
        const handler = this.game.sdk._messageHandlers.get('submitEstimate');
        if (handler) {
          handler(botObj, { value: set[botId] });
        }
      }, delay);

      this.timeouts.push(tid);
    });
  }

  queueBotBets() {
    if (!this.isDemo) return;

    const bots = ['bot_alpha', 'bot_beta', 'bot_gamma'];
    
    bots.forEach(botId => {
      // 1.5초 ~ 4초 사이에 각각 베팅 칩 투척
      const delay = 1500 + Math.random() * 2500;
      const tid = setTimeout(() => {
        if (!this.game._gameActive || this.game._roundPhase !== 'betting') return;

        const botObj = this.game.getPlayer(botId) || { id: botId };
        const slotsCount = this.game._sortedSlots.length;
        if (slotsCount === 0) return;

        // 랜덤 베팅 슬롯 인덱스 및 고정 베팅금 $300 설정
        const randomIdx = Math.floor(Math.random() * slotsCount);
        const handler = this.game.sdk._messageHandlers.get('placeBet');
        if (handler) {
          handler(botObj, { slotIndex: randomIdx, amount: 300 });
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
