import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';
import { LevelIndicator } from '../../../platform/client/shared/LevelIndicator.js';

class DiceMobileGame extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'dice-screen' });

    // Variables
    this.myColor = '#FFFFFF';
    this.isReady = false;
    this.lastUpdate = 0;
    this.lastThrowTime = 0;
    this.lastShakeHapticTime = 0;

    // Component bindings
    this.levelIndicator = new LevelIndicator({
      bubble: document.getElementById('level-bubble'),
      betaEl: document.getElementById('level-beta'),
      gammaEl: document.getElementById('level-gamma'),
    });

    this.initUI();
    this.initMessageHandlers();
  }

  initUI() {
    // Permission flow setup
    const btnGrant = document.getElementById('btn-grant-permission');
    const permissionModal = document.getElementById('permission-modal');
    if (btnGrant) {
      btnGrant.addEventListener('click', async () => {
        const granted = await this.requestSensors();
        if (permissionModal) permissionModal.classList.add('hidden');

        if (granted) {
          this.initSensors();
        } else {
          console.warn('Sensors denied. Using double-tap and buttons fallback.');
        }
      });
    }

    // Ready button handler
    const btnReady = document.getElementById('btn-ready');
    const inputNick = document.getElementById('input-nickname');
    if (btnReady) {
      btnReady.addEventListener('click', () => {
        let nick = '플레이어';
        if (inputNick && inputNick.value.trim() !== '') {
          nick = inputNick.value.trim();
        }
        
        // Save nickname and request state
        this.sendToHost('setNickname', { nickname: nick });
        this.sendToHost('setReady', {});
        this.ready();
        
        this.isReady = true;
        btnReady.disabled = true;

        const waitingDesc = document.getElementById('waiting-screen-desc');
        if (waitingDesc) {
          waitingDesc.textContent = '다른 플레이어들이 준비되기를 기다리는 중입니다...';
        }
        this.showScreen('waiting');
      });
    }

    // Manual controls in game screen
    const btnManualShake = document.getElementById('btn-manual-shake');
    const btnManualThrow = document.getElementById('btn-manual-throw');
    const visualDice = document.getElementById('visual-dice');

    if (btnManualShake) {
      btnManualShake.addEventListener('click', () => {
        if (visualDice && visualDice.classList.contains('throwing')) return;
        this.vibrate('light');
        this.animateShake();
      });
    }

    if (btnManualThrow) {
      btnManualThrow.addEventListener('click', () => {
        this.triggerThrow(1.0);
      });
    }

    // Double tap support on active game area
    const diceArea = document.getElementById('dice-area');
    if (diceArea) {
      let lastTap = 0;
      diceArea.addEventListener('touchstart', (e) => {
        const now = Date.now();
        const gap = now - lastTap;
        if (gap < 300 && gap > 0) {
          e.preventDefault();
          this.triggerThrow(1.2);
        }
        lastTap = now;
      });
      diceArea.addEventListener('dblclick', () => this.triggerThrow(1.2));
    }

    // Display session details
    const sessionDisplay = document.getElementById('session-display');
    if (sessionDisplay) {
      const sid = this.sdk.getSessionId();
      sessionDisplay.textContent = sid ? `Session: ${sid}` : 'No Session ID';
    }
  }

  initMessageHandlers() {
    this.onMessage('gameState', (state) => {
      this.handleStateUpdate(state);
    });

    this.onMessage('syncState', (state) => {
      this.handleStateUpdate(state);
    });

    this.onMessage('rollResult', ({ value }) => {
      console.log('[Dice] Received my individual roll result:', value);
    });
  }

  initSensors() {
    // Setup orientation updates locally only (avoid flooding network)
    this.onOrientation(({ beta, gamma }) => {
      this.levelIndicator.update(beta, gamma);
    });

    // Motion gestures
    this.onMotion(({ acc }) => {
      if (!acc) return;
      
      const magnitude = Math.max(Math.abs(acc.x), Math.abs(acc.y), Math.abs(acc.z));

      // Trigger swing throw on high force
      if (magnitude > 15) {
        // Map acceleration magnitude to throw strength scaling
        const strength = Math.min(2.5, Math.max(0.6, magnitude / 12.0));
        this.triggerThrow(strength);
      } 
      // Gentle shake visual effect and light haptic
      else if (magnitude > 3) {
        const visualDice = document.getElementById('visual-dice');
        if (visualDice && !visualDice.classList.contains('throwing')) {
          const now = Date.now();
          if (now - this.lastShakeHapticTime > 200) {
            this.lastShakeHapticTime = now;
            this.vibrate('light');
          }
          this.animateShake();
        }
      }
    });
  }

  animateShake() {
    const visualDice = document.getElementById('visual-dice');
    if (!visualDice) return;

    visualDice.style.transition = 'transform 0.05s ease';
    const rx = Math.random() * 40 - 20;
    const ry = Math.random() * 40 - 20;
    const rz = Math.random() * 20 - 10;
    visualDice.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(1.05)`;
    
    setTimeout(() => {
      if (visualDice && !visualDice.classList.contains('throwing')) {
        visualDice.style.transform = 'none';
        visualDice.style.transition = 'transform 0.1s ease-out';
      }
    }, 50);
  }

  triggerThrow(strength = 1.0) {
    const now = Date.now();
    if (now - this.lastThrowTime < 1000) return; // limit double triggers

    const visualDice = document.getElementById('visual-dice');
    if (visualDice && visualDice.classList.contains('throwing')) return;

    this.lastThrowTime = now;

    if (visualDice) {
      visualDice.classList.remove('throwing');
      void visualDice.offsetWidth; // trigger reflow
      visualDice.classList.add('throwing');
    }

    // Heavy haptic trigger
    this.vibrate([100, 50, 100]);

    // Send throw to host
    this.sendToHost('throwDice', { strength, color: this.myColor });

    // Transition immediately to thrown screen
    this.showScreen('thrown');
  }

  // ─── Lifecycle handlers ──────────────────────────────────────────────────

  onJoin(player) {
    console.log('[Dice] Room joined successfully:', player);
    this.myColor = player.color;
    
    const dot = document.getElementById('connection-status');
    if (dot) dot.classList.add('connected');

    const visualDice = document.getElementById('visual-dice');
    if (visualDice) {
      visualDice.style.filter = `drop-shadow(0 0 20px ${this.myColor})`;
    }

    this.showScreen('lobby');
  }

  onRejoin(player) {
    console.log('[Dice] Room rejoined after disconnect:', player);
    this.myColor = player.color;
    
    const dot = document.getElementById('connection-status');
    if (dot) dot.classList.add('connected');

    const visualDice = document.getElementById('visual-dice');
    if (visualDice) {
      visualDice.style.filter = `drop-shadow(0 0 20px ${this.myColor})`;
    }
  }

  onReset() {
    this.isReady = false;
    const btnReady = document.getElementById('btn-ready');
    if (btnReady) btnReady.disabled = false;
    
    const visualDice = document.getElementById('visual-dice');
    if (visualDice) {
      visualDice.classList.remove('throwing');
      visualDice.style.transform = 'none';
    }

    this.showScreen('lobby');
  }

  onHostDisconnect() {
    alert('호스트와의 연결이 끊어졌습니다. 로비로 이동합니다.');
    const dot = document.getElementById('connection-status');
    if (dot) dot.classList.remove('connected');
    window.location.href = '/';
  }

  // ─── State Sync handlers ─────────────────────────────────────────────────

  handleStateUpdate(state) {
    if (!state || !state.phase) return;

    console.log('[Dice] Received state update:', state);

    switch (state.phase) {
      case 'lobby':
        if (!this.isReady) {
          this.showScreen('lobby');
        } else {
          this.showScreen('waiting');
        }
        break;

      case 'roundIntro':
        const waitingTitle = document.getElementById('waiting-screen-title');
        const waitingDesc = document.getElementById('waiting-screen-desc');
        if (waitingTitle) waitingTitle.textContent = `ROUND ${state.round} 대기 중`;
        if (waitingDesc) waitingDesc.textContent = '게임 시작 연출이 진행 중입니다. TV 화면을 보세요!';
        this.showScreen('waiting');
        break;

      case 'waitingThrow':
        if (state.activePlayerId === this.playerId) {
          // My active turn
          this.vibrate('light');
          const visualDice = document.getElementById('visual-dice');
          if (visualDice) {
            visualDice.classList.remove('throwing');
            visualDice.style.transform = 'none';
          }
          this.showScreen('myTurn');
        } else {
          // Other player's turn
          const activeName = state.activePlayerName || '다른 플레이어';
          const title = document.getElementById('waiting-screen-title');
          const desc = document.getElementById('waiting-screen-desc');
          
          if (title) title.textContent = '대기 중';
          if (desc) desc.textContent = `${activeName}님이 주사위를 던지는 중입니다...`;
          
          this.showScreen('waiting');
        }
        break;

      case 'roundResult':
        const myThrow = state.throws ? state.throws.find(t => t.playerId === this.playerId) : null;
        const myVal = myThrow ? myThrow.value : '-';
        
        // Find round winner nickname
        let roundWinnerName = '없음';
        if (state.scores && state.throws && state.throws.length > 0) {
          let maxVal = -1;
          let winners = [];
          state.throws.forEach(t => {
            if (t.value > maxVal) {
              maxVal = t.value;
              winners = [t.playerId];
            } else if (t.value === maxVal) {
              winners.push(t.playerId);
            }
          });
          
          // Translate winning ids to names
          const scoreNames = state.scores.map(s => {
            // Find in global nicknames if possible (or fallback)
            const activeMatch = state.activePlayerId === s.playerId ? state.activePlayerName : null;
            return { id: s.playerId, name: activeMatch || `플레이어` };
          });
          
          // Format winning strings
          roundWinnerName = winners.map(wId => {
            if (wId === this.playerId) return '나';
            return '상대';
          }).join(', ');
        }

        const myValEl = document.getElementById('my-dice-value');
        const rWinnerEl = document.getElementById('round-winner-p');
        
        if (myValEl) myValEl.textContent = myVal;
        if (rWinnerEl) rWinnerEl.textContent = `라운드 우승: ${roundWinnerName}`;
        
        this.showScreen('roundResult');
        break;

      case 'matchResult':
        const myScoreObj = state.scores ? state.scores.find(s => s.playerId === this.playerId) : null;
        const myScore = myScoreObj ? myScoreObj.score : 0;
        
        const finalScoreEl = document.getElementById('my-final-score');
        const matchWinnerEl = document.getElementById('match-winner-p');

        if (finalScoreEl) finalScoreEl.textContent = `${myScore} 점`;
        if (matchWinnerEl) {
          if (state.allWinners && state.allWinners.length > 0) {
            matchWinnerEl.textContent = `최종 우승: ${state.allWinners.join(', ')}`;
          } else {
            matchWinnerEl.textContent = '최종 우승: -';
          }
        }

        this.showScreen('matchResult');
        break;
    }
  }
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
  const mobileSDK = new MobileSDK();
  window.game = new DiceMobileGame(mobileSDK);
});
