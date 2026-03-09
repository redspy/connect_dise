import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { SpinPhysics, MAX_RPM, ITEM_TYPES } from './SpinPhysics.js';
import { SpinRenderer } from './SpinRenderer.js';

const LAUNCH_DURATION_MS = 5000;
const BATTLE_COUNTDOWN_MS = 3000;
const ITEM_TYPE_LIST = [ITEM_TYPES.ENERGY, ITEM_TYPES.SHIELD, ITEM_TYPES.COGS];

export class SpinGame extends HostBaseGame {
  constructor(hostSDK, canvasContainer, { devMode = false } = {}) {
    super(hostSDK, { overlayClass: 'spin-overlay', qrContainerId: 'qr-main' });

    this.renderer = new SpinRenderer(canvasContainer);
    this._devMode = devMode;

    this._readyCount = 0;
    this._launchRpms = new Map();
    this._itemSpawnTimer = null;
    this._itemSpawnIntervalMs = 5000;
    this.physics = null;

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

    this._loop();
  }

  // ─── HostBaseGame 라이프사이클 오버라이드 ────────────────────────────────

  async onSetup({ sessionId }) {
    document.getElementById('session-id-display').textContent = sessionId;
    document.getElementById('btn-restart').addEventListener('click', () => {
      this._readyCount = 0;
      this._renderPlayerList();
      this.resetSession();
    });
    this.setPhase('lobby');
  }

  onPlayerJoin(_player) {
    this._renderPlayerList();
  }

  onPlayerLeave(_playerId) {
    this._renderPlayerList();
  }

  onReadyUpdate({ readyCount }) {
    this._readyCount = readyCount;
    this._renderPlayerList();
  }

  onAllReady() {
    this._launchRpms.clear();
    this.setPhase('launching');
    this._startLaunchCountdown();
  }

  onReset() {
    this._stopItemSpawner();
    this.renderer.clearItems();
    this._setQRVisible(true);

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

    this._renderPlayerList();
    this.setPhase('lobby');
  }

  // ─── 플레이어 목록 렌더링 ────────────────────────────────────────────────

  _renderPlayerList() {
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    for (const [, player] of this.players) {
      const dot = document.createElement('div');
      dot.className = 'player-dot';
      dot.style.background = player.color;
      list.appendChild(dot);
    }
    const countEl = document.getElementById('player-count-display');
    if (this.playerCount === 0) {
      countEl.textContent = '접속 중인 플레이어가 없습니다';
    } else {
      countEl.textContent = `${this.playerCount}명 접속 중 · ${this._readyCount}명 준비완료`;
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
    const el = document.getElementById('launch-countdown');
    let sec = Math.ceil(LAUNCH_DURATION_MS / 1000);
    el.textContent = sec;
    const iv = setInterval(() => {
      sec--;
      el.textContent = sec;
      if (sec <= 0) clearInterval(iv);
    }, 1000);

    setTimeout(() => this._startBattle(), LAUNCH_DURATION_MS + 800);
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
    this.broadcast('battleStart', { players });
    this._startBattleCountdown();
  }

  _startBattleCountdown() {
    this.setPhase('countdown');
    const el = document.getElementById('battle-countdown');
    let sec = Math.ceil(BATTLE_COUNTDOWN_MS / 1000);
    el.textContent = sec;
    const iv = setInterval(() => {
      sec--;
      el.textContent = sec > 0 ? sec : 'GO!';
      if (sec <= 0) {
        clearInterval(iv);
        setTimeout(() => {
          this.setPhase('battle');
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
      const p = this.getPlayer(entry.id) || { color: '#fff' };
      const div = document.createElement('div');
      div.className = 'rank-row';
      div.innerHTML = `
        <span class="rank-medal">${medals[i] || `${i + 1}위`}</span>
        <span class="rank-dot" style="background:${p.color}"></span>
        <span class="rank-name">${entry.id.slice(0, 6)}</span>
      `;
      display.appendChild(div);
    });
    this.setPhase('result');
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
        hit.colorA,
      );
    }

    for (const hit of wallHits) {
      this.renderer.spawnWallParticles(hit.x, hit.z, hit.color, hit.speed);
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
      const active = [...this.physics.spinners.values()].filter(s => !s.eliminated);
      if (active.length === 0 || (active.length === 1 && this.playerCount > 1)) {
        const winner = active[0];
        const finalRankings = [];
        if (winner) finalRankings.push({ id: winner.id, color: winner.color });
        for (let i = this._rankings.length - 1; i >= 0; i--) {
          finalRankings.push(this._rankings[i]);
        }
        this._rankings = [];
        this.broadcast('gameOver', { rankings: finalRankings });
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
