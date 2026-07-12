export class PanicCockpitDemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.timeouts = [];
    this.snapshot = null;
  }

  startDemo() {
    if (this.isDemo) return;
    this.isDemo = true;
    this.game._isDemo = true;
    this.game._demoSimulator = this;

    // 1. 실제 세션 상태 스냅샷 저장
    this.snapshot = {
      players: new Map(this.game.players),
      sdkPlayers: new Map(this.game.sdk._players),
      playerNicknames: new Map(this.game._playerNicknames)
    };

    // 2. 가상 봇 추가
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

    // 3. 대국 시작
    this.game._startGame();
  }

  stopDemo() {
    if (!this.isDemo) return;
    this.isDemo = false;
    this.game._isDemo = false;
    this.clearTimeouts();

    // 1. 게임 런타임 타이머 및 상태 강제 리셋 (main.js의 cleanupRuntime 호출 시 상호 재귀 호출 방지를 위해 직접 리셋)
    if (this.game._gameTimer) {
      clearInterval(this.game._gameTimer);
      this.game._gameTimer = null;
    }
    if (this.game._flightTimer) {
      clearInterval(this.game._flightTimer);
      this.game._flightTimer = null;
    }
    this.game._gameActive = false;
    this.game._commands = [];
    this.game._playerWidgets.clear();

    // 2. 스냅샷 복원
    this.game.players.clear();
    this.game.sdk._players.clear();
    this.game._playerNicknames.clear();

    if (this.snapshot) {
      for (const [k, v] of this.snapshot.players) this.game.players.set(k, v);
      for (const [k, v] of this.snapshot.sdkPlayers) this.game.sdk._players.set(k, v);
      for (const [k, v] of this.snapshot.playerNicknames) this.game._playerNicknames.set(k, v);
      this.snapshot = null;
    }

    // 3. 로비 화면 갱신
    this.game.renderLobbyPlayers(this.game._playerNicknames);
  }

  queueBotOperation(command) {
    if (!this.isDemo) return;

    // 1.2초 ~ 2.8초 사이의 지연 시간 설정 후 올바른 조작 수행
    // 의도적으로 선체 피해 연출을 위해 가끔 늦게 처리하는 봇 작전도 시뮬레이션
    // 약 15%의 확률로 의도적으로 만료 시간(12초)을 넘겨 13초 지연을 주어 선체 피해 연출
    const isLate = Math.random() < 0.15;
    const delay = isLate ? 13000 : (1200 + Math.random() * 1600);

    const tid = setTimeout(() => {
      if (!this.game._gameActive) return;

      // 우회하지 않고 실제 판정 경로를 그대로 강제
      this.game.handleControlAction(command.targetPlayerId, {
        key: command.widgetKey,
        value: command.targetValue
      });
    }, delay);

    this.timeouts.push(tid);
  }

  clearTimeouts() {
    this.timeouts.forEach(tid => clearTimeout(tid));
    this.timeouts = [];
  }
}
