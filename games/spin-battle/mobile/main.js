import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { LevelIndicator } from '../../../platform/client/shared/LevelIndicator.js';

const mobile = new MobileSDK();

const sessionDisplay = document.getElementById('session-display');
const connectionStatus = document.getElementById('connection-status');
const permissionModal = document.getElementById('permission-modal');
const btnGrant = document.getElementById('btn-grant-permission');

const phaseLobby = document.getElementById('phase-lobby');
const phaseLaunch = document.getElementById('phase-launch');
const phaseBattle = document.getElementById('phase-battle');
const phaseEliminated = document.getElementById('phase-eliminated');
const phaseResult = document.getElementById('phase-result');
const btnReady = document.getElementById('btn-ready');
const readyStatus = document.getElementById('ready-status');

const launchRpmDisplay = document.getElementById('launch-rpm-display');
const launchGaugeBar = document.getElementById('launch-gauge-bar');
const launchTimer = document.getElementById('launch-timer');
const battleRpmDisplay = document.getElementById('battle-rpm-display');
const battleGaugeBar = document.getElementById('battle-gauge-bar');
const myColorDot = document.getElementById('my-color-dot');

const MAX_RPM = 3000;
const MAX_SHAKE_ENERGY = 1500;

let myRpm = 0;
let tiltInterval = null;
let currentPhase = 'lobby';
let latestBeta = 0;
let latestGamma = 0;
let latestShakeMag = 0;

const levelIndicator = new LevelIndicator({
  bubble: document.getElementById('level-bubble'),
  betaEl: document.getElementById('level-beta'),
  gammaEl: document.getElementById('level-gamma'),
});

if (!mobile.getSessionId()) {
  sessionDisplay.textContent = 'No Session ID';
} else {
  sessionDisplay.textContent = `Session: ${mobile.getSessionId()}`;
}

// ─── SDK event handlers ────────────────────────────────────────────────────────

mobile.on('join', (player) => {
  connectionStatus.classList.add('connected');
  myColorDot.style.background = player.color;
  myColorDot.style.boxShadow = `0 0 12px ${player.color}`;
  myColorDot.classList.remove('hidden');
  btnReady.classList.remove('hidden');
});

mobile.on('allReady', () => {
  currentPhase = 'launch';
  _showPhase('phase-launch');
  myRpm = 0;
  _startLaunchPhase();
});

mobile.on('reset', () => {
  currentPhase = 'lobby';
  _stopTiltSending();
  btnReady.classList.remove('hidden');
  btnReady.disabled = false;
  btnReady.textContent = '준비하기';
  readyStatus.classList.add('hidden');
  _showPhase('phase-lobby');
});

mobile.on('hostDisconnect', () => {
  alert('호스트가 연결을 끊었습니다.');
});

mobile.onMessage('battleStart', ({ players }) => {
  currentPhase = 'battle';
  _showPhase('phase-battle');
  const me = players?.find(p => p.id === mobile.getMyPlayer()?.id);
  if (me) myRpm = me.rpm;
  _updateBattleRpm(myRpm);
  _startTiltSending();
});

mobile.onMessage('eliminated', ({ rank }) => {
  currentPhase = 'eliminated';
  _stopTiltSending();
  _showPhase('phase-eliminated');
  document.getElementById('eliminated-rank').textContent = `${rank}위 탈락`;
  mobile.vibrate([200, 100, 200, 100, 400]);
});

mobile.onMessage('gameOver', () => {
  _stopTiltSending();
  const isWinner = currentPhase !== 'eliminated';
  document.getElementById('result-icon').textContent = isWinner ? '🏆' : '💥';
  document.getElementById('result-title').textContent = isWinner
    ? '우승!'
    : document.getElementById('eliminated-rank').textContent;
  currentPhase = 'result';
  _showPhase('phase-result');
});

// ─── Permission flow ───────────────────────────────────────────────────────────

btnGrant.addEventListener('click', async () => {
  const granted = await mobile.requestSensors();
  if (granted) {
    permissionModal.classList.add('hidden');
    _initSensors();
  } else {
    alert('센서 권한이 필요합니다.');
  }
});

function _initSensors() {
  mobile.onOrientation(({ beta, gamma }) => {
    latestBeta = beta;
    latestGamma = gamma;
    levelIndicator.update(beta, gamma);
  });

  mobile.onMotion(({ shakeMagnitude }) => {
    latestShakeMag = shakeMagnitude;
  });
}

// ─── Launch phase ──────────────────────────────────────────────────────────────

function _startLaunchPhase() {
  let shakeEnergy = 0;
  let elapsed = 0;
  const DURATION = 5000;

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
      mobile.sendToHost('launchSpin', { rpm: finalRpm });
    }
  }, 100);
}

// ─── Tilt sending during battle ────────────────────────────────────────────────

function _startTiltSending() {
  tiltInterval = setInterval(() => {
    const tiltX = Math.max(-1, Math.min(1, latestGamma / 45));
    const tiltZ = Math.max(-1, Math.min(1, latestBeta / 45));
    mobile.sendToHost('tiltInput', { tiltX, tiltZ });
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

// ─── Ready button ──────────────────────────────────────────────────────────────

if (btnReady) {
  btnReady.addEventListener('click', () => {
    btnReady.disabled = true;
    btnReady.classList.add('hidden');
    readyStatus.classList.remove('hidden');
    mobile.ready();
  });
}

// ─── Result buttons ────────────────────────────────────────────────────────────

const btnAgain = document.getElementById('btn-again');
const btnQuit = document.getElementById('btn-quit');

if (btnAgain) {
  btnAgain.addEventListener('click', () => {
    mobile.sendToHost('requestReset', {});
  });
}

if (btnQuit) {
  btnQuit.addEventListener('click', () => {
    window.close();
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#fff;font-size:1.5rem;">탭을 닫아주세요</div>';
  });
}

// ─── Phase switcher ────────────────────────────────────────────────────────────

function _showPhase(activeId) {
  [phaseLobby, phaseLaunch, phaseBattle, phaseEliminated, phaseResult].forEach(el => {
    if (el) el.classList.toggle('hidden', el.id !== activeId);
  });
}
