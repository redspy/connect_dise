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

// HUD
const hudDistText = document.getElementById('hud-dist-text');
const hudHullText = document.getElementById('hud-hull-text');

// Role Panels
const alphaPanel = document.getElementById('alpha-panel');
const betaPanel = document.getElementById('beta-panel');
const gammaPanel = document.getElementById('gamma-panel');
const alphaGrid = document.querySelector('.alpha-grid-container');
const betaScans = document.getElementById('beta-scans');
const destabilizedAlert = document.getElementById('destabilized-alert');

// Result Screen
const resultHeadline = document.getElementById('result-headline');
const resultSummary = document.getElementById('result-summary');
const resultIcon = document.getElementById('result-icon');

let myNickname = '';
let myRoles = [];
let upcomingData = [];

// ─── Screen Transition ─────────────────────────────────────────────────────

function showScreen(name) {
  Object.keys(screens).forEach(key => {
    screens[key].classList.toggle('hidden', key !== name);
  });
}

// ─── Connection Events ─────────────────────────────────────────────────────

mobile.on('connect', () => {
  connectionStatus.classList.add('connected');
  statusLabel.textContent = '연결 완료';

  const saved = localStorage.getItem('weaver_nickname');
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
  statusLabel.textContent = '연결 유실 복구 중...';
});

mobile.on('reset', () => {
  if (btnReady) {
    btnReady.disabled = false;
    btnReady.textContent = '준비하기';
  }
  myRoles = [];
  upcomingData = [];
  showScreen('waiting');
  lobbyStatusText.textContent = '세션이 리셋되었습니다. 대기 중...';
});

// ─── Lobby Event Listeners ─────────────────────────────────────────────────

btnJoin.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    alert('닉네임을 입력하세요.');
    return;
  }
  myNickname = nickname;
  localStorage.setItem('weaver_nickname', myNickname);

  joinForm.classList.add('hidden');
  btnReady.classList.remove('hidden');

  mobile.sendToHost('setProfile', { nickname: myNickname });
});

btnReady.addEventListener('click', () => {
  btnReady.disabled = true;
  btnReady.textContent = '준비완료 ✓';
  mobile.ready();
});

// 조작 반응용 바운스 이펙트 헬퍼
function applyTactileBounce(element) {
  element.classList.add('tactile-bounce');
  element.addEventListener('animationend', () => {
    element.classList.remove('tactile-bounce');
  }, { once: true });
}

// 🔑 차원 감마: 삼색 레이저 게이트 버튼 바인딩
document.querySelectorAll('.gate-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color;
    applyTactileBounce(btn);
    mobile.vibrate('medium');
    mobile.sendToHost('unlockGate', { color });
  });
});

// ─── 렌더링 헬퍼 ─────────────────────────────────────────────────────────────

function renderAlphaGrid() {
  if (!alphaGrid || upcomingData.length === 0) return;

  alphaGrid.innerHTML = '';
  // 5행(r) x 5열(c) 그리드 생성
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const colData = upcomingData[c];
      if (!colData) continue;

      const isSolid = colData.floor[r] === 1;
      const cell = document.createElement('div');
      cell.className = `alpha-cell ${isSolid ? 'solid-cell' : 'hole-cell'}`;
      cell.textContent = `${colData.x},${r + 1}`;

      if (!isSolid) {
        cell.addEventListener('click', () => {
          applyTactileBounce(cell);
          mobile.vibrate('light');
          // 호스트에 다리 놓기 전송
          mobile.sendToHost('buildPath', { x: colData.x, row: r });
          
          // 낙관적 UI 업데이트 (지터 방지용 즉각 반응)
          cell.className = 'alpha-cell solid-cell';
        });
      }

      alphaGrid.appendChild(cell);
    }
  }
}

function renderBetaScans() {
  if (!betaScans) return;

  betaScans.innerHTML = '';
  let foundSpikes = 0;

  upcomingData.forEach(colData => {
    if (colData.challenge === 'spike' && colData.challengeActive) {
      foundSpikes++;
      const btn = document.createElement('button');
      btn.className = 'trap-item-btn';
      btn.textContent = `⚠️ 가시 소멸 (위치: ${colData.x}m / 행: ${colData.challengeRow + 1})`;
      
      btn.addEventListener('click', () => {
        applyTactileBounce(btn);
        mobile.vibrate('medium');
        // 가시 장애물 제거 전송
        mobile.sendToHost('disableTrap', { x: colData.x });
        setTimeout(() => btn.remove(), 150); // 바운스 완료 후 돔에서 제거
      });

      betaScans.appendChild(btn);
    }
  });

  if (foundSpikes === 0) {
    betaScans.innerHTML = '<p style="color: #8b9bb4; font-size: 0.85rem;">안전 구역 (감지된 가시 없음)</p>';
  }
}

// ─── Game Message Listeners ────────────────────────────────────────────────

mobile.onMessage('assignRole', ({ roles, distance, hull }) => {
  myRoles = roles;
  
  // HUD 초기화
  if (distance !== undefined) hudDistText.textContent = `${distance} / 100m`;
  if (hull !== undefined) hudHullText.textContent = `HULL: ${hull}%`;

  // 역할 패널 전환
  alphaPanel.classList.toggle('hidden', !roles.includes('alpha'));
  betaPanel.classList.toggle('hidden', !roles.includes('beta'));
  gammaPanel.classList.toggle('hidden', !roles.includes('gamma'));

  showScreen('game');
});

mobile.onMessage('mapTick', ({ distance, hull, upcoming }) => {
  hudDistText.textContent = `${distance} / 100m`;
  hudHullText.textContent = `HULL: ${hull}%`;

  destabilizedAlert.classList.add('hidden'); // 정상 상태

  // 선체 피해 경고 연출 (30% 이하인 경우 카드 붉은 점멸)
  const isCritical = hull <= 30;
  document.querySelectorAll('.card-bg').forEach(card => {
    card.classList.toggle('critical-hull-alert', isCritical);
  });

  upcomingData = upcoming;

  if (myRoles.includes('alpha')) {
    renderAlphaGrid();
  }
  if (myRoles.includes('beta')) {
    renderBetaScans();
  }
});

mobile.onMessage('damageAlert', ({ hull, cause }) => {
  hudHullText.textContent = `HULL: ${hull}%`;
  mobile.vibrate('heavy'); // 타격 시 선체 강한 피격 햅틱
});

mobile.onMessage('gameFinished', ({ win, distance }) => {
  if (win) {
    resultHeadline.textContent = '🏆 시공간 돌파 성공!';
    resultHeadline.style.color = 'var(--neon-cyan)';
    resultSummary.textContent = '차원 궤도를 무사히 완주해 탈출했습니다!';
    resultIcon.textContent = '🏆';
    mobile.vibrate([100, 50, 100, 50, 300]);
  } else {
    resultHeadline.textContent = '💥 선체 파괴 패배';
    resultHeadline.style.color = '#ef4444';
    resultSummary.textContent = `선체가 파손되었습니다. (이동 거리: ${distance}m)`;
    resultIcon.textContent = '💥';
    mobile.vibrate([200, 100, 200]);
  }

  showScreen('result');
});

// 재접속 프리징 방지 가드
mobile.onMessage('lobbyState', ({ phase }) => {
  if (phase === 'lobby') {
    btnReady.disabled = false;
    btnReady.textContent = '준비하기';
    showScreen('waiting');
  }
});
