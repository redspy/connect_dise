import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { LevelIndicator } from '../../../platform/client/shared/LevelIndicator.js';

const mobile = new MobileSDK();

const sessionDisplay = document.getElementById('session-display');
const connectionStatus = document.getElementById('connection-status');
const permissionModal = document.getElementById('permission-modal');
const btnGrant = document.getElementById('btn-grant-permission');
const diceArea = document.getElementById('dice-area');
const visualDice = document.getElementById('visual-dice');
const instructionMain = document.getElementById('instruction-main');
const instructionSub = document.getElementById('instruction-sub');
const btnRetry = document.getElementById('btn-retry');

let myColor = '#FFFFFF';
let lastUpdate = 0;
let lastThrowTime = 0;

const levelIndicator = new LevelIndicator({
  bubble: document.getElementById('level-bubble'),
  betaEl: document.getElementById('level-beta'),
  gammaEl: document.getElementById('level-gamma'),
});

if (!mobile.getSessionId()) {
  sessionDisplay.textContent = 'No Session ID provided';
} else {
  sessionDisplay.textContent = `Session: ${mobile.getSessionId()}`;
}

// ─── SDK events ────────────────────────────────────────────────────────────────

mobile.on('join', (player) => {
  connectionStatus.classList.add('connected');
  myColor = player.color;
  visualDice.style.color = myColor;
  visualDice.style.textShadow = `0 10px 20px rgba(0,0,0,0.5), 0 0 30px ${myColor}, 0 0 60px ${myColor}`;
  instructionMain.style.color = myColor;
});

mobile.on('hostDisconnect', () => {
  alert('Host has disconnected. The game is over.');
  connectionStatus.classList.remove('connected');
});

// ─── Permission flow ───────────────────────────────────────────────────────────

btnGrant.addEventListener('click', async () => {
  const granted = await mobile.requestSensors();
  if (granted) {
    permissionModal.classList.add('hidden');
    initSensors();
  } else {
    alert('Permission denied. You cannot play without motion sensors.');
  }
});

function initSensors() {
  mobile.onOrientation(({ beta, gamma, alpha }) => {
    levelIndicator.update(beta, gamma);

    const now = Date.now();
    if (now - lastUpdate > 100) {
      lastUpdate = now;
      if (connectionStatus.classList.contains('connected')) {
        mobile.sendToHost('gyroData', { alpha, beta, gamma });
      }
    }
  });

  mobile.onMotion(({ acc }) => {
    if (acc) {
      // 강한 낚시대 스윙 액션 감지 (주로 Y 또는 Z축으로 큰 가속도)
      // 이전에는 흔들기(magnitude > 5) 감지였으나, 이제는 스윙(> 20) 감지 시 바로 던지기 수행
      const magnitude = Math.max(Math.abs(acc.x), Math.abs(acc.y), Math.abs(acc.z));
      
      if (magnitude > 30) {
        triggerThrow();
      } else if (magnitude > 5 && !visualDice.classList.contains('throwing')) {
        // 부드럽게 흔들리는 시각적 효과 유지
        visualDice.style.transition = 'transform 0.05s ease';
        visualDice.style.transform = `translate(${Math.random() * 40 - 20}px, ${Math.random() * 40 - 20}px) rotate(${Math.random() * 360}deg) scale(${1 + Math.random() * 0.2})`;
        setTimeout(() => {
          if (!visualDice.classList.contains('throwing')) {
            visualDice.style.transform = 'none';
            visualDice.style.transition = 'transform 0.1s ease-out';
          }
        }, 50);
      }
    }
  });
}

// ─── Throw ────────────────────────────────────────────────────────────────────

// 터치 이벤트 복구 (센서 오류 대비 더블탭 지원)
let lastTap = 0;
diceArea.addEventListener('touchstart', (e) => {
  const now = Date.now();
  const timesince = now - lastTap;
  if (timesince < 300 && timesince > 0) triggerThrow();
  lastTap = now;
});

diceArea.addEventListener('dblclick', () => triggerThrow());

function triggerThrow() {
  const now = Date.now();
  if (now - lastThrowTime < 500) return;
  if (visualDice.classList.contains('throwing')) return;

  lastThrowTime = now;

  visualDice.classList.remove('throwing');
  void visualDice.offsetWidth;
  visualDice.classList.add('throwing');

  if (instructionMain) instructionMain.classList.add('hidden');
  if (instructionSub) instructionSub.classList.add('hidden');

  setTimeout(() => {
    if (btnRetry) {
      btnRetry.classList.remove('hidden');
      setTimeout(() => btnRetry.classList.add('visible'), 50);
    }
  }, 500);

  mobile.vibrate([100, 50, 100]);
  mobile.sendToHost('throwDice', { strength: 1.0, color: myColor });
}

if (btnRetry) {
  btnRetry.addEventListener('click', () => {
    visualDice.classList.remove('throwing');
    btnRetry.classList.remove('visible');
    setTimeout(() => btnRetry.classList.add('hidden'), 300);
    if (instructionMain) instructionMain.classList.remove('hidden');
    if (instructionSub) instructionSub.classList.remove('hidden');
    
    // 호스트의 UI 다시 표시
    mobile.sendToHost('resetDice', {});
  });
}
