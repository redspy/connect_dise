export class RhythmJamDemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.timeouts = [];
    this.tappedNotes = new Set(); // 중복 타격 방지
  }

  startDemo() {
    if (this.isDemo) return;
    this.isDemo = true;
    this.game.enterDemoMode();
  }

  stopDemo() {
    if (!this.isDemo) return;
    this.isDemo = false;
    this.clearTimeouts();
    this.tappedNotes.clear();
    
    // 호스트의 데모 플래그가 여전히 켜져있다면 동기화하여 호출
    if (this.game._isDemo) {
      this.game.exitDemoMode();
    }
  }

  onStart() {
    this.tappedNotes.clear();
  }

  onTick(elapsedTime, notes) {
    if (!this.isDemo || !this.game._gameActive || this.game._isPausedForRejoin) return;

    // 데모 봇은 3개 레인 고정
    const bots = ['bot_bass', 'bot_snare', 'bot_hihat'];

    notes.forEach(note => {
      if (note.hit || note.missed || this.tappedNotes.has(note.id)) return;

      // 판정선 (x = 130) 부근에 진입 시 타격 예약
      if (note.x <= 165 && note.x >= 120) {
        this.tappedNotes.add(note.id);
        const botId = bots[note.lane];
        if (!botId) return;
        
        // 약간의 휴먼 지터를 가미해 리얼리티 제공 (0 ~ 40ms)
        const delay = Math.random() * 40;
        this._queueAction(botId, delay);
      }
    });
  }

  _queueAction(botId, delay) {
    const tid = setTimeout(() => {
      if (!this.game._gameActive || this.game._isPausedForRejoin) return;

      const botPlayer = this.game.getPlayer(botId);
      if (!botPlayer) return;

      // 호스트의 공식 시뮬레이션 탭 API 호출
      this.game.simulateTapNote(botId);
    }, delay);

    this.timeouts.push(tid);
  }

  clearTimeouts() {
    this.timeouts.forEach(tid => clearTimeout(tid));
    this.timeouts = [];
  }
}
