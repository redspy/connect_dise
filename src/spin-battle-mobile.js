import { io } from 'socket.io-client';

const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session');

const sessionDisplay = document.getElementById('session-display');
const connectionStatus = document.getElementById('connection-status');
const permissionModal = document.getElementById('permission-modal');
const btnGrant = document.getElementById('btn-grant-permission');

const phaseLobby = document.getElementById('phase-lobby');
const phaseLaunch = document.getElementById('phase-launch');
const phaseBattle = document.getElementById('phase-battle');
const phaseEliminated = document.getElementById('phase-eliminated');

const launchRpmDisplay = document.getElementById('launch-rpm-display');
const launchGaugeBar = document.getElementById('launch-gauge-bar');
const launchTimer = document.getElementById('launch-timer');
const battleRpmDisplay = document.getElementById('battle-rpm-display');
const battleGaugeBar = document.getElementById('battle-gauge-bar');
const levelBubble = document.getElementById('level-bubble');
const levelBeta = document.getElementById('level-beta');
const levelGamma = document.getElementById('level-gamma');
const myColorDot = document.getElementById('my-color-dot');

const MAX_RPM = 3000;
const BOWL_RADIUS = 46;

let socket;
let myColor = '#FFFFFF';
let myRpm = 0;
let tiltInterval = null;
let lastTiltSend = 0;
let currentPhase = 'lobby';

if (!sessionId) {
  sessionDisplay.textContent = 'No Session ID';
} else {
  sessionDisplay.textContent = `Session: ${sessionId}`;
  socket = io();

  socket.on('connect', () => {
    socket.emit('spinJoinSession', sessionId);
  });

  socket.on('spinJoined', ({ color }) => {
    connectionStatus.classList.add('connected');
    myColor = color;
    myColorDot.style.background = color;
    myColorDot.style.boxShadow = `0 0 12px ${color}`;
    myColorDot.classList.remove('hidden');
  });

  // ─── Phase: Launch ──────────────────────────────────────────────────────────
  socket.on('spinLaunchPhase', () => {
    currentPhase = 'launch';
    _showPhase('phase-launch');
    myRpm = 0;
    _startLaunchPhase();
  });

  // ─── Phase: Battle ──────────────────────────────────────────────────────────
  socket.on('spinBattleStart', ({ players }) => {
    currentPhase = 'battle';
    _showPhase('phase-battle');
    // 서버가 확정한 내 RPM 반영 (못 찾으면 launch 단계에서 측정한 값 사용)
    const me = players?.find(p => p.id === socket.id);
    if (me) myRpm = me.rpm;
    _updateBattleRpm(myRpm);
    _startTiltSending();
  });

  // ─── My RPM update (server echoes back current RPM during battle) ───────────
  socket.on('spinMyRpm', ({ rpm }) => {
    myRpm = rpm;
    _updateBattleRpm(rpm);
  });

  // ─── Eliminated ────────────────────────────────────────────────────────────
  socket.on('spinEliminated', ({ rank }) => {
    currentPhase = 'eliminated';
    _stopTiltSending();
    _showPhase('phase-eliminated');
    document.getElementById('eliminated-rank').textContent = `${rank}위 탈락`;
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
  });

  // ─── Game over ──────────────────────────────────────────────────────────────
  socket.on('spinGameOver', () => {
    if (currentPhase !== 'eliminated') {
      // Last survivor - winner!
      _showPhase('phase-eliminated');
      document.getElementById('eliminated-rank').textContent = '🏆 우승!';
    }
    _stopTiltSending();
  });

  // Host reset → back to lobby, keep connection
  socket.on('spinGameReset', () => {
    currentPhase = 'lobby';
    _stopTiltSending();
    _showPhase('phase-lobby');
  });

  socket.on('hostDisconnected', () => {
    alert('호스트가 연결을 끊었습니다.');
  });

  socket.on('error', (msg) => {
    alert('오류: ' + msg);
  });
}

// ─── Permission flow ──────────────────────────────────────────────────────────
btnGrant.addEventListener('click', async () => {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const state = await DeviceOrientationEvent.requestPermission();
      if (state === 'granted') {
        permissionModal.classList.add('hidden');
        _initSensors();
      } else {
        alert('센서 권한이 필요합니다.');
      }
    } catch {
      permissionModal.classList.add('hidden');
      _initSensors();
    }
  } else {
    permissionModal.classList.add('hidden');
    _initSensors();
  }
});

