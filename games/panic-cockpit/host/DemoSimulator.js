export class PanicCockpitDemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.timeouts = [];
  }

  startDemo() {
    this.isDemo = true;
    this.game._isDemo = true;
    this.game._demoSimulator = this;

    // 1. 가상 봇 추가
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

    // 2. 대국 시작
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

  queueBotOperation(command) {
    if (!this.isDemo) return;

    // 1.2초 ~ 2.8초 사이의 지연 시간 설정 후 올바른 조작 수행
    const delay = 1200 + Math.random() * 1600;
    const tid = setTimeout(() => {
      if (!this.game._gameActive) return;

      // 해당 명령어의 타겟 값 발송
      const handler = this.game.sdk._messageHandlers.get('controlAction');
      if (handler) {
        handler(command.targetPlayerId, {
          key: command.widgetKey,
          value: command.targetValue
        });
      }
    }, delay);

    this.timeouts.push(tid);
  }

  clearTimeouts() {
    this.timeouts.forEach(tid => clearTimeout(tid));
    this.timeouts = [];
  }
}
