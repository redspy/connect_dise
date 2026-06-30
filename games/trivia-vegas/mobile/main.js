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
const hudRoundText = document.getElementById('hud-round-text');
const hudMoney = document.getElementById('hud-money');

// Estimate numpad
const estimateSection = document.getElementById('estimate-section');
const displayNumpadVal = document.getElementById('display-numpad-val');
const btnSubmitEstimate = document.getElementById('btn-submit-estimate');

// Betting Panel
const bettingSection = document.getElementById('betting-section');
const slotsContainer = document.getElementById('betting-slots-container');
const selectedSlotText = document.getElementById('selected-slot-text');
const currentBetValue = document.getElementById('current-bet-value');
const btnBetMinus = document.getElementById('btn-bet-minus');
const btnBetPlus = document.getElementById('btn-bet-plus');
const btnBetMax = document.getElementById('btn-bet-max');
const btnConfirmBet = document.getElementById('btn-confirm-bet');

// Waiting status
const waitingResultSection = document.getElementById('waiting-result-section');
const waitingStatusText = document.getElementById('waiting-status-text');

// Results
const resultTitle = document.getElementById('result-title');
const resultDesc = document.getElementById('result-desc');

let myNickname = '';
let myBalance = 1000;
let currentNumpadString = '0';

// Betting state
let slotsData = [];
let selectedSlotIdx = -1;
let betAmount = 100;

// ─── Screen Transition ─────────────────────────────────────────────────────

function showScreen(name) {
  Object.keys(screens).forEach(key => {
    screens[key].classList.toggle('hidden', key !== name);
  });
}

// ─── Connection Events ─────────────────────────────────────────────────────

mobile.on('connect', () => {
  connectionStatus.classList.add('connected');
  statusLabel.textContent = '서버 연결 완료';

  const saved = localStorage.getItem('vegas_nickname');
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
  currentNumpadString = '0';
  selectedSlotIdx = -1;
  betAmount = 100;
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
  localStorage.setItem('vegas_nickname', myNickname);

  joinForm.classList.add('hidden');
  btnReady.classList.remove('hidden');

  mobile.sendToHost('setProfile', { nickname: myNickname });
});

btnReady.addEventListener('click', () => {
  btnReady.disabled = true;
  btnReady.textContent = '준비완료 ✓';
  mobile.ready();
});

// ─── Numpad Logic ──────────────────────────────────────────────────────────

document.querySelectorAll('.num-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    mobile.vibrate('light');

    if (key === 'back') {
      if (currentNumpadString.length > 1) {
        currentNumpadString = currentNumpadString.slice(0, -1);
      } else {
        currentNumpadString = '0';
      }
    } else if (key === '.') {
      if (!currentNumpadString.includes('.')) {
        currentNumpadString += '.';
      }
    } else {
      // 숫자 입력
      if (currentNumpadString === '0') {
        currentNumpadString = key;
      } else if (currentNumpadString.length < 9) {
        currentNumpadString += key;
      }
    }

    displayNumpadVal.textContent = currentNumpadString;
  });
});

btnSubmitEstimate.addEventListener('click', () => {
  const num = parseFloat(currentNumpadString);
  if (isNaN(num)) {
    alert('올바른 값을 입력해주세요.');
    return;
  }

  mobile.vibrate('medium');
  mobile.sendToHost('submitEstimate', { value: num });

  // 대기 상태로 전환
  estimateSection.classList.add('hidden');
  waitingResultSection.classList.remove('hidden');
  waitingStatusText.textContent = `제출 완료($${num}). 호스트의 답변 정렬을 대기하는 중...`;
});

// ─── Betting Logic ─────────────────────────────────────────────────────────

function renderSlots() {
  slotsContainer.innerHTML = slotsData.map((slot, idx) => {
    const isSelected = selectedSlotIdx === idx;
    const isBanker = slot.isBanker;
    const valueText = isBanker ? '정답 이하 없음' : slot.value.toLocaleString();
    const ownerText = isBanker ? 'Banker' : slot.creatorNicknames.join(', ');

    return `
      <div class="slot-item-card ${isSelected ? 'selected-card' : ''}" data-index="${idx}">
        <div>
          <span class="slot-mult">${slot.multiplier}:1</span>
          <span class="slot-owner" style="margin-left: 6px;">by ${ownerText}</span>
        </div>
        <div class="slot-val">${valueText}</div>
      </div>
    `;
  }).join('');

  // 클릭 이벤트 바인딩
  document.querySelectorAll('.slot-item-card').forEach(card => {
    card.addEventListener('click', () => {
      mobile.vibrate('light');
      selectedSlotIdx = parseInt(card.dataset.index);
      
      const slot = slotsData[selectedSlotIdx];
      selectedSlotText.textContent = slot.isBanker ? '정답 이하 없음' : `$${slot.value.toLocaleString()}`;
      
      // 베팅 금액 조정 클램프
      betAmount = Math.min(myBalance, Math.max(100, betAmount));
      currentBetValue.textContent = `$${betAmount}`;

      renderSlots();
    });
  });
}

btnBetMinus.addEventListener('click', () => {
  mobile.vibrate('light');
  if (betAmount > 100) {
    betAmount -= 100;
    currentBetValue.textContent = `$${betAmount}`;
  }
});

btnBetPlus.addEventListener('click', () => {
  mobile.vibrate('light');
  if (betAmount + 100 <= myBalance) {
    betAmount += 100;
    currentBetValue.textContent = `$${betAmount}`;
  }
});