// ─── Sensors ──────────────────────────────────────────────────────────────────
let latestBeta = 0;
let latestGamma = 0;
let latestShakeMag = 0; // instantaneous shake magnitude (above gravity baseline)

function _initSensors() {
  window.addEventListener('deviceorientation', (e) => {
    latestBeta = e.beta ?? 0;
    latestGamma = e.gamma ?? 0;
    _updateLevelIndicator(latestBeta, latestGamma);
  });

  window.addEventListener('devicemotion', (e) => {
    const acc = e.accelerationIncludingGravity || e.acceleration;
    if (!acc) return;
    const mag = Math.sqrt((acc.x ?? 0) ** 2 + (acc.y ?? 0) ** 2 + (acc.z ?? 0) ** 2);
    // Subtract gravity baseline (~9.8), excess = actual shake force
    latestShakeMag = Math.max(0, mag - 9.8);
  });
}

function _updateLevelIndicator(beta, gamma) {
  const cb = Math.max(-45, Math.min(45, beta));
  const cg = Math.max(-45, Math.min(45, gamma));
  const x = (-cg / 45) * BOWL_RADIUS;
  const y = (-cb / 45) * BOWL_RADIUS;
  levelBubble.style.left = `calc(50% + ${x.toFixed(1)}px)`;
  levelBubble.style.top = `calc(50% + ${y.toFixed(1)}px)`;
  const dist = Math.sqrt(x * x + y * y);
  levelBubble.classList.toggle('tilted', dist > BOWL_RADIUS * 0.4);
  if (levelBeta) levelBeta.textContent = `β: ${beta.toFixed(1)}°`;
  if (levelGamma) levelGamma.textContent = `γ: ${gamma.toFixed(1)}°`;
}

// ─── Launch phase ─────────────────────────────────────────────────────────────
// MAX_SHAKE_ENERGY: total accumulated shake needed to reach 3000 RPM.
// Vigorous shaking at ~15 excess g per sample × ~30 samples/sec × 5 sec = ~2250.
// Set threshold slightly below peak so a good shake reaches max RPM.
const MAX_SHAKE_ENERGY = 1500;

function _startLaunchPhase() {
  let shakeEnergy = 0;
  let elapsed = 0;
  const DURATION = 5000;

  // Sample shake at high frequency via devicemotion
  const onMotion = () => {
    shakeEnergy += latestShakeMag;
  };
  window.addEventListener('devicemotion', onMotion);

  const iv = setInterval(() => {
    elapsed += 100;

    const rpm = Math.min(MAX_RPM, (shakeEnergy / MAX_SHAKE_ENERGY) * MAX_RPM);
    myRpm = rpm;
    launchRpmDisplay.textContent = `${Math.round(rpm)} RPM`;
    launchGaugeBar.style.width = `${(rpm / MAX_RPM) * 100}%`;

    const remaining = Math.ceil((DURATION - elapsed) / 1000);
    launchTimer.textContent = remaining > 0 ? remaining : '0';

    if (elapsed >= DURATION) {
      clearInterval(iv);
      window.removeEventListener('devicemotion', onMotion);
      const finalRpm = Math.max(200, Math.round(rpm));
      if (socket && sessionId) {
        socket.emit('spinLaunchSpin', { sessionId, rpm: finalRpm });
      }
    }
  }, 100);
}

// ─── Tilt sending during battle ────────────────────────────────────────────────
function _startTiltSending() {
  tiltInterval = setInterval(() => {
    if (!socket || !sessionId) return;
    const tiltX = Math.max(-1, Math.min(1, latestGamma / 45));
    const tiltZ = Math.max(-1, Math.min(1, latestBeta / 45));
    socket.emit('spinTiltInput', { sessionId, tiltX, tiltZ });
  }, 33); // ~30fps
}

function _stopTiltSending() {
  if (tiltInterval) {
    clearInterval(tiltInterval);
    tiltInterval = null;
  }
}

function _updateBattleRpm(rpm) {
  battleRpmDisplay.textContent = `${Math.round(rpm)} RPM`;
  battleGaugeBar.style.width = `${(rpm / MAX_RPM) * 100}%`;
}

// ─── Phase switcher ───────────────────────────────────────────────────────────
function _showPhase(activeId) {
  [phaseLobby, phaseLaunch, phaseBattle, phaseEliminated].forEach(el => {
    if (el) el.classList.toggle('hidden', el.id !== activeId);
  });
}
