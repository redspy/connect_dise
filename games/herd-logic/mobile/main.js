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
const hudRoundMini = document.getElementById('hud-round-mini');
const pinkCowNotice = document.getElementById('pink-cow-notice');
const displayQuestion = document.getElementById('display-question');

// Input/Sections
const submitSection = document.getElementById('submit-section');
const answerInput = document.getElementById('answer-input');
const btnSubmitAnswer = document.getElementById('btn-submit-answer');

const waitingSubmissionSection = document.getElementById('waiting-submission-section');
const submittedAnswerText = document.getElementById('submitted-answer-text');

const roundResultSection = document.getElementById('round-result-section');
const roundResultAlert = document.getElementById('round-result-alert');
const resultIconMini = document.getElementById('result-icon-mini');
const resultTextMini = document.getElementById('result-text-mini');

// Result Screen
const resultIcon = document.getElementById('result-icon');
const resultTitle = document.getElementById('result-title');
const resultDesc = document.getElementById('result-desc');

let myNickname = '';
let isReady = false;

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

  const saved = localStorage.getItem('herd_nickname');
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
  isReady = false;
  if (btnReady) {
    btnReady.disabled = false;
    btnReady.textContent = '준비하기';
  }
  answerInput.value = '';
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
  localStorage.setItem('herd_nickname', myNickname);

  joinForm.classList.add('hidden');
  btnReady.classList.remove('hidden');

  mobile.sendToHost('setProfile', { nickname: myNickname });
});

btnReady.addEventListener('click', () => {
  isReady = true;
  btnReady.disabled = true;
  btnReady.textContent = '준비완료 ✓';
  mobile.ready();
});

// ─── Game Input Interactions ────────────────────────────────────────────────

btnSubmitAnswer.addEventListener('click', () => {
  const ans = answerInput.value.trim();
  if (!ans) {
    alert('답변을 입력해주세요.');
    return;
  }

  mobile.vibrate('light');
  mobile.sendToHost('submitAnswer', { answer: ans });

  // 화면 전환 (제출 완료 대기)
  submitSection.classList.add('hidden');
  waitingSubmissionSection.classList.remove('hidden');
  submittedAnswerText.textContent = ans;
});

// ─── Game Message Listeners ────────────────────────────────────────────────

mobile.onMessage('newQuestion', ({ round, question, pinkCowPlayer }) => {
  // HUD 갱신
  hudRoundMini.textContent = `ROUND ${round}`;
  displayQuestion.textContent = question;

  // 핑크 카우 알림 감지
  const hasCow = pinkCowPlayer && pinkCowPlayer === myNickname;
  pinkCowNotice.classList.toggle('hidden', !hasCow);

  // 인풋 초기화
  answerInput.value = '';
  submitSection.classList.remove('hidden');
  waitingSubmissionSection.classList.add('hidden');
  roundResultSection.classList.add('hidden');

  showScreen('game');
});

mobile.onMessage('resolveAnswer', ({ match, pinkCow, rawAnswer }) => {
  waitingSubmissionSection.classList.add('hidden');
  roundResultSection.classList.remove('hidden');

  if (match) {
    roundResultAlert.className = 'success-alert';
    resultIconMini.textContent = '👍';
    resultTextMini.textContent = `다수파와 의견이 통했습니다! (+1점) 제출한 답: "${rawAnswer}"`;
    mobile.vibrate('light');
  } else {
    if (pinkCow) {
      roundResultAlert.className = 'success-alert fail';
      resultIconMini.textContent = '🐄⚠️';
      resultTextMini.textContent = `너무 튀는 답변으로 핑크 카우를 받았습니다! 점수가 차단됩니다! 제출한 답: "${rawAnswer}"`;
      mobile.vibrate('double');
    } else {
      roundResultAlert.className = 'success-alert fail';
      resultIconMini.textContent = '❌';
      resultTextMini.textContent = `다수파와 매칭에 실패했습니다. (0점) 제출한 답: "${rawAnswer}"`;
      mobile.vibrate('medium');
    }
  }
});

mobile.onMessage('gameFinished', ({ ranking, winner }) => {
  const myRankIdx = ranking.findIndex(r => r.id === mobile.socket.id);
  const myRank = myRankIdx !== -1 ? myRankIdx + 1 : null;
  const isWinner = myRank === 1;

  resultIcon.textContent = isWinner ? '🏆' : '🐄';
  resultTitle.textContent = isWinner ? '우승을 차지했습니다!' : '최종 순위 발표';
  
  if (myRank) {
    resultDesc.textContent = `당신의 최종 순위는 #${myRank}위 입니다. (전체 우승자: ${winner})`;
  } else {
    resultDesc.textContent = `최종 우승자: ${winner}`;
  }

  showScreen('result');

  if (isWinner) {
    mobile.vibrate([100, 50, 100, 50, 300]);
  } else {
    mobile.vibrate([200, 100, 200]);
  }
});

mobile.onMessage('rejoinState', ({ phase, round, question, hasSubmitted, pinkCowPlayer }) => {
  if (phase === 'playing') {
    hudRoundMini.textContent = `ROUND ${round}`;
    displayQuestion.textContent = question;

    const hasCow = pinkCowPlayer && pinkCowPlayer === myNickname;
    pinkCowNotice.classList.toggle('hidden', !hasCow);

    if (hasSubmitted) {
      submitSection.classList.add('hidden');
      waitingSubmissionSection.classList.remove('hidden');
      submittedAnswerText.textContent = '(제출 완료 - 복구됨)';
    } else {
      submitSection.classList.remove('hidden');
      waitingSubmissionSection.classList.add('hidden');
    }
    roundResultSection.classList.add('hidden');
    showScreen('game');
  }
});

mobile.onMessage('lobbyState', ({ phase }) => {
  if (phase === 'lobby') {
    isReady = false;
    btnReady.disabled = false;
    btnReady.textContent = '준비하기';
    showScreen('waiting');
  }
});
