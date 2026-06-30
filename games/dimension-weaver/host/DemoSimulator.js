export class DimensionWeaverDemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.timeouts = [];
  }

  startDemo() {
    this.isDemo = true;
    this.game._isDemo = true;

    const bots = [
      { id: 'bot_alpha', nickname: '🤖 알파(길 개척)', color: '#00f3ff' },
      { id: 'bot_beta', nickname: '🤖 베타(장애물)', color: '#ff007f' },
      { id: 'bot_gamma', nickname: '🤖 감마(게이트)', color: '#ffd700' }
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

  onTick() {
    if (!this.isDemo || !this.game._gameActive || this.game._isPausedForRejoin) return;

    const currentX = this.game._distance;

    // 가상 스캔 범위: 전방 5칸
    for (let i = 0; i < 5; i++) {
      const scanX = currentX + i;
      if (scanX >= this.game._map.length) break;

      const col = this.game._map[scanX];

      // 1. 차원 알파: 구멍 복구 조치
      for (let r = 0; r < 5; r++) {
        if (col.floor[r] === 0) {
          this._queueAction('buildPath', 'bot_alpha', { x: scanX, row: r }, 100 + Math.random() * 150);
        }
      }

      // 2. 차원 베타: 가시 무력화 스캔
      if (col.challenge === 'spike' && col.challengeActive) {
        this._queueAction('disableTrap', 'bot_beta', { x: scanX }, 150 + Math.random() * 150);
      }

      // 3. 차원 감마: 게이트 개방 스캔
      if (col.challenge === 'gate' && col.challengeActive) {
        this._queueAction('unlockGate', 'bot_gamma', { color: col.gateColor }, 200 + Math.random() * 150);
      }
    }
  }

  _queueAction(msgType, botId, payload, delay) {
    const tid = setTimeout(() => {
      if (!this.game._gameActive || this.game._isPausedForRejoin) return;

      const botPlayer = this.game.getPlayer(botId);
      if (!botPlayer) return;

      const handler = this.game.sdk._messageHandlers.get(msgType);
      if (handler) {
        handler(botPlayer, payload);
      }
    }, delay);

    this.timeouts.push(tid);
  }

  clearTimeouts() {
    this.timeouts.forEach(tid => clearTimeout(tid));
    this.timeouts = [];
  }
}
