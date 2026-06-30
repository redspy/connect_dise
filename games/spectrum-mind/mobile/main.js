import { MobileSDK } from '../../../platform/client/MobileSDK.js';

const mobile = new MobileSDK();
const BOARD_SIZE = 13;

const connectionStatus = document.getElementById('connection-status');
const roleBadge = document.getElementById('role-badge');
const lobbyStatusText = document.getElementById('lobby-status');

// Clue elements
const inputClue = document.getElementById('input-clue');
const btnSubmitClue = document.getElementById('btn-submit-clue');
const giverConceptLeft = document.getElementById('giver-concept-left');
const giverConceptRight = document.getElementById('giver-concept-right');

// Guesser elements
const guesserClueTitle = document.getElementById('guesser-clue-title');
const guesserConceptLeft = document.getElementById('guesser-concept-left');
const guesserConceptRight = document.getElementById('guesser-concept-right');
const touchWheel = document.getElementById('touch-wheel');
const dialAngleDisplay = document.getElementById('dial-angle-display');
const dialControlNotice = document.getElementById('dial-control-notice');
const btnSubmitGuess = document.getElementById('btn-submit-guess');
const dialSlider = document.getElementById('dial-slider');
const btnReady = document.getElementById('btn-ready');

if (btnReady) {
  btnReady.addEventListener('click', () => {
    btnReady.disabled = true;
    btnReady.textContent = '준비완료 ✓';
    mobile.ready();
  });
}

let myRole = null; // 'giver' or 'guesser'
let myColor = null;
let isActiveGuesser = false;
let currentAngle = 90;
let lastVibratedAngle = 90;

// ─── Screen Transition ─────────────────────────────────────────────────────

function showScreen(name) {
  document.querySelectorAll('.sm-screen').forEach(el => {
    el.classList.toggle('hidden', el.dataset.screen !== name);
  });
}

// ─── SDK Handlers ──────────────────────────────────────────────────────────

mobile.on('join', () => {
  connectionStatus.classList.add('connected');
  showScreen('waiting');
  lobbyStatusText.textContent = '방에 입장했습니다. 대기 중...';
});

mobile.on('rejoin', () => {
  connectionStatus.classList.add('connected');
});

mobile.on('reset', () => {
  myRole = null;
  isActiveGuesser = false;
  roleBadge.className = 'sm-role-badge hidden';
  roleBadge.textContent = '대기 중';

  if (btnReady) {
    btnReady.disabled = false;
    btnReady.textContent = '준비하기';
  }

  showScreen('waiting');
  lobbyStatusText.textContent = '세션이 리셋되었습니다. 대기 중...';
});

mobile.on('hostDisconnect', () => {
  connectionStatus.classList.remove('connected');
  alert('호스트와 연결이 끊어졌습니다.');
});

// ─── Game Message Listeners ────────────────────────────────────────────────

mobile.onMessage('roleAssign', ({ role, targetAngle, concept, giverNickname, round }) => {
  myRole = role;

  roleBadge.classList.remove('hidden');
  roleBadge.className = `sm-role-badge ${role}`;
  roleBadge.textContent = role === 'giver' ? `출제자 (R${round})` : `추측자 (R${round})`;

  if (role === 'giver') {
    giverConceptLeft.textContent = concept.left;
    giverConceptRight.textContent = concept.right;
    inputClue.value = '';
    
    // 미니 타겟 그리기
    _renderMiniGauge(targetAngle);
    showScreen('giver-clue');
  } else {
    document.getElementById('guesser-wait-giver-name').textContent = giverNickname || '출제자';
    showScreen('guesser-wait');
  }
});

mobile.onMessage('clueSubmitted', ({ clue }) => {
  if (myRole !== 'guesser') return;

  guesserClueTitle.textContent = `제시어: "${clue}"`;
  guesserConceptLeft.textContent = giverConceptLeft.textContent;
  guesserConceptRight.textContent = giverConceptRight.textContent;

  // 턴 판별
  // 주석: roleAssign 단계에서 activeGuesserId가 설정되어 배분됩니다.
  isActiveGuesser = true; // 기본적으로 추측 참여 허용

  // 다이얼 기본값 세팅
  currentAngle = 90;
  _updateWheelRotation(90);

  showScreen('guesser-play');
});

mobile.onMessage('guessResolved', ({ targetAngle, guessAngle, points }) => {
  document.getElementById('val-target-angle').textContent = `${Math.round(targetAngle)}°`;
  document.getElementById('val-guess-angle').textContent = `${Math.round(guessAngle)}°`;
  document.getElementById('reveal-score-title').textContent = points > 0 ? `+${points}점 획득!` : '0점...';
  document.getElementById('reveal-score-icon').textContent = points > 0 ? '🎯' : '💨';

  showScreen('reveal');

  if (points >= 3) {
    mobile.vibrate([100, 50, 100, 50, 200]);
  } else if (points > 0) {
    mobile.vibrate('medium');
  } else {
    mobile.vibrate('light');
  }
});

