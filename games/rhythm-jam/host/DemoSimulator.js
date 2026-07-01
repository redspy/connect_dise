export class RhythmJamDemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.timeouts = [];
    this.tappedNotes = new Set(); // 중복 타격 방지
  }

  startDemo() {
    this.isDemo = true;
    this.game._isDemo = true;

    const bots = [
      { id: 'bot_bass', nickname: '🤖 리듬 천재 (Bass)', color: '#ff007f' },
      { id: 'bot_snare', nickname: '🤖 비트 매니아 (Snare)', color: '#ffd700' },
      { id: 'bot_hihat', nickname: '🤖 드럼 마스터 (Hi-hat)', color: '#00f3ff' }
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
    this.tappedNotes.clear();
  }

  onStart() {
    this.tappedNotes.clear();
  }

  onTick(elapsedTime, notes) {
    if (!this.isDemo || !this.game._gameActive || this.game._isPausedForRejoin) return;

    const bots = ['bot_bass', 'bot_snare', 'bot_hihat'];

    notes.forEach(note => {
      if (note.hit || note.missed || this.tappedNotes.has(note.id)) return;

      // 판정선 (x = 130) 부근에 진입 시 타격 예약
      if (note.x <= 165 && note.x >= 120) {
        this.tappedNotes.add(note.id);
        const botId = bots[note.lane];
        
        // 약간의 휴먼 지터를 가미해 리얼리티 제공 (0 ~ 40ms)
        const delay = Math.random() * 40;
        this._queueAction('tapNote', botId, {}, delay);
      }
    });
  }

  _queueAction(msgType, botId, payload, delay) {
    const tid = setTimeout(() => {
      if (!this.game._gameActive || this.game._isPausedForRejoin) return;

      const botPlayer = this.game.getPlayer(botId);
      if (!botPlayer) return;

      const handler = this.game.sdk._messageHandlers.get(msgType);
      if (handler) {
        // SDK 메타 메시지 핸들러 직접 격발
        handler(payload, botId);
      }
    }, delay);

    this.timeouts.push(tid);
  }

  clearTimeouts() {
    this.timeouts.forEach(tid => clearTimeout(tid));
    this.timeouts = [];
  }
}
