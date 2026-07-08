export class DemoSimulator {
  /**
   * @param {import('./PiratePlunderGame.js').PiratePlunderGame} gameInstance
   */
  constructor(gameInstance) {
    this.game = gameInstance;
    this._bots = [
      { id: 'demo_bot_1', nickname: '🤖 봇_Alice', color: '#06b6d4' },
      { id: 'demo_bot_2', nickname: '🤖 봇_Bob', color: '#a855f7' },
      { id: 'demo_bot_3', nickname: '🤖 봇_Charlie', color: '#10b981' }
    ];
    this._timerQueue = [];
    this._isDemoRunning = false;
  }

  registerTimeout(fn, ms) {
    const id = setTimeout(fn, ms);
    this._timerQueue.push({ type: 'timeout', id });
    return id;
  }

  registerInterval(fn, ms) {
    const id = setInterval(fn, ms);
    this._timerQueue.push({ type: 'interval', id });
    return id;
  }

  _clearAllTimers() {
    this._timerQueue.forEach(t => {
      if (t.type === 'timeout') {
        clearTimeout(t.id);
      } else if (t.type === 'interval') {
        clearInterval(t.id);
      }
    });
    this._timerQueue = [];
  }

  start() {
    this.stop(); // Clean previous run
    this._isDemoRunning = true;

    console.log('[Demo] Starting Pirate Plunder attract simulation...');
    this._updateScenarioText('🤖 봇들이 선술집에 입장하고 있습니다...');

    // 1. Bots join lobby sequentially
    this._bots.forEach((bot, idx) => {
      this.registerTimeout(() => {
        if (!this._isDemoRunning) return;

        // Directly inject into internal players map
        const playerObj = { id: bot.id, color: bot.color };
        this.game.players.set(bot.id, playerObj);
        
        // Bind profile
        this.game._profiles.set(bot.id, { nickname: bot.nickname, avatar: null });
        this.game.setPlayerName(bot.id, bot.nickname);

        // Update lobby
        this.game._updateLobby();
        console.log(`[Demo] ${bot.nickname} joined lobby.`);
      }, idx * 600);
    });

    // 2. Set ready count
    this.registerTimeout(() => {
      if (!this._isDemoRunning) return;
      this.game.updateLobbyReady(3);
    }, 2000);

    // 3. Start demo game loop
    this.registerTimeout(() => {
      if (!this._isDemoRunning) return;
      this._simulateGameStart();
    }, 3500);
  }

  stop() {
    this._isDemoRunning = false;
    this._clearAllTimers();

    // Remove bot information
    this._bots.forEach(bot => {
      this.game.players.delete(bot.id);
      this.game._profiles.delete(bot.id);
    });

    // Reset game
    this.game.onReset();
    console.log('[Demo] Local attract simulation stopped.');
  }

  _updateScenarioText(text) {
    const el = document.getElementById('demo-scenario-text');
    if (el) {
      el.textContent = text;
    }
  }

  _simulateGameStart() {
    console.log('[Demo] Simulating Game Start...');
    
    // Initialize scores
    this._bots.forEach(bot => {
      this.game.scores[bot.id] = 0;
    });

    this.game.currentRound = 1;
    this.game.lookoutHistory = [];
    this.game.maxRounds = 3; // 시뮬레이터는 3라운드 강제 시연

    const maxRoundText = document.getElementById('max-round-text');
    if (maxRoundText) maxRoundText.textContent = 3;

    this._simulateRoundStart(1);
  }

  _simulateRoundStart(roundNum) {
    if (!this._isDemoRunning) return;
    console.log(`[Demo] Simulating Round ${roundNum} Start...`);

    this.game.currentRound = roundNum;
    this.game.decisions = {};
    this.game.lastPayouts = {};
    this.game.predictions = {};
    this.game.setPhase('setup');

    // 봇 역할 분배 시나리오
    if (roundNum === 1) {
      this._updateScenarioText('라운드 1: 의리와 신뢰 (공동 분배 및 예측 성공)');
      this.game.currentLookout = 'demo_bot_1';
      this.game.lookoutHistory.push('demo_bot_1');
      this.game.currentPairs = [['demo_bot_2', 'demo_bot_3']];
    } else if (roundNum === 2) {
      this._updateScenarioText('라운드 2: 탐욕과 배신 (배신 성공 및 예측 성공)');
      this.game.currentLookout = 'demo_bot_2';
      this.game.lookoutHistory.push('demo_bot_2');
      this.game.currentPairs = [['demo_bot_1', 'demo_bot_3']];
    } else {
      this._updateScenarioText('라운드 3: 상호 파멸 (상자 파괴 및 예측 실패)');
      this.game.currentLookout = 'demo_bot_3';
      this.game.lookoutHistory.push('demo_bot_3');
      this.game.currentPairs = [['demo_bot_1', 'demo_bot_2']];
    }

    // Render pairs on Host Screen
    this.game._renderSetupPairs();

    // 5-second countdown accelerated (0.6s per tick)
    let countdown = 5;
    const countdownEl = document.getElementById('setup-countdown');
    if (countdownEl) countdownEl.textContent = countdown;

    const setupInterval = this.registerInterval(() => {
      countdown--;
      if (countdownEl) countdownEl.textContent = countdown;

      if (countdown <= 0) {
        clearInterval(setupInterval);
        this._simulateNegotiation();
      }
    }, 600);
  }

  _simulateNegotiation() {
    if (!this._isDemoRunning) return;
    console.log(`[Demo] Simulating Negotiation...`);
    this.game.setPhase('negotiation');

    const roundText = document.getElementById('current-round-text');
    if (roundText) roundText.textContent = this.game.currentRound;

    this.game._renderNegotiationPairs();
    this.game._updateSubmitUI();

    // 30 seconds timer accelerated (15 ticks, 0.4s each = 6 seconds total)
    let timeRemaining = 15;
    const timerText = document.getElementById('neg-timer-text');
    const timerBar = document.getElementById('neg-timer-bar');
    if (timerBar) timerBar.style.width = '100%';
    if (timerText) timerText.textContent = `남은 시간: ${timeRemaining}초`;

    const timerInterval = this.registerInterval(() => {
      timeRemaining--;
      if (timerText) timerText.textContent = `남은 시간: ${timeRemaining}초`;
      if (timerBar) {
        const pct = (timeRemaining / 15) * 100;
        timerBar.style.width = `${pct}%`;
      }
      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
      }
    }, 400);

    // Lookout 예측 설정
    if (this.game.currentLookout) {
      const pred = (this.game.currentRound === 2) ? 'betray' : 'trust';
      this.game.predictions[this.game.currentLookout] = pred;
    }

    // Bots make decisions with delay
    const pair = this.game.currentPairs[0];
    const p1 = pair[0];
    const p2 = pair[1];

    // Player 1 decisions
    this.registerTimeout(() => {
      if (!this._isDemoRunning) return;
      if (this.game.currentRound === 1) {
        this.game.decisions[p1] = 'split';
      } else {
        this.game.decisions[p1] = 'steal';
      }
      this.game._updateSubmitUI();
      console.log(`[Demo] ${p1} submitted decision`);
    }, 1500);

    // Player 2 decisions
    this.registerTimeout(() => {
      if (!this._isDemoRunning) return;
      if (this.game.currentRound === 3) {
        this.game.decisions[p2] = 'steal';
      } else {
        this.game.decisions[p2] = 'split';
      }
      this.game._updateSubmitUI();
      console.log(`[Demo] ${p2} submitted decision`);

      // Both submitted, proceed to result
      clearInterval(timerInterval);
      
      this.registerTimeout(() => {
        if (!this._isDemoRunning) return;
        this._simulateResolveResult();
      }, 1500);
    }, 3000);
  }

  _simulateResolveResult() {
    if (!this._isDemoRunning) return;
    console.log(`[Demo] Simulating Resolve Result...`);
    this.game.setPhase('reveal');

    this.game.lastPayouts = {};

    // 짝들의 실제 결정 중 'steal'이 있었는지 확인
    let hasSteal = false;
    this.game.currentPairs.forEach(([p1, p2]) => {
      const d1 = this.game.decisions[p1] || 'split';
      const d2 = this.game.decisions[p2] || 'split';
      if (d1 === 'steal' || d2 === 'steal') {
        hasSteal = true;
      }
    });

    // Lookout gets flat 20 gold + prediction bonus
    let lookoutCorrect = false;
    let lookoutPayout = 20;
    if (this.game.currentLookout) {
      const prediction = this.game.predictions[this.game.currentLookout];
      lookoutCorrect = (prediction === 'betray' && hasSteal) || (prediction === 'trust' && !hasSteal);
      if (prediction) {
        lookoutPayout = lookoutCorrect ? 30 : 20;
      }
      this.game.lastPayouts[this.game.currentLookout] = lookoutPayout;
      this.game.scores[this.game.currentLookout] += lookoutPayout;
    }

    // Pairs payout
    const pair = this.game.currentPairs[0];
    const p1 = pair[0];
    const p2 = pair[1];
    const d1 = this.game.decisions[p1];
    const d2 = this.game.decisions[p2];

    if (d1 === 'split' && d2 === 'split') {
      this.game.lastPayouts[p1] = 50;
      this.game.lastPayouts[p2] = 50;
    } else if (d1 === 'split' && d2 === 'steal') {
      this.game.lastPayouts[p1] = 0;
      this.game.lastPayouts[p2] = 100;
    } else if (d1 === 'steal' && d2 === 'split') {
      this.game.lastPayouts[p1] = 100;
      this.game.lastPayouts[p2] = 0;
    } else if (d1 === 'steal' && d2 === 'steal') {
      this.game.lastPayouts[p1] = 0;
      this.game.lastPayouts[p2] = 0;
    }

    this.game.scores[p1] += this.game.lastPayouts[p1];
    this.game.scores[p2] += this.game.lastPayouts[p2];

    this.game._renderRevealPairs();

    // Show results for 6 seconds, then transition
    this.registerTimeout(() => {
      if (!this._isDemoRunning) return;

      if (this.game.currentRound < 3) {
        this._simulateRoundStart(this.game.currentRound + 1);
      } else {
        this._simulateEndGame();
      }
    }, 6000); // 앗! 6000ms여야 하는데 600ms로 적으면 너무 빠르다. 6000ms로 하자.
  }

  _simulateEndGame() {
    if (!this._isDemoRunning) return;
    this._updateScenarioText('데모 종료! 최종 순위를 선포합니다.');
    console.log('[Demo] Simulating End Game (Leaderboard)...');
    this.game._endGame();
  }
}
