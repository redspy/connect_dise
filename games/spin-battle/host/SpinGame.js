import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { SpinPhysics, MAX_RPM, ITEM_TYPES } from './SpinPhysics.js';
import { SpinRenderer } from './SpinRenderer.js';
import { DemoSimulator } from './DemoSimulator.js';

const LAUNCH_DURATION_MS = 5000;
const BATTLE_COUNTDOWN_MS = 3000;
const ITEM_TYPE_LIST = [ITEM_TYPES.ENERGY, ITEM_TYPES.SHIELD, ITEM_TYPES.COGS];

export class SpinGame extends HostBaseGame {
  constructor(hostSDK, canvasContainer, { devMode = false } = {}) {
    super(hostSDK, { overlayClass: 'spin-overlay' });

    this.renderer = new SpinRenderer(canvasContainer);
    this._devMode = devMode;

    this._readyCount = 0;
    this._launchRpms = new Map();
    this._itemSpawnTimer = null;
    this._itemSpawnIntervalMs = 5000;
    this.physics = null;

    // 타이머 핸들들 관리
    this._launchInterval = null;
    this._launchTimeout = null;
    this._battleCountdownInterval = null;
    this._battleCountdownTimeout = null;
    this._stateSyncInterval = null;
    this._bannerTimeout = null;

    // 게임 고유 메시지 등록
    this.onMessage('tiltInput', (player, { tiltX, tiltZ }) => {
      this.physics?.setTilt(player.id, tiltX, tiltZ);
    });
    this.onMessage('launchSpin', (player, { rpm }) => {
      const value = this._devMode ? MAX_RPM : Math.min(3000, Math.max(300, rpm || 1000));
      this._launchRpms.set(player.id, value);
    });
    this.onMessage('requestReset', () => {
      this.resetSession();
    });

    this._demoSimulator = new DemoSimulator(this);
    this._loop();
  }

  // ─── HostBaseGame 라이프사이클 오버라이드 ────────────────────────────────

