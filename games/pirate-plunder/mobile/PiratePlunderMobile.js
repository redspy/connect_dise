import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';

export class PiratePlunderMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'game-screen' });

    // Current round information
    this.role = null; // 'pirate' | 'lookout'
    this.partnerId = null;
    this.partnerName = null;
    this.partnerColor = null;
    this.currentGold = 0;
    this.currentRound = 1;

    // Slider state
    this.sliderIsUnlocked = false;

    this._wireMessages();
    this._initUIEvents();
    this._initSlider();
  }

  // ─── MobileBaseGame Lifecycle hooks ───────────────────────────────────────

  onJoin(player) {
    this.showScreen('setup-profile');
    
    // Fill saved nickname if exists
    const savedNick = localStorage.getItem('pp_nickname');
    if (savedNick) {
      document.getElementById('input-nickname').value = savedNick;
    }
  }

  onRejoin(player) {
    this.showScreen('waiting');
    document.getElementById('waiting-title').textContent = '연결 복구 중...';
    document.getElementById('waiting-desc').textContent = '기존 게임 정보를 호스트로부터 복구하고 있습니다.';
  }

  onReset() {
    this.role = null;
    this.partnerId = null;
    this.partnerName = null;
    this.partnerColor = null;
    this.currentGold = 0;
    this.currentRound = 1;
    this.sliderIsUnlocked = false;

    const nickname = document.getElementById('input-nickname').value.trim();
    if (nickname) {
      this.showScreen('waiting');
      document.getElementById('waiting-title').textContent = '대기 중...';
      document.getElementById('waiting-desc').textContent = '호스트가 새 게임을 시작하기를 기다리고 있습니다.';
    } else {
      this.showScreen('setup-profile');
    }
  }

  // ─── UI Interactions ──────────────────────────────────────────────────────

  _initUIEvents() {
    // Join button
    const btnJoin = document.getElementById('btn-join');
    if (btnJoin) {
      btnJoin.onclick = () => {
        const nicknameEl = document.getElementById('input-nickname');
        const nickname = nicknameEl.value.trim();

        if (!nickname) {
          alert('해적 이름을 입력해 주세요!');
          return;
        }

        localStorage.setItem('pp_nickname', nickname);
        this.sendToHost('setProfile', { nickname });
        this.ready();

        this.showScreen('waiting');
        document.getElementById('waiting-title').textContent = '입장 완료!';
        document.getElementById('waiting-desc').textContent = '다른 해적들이 준비되면 호스트가 게임을 시작합니다.';
        this.vibrate(50);
      };
    }

    // Split button
    const btnSplit = document.getElementById('btn-split');
    if (btnSplit) {
      btnSplit.onclick = () => {
        if (this.role !== 'pirate') return;
        this._submitDecision('split');
        this.vibrate(50);
      };
    }

    // Steal button
    const btnSteal = document.getElementById('btn-steal');
    if (btnSteal) {
      btnSteal.onclick = () => {
        if (this.role !== 'pirate') return;
        if (!this.sliderIsUnlocked) return;
        this._submitDecision('steal');
        this.vibrate([100, 50, 100]);
      };
    }
  }

  // ─── Swipe Slider for Steal ───────────────────────────────────────────────

  _initSlider() {
    const track = document.getElementById('steal-slider-track');
    const handle = document.getElementById('steal-slider-handle');

    if (!track || !handle) return;

    let startX = 0;
    let isDragging = false;
    let maxDrag = 0;
    let currentDelta = 0;

    const onStart = (e) => {
      if (this.sliderIsUnlocked) return;
      isDragging = true;
      startX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
      maxDrag = track.clientWidth - handle.clientWidth - 4; // 4px padding/border guard
      handle.style.transition = 'none';
    };

    const onMove = (e) => {
      if (!isDragging) return;
      const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
      let deltaX = clientX - startX;

      // Constrain inside bounds
      if (deltaX < 0) deltaX = 0;
      if (deltaX > maxDrag) deltaX = maxDrag;

      currentDelta = deltaX;
      handle.style.transform = `translateX(${deltaX}px)`;
    };

    const onEnd = () => {
      if (!isDragging) return;
      isDragging = false;

      // Trigger unlock if slid to 90% or more
      if (currentDelta >= maxDrag * 0.88) {
        this._unlockSteal();
      } else {
        // Bounce back
        handle.style.transition = 'transform 0.2s ease';
        handle.style.transform = 'translateX(0px)';
        currentDelta = 0;
      }
    };

    // Touch events
    handle.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);

    // Mouse events (for desktop test simulators)
    handle.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  }

  _unlockSteal() {
    this.sliderIsUnlocked = true;
    
    const track = document.getElementById('steal-slider-track');
    const btnSteal = document.getElementById('btn-steal');
    const sliderText = track?.querySelector('.pp-slider-text');

    if (track) track.classList.add('unlocked');
    if (sliderText) sliderText.textContent = '훔치기 잠금 해제됨! ☠️';
    if (btnSteal) {
      btnSteal.classList.remove('disabled');
      btnSteal.disabled = false;
    }

    // Heavy unlock vibration
    this.vibrate([80, 40, 80]);
  }

  _resetSlider() {
    this.sliderIsUnlocked = false;

    const track = document.getElementById('steal-slider-track');
    const handle = document.getElementById('steal-slider-handle');
    const btnSteal = document.getElementById('btn-steal');
    const sliderText = track?.querySelector('.pp-slider-text');

    if (track) track.classList.remove('unlocked');
    if (handle) {
      handle.style.transition = 'none';
      handle.style.transform = 'translateX(0px)';
    }
    if (sliderText) sliderText.textContent = '오른쪽으로 슬라이드하여 훔치기 잠금 해제';
    if (btnSteal) {
      btnSteal.classList.add('disabled');
      btnSteal.disabled = true;
    }
  }

  _submitDecision(decision) {
    this.sendToHost('submitDecision', { decision });
    this.showScreen('waiting');
    document.getElementById('waiting-title').textContent = '제출 완료!';
    document.getElementById('waiting-desc').textContent = `${decision === 'split' ? '나누기 🤝' : '훔치기 🏴‍☠️'} 선택을 보냈습니다. 파트너의 선택을 대기 중입니다.`;
  }

  // ─── Socket Message Handlers ──────────────────────────────────────────────

  _wireMessages() {
    // 1. Round Start Info
    this.onMessage('roundStart', (data) => {
      this.role = data.role;
      this.currentRound = data.round;
      this.currentGold = data.gold;
      this.partnerId = data.partnerId;
      this.partnerName = data.partnerName;
      this.partnerColor = data.partnerColor;

      // Update UI elements
      document.getElementById('reveal-round-num').textContent = data.round;
      document.getElementById('reveal-current-gold').textContent = data.gold;
      document.getElementById('neg-round-num').textContent = data.round;
      document.getElementById('neg-current-gold').textContent = data.gold;

      const roleEmoji = document.getElementById('role-emoji');
      const roleTitle = document.getElementById('role-title');
      const roleDesc = document.getElementById('role-desc');
      const partnerBox = document.getElementById('partner-info-box');
      const roleCard = document.getElementById('role-card-display');

      if (data.role === 'lookout') {
        if (roleEmoji) roleEmoji.textContent = '👁️';
        if (roleTitle) roleTitle.textContent = '망보기 (Lookout)';
        if (roleDesc) roleDesc.textContent = '이번 라운드는 다른 해적들이 보물을 나눌 동안 안전한 배의 망을 지키며 감시합니다. 평화 수당으로 무조건 20 금화를 얻습니다.';
        if (partnerBox) partnerBox.classList.add('hidden');
        if (roleCard) {
          roleCard.style.borderColor = 'rgba(251, 191, 36, 0.3)';
          roleCard.style.background = 'linear-gradient(to bottom, rgba(251, 191, 36, 0.05), rgba(0,0,0,0.3))';
        }
      } else {
        if (roleEmoji) roleEmoji.textContent = '🏴‍☠️';
        if (roleTitle) roleTitle.textContent = '해적 (Pirate)';
        if (roleDesc) roleDesc.textContent = '선술집에서 전리품 상자를 정산합니다. 보물을 반씩 나눌지(Split), 상대방을 배신하고 훔칠지(Steal) 결정하세요!';
        if (partnerBox) {
          partnerBox.classList.remove('hidden');
          const pName = document.getElementById('partner-name-text');
          const pColor = document.getElementById('partner-color-dot');
          if (pName) pName.textContent = data.partnerName;
          if (pColor) pColor.style.backgroundColor = data.partnerColor;
        }
        if (roleCard) {
          roleCard.style.borderColor = 'rgba(255, 255, 255, 0.05)';
          roleCard.style.background = 'rgba(0, 0, 0, 0.3)';
        }
      }

      this.showScreen('role-reveal');
    });

    // 2. Phase transition broadcast
    this.onMessage('phaseChange', (data) => {
      if (data.phase === 'negotiation') {
        if (this.role === 'lookout') {
          this.showScreen('waiting');
          document.getElementById('waiting-title').textContent = '협상 감시 중...';
          document.getElementById('waiting-desc').textContent = '다른 해적들이 보물을 두고 협상하고 있습니다. 망을 보며 기다리세요.';
        } else {
          // Reset slider for negotiation phase
          this._resetSlider();

          // Update partner name and color in Negotiation screen
          const negPName = document.getElementById('neg-partner-name');
          const negPColor = document.getElementById('neg-partner-color');
          if (negPName) negPName.textContent = this.partnerName;
          if (negPColor) negPColor.style.backgroundColor = this.partnerColor;

          this.showScreen('negotiation');
        }
      } else if (data.phase === 'result') {
        this.showScreen('waiting');
        document.getElementById('waiting-title').textContent = '게임 종료 👑';
        document.getElementById('waiting-desc').textContent = 'TV 화면에서 최종 순위와 해적왕을 확인하세요!';
      }
    });

    // 3. Result Reveal
    this.onMessage('revealResult', (data) => {
      this.currentGold = data.gold;
      
      const emojiEl = document.getElementById('result-emoji');
      const titleEl = document.getElementById('result-status-title');
      const descEl = document.getElementById('result-summary-text');
      
      const myChoiceEl = document.getElementById('result-my-choice');
      const myPayoutEl = document.getElementById('result-my-payout');
      
      const partnerItemEl = document.getElementById('result-partner-item');
      const partnerChoiceEl = document.getElementById('result-partner-choice');
      const partnerPayoutEl = document.getElementById('result-partner-payout');
      
      const totalGoldEl = document.getElementById('result-total-gold');
      if (totalGoldEl) totalGoldEl.textContent = data.gold;

      if (this.role === 'lookout') {
        if (emojiEl) emojiEl.textContent = '👁️';
        if (titleEl) titleEl.textContent = '망보기 완료!';
        if (myChoiceEl) {
          myChoiceEl.textContent = '망보기 👁️';
          myChoiceEl.className = 'pp-choice-badge split';
        }
        if (myPayoutEl) myPayoutEl.textContent = '+20 🪙';
        if (partnerItemEl) partnerItemEl.classList.add('hidden');
        if (descEl) descEl.textContent = '해적들이 싸우는 동안 안전한 거리에서 20 금화를 평화 수수료로 수령했습니다.';
        
        // Lookout vibration
        this.vibrate(80);
      } else {
        if (partnerItemEl) partnerItemEl.classList.remove('hidden');

        // Render choices
        if (myChoiceEl) {
          myChoiceEl.textContent = data.ownDecision === 'split' ? '나누기 🤝' : '훔치기 🏴‍☠️';
          myChoiceEl.className = `pp-choice-badge ${data.ownDecision}`;
        }
        if (myPayoutEl) myPayoutEl.textContent = `+${data.payout} 🪙`;

        if (partnerChoiceEl) {
          partnerChoiceEl.textContent = data.partnerDecision === 'split' ? '나누기 🤝' : '훔치기 🏴‍☠️';
          partnerChoiceEl.className = `pp-choice-badge ${data.partnerDecision}`;
        }
        if (partnerPayoutEl) partnerPayoutEl.textContent = `+${data.partnerPayout} 🪙`;

        // Scenarios
        if (data.ownDecision === 'split' && data.partnerDecision === 'split') {
          if (emojiEl) emojiEl.textContent = '🤝';
          if (titleEl) titleEl.textContent = '공동 분배!';
          if (descEl) descEl.textContent = '서로 약속을 지켜 의리를 증명했습니다! 전리품을 사이좋게 50 금화씩 나눴습니다.';
          this.vibrate([100, 100, 100]);
        } else if (data.ownDecision === 'split' && data.partnerDecision === 'steal') {
          if (emojiEl) emojiEl.textContent = '😢';
          if (titleEl) titleEl.textContent = '약탈당했습니다!';
          if (descEl) descEl.textContent = '의리를 지키려 했으나 파트너가 배신하여 전리품을 몽땅 훔쳐갔습니다!';
          this.vibrate(600); // Crash shock vibration
        } else if (data.ownDecision === 'steal' && data.partnerDecision === 'split') {
          if (emojiEl) emojiEl.textContent = '👑';
          if (titleEl) titleEl.textContent = '약탈 성공!';
          if (descEl) descEl.textContent = '파트너를 영리하게 속이고 전리품 상자의 100 금화를 독차지했습니다!';
          this.vibrate([100, 80, 200, 80, 300]); // Success jackpot vibration
        } else if (data.ownDecision === 'steal' && data.partnerDecision === 'steal') {
          if (emojiEl) emojiEl.textContent = '💥';
          if (titleEl) titleEl.textContent = '상자가 깨졌습니다!';
          if (descEl) descEl.textContent = '서로 훔치겠다고 욕심을 부려 상자가 파손되었습니다. 결국 둘 다 아무것도 얻지 못했습니다!';
          this.vibrate([400, 200, 400]); // Heavy crash clash vibration
        }
      }

      this.showScreen('reveal');
    });

    // 4. Rejoin State restoration
    this.onMessage('rejoinState', (data) => {
      this.role = data.role;
      this.currentRound = data.round;
      this.currentGold = data.gold;
      this.partnerId = data.partnerId;
      this.partnerName = data.partnerName;
      this.partnerColor = data.partnerColor;

      // Update basic texts
      document.getElementById('reveal-round-num').textContent = data.round;
      document.getElementById('reveal-current-gold').textContent = data.gold;
      document.getElementById('neg-round-num').textContent = data.round;
      document.getElementById('neg-current-gold').textContent = data.gold;

      if (data.phase === 'setup') {
        // Re-trigger round start layout
        this.showScreen('role-reveal');
      } else if (data.phase === 'negotiation') {
        if (this.role === 'lookout') {
          this.showScreen('waiting');
          document.getElementById('waiting-title').textContent = '협상 감시 중...';
          document.getElementById('waiting-desc').textContent = '다른 해적들이 보물을 두고 협상하고 있습니다. 망을 보며 기다리세요.';
        } else {
          if (data.hasSubmitted) {
            this.showScreen('waiting');
            document.getElementById('waiting-title').textContent = '제출 완료!';
            document.getElementById('waiting-desc').textContent = `${data.decision === 'split' ? '나누기 🤝' : '훔치기 🏴‍☠️'} 선택을 보냈습니다. 파트너의 선택을 대기 중입니다.`;
          } else {
            this._resetSlider();
            const negPName = document.getElementById('neg-partner-name');
            const negPColor = document.getElementById('neg-partner-color');
            if (negPName) negPName.textContent = this.partnerName;
            if (negPColor) negPColor.style.backgroundColor = this.partnerColor;
            this.showScreen('negotiation');
          }
        }
      } else if (data.phase === 'reveal') {
        // If data includes final results for reveal
        if (data.ownDecision !== undefined) {
          const emojiEl = document.getElementById('result-emoji');
          const titleEl = document.getElementById('result-status-title');
          const descEl = document.getElementById('result-summary-text');
          
          const myChoiceEl = document.getElementById('result-my-choice');
          const myPayoutEl = document.getElementById('result-my-payout');
          
          const partnerItemEl = document.getElementById('result-partner-item');
          const partnerChoiceEl = document.getElementById('result-partner-choice');
          const partnerPayoutEl = document.getElementById('result-partner-payout');
          
          const totalGoldEl = document.getElementById('result-total-gold');
          if (totalGoldEl) totalGoldEl.textContent = data.gold;

          if (this.role === 'lookout') {
            if (emojiEl) emojiEl.textContent = '👁️';
            if (titleEl) titleEl.textContent = '망보기 완료!';
            if (myChoiceEl) {
              myChoiceEl.textContent = '망보기 👁️';
              myChoiceEl.className = 'pp-choice-badge split';
            }
            if (myPayoutEl) myPayoutEl.textContent = '+20 🪙';
            if (partnerItemEl) partnerItemEl.classList.add('hidden');
            if (descEl) descEl.textContent = '해적들이 싸우는 동안 안전한 거리에서 20 금화를 평화 수수료로 수령했습니다.';
          } else {
            if (partnerItemEl) partnerItemEl.classList.remove('hidden');

            if (myChoiceEl) {
              myChoiceEl.textContent = data.ownDecision === 'split' ? '나누기 🤝' : '훔치기 🏴‍☠️';
              myChoiceEl.className = `pp-choice-badge ${data.ownDecision}`;
            }
            if (myPayoutEl) myPayoutEl.textContent = `+${data.payout} 🪙`;

            if (partnerChoiceEl) {
              partnerChoiceEl.textContent = data.partnerDecision === 'split' ? '나누기 🤝' : '훔치기 🏴‍☠️';
              partnerChoiceEl.className = `pp-choice-badge ${data.partnerDecision}`;
            }
            if (partnerPayoutEl) {
              // Partner payout calculation in client state if not provided
              let partnerPay = 0;
              if (data.ownDecision === 'split' && data.partnerDecision === 'split') partnerPay = 50;
              else if (data.ownDecision === 'steal' && data.partnerDecision === 'split') partnerPay = 0;
              else if (data.ownDecision === 'split' && data.partnerDecision === 'steal') partnerPay = 100;
              partnerPayoutEl.textContent = `+${partnerPay} 🪙`;
            }

            if (data.ownDecision === 'split' && data.partnerDecision === 'split') {
              if (emojiEl) emojiEl.textContent = '🤝';
              if (titleEl) titleEl.textContent = '공동 분배!';
              if (descEl) descEl.textContent = '서로 약속을 지켜 의리를 증명했습니다! 전리품을 사이좋게 50 금화씩 나눴습니다.';
            } else if (data.ownDecision === 'split' && data.partnerDecision === 'steal') {
              if (emojiEl) emojiEl.textContent = '😢';
              if (titleEl) titleEl.textContent = '약탈당했습니다!';
              if (descEl) descEl.textContent = '의리를 지키려 했으나 파트너가 배신하여 전리품을 몽땅 훔쳐갔습니다!';
            } else if (data.ownDecision === 'steal' && data.partnerDecision === 'split') {
              if (emojiEl) emojiEl.textContent = '👑';
              if (titleEl) titleEl.textContent = '약탈 성공!';
              if (descEl) descEl.textContent = '파트너를 영리하게 속이고 전리품 상자의 100 금화를 독차지했습니다!';
            } else if (data.ownDecision === 'steal' && data.partnerDecision === 'steal') {
              if (emojiEl) emojiEl.textContent = '💥';
              if (titleEl) titleEl.textContent = '상자가 깨졌습니다!';
              if (descEl) descEl.textContent = '서로 훔치겠다고 욕심을 부려 상자가 파손되었습니다. 결국 둘 다 아무것도 얻지 못했습니다!';
            }
          }
          this.showScreen('reveal');
        } else {
          this.showScreen('waiting');
          document.getElementById('waiting-title').textContent = '정산 대기 중...';
          document.getElementById('waiting-desc').textContent = '라운드가 종료되어 결과를 계산하고 있습니다.';
        }
      } else if (data.phase === 'result') {
        this.showScreen('waiting');
        document.getElementById('waiting-title').textContent = '게임 종료 👑';
        document.getElementById('waiting-desc').textContent = 'TV 화면에서 최종 순위와 해적왕을 확인하세요!';
      }
    });

    // 5. Lobby State restoration on Rejoin
    this.onMessage('lobbyState', (data) => {
      if (!data.hasName) {
        this.showScreen('setup-profile');
      } else {
        this.showScreen('waiting');
        document.getElementById('waiting-title').textContent = '준비 완료!';
        document.getElementById('waiting-desc').textContent = '다른 플레이어들이 다 모이면 방장이 게임을 시작합니다.';
      }
    });
  }
}
