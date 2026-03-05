import { SpinPhysics, MAX_RPM } from './SpinPhysics.js';
import { SpinRenderer } from './SpinRenderer.js';

const LAUNCH_DURATION_MS = 5000;
const BATTLE_COUNTDOWN_MS = 3000;

export class SpinGame {
  constructor(socket, canvasContainer) {
    this.socket = socket;
    this.physics = new SpinPhysics();
    this.renderer = new SpinRenderer(canvasContainer);

    this.state = 'lobby'; // lobby | launching | countdown | battle | result
    this.players = new Map();   // playerId → { id, color, rpm }
    this.sessionId = null;
    this.rankings = [];         // ordered list of eliminated playerIds (first = 1st eliminated)
    this.launchRpms = new Map(); // playerId → submitted RPM from launch phase

    this._setupSocketListeners();
    this._loop();
  }

  _setupSocketListeners() {
    // ─── Server → Host ────────────────────────────────────────────────────────

    // Launch phase: mobiles are twisting their phones
    this.socket.on('spinLaunchPhase', () => {
      this.state = 'launching';
      this.launchRpms.clear();
      this._showOverlay('launch-overlay');
      this._startLaunchCountdown();
    });

    // Server collected all launch RPMs, sends battle initialisation data
    this.socket.on('spinBattleStart', ({ players }) => {
      this._hideAllOverlays();
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
      this._startBattleCountdown();
    });

    // Tilt forwarded from server
    this.socket.on('spinTiltUpdate', ({ playerId, tiltX, tiltZ }) => {
      this.physics.setTilt(playerId, tiltX, tiltZ);
    });

    // Launch spin received from a mobile (host logs it)
    this.socket.on('spinLaunchSpinReceived', ({ playerId, rpm }) => {
      this.launchRpms.set(playerId, rpm);
    });

    // Game over from server
    this.socket.on('spinGameOver', ({ rankings }) => {
      this.state = 'result';
      this._showResult(rankings);
    });

  }

  reset() {
    this.state = 'lobby';
    this.players.clear();
    this.rankings = [];
    this.launchRpms.clear();

    // Clear all spinner meshes from the 3D scene
    for (const id of [...this.physics.spinners.keys()]) {
      this.renderer.removeSpinner(id);
    }
    this.physics = new SpinPhysics();

    const rpmBars = document.getElementById('rpm-bars');
    if (rpmBars) rpmBars.innerHTML = '';

    this._showOverlay('lobby-overlay');
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

    // 모바일 spinLaunchSpin이 서버에 도착할 시간(800ms)을 확보한 뒤 배틀 시작 요청
    setTimeout(() => {
      this.socket.emit('spinLaunchDone', { sessionId: this.sessionId });
    }, LAUNCH_DURATION_MS + 800);
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
      `;
      container.appendChild(row);
    }
  }

  _updateRpmBar(playerId, rpm) {
    const fill = document.getElementById(`rpm-fill-${playerId}`);
    const val = document.getElementById(`rpm-val-${playerId}`);
    if (fill) fill.style.width = `${(rpm / MAX_RPM) * 100}%`;
    if (val) val.textContent = `${Math.round(rpm)} RPM`;
  }

  _showResult(rankings) {
    const overlay = document.getElementById('result-overlay');
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

    const { eliminated, collisions } = this.physics.update();

    // Sync 3D positions
    for (const [id, s] of this.physics.spinners) {
      if (!s.eliminated) {
        this.renderer.updateSpinner(id, s.x, s.z, s.rpm);
        this._updateRpmBar(id, s.rpm);
      }
    }

    // Collision particles
    for (const hit of collisions) {
      this.renderer.spawnCollisionParticles(
        (hit.ax + hit.bx) / 2,
        (hit.az + hit.bz) / 2,
        hit.colorA,
      );
    }

    // Eliminations
    for (const { id, reason, x, z } of eliminated) {
      this.renderer.removeSpinner(id);
      this.renderer.spawnCollisionParticles(x, z, this.players.get(id)?.color || '#fff');
      this.rankings.push(id);

      // Grey out the RPM bar
      const row = document.getElementById(`rpm-row-${id}`);
      if (row) row.classList.add('eliminated');

      this.socket.emit('spinPlayerEliminated', {
        sessionId: this.sessionId,
        playerId: id,
        reason,
      });
    }
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    this._update();
    this.renderer.render();
  }
}
