export class TriviaVegasDemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.timeouts = [];
    this.snapshot = null;

    // 가상 봇 전용 고정 답안 사전
    this.estimateSets = {
      '자이언트 판다가 하루에 먹는 대나무의 평균 무게는 몇 kg일까요?': { bot_alpha: 12, bot_beta: 18, bot_gamma: 25 },
      '에펠탑의 실제 정밀 높이는 몇 미터일까요? (안테나 포함)': { bot_alpha: 280, bot_beta: 320, bot_gamma: 350 },
      '라이트 형제가 최초의 동력 비행을 성공한 연도는 몇 년도일까요?': { bot_alpha: 1895, bot_beta: 1900, bot_gamma: 1910 },
      '달의 평균 표면 온도는 영하 몇 도(°C)일까요?': { bot_alpha: 100, bot_beta: 120, bot_gamma: 150 },
      '모나리자 그림의 세로 정밀 길이는 몇 cm일까요?': { bot_alpha: 60, bot_beta: 75, bot_gamma: 90 },
      '세계에서 가장 깊은 마리아나 해구의 깊이는 몇 미터일까요?': { bot_alpha: 8000, bot_beta: 10000, bot_gamma: 12000 },
      '세계 최초의 상업용 여객기 보잉 707이 첫 비행을 한 연도는?': { bot_alpha: 1950, bot_beta: 1955, bot_gamma: 1960 },
      '조선 왕조의 역대 왕은 총 몇 명일까요?': { bot_alpha: 25, bot_beta: 27, bot_gamma: 30 },
      '지구에서 태양까지의 평균 거리는 약 몇 만 km일까요?': { bot_alpha: 12000, bot_beta: 14000, bot_gamma: 16000 },
      '축구 경기장 규격의 국제 표준 터치라인 최소 길이는 몇 m일까요?': { bot_alpha: 90, bot_beta: 105, bot_gamma: 110 },
      '한국에서 가장 높은 산인 한라산의 높이는 몇 m일까요?': { bot_alpha: 1800, bot_beta: 1900, bot_gamma: 2000 },
      '태양계 행성 중 가장 크기가 큰 목성의 자전 주기는 약 몇 시간일까요?': { bot_alpha: 8, bot_beta: 9, bot_gamma: 12 }
    };
  }

  startDemo() {
    this.isDemo = true;
    this.game._isDemo = true;

    // 1. 현재 실제 접속한 플레이어 상태 스냅샷 저장
    this.snapshot = {
      players: new Map(this.game.players),
      sdkPlayers: new Map(this.game.sdk._players),
      playerNicknames: new Map(this.game._playerNicknames)
    };

    const bots = [
      { id: 'bot_alpha', nickname: '🤖 알파 조종사', color: '#00f3ff' },
      { id: 'bot_beta', nickname: '🤖 베타 조종사', color: '#ff3c3c' },
      { id: 'bot_gamma', nickname: '🤖 감마 조종사', color: '#39ff14' }
    ];

    // 2. 데모용 가상 플레이어 설정
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

    this.game.players.clear();
    this.game.sdk._players.clear();
    this.game._playerNicknames.clear();

    // 3. 스냅샷 복구
    if (this.snapshot) {
      this.snapshot.players.forEach((val, key) => this.game.players.set(key, val));
      this.snapshot.sdkPlayers.forEach((val, key) => this.game.sdk._players.set(key, val));
      this.snapshot.playerNicknames.forEach((val, key) => this.game._playerNicknames.set(key, val));
      this.snapshot = null;
    }
  }

  queueBotEstimates(question) {
    if (!this.isDemo) return;

    const bots = ['bot_alpha', 'bot_beta', 'bot_gamma'];
    const set = this.estimateSets[question] || { bot_alpha: 10, bot_beta: 50, bot_gamma: 100 };

    bots.forEach(botId => {
      const delay = 800 + Math.random() * 1200;
      const tid = setTimeout(() => {
        if (!this.game._gameActive || this.game._roundPhase !== 'estimates') return;
        
        // 캡슐화를 깨뜨리던 sdk._messageHandlers 호출 대신 game 레벨의 공개 메서드 호출
        this.game.submitEstimateForPlayer(botId, set[botId]);
      }, delay);

      this.timeouts.push(tid);
    });
  }

  queueBotBets() {
    if (!this.isDemo) return;

    const bots = ['bot_alpha', 'bot_beta', 'bot_gamma'];
    
    bots.forEach(botId => {
      const delay = 1500 + Math.random() * 2500;
      const tid = setTimeout(() => {
        if (!this.game._gameActive || this.game._roundPhase !== 'betting') return;

        const slotsCount = this.game._sortedSlots.length;
        if (slotsCount === 0) return;

        const randomIdx = Math.floor(Math.random() * slotsCount);
        
        // game 레벨의 공개 메서드 호출
        this.game.placeBetForPlayer(botId, randomIdx, 300);
      }, delay);

      this.timeouts.push(tid);
    });
  }

  clearTimeouts() {
    this.timeouts.forEach(tid => clearTimeout(tid));
    this.timeouts = [];
  }
}
