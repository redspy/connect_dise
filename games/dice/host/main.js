import { HostSDK } from '../../../platform/client/HostSDK.js';
import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { renderQR } from '../../../platform/client/shared/QRDisplay.js';
import { AppBar } from '../../../platform/client/shared/AppBar.js';
import DiceBox from '@3d-dice/dice-box';
import { DemoSimulator } from './DemoSimulator.js';

class DiceGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'dice-overlay', qrContainerId: null });

    // Game stats
    this.round = 0;
    this.scores = new Map(); // playerId -> score
    this.throws = new Map(); // playerId -> { value, color }
    this.readyPlayers = new Set(); // Track player ready states explicitly
    this.currentTurnIdx = -1;
    this.turnOrder = [];
    this.isRolling = false;
    this.isDiceReady = false;

    // Initialization of components
    this.appbar = new AppBar('game-appbar', {
      title: '주사위 파티 🎲',
      onRestart: () => this.resetSession(),
    });

    this.initDiceBox();
    this.demoSimulator = new DemoSimulator(this);

    // Messages mapping
    this.onMessage('setNickname', (player, { nickname }) => {
      this.setPlayerName(player.id, nickname);
      this.updateLobbyUI();
    });

    this.onMessage('setReady', (player) => {
      this.readyPlayers.add(player.id);
      this.updateLobbyUI();
    });

    this.onMessage('throwDice', (player, { strength, color }) => {
      this.handleThrow(player.id, strength, color);
    });

    // Test button mapping
    const testBtn = document.getElementById('test-roll-btn');
    if (testBtn) {
      testBtn.addEventListener('click', () => {
        if (this.isDiceReady) {
          this.diceBox.roll('1d6').catch(console.error);
        }
      });
    }

    // Connect Demo Play button
    const demoBtn = document.getElementById('demoPlayBtn');
    if (demoBtn) {
      demoBtn.addEventListener('click', () => {
        if (!this.demoSimulator.isDemo) {
          this.demoSimulator.startDemo();
          demoBtn.textContent = '⏹️ 데모 중지';
        } else {
          this.demoSimulator.stopDemo();
          demoBtn.textContent = '🤖 데모 플레이 실행';
        }
      });
    }
  }

  initDiceBox() {
    this.diceBox = new DiceBox({
      container: '#dice-box',
      assetPath: '/assets/dice-box/',
      origin: window.location.origin,
      theme: 'default',
      themeColor: '#FFD700',
      offscreen: false,
      spinForce: 10,
      throwForce: 20,
      gravity: 1.5,
      linearDamping: 0.3,
      angularDamping: 0.2,
      restitution: 0.5,
      scale: 6,
    });

    this.diceBox.init()
      .then(() => {
        console.log('DiceBox 3D Engine ready');
        this.isDiceReady = true;
      })
      .catch((err) => {
        console.error('DiceBox init failed:', err);
      });
  }

  // ─── Lifecycle hooks ─────────────────────────────────────────────────────

  async onSetup({ qrUrl, sessionId }) {
    console.log('[Dice] Room setup complete. Session ID:', sessionId);
    
    // Set lobby session display
    const sessionInfo = document.getElementById('session-info');
    if (sessionInfo) {
      sessionInfo.innerHTML = `Session ID<br><strong>${sessionId}</strong>`;
    }

    // Render QR codes in 4 corners
    const qrContainers = [
      document.getElementById('qr-top-left'),
      document.getElementById('qr-top-right'),
      document.getElementById('qr-bottom-left'),
      document.getElementById('qr-bottom-right'),
    ];
    for (const container of qrContainers) {
      if (container) {
        container.innerHTML = '';
        await renderQR(container, qrUrl, { width: 120 });
        const text = document.createElement('p');
        text.textContent = 'Scan to Join';
        container.appendChild(text);
      }
    }

    this.resetGameData();
    this.setPhase('lobby');
    this._resetIdleTimer();
  }

  onPlayerJoin(player) {
    console.log(`[Dice] Player joined: ${player.id}`);
    
    // Set default name and initial score
    if (!this._playerNicknames.has(player.id)) {
      this.setPlayerName(player.id, `플레이어 ${this.players.size}`);
    }
    if (!this.scores.has(player.id)) {
      this.scores.set(player.id, 0);
    }

    this.updateLobbyUI();

    // If real player joined during demo, stop demo play immediately
    if (this.demoSimulator.isDemo) {
      console.log('[Dice] Real player joined. Stopping active demo.');
      this.demoSimulator.stopDemo();
    } else {
      // Broadcast state to sync joining/rejoining client
      this.broadcastState();
    }
  }

  onPlayerLeave(playerId) {
    console.log(`[Dice] Player left: ${playerId}`);
    this.scores.delete(playerId);
    this.updateLobbyUI();

    // Handle mid-game disconnect
    if (this.phase === 'waitingThrow') {
      const exitIdx = this.turnOrder.indexOf(playerId);
      if (exitIdx !== -1) {
        this.turnOrder.splice(exitIdx, 1);
        // If it was the disconnected player's turn, redirect to next player
        if (this.currentTurnIdx === exitIdx) {
          this.isRolling = false;
          this.nextTurn();
        } else if (this.currentTurnIdx > exitIdx) {
          this.currentTurnIdx--;
        }
      }
    }
  }

  onPlayerDisconnect(playerId) {
    console.log(`[Dice] Player disconnected temporarily: ${playerId}`);
  }

  onPlayerRejoin(player) {
    console.log(`[Dice] Player rejoined: ${player.id}`);
    // Sync current state immediately for reconnect recovery
    this.sendToPlayer(player.id, 'syncState', this.getGameStatePayload(player.id));
    this.updateLobbyUI();
  }

  onReadyUpdate({ readyCount, total }) {
    console.log(`[Dice] Ready status update: ${readyCount}/${total}`);
    const statusText = document.getElementById('player-status');
    if (statusText) {
      if (total > 0) {
        statusText.textContent = `${readyCount} / ${total} 플레이어 준비 완료!`;
        statusText.style.color = readyCount === total ? '#00C851' : '#F59E0B';
      } else {
        statusText.textContent = '플레이어를 기다리는 중...';
        statusText.style.color = '#F0F0F0';
      }
    }
  }

  onAllReady() {
    console.log('[Dice] All players ready! Starting game.');
    this.startGame();
  }

  onReset() {
    console.log('[Dice] Game reset');
    this.resetGameData();
    this.setPhase('lobby');
    this.updateLobbyUI();
    
    const demoBtn = document.getElementById('demoPlayBtn');
    if (demoBtn) demoBtn.textContent = '🤖 데모 플레이 실행';

    // Broadcast reset to all clients
    this.broadcast('gameState', { phase: 'lobby' });
  }

  // ─── Game flow ───────────────────────────────────────────────────────────

  resetGameData() {
    this.round = 0;
    this.scores.clear();
    this.throws.clear();
    this.readyPlayers.clear();
    this.turnOrder = [];
    this.currentTurnIdx = -1;
    this.isRolling = false;
  }

  updateLobbyUI() {
    const lobbyPlayers = document.getElementById('lobby-players');
    if (!lobbyPlayers) return;

    lobbyPlayers.innerHTML = '';
    this.players.forEach(p => {
      const name = this._playerNicknames.get(p.id) || `플레이어 ${p.id.substring(0, 4)}`;
      const readyState = this.readyPlayers.has(p.id);

      const card = document.createElement('div');
      card.className = `lobby-player-card ${readyState ? 'ready' : ''}`;
      card.innerHTML = `
        <div class="p-name" style="border-bottom: 2px solid ${p.color}; padding-bottom: 4px;">${name}</div>
        <div class="p-status">${readyState ? '준비완료' : '대기중'}</div>
      `;
      lobbyPlayers.appendChild(card);
    });

    const statusText = document.getElementById('player-status');
    if (statusText && this.players.size === 0) {
      statusText.textContent = '플레이어를 기다리는 중...';
      statusText.style.color = '#F0F0F0';
    }
  }

  startGame() {
    this.round = 1;
    this.scores.clear();
    this.players.forEach((p) => this.scores.set(p.id, 0));
    this.startRound();
  }

  startRound() {
    this.throws.clear();
    this.turnOrder = Array.from(this.players.keys());
    this.currentTurnIdx = 0;
    this.isRolling = false;

    // Show round intro
    const roundTitle = document.getElementById('round-intro-title');
    if (roundTitle) roundTitle.textContent = `ROUND ${this.round}`;
    
    this.setPhase('roundIntro');

    setTimeout(() => {
      if (this.phase === 'roundIntro') {
        this.setPhase('waitingThrow');
        this.nextTurn();
      }
    }, 2500);
  }

  nextTurn() {
    if (this.currentTurnIdx >= this.turnOrder.length) {
      this.endRound();
      return;
    }

    const activeId = this.turnOrder[this.currentTurnIdx];
    const player = this.getPlayer(activeId);
    if (!player) {
      // In case player disconnected or missing
      this.currentTurnIdx++;
      this.nextTurn();
      return;
    }

    const name = this._playerNicknames.get(activeId) || '플레이어';

    // Highlight turn card UI
    const turnCard = document.getElementById('current-turn-card');
    const nameText = document.getElementById('current-turn-player-name');
    const progressText = document.getElementById('turn-progress-text');

    if (nameText) nameText.textContent = name;
    if (turnCard) {
      turnCard.style.borderColor = player.color;
      turnCard.style.boxShadow = `0 0 20px ${player.color}40`;
    }
    if (progressText) {
      progressText.textContent = `순서: ${this.currentTurnIdx + 1} / ${this.turnOrder.length}`;
    }

    // Broadcast current turn state to all players
    this.broadcastState();
  }

  handleThrow(playerId, strength = 1.0, color = '#FFFFFF') {
    if (this.phase !== 'waitingThrow') return;
    if (this.isRolling) return;

    const activeId = this.turnOrder[this.currentTurnIdx];
    if (playerId !== activeId) {
      console.warn(`[Dice] Ignoring throw from ${playerId}. Not their turn.`);
      return;
    }

    this.isRolling = true;
    console.log(`[Dice] Player ${playerId} throws with strength ${strength}`);

    // Trigger visual camera shake on high force
    if (strength > 1.2) {
      const container = document.getElementById('host-main-container');
      if (container) {
        container.classList.add('shake');
        setTimeout(() => container.classList.remove('shake'), 500);
      }
    }

    // Play 3D roll
    const canvas = document.querySelector('#dice-box canvas');
    if (canvas) {
      canvas.style.filter = `drop-shadow(0 0 30px ${color})`;
    }

    // Apply strength physics tweaks
    this.diceBox.spinForce = 5 + strength * 12;
    this.diceBox.throwForce = 10 + strength * 22;

    this.diceBox.roll('1d6', { themeColor: color })
      .then((results) => {
        const val = results && results[0] ? results[0].value : Math.floor(Math.random() * 6) + 1;
        this.resolveThrowResult(playerId, val, color);
      })
      .catch((err) => {
        console.error('3D roll fail fallback:', err);
        const val = Math.floor(Math.random() * 6) + 1;
        this.resolveThrowResult(playerId, val, color);
      });
  }

  resolveThrowResult(playerId, value, color) {
    console.log(`[Dice] Throw result for ${playerId}: ${value}`);
    this.throws.set(playerId, { value, color });

    // Send immediate feedback to active player
    this.sendToPlayer(playerId, 'rollResult', { value });

    // Display result highlight glow effect on canvas
    const canvas = document.querySelector('#dice-box canvas');
    setTimeout(() => {
      if (canvas) canvas.style.filter = 'drop-shadow(0 0 15px rgba(255, 255, 255, 0.4))';
    }, 2000);

    // Proceed to next turn after small delay
    setTimeout(() => {
      if (this.phase === 'waitingThrow') {
        this.isRolling = false;
        this.currentTurnIdx++;
        this.nextTurn();
      }
    }, 2500);
  }

  endRound() {
    // Determine winner of this round
    let maxVal = -1;
    let roundWinners = [];

    this.throws.forEach((data, pId) => {
      if (data.value > maxVal) {
        maxVal = data.value;
        roundWinners = [pId];
      } else if (data.value === maxVal) {
        roundWinners.push(pId);
      }
    });

    // Award point to winners
    roundWinners.forEach(wId => {
      const curScore = this.scores.get(wId) || 0;
      this.scores.set(wId, curScore + 1);
    });

    // Update Round Result UI
    const resultList = document.getElementById('round-results-list');
    const winnerAnnounce = document.getElementById('round-winner-announce');

    if (resultList) {
      resultList.innerHTML = Array.from(this.throws.entries()).map(([pId, data]) => {
        const name = this._playerNicknames.get(pId) || '플레이어';
        const p = this.getPlayer(pId);
        const color = p?.color || '#fff';
        const score = this.scores.get(pId) || 0;
        const isWinner = roundWinners.includes(pId);
        return `
          <div class="result-row" style="${isWinner ? 'border: 1px solid #00C851; background: rgba(0, 200, 81, 0.08);' : ''}">
            <div class="player-info">
              <div class="player-color-dot" style="background: ${color};"></div>
              <span style="font-weight: bold; color: #fff;">${name}</span>
            </div>
            <div style="display: flex; gap: 20px; align-items: center;">
              <span style="color: rgba(255,255,255,0.75);">눈: <strong>${data.value}</strong></span>
              <span class="score-val" title="승점">★ ${score}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    if (winnerAnnounce) {
      if (roundWinners.length > 0) {
        const names = roundWinners.map(wId => this._playerNicknames.get(wId) || '플레이어').join(', ');
        winnerAnnounce.textContent = `우승: ${names} (눈: ${maxVal}) 🏆`;
        winnerAnnounce.style.color = '#00C851';
      } else {
        winnerAnnounce.textContent = '기록 없음';
        winnerAnnounce.style.color = '#fff';
      }
    }

    this.setPhase('roundResult');
    this.broadcastState();

    // After 5s, proceed to next round or end game
    setTimeout(() => {
      if (this.phase === 'roundResult') {
        if (this.round < 3) {
          this.round++;
          this.startRound();
        } else {
          this.endMatch();
        }
      }
    }, 5000);
  }

  endMatch() {
    // Sort standings
    const standings = Array.from(this.scores.entries()).map(([pId, score]) => ({
      playerId: pId,
      name: this._playerNicknames.get(pId) || '플레이어',
      color: this.getPlayer(pId)?.color || '#fff',
      score
    })).sort((a, b) => b.score - a.score);

    // Render Final Scoreboard
    const finalBoard = document.getElementById('final-scoreboard-list');
    if (finalBoard) {
      finalBoard.innerHTML = standings.map((item, idx) => {
        const isWinner = item.score === standings[0].score && item.score > 0;
        return `
          <div class="result-row" style="padding: 12px; ${isWinner ? 'border: 2px solid var(--gold); background: rgba(255, 215, 0, 0.08);' : ''}">
            <div class="player-info">
              <span style="font-weight: bold; width: 24px; color: ${isWinner ? 'var(--gold)' : '#aaa'}">${idx + 1}위</span>
              <div class="player-color-dot" style="background: ${item.color};"></div>
              <span style="font-weight: bold; color: #fff;">${item.name}</span>
            </div>
            <span class="score-val" style="font-size: 1.3rem;">★ ${item.score}</span>
          </div>
        `;
      }).join('');
    }

    this.setPhase('matchResult');
    this.broadcastState();

    // Map restart button
    const restartBtn = document.getElementById('btn-restart-game');
    if (restartBtn) {
      restartBtn.onclick = () => this.resetSession();
    }
  }

  // ─── State Synchronization helper ────────────────────────────────────────

  broadcastState() {
    const activePlayerId = this.phase === 'waitingThrow' && this.turnOrder[this.currentTurnIdx]
      ? this.turnOrder[this.currentTurnIdx]
      : null;

    const payload = {
      phase: this.phase,
      round: this.round,
      activePlayerId,
      activePlayerName: activePlayerId ? this._playerNicknames.get(activePlayerId) : null,
      activePlayerColor: activePlayerId ? this.getPlayer(activePlayerId)?.color : null,
      scores: Array.from(this.scores.entries()).map(([pId, val]) => ({ playerId: pId, score: val })),
      throws: Array.from(this.throws.entries()).map(([pId, data]) => ({ playerId: pId, value: data.value })),
    };

    this.broadcast('gameState', payload);
  }

  getGameStatePayload(playerId) {
    const activePlayerId = this.phase === 'waitingThrow' && this.turnOrder[this.currentTurnIdx]
      ? this.turnOrder[this.currentTurnIdx]
      : null;

    const myThrows = this.throws.get(playerId);

    return {
      phase: this.phase,
      round: this.round,
      activePlayerId,
      activePlayerName: activePlayerId ? this._playerNicknames.get(activePlayerId) : null,
      activePlayerColor: activePlayerId ? this.getPlayer(activePlayerId)?.color : null,
      myScore: this.scores.get(playerId) || 0,
      myThrowValue: myThrows ? myThrows.value : null,
      scores: Array.from(this.scores.entries()).map(([pId, val]) => ({ playerId: pId, score: val })),
      throws: Array.from(this.throws.entries()).map(([pId, data]) => ({ playerId: pId, value: data.value })),
      allWinners: this.phase === 'matchResult' 
        ? Array.from(this.scores.entries())
            .filter(([_, score]) => score === Math.max(...this.scores.values()))
            .map(([pId, _]) => this._playerNicknames.get(pId) || '플레이어')
        : []
    };
  }
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
  const hostSDK = new HostSDK({ gameId: 'dice' });
  window.game = new DiceGame(hostSDK);
});
