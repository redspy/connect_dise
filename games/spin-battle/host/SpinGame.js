import { SpinPhysics, MAX_RPM, ITEM_TYPES } from './SpinPhysics.js';
import { SpinRenderer } from './SpinRenderer.js';

const LAUNCH_DURATION_MS = 5000;
const BATTLE_COUNTDOWN_MS = 3000;

const ITEM_TYPE_LIST = [ITEM_TYPES.ENERGY, ITEM_TYPES.SHIELD, ITEM_TYPES.COGS];

export class SpinGame {
  constructor(hostSDK, canvasContainer, { devMode = false } = {}) {
    this.host = hostSDK;
    this.physics = new SpinPhysics();
    this.renderer = new SpinRenderer(canvasContainer);
    this._devMode = devMode;

    this.state = 'lobby'; // lobby | launching | countdown | battle | result
    this.players = new Map();   // playerId → { id, color, rpm }
    this.rankings = [];         // elimination order: { id, color }
    this.launchRpms = new Map(); // playerId → submitted RPM from launch phase
    this._itemSpawnTimer = null;
    this._itemSpawnIntervalMs = 5000;

    this._setupListeners();
    this._loop();
  }

  _setupListeners() {
    // All players ready → launch phase starts
    this.host.on('allReady', () => {
      this.state = 'launching';
      this.launchRpms.clear();
      this._showOverlay('launch-overlay');
      this._startLaunchCountdown();
    });

    // Tilt input from mobile during battle
    this.host.onMessage('tiltInput', (player, { tiltX, tiltZ }) => {
      this.physics.setTilt(player.id, tiltX, tiltZ);
    });

    // Launch spin from mobile during launch phase
    this.host.onMessage('launchSpin', (player, { rpm }) => {
      const value = this._devMode ? MAX_RPM : Math.min(3000, Math.max(300, rpm || 1000));
      this.launchRpms.set(player.id, value);
    });

    // Mobile requests game reset (다시하기)
    this.host.onMessage('requestReset', () => {
      this.host.resetSession();
    });
  }

  reset() {
    this._stopItemSpawner();
    this.renderer.clearItems();
    this._setQRVisible(true);

    this.state = 'lobby';
    this.players.clear();
    this.rankings = [];
    this.launchRpms.clear();

    for (const id of [...this.physics.spinners.keys()]) {
      this.renderer.removeSpinner(id);
    }
    this.physics = new SpinPhysics();

    const rpmBars = document.getElementById('rpm-bars');
    if (rpmBars) rpmBars.innerHTML = '';

    this._showOverlay('lobby-overlay');
  }

  // ─── Item spawner ────────────────────────────────────────────────────────────

