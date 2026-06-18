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

  start() {
    this.stop(); // Clean previous run
    this._isDemoRunning = true;

    console.log('[Demo] Starting Pirate Plunder attract simulation...');

    // 1. Bots join lobby sequentially
    this._bots.forEach((bot, idx) => {
      const t = setTimeout(() => {
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

      this._timerQueue.push(t);
    });

    // 2. Set ready count
    const tReady = setTimeout(() => {
      if (!this._isDemoRunning) return;
      this.game.updateLobbyReady(3);
    }, 2000);
    this._timerQueue.push(tReady);

    // 3. Start demo game loop
    const tStart = setTimeout(() => {
      if (!this._isDemoRunning) return;
      this._simulateGameStart();
    }, 3500);
    this._timerQueue.push(tStart);
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

  _simulateGameStart() {
    console.log('[Demo] Simulating Game Start...');
    
    // Initialize scores
    this._bots.forEach(bot => {
      this.game.scores[bot.id] = 0;
    });

    this.game.currentRound = 1;
    this.game.lookoutHistory = [];
    this._simulateRoundStart(1);
  }

  _simulateRoundStart(roundNum) {
    if (!this._isDemoRunning) return;
    console.log(`[Demo] Simulating Round ${roundNum} Start...`);

    this.game.currentRound = roundNum;
    this.game.decisions = {};
    this.game.lastPayouts = {};
    this.game.setPhase('setup');

    // Mock role assignment: bot 1 is lookout in round 1, bot 2 in round 2
    if (roundNum === 1) {
      this.game.currentLookout = 'demo_bot_1';
      this.game.lookoutHistory.push('demo_bot_1');
      this.game.currentPairs = [['demo_bot_2', 'demo_bot_3']];
    } else {
      this.game.currentLookout = 'demo_bot_2';
      this.game.lookoutHistory.push('demo_bot_2');
      this.game.currentPairs = [['demo_bot_1', 'demo_bot_3']];
    }

    // Render pairs on Host Screen
    this.game._renderSetupPairs();

    // 5-second countdown accelerated (0.6s per tick)
    let countdown = 5;
    const countdownEl = document.getElementById('setup-countdown');
    if (countdownEl) countdownEl.textContent = countdown;

    const setupInterval = setInterval(() => {
      if (!this._isDemoRunning) {
        clearInterval(setupInterval);
        return;
      }

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

    // 30 seconds timer accelerated
    let timeRemaining = 15;
    const timerText = document.getElementById('neg-timer-text');
    const timerBar = document.getElementById('neg-timer-bar');
    if (timerBar) timerBar.style.width = '100%';
    if (timerText) timerText.textContent = `남은 시간: ${timeRemaining}초`;

    const timerInterval = setInterval(() => {
      if (!this._isDemoRunning) {
        clearInterval(timerInterval);
        return;
      }
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

    // Bots make decisions with delay
    const pair = this.game.currentPairs[0];
    const p1 = pair[0];
    const p2 = pair[1];

    // Player 1 decisions
    const tSubmit1 = setTimeout(() => {
      if (!this._isDemoRunning) return;
      // Round 1: p1 splits, p2 steals. Round 2: both split.
      this.game.decisions[p1] = 'split';
      this.game._updateSubmitUI();
      console.log(`[Demo] ${p1} submitted split`);
    }, 1500);
    this._timerQueue.push(tSubmit1);

    // Player 2 decisions
    const tSubmit2 = setTimeout(() => {
      if (!this._isDemoRunning) return;
      this.game.decisions[p2] = (this.game.currentRound === 1) ? 'steal' : 'split';
      this.game._updateSubmitUI();
      console.log(`[Demo] ${p2} submitted decision`);

      // Both submitted, proceed to result
      clearInterval(timerInterval);
      
      const tNext = setTimeout(() => {
        if (!this._isDemoRunning) return;
        this._simulateResolveResult();
      }, 1500);
      this._timerQueue.push(tNext);
    }, 3000);
    this._timerQueue.push(tSubmit2);
  }

  _simulateResolveResult() {
    if (!this._isDemoRunning) return;
    console.log(`[Demo] Simulating Resolve Result...`);
    this.game.setPhase('reveal');

    this.game.lastPayouts = {};

    // Lookout gets flat 20 gold
    if (this.game.currentLookout) {
      this.game.lastPayouts[this.game.currentLookout] = 20;
      this.game.scores[this.game.currentLookout] += 20;
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
    const tNext = setTimeout(() => {
      if (!this._isDemoRunning) return;

      if (this.game.currentRound < 2) {
        this._simulateRoundStart(this.game.currentRound + 1);
      } else {
        this._simulateEndGame();
      }
    }, 6000);
    this._timerQueue.push(tNext);
  }

  _simulateEndGame() {
    if (!this._isDemoRunning) return;
    console.log('[Demo] Simulating End Game (Leaderboard)...');
    this.game._endGame();
  }

  _clearAllTimers() {
    this._timerQueue.forEach(t => clearTimeout(t));
    this._timerQueue = [];
  }
}