  async onSetup() {
    if (this._lobbyEl) {
      this._lobbyEl.onStart = () => {
        this._launchRpms.clear();
        this.setPhase('launching');
        this._startLaunchCountdown();
      };
      this._lobbyEl.onKick = (playerId) => this.kickPlayer(playerId);
    }
    document.getElementById('btn-restart').addEventListener('click', () => {
      this._readyCount = 0;
      this.resetSession();
    });

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.onclick = () => {
        if (!this._isDemo) {
          this._demoSimulator.startDemo();
        } else {
          this._demoSimulator.stopDemo();
        }
      };
    }

    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    if (!player.id.startsWith('bot_')) {
      if (this._isDemo) {
        this._demoSimulator.stopDemo();
        const demoBanner = document.getElementById('demo-banner');
        if (demoBanner) {
          demoBanner.textContent = '🔌 실제 플레이어 입장으로 데모 중단됨';
          demoBanner.classList.remove('hidden');
          if (this._bannerTimeout) clearTimeout(this._bannerTimeout);
          this._bannerTimeout = setTimeout(() => {
            demoBanner.classList.add('hidden');
          }, 3000);
        }
      }
    }
    this.renderLobbyPlayers();
    this.updateLobbyReady(this._readyCount);
  }

  onPlayerRejoin(player) {
    if (this.phase === 'lobby') {
      this.sendToPlayer(player.id, 'lobbyState', {
        players: [...this.players.values()].map(p => ({ id: p.id, color: p.color }))
      });
      this.renderLobbyPlayers();
      this.updateLobbyReady(this._readyCount);
    } else if (this.phase === 'launching') {
      const remainingMs = Math.max(0, (this._launchStartTime + LAUNCH_DURATION_MS) - Date.now());
      this.sendToPlayer(player.id, 'launchState', {
        remainingMs,
        rpm: this._launchRpms.get(player.id) || 0
      });
    } else if (this.phase === 'countdown' || this.phase === 'battle') {
      const players = [...this.players.values()].map(p => {
        const spinner = this.physics?.spinners.get(p.id);
        const buffs = this.physics?.getBuffs(p.id) || { shield: 0, cogs: 0 };
        return {
          id: p.id,
          color: p.color,
          rpm: spinner ? spinner.rpm : (this._launchRpms.get(p.id) || 1000),
          eliminated: spinner ? spinner.eliminated : false,
          shield: buffs.shield > 0,
          cogs: buffs.cogs > 0
        };
      });
      const spinner = this.physics?.spinners.get(player.id);
      const isEliminated = spinner ? spinner.eliminated : false;
      const countdownRemainingMs = this.phase === 'countdown' ? Math.max(0, (this._battleCountdownStartTime + BATTLE_COUNTDOWN_MS) - Date.now()) : 0;
      this.sendToPlayer(player.id, 'battleState', {
        players,
        phase: this.phase,
        isEliminated,
        countdownRemainingMs
      });
    } else if (this.phase === 'result') {
      this.sendToPlayer(player.id, 'resultState', {
        rankings: this._finalRankings || []
      });
    }
  }

  onPlayerLeave(playerId) {
    if (this.phase === 'battle' || this.phase === 'countdown') {
      const elResult = this.physics?.eliminateSpinner(playerId, 'leave');
      if (elResult) {
        this.renderer.removeSpinner(playerId);
        this._rankings.push({ id: playerId, color: this.getPlayer(playerId)?.color });
        const row = document.getElementById(`rpm-row-${playerId}`);
        if (row) row.classList.add('eliminated');
        this.sendToPlayer(playerId, 'eliminated', { rank: this._rankings.length, reason: 'leave' });
        this._checkBattleOver();
      }
    }
    this.renderLobbyPlayers();
    this.updateLobbyReady(this._readyCount);
  }

  onReadyUpdate({ readyCount }) {
    this._readyCount = readyCount;
    this.updateLobbyReady(readyCount);
  }

  onAllReady() {
    this.updateLobbyReady(this.playerCount);
  }

  _clearAllTimers() {
    if (this._launchInterval) { clearInterval(this._launchInterval); this._launchInterval = null; }
    if (this._launchTimeout) { clearTimeout(this._launchTimeout); this._launchTimeout = null; }
    if (this._battleCountdownInterval) { clearInterval(this._battleCountdownInterval); this._battleCountdownInterval = null; }
    if (this._battleCountdownTimeout) { clearTimeout(this._battleCountdownTimeout); this._battleCountdownTimeout = null; }
    if (this._stateSyncInterval) { clearInterval(this._stateSyncInterval); this._stateSyncInterval = null; }
    if (this._bannerTimeout) { clearTimeout(this._bannerTimeout); this._bannerTimeout = null; }
    this._stopItemSpawner();
  }

  onReset() {
    this._demoSimulator.stopDemo();
    this._clearAllTimers();
    this.renderer.clearItems();

    this._readyCount = 0;
    this._launchRpms.clear();

    if (this.physics) {
      for (const id of [...this.physics.spinners.keys()]) {
        this.renderer.removeSpinner(id);
      }
      this.physics = null;
    }

    const rpmBars = document.getElementById('rpm-bars');
    if (rpmBars) rpmBars.innerHTML = '';

    this.renderLobbyPlayers();
    this.updateLobbyReady(0);
    this.setPhase('lobby');
  }

  onPhaseChange(from, to) {
    if (this._isDemo) {
      this._demoSimulator.onPhaseChange(to);
    }
  }

  // ─── 아이템 스포너 ────────────────────────────────────────────────────────

  _startItemSpawner() {
    this._itemSpawnTimer = setInterval(() => {
      if (this.phase !== 'battle') return;
      const type = ITEM_TYPE_LIST[Math.floor(Math.random() * ITEM_TYPE_LIST.length)];
      const item = this.physics.spawnItem(type);
      this.renderer.addItem(item);
    }, this._itemSpawnIntervalMs);
  }

  setItemSpawnInterval(ms) {
    this._itemSpawnIntervalMs = ms;
    if (this._itemSpawnTimer) {
      this._stopItemSpawner();
      this._startItemSpawner();
    }
  }

  setVisualParam(key, value) { this.renderer?.setVisualParam(key, value); }
  getVisualState() { return this.renderer?.getVisualState?.() || {}; }
  resetVisualParams() { this.renderer?.resetVisualParams?.(); }

  _stopItemSpawner() {
    if (this._itemSpawnTimer) {
      clearInterval(this._itemSpawnTimer);
      this._itemSpawnTimer = null;
    }
  }

  // ─── 게임 흐름 ───────────────────────────────────────────────────────────

  _startLaunchCountdown() {
    this._launchStartTime = Date.now();
    this.broadcast('launchStart', { durationMs: LAUNCH_DURATION_MS });

    const el = document.getElementById('launch-countdown');
    let sec = Math.ceil(LAUNCH_DURATION_MS / 1000);
    el.textContent = sec;
    this._launchInterval = setInterval(() => {
      sec--;
      el.textContent = sec;
      if (sec <= 0) {
        clearInterval(this._launchInterval);
        this._launchInterval = null;
      }
    }, 1000);

    this._launchTimeout = setTimeout(() => {
      this._launchTimeout = null;
      this._startBattle();
    }, LAUNCH_DURATION_MS + 800);
  }

  _startBattle() {
    const allPlayers = this.sdk.getPlayers();
    const players = allPlayers.map(p => ({
      id: p.id,
      color: p.color,
      rpm: this._launchRpms.get(p.id) || 1000,
    }));

    if (this._devMode) {
      players.forEach(p => { p.rpm = MAX_RPM; });
    }

    this._rankings = [];
    this.physics = new SpinPhysics();
    const count = players.length;
    players.forEach((p, i) => {
      const angle = (i / count) * Math.PI * 2;
      this.physics.addSpinner(p.id, p.color, p.rpm, angle);
      this.renderer.addSpinner(p.id, p.color);
    });

    this._buildRpmBars(players);
    this._startBattleCountdown();
  }

  _startBattleCountdown() {
    this.setPhase('countdown');
    this._battleCountdownStartTime = Date.now();

    const allPlayers = this.sdk.getPlayers();
    const players = allPlayers.map(p => ({
      id: p.id,
      color: p.color,
      rpm: this._launchRpms.get(p.id) || 1000,
    }));

    this.broadcast('battleCountdown', { durationMs: BATTLE_COUNTDOWN_MS, players });

    const el = document.getElementById('battle-countdown');
    let sec = Math.ceil(BATTLE_COUNTDOWN_MS / 1000);
    el.textContent = sec;
    this._battleCountdownInterval = setInterval(() => {
      sec--;
      el.textContent = sec > 0 ? sec : 'GO!';
      if (sec <= 0) {
        clearInterval(this._battleCountdownInterval);
        this._battleCountdownInterval = null;
        this._battleCountdownTimeout = setTimeout(() => {
          this._battleCountdownTimeout = null;
          this.setPhase('battle');
          
          this._stateSyncInterval = setInterval(() => this._syncBattleState(), 200);
          this._startItemSpawner();
          this.broadcast('battleLive', { players });
        }, 600);
      }
    }, 1000);
  }

  _syncBattleState() {
    if (this.phase !== 'battle' || !this.physics) return;
    const players = [...this.players.values()].map(p => {
      const spinner = this.physics.spinners.get(p.id);
      const buffs = this.physics.getBuffs(p.id) || { shield: 0, cogs: 0 };
      return {
        id: p.id,
        color: p.color,
        rpm: spinner ? spinner.rpm : 0,
        eliminated: spinner ? spinner.eliminated : false,
        shield: buffs.shield > 0,
        cogs: buffs.cogs > 0
      };
    });
    this.broadcast('battleState', { players });
  }

  _buildRpmBars(players) {
    const container = document.getElementById('rpm-bars');
    container.innerHTML = '';
    for (const p of players) {
      const row = document.createElement('div');
      row.className = 'rpm-row';
      row.id = `rpm-row-${p.id}`;
      row.innerHTML = `
        <span class="rpm-dot" style="background:${p.color}"></span>
        <div class="rpm-bar-bg">
          <div class="rpm-bar-fill" id="rpm-fill-${p.id}" style="background:${p.color};width:100%"></div>
        </div>
        <span class="rpm-value" id="rpm-val-${p.id}">${p.rpm} RPM</span>
        <span class="buff-icons" id="buff-${p.id}"></span>
      `;
      container.appendChild(row);
    }
  }

  _updateRpmBar(playerId, rpm) {
    const fill = document.getElementById(`rpm-fill-${playerId}`);
    const val = document.getElementById(`rpm-val-${playerId}`);
    const buffEl = document.getElementById(`buff-${playerId}`);
    if (fill) fill.style.width = `${(rpm / MAX_RPM) * 100}%`;
    if (val) val.textContent = `${Math.round(rpm)} RPM`;
    if (buffEl) {
      const buffs = this.physics.getBuffs(playerId);
      buffEl.textContent = (buffs.shield > 0 ? '🛡️' : '') + (buffs.cogs > 0 ? '⚙️' : '');
    }
  }

  _showResult(rankings) {
    this._finalRankings = rankings;
    this._stopItemSpawner();
    if (this._stateSyncInterval) {
      clearInterval(this._stateSyncInterval);
      this._stateSyncInterval = null;
    }
    this.renderer.clearItems();
    const display = document.getElementById('rankings-display');
    display.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    rankings.forEach((entry, i) => {
      const p = this.getPlayer(entry.id) || { color: '#fff' };
      const nickname = this._playerNicknames.get(entry.id) || p.nickname || entry.id.slice(0, 6);
      const div = document.createElement('div');
      div.className = 'rank-row';
      div.innerHTML = `
        <span class="rank-medal">${medals[i] || `${i + 1}위`}</span>
        <span class="rank-dot" style="background:${p.color}"></span>
        <span class="rank-name">${nickname}</span>
      `;
      display.appendChild(div);
    });
    this.setPhase('result');
  }

  _checkBattleOver() {
    if (!this.physics) return;
    const active = [...this.physics.spinners.values()].filter(s => !s.eliminated);
    if (active.length === 0 || (active.length === 1 && this.playerCount > 1)) {
      const winner = active[0];
      const finalRankings = [];
      if (winner) finalRankings.push({ id: winner.id, color: winner.color });
      for (let i = this._rankings.length - 1; i >= 0; i--) {
        // 이미 랭킹에 들어간 중복 플레이어 스냅 방지
        if (winner && this._rankings[i].id === winner.id) continue;
        finalRankings.push(this._rankings[i]);
      }
      this._rankings = [];
      this._finalRankings = finalRankings;
      this.broadcast('gameOver', { rankings: finalRankings });
      this._showResult(finalRankings);
    }
  }

  // ─── 게임 루프 ───────────────────────────────────────────────────────────

  _update() {
    if (this.phase !== 'battle' || !this.physics) return;

    const { eliminated, collisions, pickedUp, expired, wallHits } = this.physics.update();

    for (const [id, s] of this.physics.spinners) {
      if (!s.eliminated) {
        this.renderer.updateSpinner(id, s.x, s.z, s.rpm);
        this._updateRpmBar(id, s.rpm);
      }
    }

    for (const hit of collisions) {
      this.renderer.spawnCollisionParticles(
        (hit.ax + hit.bx) / 2,
        (hit.az + hit.bz) / 2,
        hit.colorA
      );
      if (hit.idA && !hit.idA.startsWith('bot_')) {
        this.sendToPlayer(hit.idA, 'collisionFeedback', { intensity: 'heavy' });
      }
      if (hit.idB && !hit.idB.startsWith('bot_')) {
        this.sendToPlayer(hit.idB, 'collisionFeedback', { intensity: 'heavy' });
      }
    }

    for (const hit of wallHits) {
      this.renderer.spawnWallParticles(hit.x, hit.z, hit.color, hit.speed);
      if (hit.id && !hit.id.startsWith('bot_')) {
        this.sendToPlayer(hit.id, 'wallFeedback', { speed: hit.speed });
      }
    }

    for (const { item } of pickedUp) {
      this.renderer.removeItem(item.id);
    }

    for (const item of expired) {
      this.renderer.removeItem(item.id);
    }

    for (const { id, reason, x, z } of eliminated) {
      this.renderer.removeSpinner(id);
      this.renderer.spawnCollisionParticles(x, z, this.getPlayer(id)?.color || '#fff');
      this._rankings.push({ id, color: this.getPlayer(id)?.color });

      const row = document.getElementById(`rpm-row-${id}`);
      if (row) row.classList.add('eliminated');

      const rank = this._rankings.length;
      this.sendToPlayer(id, 'eliminated', { rank, reason });
    }

    if (eliminated.length > 0) {
      this._checkBattleOver();
    }
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    this._update();
    this.renderer.render();
  }
}