  _startItemSpawner() {
    this._itemSpawnTimer = setInterval(() => {
      if (this.state !== 'battle') return;
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

  setVisualParam(key, value) {
    this.renderer?.setVisualParam(key, value);
  }

  getVisualState() {
    return this.renderer?.getVisualState?.() || {};
  }

  resetVisualParams() {
    this.renderer?.resetVisualParams?.();
  }

  _stopItemSpawner() {
    if (this._itemSpawnTimer) {
      clearInterval(this._itemSpawnTimer);
      this._itemSpawnTimer = null;
    }
  }

  // ─── Lifecycle helpers ──────────────────────────────────────────────────────

  _startLaunchCountdown() {
    const el = document.getElementById('launch-countdown');
    let sec = Math.ceil(LAUNCH_DURATION_MS / 1000);
    el.textContent = sec;
    const iv = setInterval(() => {
      sec--;
      el.textContent = sec;
      if (sec <= 0) clearInterval(iv);
    }, 1000);

    // Wait for mobile launch RPMs to arrive, then start battle
    setTimeout(() => {
      this._startBattle();
    }, LAUNCH_DURATION_MS + 800);
  }

  _startBattle() {
    this._hideAllOverlays();
    const allPlayers = this.host.getPlayers();
    const players = allPlayers.map(p => ({
      id: p.id,
      color: p.color,
      rpm: this.launchRpms.get(p.id) || 1000,
    }));

    if (this._devMode) {
      players.forEach(p => { p.rpm = MAX_RPM; });
    }
    this.players = new Map(players.map(p => [p.id, { ...p }]));
    this.rankings = [];
    this.physics = new SpinPhysics();

    const count = players.length;
    players.forEach((p, i) => {
      const angle = (i / count) * Math.PI * 2;
      this.physics.addSpinner(p.id, p.color, p.rpm, angle);
      this.renderer.addSpinner(p.id, p.color);
    });

    this._buildRpmBars(players);
    this.host.broadcast('battleStart', { players });
    this._startBattleCountdown();
  }

  _startBattleCountdown() {
    this._showOverlay('countdown-overlay');
    const el = document.getElementById('battle-countdown');
    let sec = Math.ceil(BATTLE_COUNTDOWN_MS / 1000);
    el.textContent = sec;
    const iv = setInterval(() => {
      sec--;
      el.textContent = sec > 0 ? sec : 'GO!';
      if (sec <= 0) {
        clearInterval(iv);
        setTimeout(() => {
          this._hideAllOverlays();
          this.state = 'battle';
          this._setQRVisible(false);
          this._startItemSpawner();
        }, 600);
      }
    }, 1000);
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

  _setQRVisible(visible) {
    const qr = document.getElementById('qr-main');
    if (qr) qr.style.display = visible ? '' : 'none';
  }

  _showResult(rankings) {
    this._stopItemSpawner();
    this.renderer.clearItems();
    const display = document.getElementById('rankings-display');
    display.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    rankings.forEach((entry, i) => {
      const p = this.players.get(entry.id) || { color: '#fff' };
      const div = document.createElement('div');
      div.className = 'rank-row';
      div.innerHTML = `
        <span class="rank-medal">${medals[i] || `${i + 1}위`}</span>
        <span class="rank-dot" style="background:${p.color}"></span>
        <span class="rank-name">${entry.id.slice(0, 6)}</span>
      `;
      display.appendChild(div);
    });
    this._showOverlay('result-overlay');
  }

  _showOverlay(id) {
    document.querySelectorAll('.spin-overlay').forEach(el => {
      el.classList.toggle('hidden', el.id !== id);
    });
  }

  _hideAllOverlays() {
    document.querySelectorAll('.spin-overlay').forEach(el => el.classList.add('hidden'));
  }

  // ─── Game loop ──────────────────────────────────────────────────────────────

  _update() {
    if (this.state !== 'battle') return;

    const { eliminated, collisions, pickedUp, expired, wallHits } = this.physics.update();

    // Sync 3D positions
    for (const [id, s] of this.physics.spinners) {
      if (!s.eliminated) {
        this.renderer.updateSpinner(id, s.x, s.z, s.rpm);
        this._updateRpmBar(id, s.rpm);
      }
    }

    // Spinner-spinner collision particles
    for (const hit of collisions) {
      this.renderer.spawnCollisionParticles(
        (hit.ax + hit.bx) / 2,
        (hit.az + hit.bz) / 2,
        hit.colorA,
      );
    }

    // Wall hit particles
    for (const hit of wallHits) {
      this.renderer.spawnWallParticles(hit.x, hit.z, hit.color, hit.speed);
    }

    // Item pickups → remove from renderer
    for (const { item } of pickedUp) {
      this.renderer.removeItem(item.id);
    }

    // Item TTL expiry → remove from renderer
    for (const item of expired) {
      this.renderer.removeItem(item.id);
    }

    // Eliminations — host directly notifies each eliminated player
    for (const { id, reason, x, z } of eliminated) {
      this.renderer.removeSpinner(id);
      this.renderer.spawnCollisionParticles(x, z, this.players.get(id)?.color || '#fff');
      this.rankings.push({ id, color: this.players.get(id)?.color });

      const row = document.getElementById(`rpm-row-${id}`);
      if (row) row.classList.add('eliminated');

      // rank: 1-based elimination order (1 = first out)
      const rank = this.rankings.length;
      this.host.sendToPlayer(id, 'eliminated', { rank, reason });
    }

    // Game over check: one or fewer spinners still active
    if (eliminated.length > 0) {
      const active = [...this.physics.spinners.values()].filter(s => !s.eliminated);
      if (active.length === 0 || (active.length === 1 && this.players.size > 1)) {
        this.state = 'result';

        const winner = active[0];
        const finalRankings = [];
        if (winner) finalRankings.push({ id: winner.id, color: winner.color });
        // Append eliminated in reverse order (last eliminated = rank 2)
        for (let i = this.rankings.length - 1; i >= 0; i--) {
          finalRankings.push(this.rankings[i]);
        }

        this.host.broadcast('gameOver', { rankings: finalRankings });
        this._showResult(finalRankings);
      }
    }
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    this._update();
    this.renderer.render();
  }
}
