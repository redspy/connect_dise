import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';

export class PiratePlunderGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'pp-overlay', qrContainerId: null });

    this._profiles = new Map(); // playerId -> { nickname, avatar }
    this.scores = {}; // playerId -> number
    this.lookoutHistory = []; // playerIds who have been lookouts
    this.currentRound = 1;
    this.currentLookout = null;
    this.currentPairs = []; // Array of [p1Id, p2Id]
    this.decisions = {}; // playerId -> 'split' | 'steal'
    this.lastPayouts = {}; // playerId -> number (payout of last round)

    this.timer = null;
    this.countdownTimer = null;

    this._wireMessages();
  }

  // ─── HostBaseGame Life cycle hooks ────────────────────────────────────────

  async onSetup({ sessionId }) {
    document.documentElement.dataset.sessionId = sessionId;
    if (this._lobbyEl) {
      this._lobbyEl.onStart = () => {
        if (this.playerCount >= 3) {
          this._startGame();
        } else {
          alert('해적의 전리품! 게임은 최소 3인 이상 플레이어가 접속해야 합니다.');
        }
      };
    }

    const btnRestart = document.getElementById('btn-restart');
    if (btnRestart) {
      btnRestart.onclick = () => {
        this.resetSession();
      };
    }

    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    this._updateLobby();
  }

  onPlayerLeave(playerId) {
    this._profiles.delete(playerId);
    this._updateLobby();

    // If game is in progress and player count drops below 3, reset to lobby
    if (this.phase !== 'lobby' && this.phase !== 'loading') {
      if (this.playerCount < 3) {
        alert('플레이어 수 부족으로 게임을 계속 진행할 수 없습니다. 로비로 돌아갑니다.');
        this.resetSession();
      }
    }
  }

  onReadyUpdate({ readyCount }) {
    this.updateLobbyReady(readyCount);
  }

  onAllReady() {
    this.updateLobbyReady(this.playerCount);
  }

  onPlayerRejoin(player) {
    const nickname = this._profiles.get(player.id)?.nickname ?? '익명';
    this.setPlayerName(player.id, nickname);

    if (this.phase !== 'lobby' && this.phase !== 'loading') {
      const partnerId = this._getPartnerId(player.id);
      const isLookout = (this.currentLookout === player.id);

      let payload = {
        phase: this.phase,
        round: this.currentRound,
        role: isLookout ? 'lookout' : 'pirate',
        gold: this.scores[player.id] || 0,
        partnerId: partnerId || null,
        partnerName: partnerId ? (this._profiles.get(partnerId)?.nickname || '익명') : null,
        partnerColor: partnerId ? (this.getPlayer(partnerId)?.color || '#888') : null,
      };

      if (this.phase === 'negotiation') {
        const hasSubmitted = !!this.decisions[player.id];
        payload = {
          ...payload,
          hasSubmitted,
          decision: hasSubmitted ? this.decisions[player.id] : null,
        };
      } else if (this.phase === 'reveal') {
        payload = {
          ...payload,
          ownDecision: this.decisions[player.id] || 'split',
          partnerDecision: partnerId ? (this.decisions[partnerId] || 'split') : null,
          payout: this.lastPayouts[player.id] || 0,
        };
      }

      this.sendToPlayer(player.id, 'rejoinState', payload);
    } else {
      this._updateLobby();
    }
  }

  onReset() {
    this.scores = {};
    this.lookoutHistory = [];
    this.currentRound = 1;
    this.currentLookout = null;
    this.currentPairs = [];
    this.decisions = {};
    this.lastPayouts = {};
    this._stopTimer();
    this._stopCountdown();

    this._updateLobby();
    this.updateLobbyReady(0);
    this.setPhase('lobby');
  }

  // ─── Socket Message Handlers ──────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('setProfile', (player, { nickname, avatar }) => {
      const name = nickname.trim() || '익명';
      this._profiles.set(player.id, { nickname: name, avatar: avatar || null });
      this.setPlayerName(player.id, name);
      this._updateLobby();
    });

    this.onMessage('submitDecision', (player, { decision }) => {
      if (this.phase !== 'negotiation') return;
      
      // Make sure the player is in a pair (Lookouts can't submit)
      const partnerId = this._getPartnerId(player.id);
      if (!partnerId) return;

      this.decisions[player.id] = decision;

      // Update submit status on Host UI
      this._updateSubmitUI();

      // Check if all paired players have submitted
      const pairedPlayerIds = this.currentPairs.flat();
      const allSubmitted = pairedPlayerIds.every(id => !!this.decisions[id]);

      if (allSubmitted) {
        this._stopTimer();
        this._resolveResult();
      }
    });
  }

  // ─── Game Flow Logic ──────────────────────────────────────────────────────

  _updateLobby() {
    this.renderLobbyPlayers(this._profiles);
  }

  _startGame() {
    // Initialize scores
    const playerIds = Array.from(this.players.keys());
    playerIds.forEach(id => {
      this.scores[id] = 0;
    });

    this.currentRound = 1;
    this.lookoutHistory = [];
    this._startRound(1);
  }

  _startRound(roundNum) {
    this.currentRound = roundNum;
    this.decisions = {};
    this.lastPayouts = {};
    this.setPhase('setup');

    // Partner pairing and Lookout assignment
    const playerIds = Array.from(this.players.keys());
    
    // Shuffle playerIds
    for (let i = playerIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
    }

    if (playerIds.length % 2 !== 0) {
      // Find a lookout: someone who hasn't been a lookout yet
      let candidate = playerIds.find(id => !this.lookoutHistory.includes(id));
      // If everyone has been a lookout, pick anyone
      if (!candidate) {
        this.lookoutHistory = [];
        candidate = playerIds[0];
      }
      this.currentLookout = candidate;
      this.lookoutHistory.push(candidate);

      // Remaining are paired
      const pairedIds = playerIds.filter(id => id !== candidate);
      this.currentPairs = [];
      for (let i = 0; i < pairedIds.length; i += 2) {
        this.currentPairs.push([pairedIds[i], pairedIds[i + 1]]);
      }
    } else {
      this.currentLookout = null;
      this.currentPairs = [];
      for (let i = 0; i < playerIds.length; i += 2) {
        this.currentPairs.push([playerIds[i], playerIds[i + 1]]);
      }
    }

    // Broadcast setup information to mobile clients
    this.currentPairs.forEach(([p1, p2]) => {
      const p1Info = this.getPlayer(p1);
      const p2Info = this.getPlayer(p2);
      const p1Name = this._profiles.get(p1)?.nickname || '익명';
      const p2Name = this._profiles.get(p2)?.nickname || '익명';

      this.sendToPlayer(p1, 'roundStart', {
        role: 'pirate',
        round: roundNum,
        partnerId: p2,
        partnerName: p2Name,
        partnerColor: p2Info?.color || '#888',
        gold: this.scores[p1],
      });

      this.sendToPlayer(p2, 'roundStart', {
        role: 'pirate',
        round: roundNum,
        partnerId: p1,
        partnerName: p1Name,
        partnerColor: p1Info?.color || '#888',
        gold: this.scores[p2],
      });
    });

    if (this.currentLookout) {
      this.sendToPlayer(this.currentLookout, 'roundStart', {
        role: 'lookout',
        round: roundNum,
        partnerId: null,
        partnerName: null,
        partnerColor: null,
        gold: this.scores[this.currentLookout],
      });
    }

    // Render pairs on Host Screen
    this._renderSetupPairs();

    // Start 5-second countdown
    let countdown = 5;
    const countdownEl = document.getElementById('setup-countdown');
    if (countdownEl) countdownEl.textContent = countdown;

    this._stopCountdown();
    this.countdownTimer = setInterval(() => {
      countdown--;
      if (countdownEl) countdownEl.textContent = countdown;

      if (countdown <= 0) {
        this._stopCountdown();
        this._startNegotiation();
      }
    }, 1000);
  }

  _startNegotiation() {
    this.setPhase('negotiation');

    // Notify all players that negotiation has started
    this.broadcast('phaseChange', {
      phase: 'negotiation',
      round: this.currentRound,
    });

    // Update current round text
    const roundText = document.getElementById('current-round-text');
    if (roundText) roundText.textContent = this.currentRound;

    // Render pairs container for status tracking
    this._renderNegotiationPairs();
    this._updateSubmitUI();

    // Start 30 seconds negotiation timer
    let timeRemaining = 30;
    const timerText = document.getElementById('neg-timer-text');
    const timerBar = document.getElementById('neg-timer-bar');
    if (timerBar) timerBar.style.width = '100%';
    if (timerText) timerText.textContent = `남은 시간: ${timeRemaining}초`;

    this._stopTimer();
    this.timer = setInterval(() => {
      timeRemaining--;
      if (timerText) timerText.textContent = `남은 시간: ${timeRemaining}초`;
      if (timerBar) {
        const pct = (timeRemaining / 30) * 100;
        timerBar.style.width = `${pct}%`;
      }

      if (timeRemaining <= 0) {
        this._stopTimer();
        // AFK Fallback: auto 'split' for players who haven't submitted
        const pairedPlayerIds = this.currentPairs.flat();
        pairedPlayerIds.forEach(id => {
          if (!this.decisions[id]) {
            this.decisions[id] = 'split';
          }
        });
        this._resolveResult();
      }
    }, 1000);
  }

  _resolveResult() {
    this.setPhase('reveal');

    // Calculate payouts
    this.lastPayouts = {};

    // Lookout gets flat 20 gold
    if (this.currentLookout) {
      this.lastPayouts[this.currentLookout] = 20;
      this.scores[this.currentLookout] += 20;
    }

    // Calculate for pairs
    this.currentPairs.forEach(([p1, p2]) => {
      const d1 = this.decisions[p1] || 'split';
      const d2 = this.decisions[p2] || 'split';

      if (d1 === 'split' && d2 === 'split') {
        this.lastPayouts[p1] = 50;
        this.lastPayouts[p2] = 50;
      } else if (d1 === 'split' && d2 === 'steal') {
        this.lastPayouts[p1] = 0;
        this.lastPayouts[p2] = 100;
      } else if (d1 === 'steal' && d2 === 'split') {
        this.lastPayouts[p1] = 100;
        this.lastPayouts[p2] = 0;
      } else if (d1 === 'steal' && d2 === 'steal') {
        this.lastPayouts[p1] = 0;
        this.lastPayouts[p2] = 0;
      }

      this.scores[p1] += this.lastPayouts[p1];
      this.scores[p2] += this.lastPayouts[p2];
    });

    // Render results on Host screen
    this._renderRevealPairs();

    // Broadcast results to each player
    this.currentPairs.forEach(([p1, p2]) => {
      const d1 = this.decisions[p1] || 'split';
      const d2 = this.decisions[p2] || 'split';

      this.sendToPlayer(p1, 'revealResult', {
        ownDecision: d1,
        partnerDecision: d2,
        payout: this.lastPayouts[p1],
        partnerPayout: this.lastPayouts[p2],
        gold: this.scores[p1],
      });

      this.sendToPlayer(p2, 'revealResult', {
        ownDecision: d2,
        partnerDecision: d1,
        payout: this.lastPayouts[p2],
        partnerPayout: this.lastPayouts[p1],
        gold: this.scores[p2],
      });
    });

    if (this.currentLookout) {
      this.sendToPlayer(this.currentLookout, 'revealResult', {
        ownDecision: null,
        partnerDecision: null,
        payout: 20,
        partnerPayout: null,
        gold: this.scores[this.currentLookout],
      });
    }

    // Wait 9 seconds, then go to next round or end game
    this._stopTimer();
    this.timer = setTimeout(() => {
      if (this.currentRound < 5) {
        this._startRound(this.currentRound + 1);
      } else {
        this._endGame();
      }
    }, 9000);
  }

  _endGame() {
    this.setPhase('result');

    const sortedPlayers = Array.from(this.players.values())
      .map(p => ({
        id: p.id,
        nickname: this._profiles.get(p.id)?.nickname || '익명',
        color: p.color,
        score: this.scores[p.id] || 0,
      }))
      .sort((a, b) => b.score - a.score);

    // Render final leaderboard on Host UI
    this._renderFinalLeaderboard(sortedPlayers);

    // Notify all players of final results
    this.broadcast('phaseChange', {
      phase: 'result',
      leaderboard: sortedPlayers,
    });
  }

  // ─── Rendering Helpers ────────────────────────────────────────────────────

  _renderSetupPairs() {
    const container = document.getElementById('pp-setup-pairs');
    if (!container) return;
    container.innerHTML = '';

    // Render Lookout card first if any
    if (this.currentLookout) {
      const p = this.getPlayer(this.currentLookout);
      const name = this._profiles.get(this.currentLookout)?.nickname || '익명';
      const card = document.createElement('div');
      card.className = 'pp-lookout-card';
      card.innerHTML = `
        <div class="pp-lookout-title">👁️ 오늘의 Lookout (망보기)</div>
        <div class="pp-player-color" style="background: ${p?.color || '#888'};"></div>
        <div class="pp-player-name" style="margin-top: 8px;">${name}</div>
        <div class="pp-lookout-desc" style="margin-top: 10px;">
          안전하게 망을 보며 상황을 감시합니다.<br>기본 수수료 <strong>20 금화</strong> 획득!
        </div>
      `;
      container.appendChild(card);
    }

    // Render pairs
    this.currentPairs.forEach(([p1, p2]) => {
      const p1Info = this.getPlayer(p1);
      const p2Info = this.getPlayer(p2);
      const name1 = this._profiles.get(p1)?.nickname || '익명';
      const name2 = this._profiles.get(p2)?.nickname || '익명';

      const card = document.createElement('div');
      card.className = 'pp-pair-card';
      card.innerHTML = `
        <div class="pp-player-badges">
          <div class="pp-player-badge">
            <div class="pp-player-color" style="background: ${p1Info?.color || '#888'};"></div>
            <div class="pp-player-name">${name1}</div>
          </div>
          <div class="pp-vs-divider">VS</div>
          <div class="pp-player-badge">
            <div class="pp-player-color" style="background: ${p2Info?.color || '#888'};"></div>
            <div class="pp-player-name">${name2}</div>
          </div>
        </div>
        <div class="pp-plunder-amount">💰 전리품 상자: 100 금화</div>
      `;
      container.appendChild(card);
    });
  }

  _renderNegotiationPairs() {
    const container = document.getElementById('negotiation-pairs-container');
    if (!container) return;
    container.innerHTML = '';

    // Render Lookout
    if (this.currentLookout) {
      const p = this.getPlayer(this.currentLookout);
      const name = this._profiles.get(this.currentLookout)?.nickname || '익명';
      const card = document.createElement('div');
      card.className = 'pp-lookout-card';
      card.innerHTML = `
        <div class="pp-lookout-title">👁️ Lookout (망보기)</div>
        <div class="pp-player-color" style="background: ${p?.color || '#888'};"></div>
        <div class="pp-player-name" style="margin-top: 8px;">${name}</div>
        <div class="pp-lookout-desc" style="margin-top: 10px;">
          약탈 파트너들을 살피는 중... (20 금화 확보)
        </div>
      `;
      container.appendChild(card);
    }

    // Render pairs
    this.currentPairs.forEach(([p1, p2]) => {
      const p1Info = this.getPlayer(p1);
      const p2Info = this.getPlayer(p2);
      const name1 = this._profiles.get(p1)?.nickname || '익명';
      const name2 = this._profiles.get(p2)?.nickname || '익명';

      const card = document.createElement('div');
      card.className = 'pp-pair-card';
      card.id = `neg-card-${p1}-${p2}`;
      card.innerHTML = `
        <div class="pp-player-badges">
          <div class="pp-player-badge">
            <div class="pp-player-color" style="background: ${p1Info?.color || '#888'};"></div>
            <div class="pp-player-name">${name1}</div>
          </div>
          <div class="pp-vs-divider">VS</div>
          <div class="pp-player-badge">
            <div class="pp-player-color" style="background: ${p2Info?.color || '#888'};"></div>
            <div class="pp-player-name">${name2}</div>
          </div>
        </div>
        <div class="pp-status-indicators">
          <div class="pp-indicator" id="ind-${p1}">선택 중...</div>
          <div class="pp-indicator" id="ind-${p2}">선택 중...</div>
        </div>
      `;
      container.appendChild(card);
    });
  }

  _updateSubmitUI() {
    // Update individual indicators
    this.currentPairs.forEach(([p1, p2]) => {
      const ind1 = document.getElementById(`ind-${p1}`);
      const ind2 = document.getElementById(`ind-${p2}`);
      const card = document.getElementById(`neg-card-${p1}-${p2}`);

      if (ind1 && this.decisions[p1]) {
        ind1.textContent = '준비 완료!';
        ind1.classList.add('submitted');
      }
      if (ind2 && this.decisions[p2]) {
        ind2.textContent = '준비 완료!';
        ind2.classList.add('submitted');
      }

      if (card && this.decisions[p1] && this.decisions[p2]) {
        card.classList.add('ready');
      }
    });

    // Update status text count
    const statusText = document.getElementById('submit-status-text');
    if (statusText) {
      const pairedPlayerIds = this.currentPairs.flat();
      const submittedCount = pairedPlayerIds.filter(id => !!this.decisions[id]).length;
      statusText.textContent = `결정 제출 현황: ${submittedCount} / ${pairedPlayerIds.length}명`;
    }
  }

  _renderRevealPairs() {
    const container = document.getElementById('reveal-pairs-container');
    if (!container) return;
    container.innerHTML = '';

    // Render Lookout
    if (this.currentLookout) {
      const p = this.getPlayer(this.currentLookout);
      const name = this._profiles.get(this.currentLookout)?.nickname || '익명';
      const card = document.createElement('div');
      card.className = 'pp-reveal-card split-split'; // Green felt
      card.innerHTML = `
        <div style="font-weight: bold; color: var(--pp-gold); font-size: 1.1rem;">망보기 정산</div>
        <div class="pp-player-color" style="background: ${p?.color || '#888'}; margin-top: 10px;"></div>
        <div class="pp-player-name" style="margin-top: 6px;">${name}</div>
        <div style="font-size: 1.5rem; font-weight: 800; color: var(--pp-gold); margin: 15px 0;">+20 💰</div>
        <div class="pp-result-label">안전한 감시자 👁️</div>
      `;
      container.appendChild(card);
    }

    // Render pairs
    this.currentPairs.forEach(([p1, p2]) => {
      const p1Info = this.getPlayer(p1);
      const p2Info = this.getPlayer(p2);
      const name1 = this._profiles.get(p1)?.nickname || '익명';
      const name2 = this._profiles.get(p2)?.nickname || '익명';

      const d1 = this.decisions[p1] || 'split';
      const d2 = this.decisions[p2] || 'split';
      const pay1 = this.lastPayouts[p1];
      const pay2 = this.lastPayouts[p2];

      let cardClass = '';
      let resultText = '';
      let chestEmoji = '📦';

      if (d1 === 'split' && d2 === 'split') {
        cardClass = 'split-split';
        resultText = '공동 분배 🤝';
        chestEmoji = '🔓💰';
      } else if (d1 === 'steal' && d2 === 'steal') {
        cardClass = 'steal-steal';
        resultText = '욕심의 최후 💥';
        chestEmoji = '💣💥';
      } else {
        cardClass = 'steal-split';
        resultText = '배신과 독차지 🏴‍☠️';
        chestEmoji = '🔓💰';
      }

      const card = document.createElement('div');
      card.className = `pp-reveal-card ${cardClass}`;
      card.innerHTML = `
        <div class="pp-player-badges">
          <div class="pp-player-badge">
            <div class="pp-player-color" style="background: ${p1Info?.color || '#888'};"></div>
            <div class="pp-player-name">${name1}</div>
            <div class="pp-choice-indicator ${d1}">${d1 === 'split' ? '나누기 🤝' : '훔치기 🏴‍☠️'}</div>
            <div style="font-size: 1.25rem; font-weight: 800; color: var(--pp-gold); margin-top: 5px;">+${pay1}💰</div>
          </div>
          
          <div class="pp-chest-area">
            <div class="pp-chest-graphic">${d1 === 'steal' && d2 === 'steal' ? '💥' : '🪙'}</div>
            <div style="font-size: 2.2rem; margin-top:-5px;">${d1 === 'steal' && d2 === 'steal' ? '💔' : '🔑'}</div>
          </div>

          <div class="pp-player-badge">
            <div class="pp-player-color" style="background: ${p2Info?.color || '#888'};"></div>
            <div class="pp-player-name">${name2}</div>
            <div class="pp-choice-indicator ${d2}">${d2 === 'split' ? '나누기 🤝' : '훔치기 🏴‍☠️'}</div>
            <div style="font-size: 1.25rem; font-weight: 800; color: var(--pp-gold); margin-top: 5px;">+${pay2}💰</div>
          </div>
        </div>
        <div class="pp-result-label">${resultText}</div>
      `;
      container.appendChild(card);
    });
  }

  _renderFinalLeaderboard(sortedPlayers) {
    const container = document.getElementById('final-leaderboard-container');
    if (!container) return;
    container.innerHTML = '';

    sortedPlayers.forEach((player, index) => {
      const row = document.createElement('div');
      row.className = `pp-rank-row ${index === 0 ? 'rank-1' : ''}`;
      row.innerHTML = `
        <div class="pp-rank-num">${index === 0 ? '👑' : index + 1}</div>
        <div class="pp-rank-color" style="background: ${player.color};"></div>
        <div class="pp-rank-name">${player.nickname}</div>
        <div class="pp-rank-score">${player.score} 금화</div>
      `;
      container.appendChild(row);
    });
  }

  // ─── Timers Management ───────────────────────────────────────────────────

  _stopTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  _stopCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  _getPartnerId(playerId) {
    const pair = this.currentPairs.find(p => p.includes(playerId));
    if (!pair) return null;
    return pair[0] === playerId ? pair[1] : pair[0];
  }
}