// ─── Clue Submission ───────────────────────────────────────────────────────

btnSubmitClue.addEventListener('click', () => {
  const clue = inputClue.value.trim();
  if (!clue) {
    alert('힌트 제시어를 입력해 주세요.');
    return;
  }
  mobile.vibrate('medium');
  mobile.sendToHost('submitClue', { clue });
});

// ─── Mini Gauge Render (SVG) ───────────────────────────────────────────────

function _renderMiniGauge(targetAngle) {
  document.getElementById('target-angle-label').textContent = `목표: ${targetAngle}°`;

  const rad = (Math.PI * (180 - targetAngle)) / 180;
  const needle = document.getElementById('svg-target-needle');
  if (needle) {
    needle.setAttribute('x2', (100 + Math.cos(rad) * 75).toString());
    needle.setAttribute('y2', (100 - Math.sin(rad) * 75).toString());
  }

  // Wedges: 4점(8도), 3점(24도), 2점(40도)
  _drawSvgArc('svg-wedge-2', targetAngle, 40, 80);
  _drawSvgArc('svg-wedge-3', targetAngle, 24, 80);
  _drawSvgArc('svg-wedge-4', targetAngle, 8, 80);
}

function _drawSvgArc(id, centerAngle, width, radius) {
  const el = document.getElementById(id);
  if (!el) return;

  const startAngle = Math.max(0, Math.min(180, centerAngle - width / 2));
  const endAngle = Math.max(0, Math.min(180, centerAngle + width / 2));

  const rStart = (Math.PI * (180 - startAngle)) / 180;
  const rEnd = (Math.PI * (180 - endAngle)) / 180;

  const x1 = 100 + Math.cos(rStart) * radius;
  const y1 = 100 - Math.sin(rStart) * radius;
  const x2 = 100 + Math.cos(rEnd) * radius;
  const y2 = 100 - Math.sin(rEnd) * radius;

  el.setAttribute('d', `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`);
}

// ─── Wheel Touch/Drag Logic ────────────────────────────────────────────────

if (touchWheel) {
  let isDragging = false;

  const handlePointerDown = () => {
    isDragging = true;
    btnSubmitGuess.disabled = false;
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;

    const rect = touchWheel.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const pointerX = e.clientX || (e.touches && e.touches[0]?.clientX);
    const pointerY = e.clientY || (e.touches && e.touches[0]?.clientY);

    if (pointerX === undefined || pointerY === undefined) return;

    const dx = pointerX - cx;
    const dy = pointerY - cy;

    // polar angle relative to horizontal right
    const rad = Math.atan2(-dy, dx); // negative because screen y goes down
    let deg = (rad * 180) / Math.PI;

    // Convert from [-180, 180] to [0, 180] (left is 0, straight up is 90, right is 180)
    // atan2 right is 0, up is 90, left is 180
    // So 180 - deg fits perfectly!
    let targetTheta = 180 - deg;
    targetTheta = Math.max(0, Math.min(180, targetTheta));

    _updateWheelRotation(targetTheta);
  };

  const handlePointerUp = () => {
    isDragging = false;
  };

  touchWheel.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);

  touchWheel.addEventListener('touchstart', handlePointerDown, { passive: true });
  window.addEventListener('touchmove', handlePointerMove, { passive: true });
  window.addEventListener('touchend', handlePointerUp, { passive: true });
}

function _updateWheelRotation(theta) {
  currentAngle = theta;
  dialAngleDisplay.textContent = `${Math.round(theta)}°`;

  if (dialSlider) {
    dialSlider.value = Math.round(theta);
  }

  // needle points straight up when theta = 90
  // so needle rotation is theta - 90 deg
  touchWheel.style.transform = `rotate(${theta - 90}deg)`;

  // 10도 단위 햅틱 진동 피드백
  if (Math.abs(theta - lastVibratedAngle) >= 10) {
    mobile.vibrate('light');
    lastVibratedAngle = Math.round(theta / 10) * 10;
  }

  // 실시간 다이얼 각도 호스트 싱크 전송
  mobile.sendToHost('rotateDial', { angle: theta });
}

if (dialSlider) {
  dialSlider.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    btnSubmitGuess.disabled = false;
    _updateWheelRotation(val);
  });
}

// ─── 추측 제출 ─────────────────────────────────────────────────────────────

btnSubmitGuess.addEventListener('click', () => {
  mobile.vibrate('heavy');
  mobile.sendToHost('submitGuess');
  btnSubmitGuess.disabled = true;
});