btnBetMax.addEventListener('click', () => {
  mobile.vibrate('medium');
  betAmount = myBalance;
  currentBetValue.textContent = `$${betAmount}`;
});

btnConfirmBet.addEventListener('click', () => {
  if (selectedSlotIdx === -1) {
    alert('베팅할 슬롯 카드를 먼저 선택해주세요.');
    return;
  }
  if (betAmount <= 0 || betAmount > myBalance) {
    alert('소지 한도 내에서 올바른 금액을 정하세요.');
    return;
  }

  mobile.vibrate('heavy');
  mobile.sendToHost('placeBet', { slotIndex: selectedSlotIdx, amount: betAmount });

  // 베팅 대기 전환
  bettingSection.classList.add('hidden');
  waitingResultSection.classList.remove('hidden');
  waitingStatusText.textContent = `배팅 칩 투척 완료! ($${betAmount} 베팅됨)`;
});

// ─── Game Message Listeners ────────────────────────────────────────────────

mobile.onMessage('newQuestion', ({ round, question }) => {
  hudRoundText.textContent = `ROUND ${round}`;
  currentNumpadString = '0';
  displayNumpadVal.textContent = '0';

  estimateSection.classList.remove('hidden');
  bettingSection.classList.add('hidden');
  waitingResultSection.classList.add('hidden');

  showScreen('game');
});

mobile.onMessage('bettingStart', ({ slots, balance }) => {
  slotsData = slots;
  myBalance = balance;
  hudMoney.textContent = `$${myBalance.toLocaleString()}`;

  // 초기 상태
  selectedSlotIdx = -1;
  selectedSlotText.textContent = '선택 안 함';
  betAmount = Math.min(myBalance, 100);
  currentBetValue.textContent = `$${betAmount}`;

  renderSlots();

  estimateSection.classList.add('hidden');
  bettingSection.classList.remove('hidden');
  waitingResultSection.classList.add('hidden');
});

mobile.onMessage('betUpdate', ({ balance, slotIndex, amount }) => {
  myBalance = balance;
  hudMoney.textContent = `$${myBalance.toLocaleString()}`;
});

mobile.onMessage('bettingTimeOut', () => {
  bettingSection.classList.add('hidden');
  waitingResultSection.classList.remove('hidden');
  waitingStatusText.textContent = '베팅이 종료되었습니다. 호스트 정산 대기 중...';
});

mobile.onMessage('roundResolved', ({ correctAnswer, winnerSlotIndex, payout, balance }) => {
  myBalance = balance;
  hudMoney.textContent = `$${myBalance.toLocaleString()}`;

  waitingResultSection.classList.remove('hidden');
  if (payout > 0) {
    waitingStatusText.textContent = `🎉 축하합니다! 정산 당첨금 $${payout.toLocaleString()}을 획득했습니다! (총 자산: $${myBalance.toLocaleString()})`;
    mobile.vibrate([100, 50, 100, 50, 200]);
  } else {
    waitingStatusText.textContent = `정답은 "${correctAnswer.toLocaleString()}" 이었습니다. 다음 퀴즈를 준비하세요. (총 자산: $${myBalance.toLocaleString()})`;
  }
});

mobile.onMessage('gameFinished', ({ ranking, winner }) => {
  const myRankIdx = ranking.findIndex(r => r.id === mobile.socket.id);
  const myRank = myRankIdx !== -1 ? myRankIdx + 1 : null;
  const isWinner = myRank === 1;

  resultTitle.textContent = isWinner ? '🥇 우승 뱅커 등극!' : '매치 뱅커 결과';
  
  if (myRank) {
    resultDesc.textContent = `최종 자산 순위 #${myRank}위를 기록했습니다. (전체 우승자: ${winner})`;
  } else {
    resultDesc.textContent = `최종 매치 우승자: ${winner}`;
  }

  showScreen('result');
  
  if (isWinner) {
    mobile.vibrate([100, 50, 100, 50, 300]);
  } else {
    mobile.vibrate([200, 100, 200]);
  }
});

mobile.onMessage('rejoinState', ({ phase, roundPhase, round, question, balance, hasSubmitted, slots, winnerSlotIndex, correctAnswer }) => {
  if (phase === 'playing') {
    hudRoundText.textContent = `ROUND ${round}`;
    myBalance = balance;
    hudMoney.textContent = `$${myBalance.toLocaleString()}`;

    if (roundPhase === 'estimates') {
      if (hasSubmitted) {
        estimateSection.classList.add('hidden');
        waitingResultSection.classList.remove('hidden');
        waitingStatusText.textContent = '제출 완료. 호스트의 답변 정렬을 대기하는 중...';
      } else {
        estimateSection.classList.remove('hidden');
        waitingResultSection.classList.add('hidden');
      }
      bettingSection.classList.add('hidden');
    } else if (roundPhase === 'betting') {
      slotsData = slots;
      renderSlots();
      estimateSection.classList.add('hidden');
      bettingSection.classList.remove('hidden');
      waitingResultSection.classList.add('hidden');
    } else if (roundPhase === 'resolved') {
      estimateSection.classList.add('hidden');
      bettingSection.classList.add('hidden');
      waitingResultSection.classList.remove('hidden');
      waitingStatusText.textContent = `정답은 "${correctAnswer.toLocaleString()}" 이었습니다. (총 자산: $${myBalance.toLocaleString()})`;
    }
    showScreen('game');
  }
});

mobile.onMessage('lobbyState', ({ phase }) => {
  if (phase === 'lobby') {
    btnReady.disabled = false;
    btnReady.textContent = '준비하기';
    showScreen('waiting');
  }
});
