import { MobileSDK } from '../../../platform/client/MobileSDK.js';

const mobile = new MobileSDK();

// UI Elements
const connectionStatus = document.getElementById('connection-status');
const statusLabel = connectionStatus.querySelector('.status-label');

const screens = {
  waiting: document.querySelector('[data-screen="waiting"]'),
  game: document.querySelector('[data-screen="game"]'),
  result: document.querySelector('[data-screen="result"]')
};

// Lobby
const joinForm = document.getElementById('join-form');
const nicknameInput = document.getElementById('nickname-input');
const btnJoin = document.getElementById('btn-join');
const btnReady = document.getElementById('btn-ready');
const lobbyStatusText = document.getElementById('lobby-status');

// Instruction Box
const instructionText = document.getElementById('instruction-text');
const instructionTimer = document.getElementById('instruction-timer');

// Controls
const sliderLever = document.getElementById('slider-lever');
const switchA = document.getElementById('switch-a');
const switchB = document.getElementById('switch-b');
const btnAction = document.getElementById('btn-action');

// HUD
const hudHealthFill = document.getElementById('hud-health-fill');
const hudDistanceFill = document.getElementById('hud-distance-fill');

let myNickname = '';
let activeInstruction = null; // { cmdId, timeLeft, duration, intervalId }

// ─── Screen Transitions ────────────────────────────────────────────────────

function showScreen(name) {
  Object.keys(screens).forEach(key => {
    screens[key].classList.toggle('hidden', key !== name);
  });
}

// ─── Connection Events ─────────────────────────────────────────────────────

mobile.on('connect', () => {
  connectionStatus.classList.add('connected');
  statusLabel.textContent = '서버 연결 완료';
  
  // 프로필 자동 연동
  const saved = localStorage.getItem('panic_nickname');
  if (saved) {
    myNickname = saved;
    joinForm.classList.add('hidden');
    btnReady.classList.remove('hidden');
    mobile.sendToHost('setProfile', { nickname: myNickname });
  } else {
    joinForm.classList.remove('hidden');
    btnReady.classList.add('hidden');
  }
});

mobile.on('disconnect', () => {
  connectionStatus.classList.remove('connected');
  statusLabel.textContent = '연결 복구 중...';
});

mobile.on('reset', () => {
  if (btnReady) {
    btnReady.disabled = false;
    btnReady.textContent = '준비하기';
  }
  _clearActiveInstruction();
  showScreen('waiting');
  lobbyStatusText.textContent = '세션이 리셋되었습니다. 대기 중...';
});

// ─── Lobby Event Listeners ─────────────────────────────────────────────────

btnJoin.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    alert('닉네임을 입력해주세요.');
    return;
  }
  myNickname = nickname;
  localStorage.setItem('panic_nickname', myNickname);
  
  joinForm.classList.add('hidden');
  btnReady.classList.remove('hidden');

  mobile.sendToHost('setProfile', { nickname: myNickname });
});

btnReady.addEventListener('click', () => {
  btnReady.disabled = true;
  btnReady.textContent = '준비완료 ✓';
  mobile.ready();
});

// ─── Control Interactions & Vibrations ──────────────────────────────────────

sliderLever.addEventListener('input', function() {
  const val = Number(this.value);
  mobile.vibrate('light');
  mobile.sendToHost('controlAction', { key: 'lever', value: val });
});

switchA.addEventListener('change', function() {
  mobile.vibrate('light');
  mobile.sendToHost('controlAction', { key: 'switchA', value: this.checked });
});

switchB.addEventListener('change', function() {
  mobile.vibrate('light');
  mobile.sendToHost('controlAction', { key: 'switchB', value: this.checked });
});

btnAction.addEventListener('click', () => {
  mobile.vibrate('medium');
  mobile.sendToHost('controlAction', { key: 'btnAction', value: 'click' });
  
  // 버튼 액션 스케일 이펙트
  btnAction.style.transform = 'scale(0.95)';
  setTimeout(() => btnAction.style.transform = 'none', 100);
});

// ─── Game Message Listeners ────────────────────────────────────────────────

mobile.onMessage('roleAssign', ({ widgets }) => {
  // 위젯 레이블 다이나믹 적용
  if (widgets) {
    if (widgets.lever) document.getElementById('label-lever').textContent = widgets.lever.name;
    if (widgets.switchA) document.getElementById('label-switch-a').textContent = widgets.switchA.name;
    if (widgets.switchB) document.getElementById('label-switch-b').textContent = widgets.switchB.name;
    if (widgets.btnAction) document.getElementById('label-btn-action').textContent = widgets.btnAction.name;
  }

  // 기본 계기판 값 리셋
  sliderLever.value = 0;
  switchA.checked = false;
  switchB.checked = false;

  showScreen('game');
});

mobile.onMessage('newInstruction', ({ cmdId, text, duration, elapsed = 0 }) => {
  _clearActiveInstruction();

  instructionText.textContent = text;
  instructionTimer.style.width = '100%';

  const timeLeft = duration - elapsed;
  activeInstruction = {
    cmdId,
    duration,
    timeLeft,
    intervalId: setInterval(() => {
      activeInstruction.timeLeft -= 0.1;
      const pct = Math.max(0, (activeInstruction.timeLeft / activeInstruction.duration) * 100);
      instructionTimer.style.width = `${pct}%`;
      
      if (activeInstruction.timeLeft <= 0) {
        _clearActiveInstruction();
      }
    }, 100)
  };
});

mobile.onMessage('resolveInstruction', ({ cmdId, success, failed }) => {
  if (activeInstruction && activeInstruction.cmdId === cmdId) {
    _clearActiveInstruction();
  }

  if (success) {
    mobile.vibrate('light');
  } else if (failed) {
    mobile.vibrate('double');
  }
});

mobile.onMessage('statusSync', ({ hullHealth, distance, goalDistance }) => {
  if (hudHealthFill) hudHealthFill.style.width = `${hullHealth}%`;
  
  if (hudDistanceFill) {
    const pct = Math.min(100, (distance / goalDistance) * 100);
    hudDistanceFill.style.width = `${pct}%`;
  }
});

mobile.onMessage('gameFinished', ({ success, message }) => {
  _clearActiveInstruction();
  
  document.getElementById('result-icon').textContent = success ? '🏆' : '💀';
  document.getElementById('result-title').textContent = success ? '임무 성공!' : '선체 완파...';
  document.getElementById('result-desc').textContent = message;

  showScreen('result');
  
  if (success) {
    mobile.vibrate([100, 50, 100, 50, 300]);
  } else {
    mobile.vibrate([200, 100, 200, 100, 400]);
  }
});

// Helper
function _clearActiveInstruction() {
  if (activeInstruction) {
    clearInterval(activeInstruction.intervalId);
    activeInstruction = null;
  }
  instructionText.textContent = '대기 중...';
  instructionTimer.style.width = '0%';
}
