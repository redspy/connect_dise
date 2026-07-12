export class DemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.state = 'idle'; // idle -> seeding -> running -> result -> restoring
    this.timeouts = [];

    // 세션 백업용
    this._realPlayersBackup = new Map();
    this._realNicknamesBackup = new Map();
    this._realSdkPlayersBackup = new Map();
  }

  _updateDOMState(stateName) {
    this.state = stateName;
    const lobbyView = document.getElementById('lobby-view');
    if (lobbyView) {
      lobbyView.setAttribute('data-demo-state', stateName);
    }
    const banner = document.getElementById('demo-indicator-banner');
    if (banner) {
      banner.classList.toggle('hidden', stateName === 'idle');
    }
  }

  startDemo() {
    if (this.isDemo) return;
    this.isDemo = true;
    this.game._isDemo = true;

    // 1. 실제 세션 데이터 안전하게 백업
    this._realPlayersBackup.clear();
    this._realNicknamesBackup.clear();
    this._realSdkPlayersBackup.clear();

    this.game.players.forEach((v, k) => this._realPlayersBackup.set(k, { ...v }));
    this.game._playerNicknames.forEach((v, k) => this._realNicknamesBackup.set(k, v));
    this.game.sdk._players.forEach((v, k) => this._realSdkPlayersBackup.set(k, { ...v }));

    // 실세션 지우기
    this.game.players.clear();
    this.game._playerNicknames.clear();
    this.game.sdk._players.clear();

    this._updateDOMState('seeding');

    const bots = [
      { id: 'bot_1', nickname: '🤖 수다쟁이 알파', color: '#ff3333' },
      { id: 'bot_2', nickname: '🤖 설명 요정 베타', color: '#ffcc00' },
      { id: 'bot_3', nickname: '🤖 유추 대장 감마', color: '#00f3ff' }
    ];

    // 연출용 시나리오: 봇이 0.4초 간격으로 하나씩 입장하고 준비하는 모션
    bots.forEach((b, idx) => {
      const entryTid = setTimeout(() => {
        if (!this.isDemo) return;

        this.game._playerNicknames.set(b.id, b.nickname);
        this.game.players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
        this.game.sdk._players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
        this.game._renderLobbyGrid();

        // 입장 후 0.2초 뒤 준비 완료
        const readyTid = setTimeout(() => {
          if (!this.isDemo) return;
          this.game._readyPlayers.add(b.id);
          this.game._renderLobbyGrid();

          // 마지막 봇까지 들어오고 준비가 완료되면 0.8초 후 게임 기동
          if (idx === bots.length - 1) {
            const startTid = setTimeout(() => {
              if (!this.isDemo) return;
              this._updateDOMState('running');
              this.game._startGame();
            }, 800);
            this.timeouts.push(startTid);
          }
        }, 200);
        this.timeouts.push(readyTid);

      }, idx * 400);

      this.timeouts.push(entryTid);
    });
  }

  stopDemo() {
    this.isDemo = false;
    this.game._isDemo = false;
    this.clearTimeouts();

    // 준비 셋 정리
    this.game._readyPlayers.clear();

    // 2. 백업했던 실제 플레이어 정보 복구
    this.game.players.clear();
    this.game._playerNicknames.clear();
    this.game.sdk._players.clear();

    this._realPlayersBackup.forEach((v, k) => this.game.players.set(k, v));
    this._realNicknamesBackup.forEach((v, k) => this.game._playerNicknames.set(k, v));
    this._realSdkPlayersBackup.forEach((v, k) => this.game.sdk._players.set(k, v));

    this._updateDOMState('idle');
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
      // 봇들이 대답을 생각하고 외치는 딜레이 (1.2초 ~ 2.2초)
      const delay = Math.random() * 1000 + 1200;
      const turnTid = setTimeout(() => {
        if (!this.game._gameActive || this.game._isExploded) return;
        // 호스트의 공개 handleDemoSubmit API 호출 (우회 없음)
        this.game.handleDemoSubmit(activeId);
      }, delay);
      this.timeouts.push(turnTid);
    }
  }

  onExplode() {
    this.clearTimeouts();
    this._updateDOMState('result');

    // 폭발 결과를 3.5초간 노출한 후 자동으로 로비로 복귀하여 세션 리셋
    const resultTid = setTimeout(() => {
      if (this.isDemo) {
        this.stopDemo();
        this.game.resetSession();
      }
    }, 3500);
    this.timeouts.push(resultTid);
  }

  clearTimeouts() {
    this.timeouts.forEach(tid => clearTimeout(tid));
    this.timeouts = [];
  }
}
