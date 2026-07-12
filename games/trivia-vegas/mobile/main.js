import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';
import { MobileSDK } from '../../../platform/client/MobileSDK.js';

export class TriviaVegasMobileGame extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'tv-screen' });

    this.myNickname = '';
    this.myBalance = 1000;
    this.currentNumpadString = '0';
    this.slotsData = [];
    this.selectedSlotIdx = -1;
    this.betAmount = 100;

    this._setupUIElements();
    this._bindEvents();
    this._wireMessages();
  }

  _setupUIElements() {
    this.connectionStatus = document.getElementById('connection-status');
    this.statusLabel = this.connectionStatus.querySelector('.status-label');
    this.joinForm = document.getElementById('join-form');
    this.nicknameInput = document.getElementById('nickname-input');
    this.joinErrorMsg = document.getElementById('join-error-msg');
    this.btnJoin = document.getElementById('btn-join');
    this.btnReady = document.getElementById('btn-ready');
    this.btnShowRulesLobby = document.getElementById('btn-show-rules-lobby');
    this.btnShowRulesPad = document.getElementById('btn-show-rules-pad');
    
    this.rulesModal = document.getElementById('rules-modal');
    this.closeRulesBtn = document.getElementById('close-rules-btn');
    this.closeRulesConfirm = document.getElementById('close-rules-confirm');

    this.lobbyStatusText = document.getElementById('lobby-status');
    this.hudRoundText = document.getElementById('hud-round-text');
    this.hudMoney = document.getElementById('hud-money');

    this.estimateSection = document.getElementById('estimate-section');
    this.displayNumpadVal = document.getElementById('display-numpad-val');
    this.btnSubmitEstimate = document.getElementById('btn-submit-estimate');

    this.bettingSection = document.getElementById('betting-section');
    this.slotsContainer = document.getElementById('betting-slots-container');
    this.selectedSlotText = document.getElementById('selected-slot-text');
    this.currentBetValue = document.getElementById('current-bet-value');
    this.btnBetMinus = document.getElementById('btn-bet-minus');
    this.btnBetPlus = document.getElementById('btn-bet-plus');
    this.btnBetMax = document.getElementById('btn-bet-max');
    this.btnConfirmBet = document.getElementById('btn-confirm-bet');

    this.waitingResultSection = document.getElementById('waiting-result-section');
    this.waitingStatusText = document.getElementById('waiting-status-text');

    this.resultTitle = document.getElementById('result-title');
    this.resultDesc = document.getElementById('result-desc');
  }

  _bindEvents() {
    // 룰 설명 보기 모달 제어
    const showModal = () => {
      this.rulesModal.classList.remove('hidden');
    };
    const hideModal = () => {
      this.rulesModal.classList.add('hidden');
    };
    
    if (this.btnShowRulesLobby) this.btnShowRulesLobby.onclick = showModal;
    if (this.btnShowRulesPad) this.btnShowRulesPad.onclick = showModal;
    if (this.closeRulesBtn) this.closeRulesBtn.onclick = hideModal;
    if (this.closeRulesConfirm) this.closeRulesConfirm.onclick = hideModal;

    // 닉네임 참가
    this.btnJoin.onclick = () => {
      const nickname = this.nicknameInput.value.trim();
      if (!nickname) {
        this.showInlineError(this.joinErrorMsg, '닉네임을 입력해주세요.');
        return;
      }
      this.myNickname = nickname;
      localStorage.setItem('vegas_nickname', this.myNickname);
      this.joinForm.classList.add('hidden');
      this.btnReady.classList.remove('hidden');
      this.sendToHost('setProfile', { nickname: this.myNickname });
    };

    // 준비 완료
    this.btnReady.onclick = () => {
      this.btnReady.disabled = true;
      this.btnReady.textContent = '준비완료 ✓';
      this.ready();
    };

    // 키패드 조작
    document.querySelectorAll('.num-btn').forEach(btn => {
      btn.onclick = () => {
        const key = btn.dataset.key;
        if (key === 'rules') return; // rules 버튼은 모달 창 띄우기용
        this.vibrate('light');

        if (key === 'back') {
          if (this.currentNumpadString.length > 1) {
            this.currentNumpadString = this.currentNumpadString.slice(0, -1);
          } else {
            this.currentNumpadString = '0';
          }
        } else {
          // 숫자 입력 (소수점은 HTML에서 제거됨)
          if (this.currentNumpadString === '0') {
            this.currentNumpadString = key;
          } else if (this.currentNumpadString.length < 9) {
            this.currentNumpadString += key;
          }
        }
        this.displayNumpadVal.textContent = this.currentNumpadString;
      };
    });

    // 추정 제출
    this.btnSubmitEstimate.onclick = () => {
      const num = parseInt(this.currentNumpadString);
      if (isNaN(num) || num < 0) {
        this.displayNumpadVal.style.color = '#ff3c3c';
        setTimeout(() => this.displayNumpadVal.style.color = '#fff', 1500);
        return;
      }
      this.vibrate('medium');
      this.sendToHost('submitEstimate', { value: num });
      this.estimateSection.classList.add('hidden');
      this.waitingResultSection.classList.remove('hidden');
      this.waitingStatusText.textContent = `제출 완료(${num}). 호스트의 답변 정렬을 대기하는 중...`;
    };

    // 베팅 조정
    this.btnBetMinus.onclick = () => {
      this.vibrate('light');
      if (this.betAmount > 100) {
        this.betAmount -= 100;
        this.currentBetValue.textContent = `$${this.betAmount}`;
      }
    };

    this.btnBetPlus.onclick = () => {
      this.vibrate('light');
      if (this.betAmount + 100 <= this.myBalance) {
        this.betAmount += 100;
        this.currentBetValue.textContent = `$${this.betAmount}`;
      }
    };

    this.btnBetMax.onclick = () => {
      this.vibrate('medium');
      this.betAmount = this.myBalance;
      this.currentBetValue.textContent = `$${this.betAmount}`;
    };

    this.btnConfirmBet.onclick = () => {
      if (this.selectedSlotIdx === -1) {
        this.showInlineError(null, '베팅할 슬롯 카드를 선택하세요!');
        return;
      }
      if (this.betAmount <= 0 || this.betAmount > this.myBalance) {
        this.showInlineError(null, '소지 한도 내에서 올바른 금액을 정하세요.');
        return;
      }

      this.vibrate('heavy');
      this.sendToHost('placeBet', { slotIndex: this.selectedSlotIdx, amount: this.betAmount });
      this.bettingSection.classList.add('hidden');
      this.waitingResultSection.classList.remove('hidden');
      this.waitingStatusText.textContent = `배팅 칩 투척 완료! ($${this.betAmount} 베팅됨)`;
    };
  }

  showInlineError(element, message) {
    if (element) {
      element.textContent = message;
      element.classList.remove('hidden');
      setTimeout(() => element.classList.add('hidden'), 2500);
    } else {
      const prevText = this.btnConfirmBet.textContent;
      this.btnConfirmBet.textContent = `⚠️ ${message}`;
      this.btnConfirmBet.style.background = '#ff3c3c';
      setTimeout(() => {
        this.btnConfirmBet.textContent = prevText;
        this.btnConfirmBet.style.background = '';
      }, 2000);
    }
  }

  renderSlots() {
    this.slotsContainer.innerHTML = this.slotsData.map((slot, idx) => {
      const isSelected = this.selectedSlotIdx === idx;
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

    document.querySelectorAll('.slot-item-card').forEach(card => {
      card.onclick = () => {
        this.vibrate('light');
        this.selectedSlotIdx = parseInt(card.dataset.index);
        const slot = this.slotsData[this.selectedSlotIdx];
        this.selectedSlotText.textContent = slot.isBanker ? '정답 이하 없음' : `${slot.value.toLocaleString()}`;
        this.betAmount = Math.min(this.myBalance, Math.max(100, this.betAmount));
        this.currentBetValue.textContent = `$${this.betAmount}`;
        this.renderSlots();
      };
    });
  }

  // ─── BaseGame Hooks ────────────────────────────────────────────────────────
  onJoin(player) {
    this.connectionStatus.classList.add('connected');
    this.statusLabel.textContent = '서버 연결 완료';

    const saved = localStorage.getItem('vegas_nickname');
    if (saved) {
      this.myNickname = saved;
      this.joinForm.classList.add('hidden');
      this.btnReady.classList.remove('hidden');
      this.sendToHost('setProfile', { nickname: this.myNickname });
    } else {
      this.joinForm.classList.remove('hidden');
      this.btnReady.classList.add('hidden');
    }
    this.showScreen('waiting');
  }

  onRejoin(player) {
    this.connectionStatus.classList.add('connected');
    this.statusLabel.textContent = '서버 재연결 완료';
    
    // 재연결 시 혹시 lobbyState가 필요하면 호스트에서 자동으로 emit해주므로, 
    // 여기선 단순히 join 상태 복구 흐름을 지원
    this.showScreen('game');
  }

  onReset() {
    if (this.btnReady) {
      this.btnReady.disabled = false;
      this.btnReady.textContent = '준비하기';
    }
    this.currentNumpadString = '0';
    this.selectedSlotIdx = -1;
    this.betAmount = 100;
    this.showScreen('waiting');
    this.lobbyStatusText.textContent = '세션이 리셋되었습니다. 대기 중...';
  }

  onHostDisconnect() {
    this.connectionStatus.classList.remove('connected');
    this.statusLabel.textContent = '연결 복구 중...';
  }

  _wireMessages() {
    this.onMessage('newQuestion', ({ round, question }) => {
      this.hudRoundText.textContent = `ROUND ${round}`;
      this.currentNumpadString = '0';
      this.displayNumpadVal.textContent = '0';

      this.estimateSection.classList.remove('hidden');
      this.bettingSection.classList.add('hidden');
      this.waitingResultSection.classList.add('hidden');

      this.showScreen('game');
    });

    this.onMessage('bettingStart', ({ slots, balance }) => {
      this.slotsData = slots;
      this.myBalance = balance;
      this.hudMoney.textContent = `$${this.myBalance.toLocaleString()}`;

      this.selectedSlotIdx = -1;
      this.selectedSlotText.textContent = '선택 안 함';
      this.betAmount = Math.min(this.myBalance, 100);
      this.currentBetValue.textContent = `$${this.betAmount}`;

      this.renderSlots();

      this.estimateSection.classList.add('hidden');
      this.bettingSection.classList.remove('hidden');
      this.waitingResultSection.classList.add('hidden');
    });

    this.onMessage('betUpdate', ({ balance, slotIndex, amount }) => {
      this.myBalance = balance;
      this.hudMoney.textContent = `$${this.myBalance.toLocaleString()}`;
    });

    this.onMessage('bettingTimeOut', () => {
      this.bettingSection.classList.add('hidden');
      this.waitingResultSection.classList.remove('hidden');
      this.waitingStatusText.textContent = '베팅이 종료되었습니다. 호스트 정산 대기 중...';
    });

    this.onMessage('roundResolved', ({ correctAnswer, winnerSlotIndex, payout, balance }) => {
      this.myBalance = balance;
      this.hudMoney.textContent = `$${this.myBalance.toLocaleString()}`;

      this.waitingResultSection.classList.remove('hidden');
      if (payout > 0) {
        this.waitingStatusText.textContent = `🎉 축하합니다! 정산 당첨금 $${payout.toLocaleString()}을 획득했습니다! (총 자산: $${this.myBalance.toLocaleString()})`;
        this.vibrate([100, 50, 100, 50, 200]);
      } else {
        this.waitingStatusText.textContent = `정답은 "${correctAnswer.toLocaleString()}" 이었습니다. 다음 퀴즈를 준비하세요. (총 자산: $${this.myBalance.toLocaleString()})`;
      }
    });

    this.onMessage('gameFinished', ({ ranking, winner }) => {
      const myPlayer = this.sdk.getMyPlayer();
      const myRankIdx = ranking.findIndex(r => r.id === myPlayer?.id);
      const myRank = myRankIdx !== -1 ? myRankIdx + 1 : null;
      const isWinner = myRank === 1;

      this.resultTitle.textContent = isWinner ? '🥇 우승 뱅커 등극!' : '매치 뱅커 결과';
      
      if (myRank) {
        this.resultDesc.textContent = `최종 자산 순위 #${myRank}위를 기록했습니다. (전체 우승자: ${winner})`;
      } else {
        this.resultDesc.textContent = `최종 매치 우승자: ${winner}`;
      }

      this.showScreen('result');
      
      if (isWinner) {
        this.vibrate([100, 50, 100, 50, 300]);
      } else {
        this.vibrate([200, 100, 200]);
      }
    });

    this.onMessage('rejoinState', ({ phase, roundPhase, round, question, balance, hasSubmitted, slots, winnerSlotIndex, correctAnswer }) => {
      if (phase === 'playing') {
        this.hudRoundText.textContent = `ROUND ${round}`;
        this.myBalance = balance;
        this.hudMoney.textContent = `$${this.myBalance.toLocaleString()}`;

        if (roundPhase === 'estimates') {
          if (hasSubmitted) {
            this.estimateSection.classList.add('hidden');
            this.waitingResultSection.classList.remove('hidden');
            this.waitingStatusText.textContent = '제출 완료. 호스트의 답변 정렬을 대기하는 중...';
          } else {
            this.estimateSection.classList.remove('hidden');
            this.waitingResultSection.classList.add('hidden');
          }
          this.bettingSection.classList.add('hidden');
        } else if (roundPhase === 'betting') {
          this.slotsData = slots;
          this.renderSlots();
          this.estimateSection.classList.add('hidden');
          this.bettingSection.classList.remove('hidden');
          this.waitingResultSection.classList.add('hidden');
        } else if (roundPhase === 'resolved') {
          this.estimateSection.classList.add('hidden');
          this.bettingSection.classList.add('hidden');
          this.waitingResultSection.classList.remove('hidden');
          this.waitingStatusText.textContent = `정답은 "${correctAnswer.toLocaleString()}" 이었습니다. (총 자산: $${this.myBalance.toLocaleString()})`;
        }
        this.showScreen('game');
      }
    });

    this.onMessage('lobbyState', ({ phase }) => {
      if (phase === 'lobby') {
        this.btnReady.disabled = false;
        this.btnReady.textContent = '준비하기';
        this.showScreen('waiting');
      }
    });
  }
}

// SDK 엔트리 초기화
const sdk = new MobileSDK();
new TriviaVegasMobileGame(sdk);
