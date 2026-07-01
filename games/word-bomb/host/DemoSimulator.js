export class DemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.timeouts = [];
  }

  startDemo() {
    this.isDemo = true;
    this.game._isDemo = true;

    const bots = [
      { id: 'bot_1', nickname: '🤖 수다쟁이 알파', color: '#ff3333' },
      { id: 'bot_2', nickname: '🤖 설명 요정 베타', color: '#ffcc00' },
      { id: 'bot_3', nickname: '🤖 유추 대장 감마', color: '#00f3ff' }
    ];

    this.game.players.clear();
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
  }

  onStart() {
    this.clearTimeouts();
    this.onTurnChange();
  }

  onTurnChange() {
    this.clearTimeouts();
    if (!this.isDemo || !this.game._gameActive || this.game._isExploded) return;

    const activeId = this.game._playersList[this.game._activePlayerIndex];
    if (activeId && activeId.startsWith('bot_')) {
      // 봇이 단어를 묘사하고 맞히는 시간을 시뮬레이션 (1.5초 ~ 2.5초)
      const delay = Math.random() * 1000 + 1500;
      this._queueAction('submitCorrect', activeId, {}, delay);
    }
  }

  _queueAction(msgType, botId, payload, delay) {
    const tid = setTimeout(() => {
      if (!this.game._gameActive || this.game._isExploded) return;

      const handler = this.game.sdk._messageHandlers.get(msgType);
      if (handler) {
        // SDK 메타 메시지 핸들러 직접 격발 (player, payload 순서 준수)
        handler({ id: botId }, payload);
      }
    }, delay);

    this.timeouts.push(tid);
  }

  clearTimeouts() {
    this.timeouts.forEach(tid => clearTimeout(tid));
    this.timeouts = [];
  }
}
