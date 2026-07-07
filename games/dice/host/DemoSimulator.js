export class DemoSimulator {
  constructor(game) {
    this.game = game;
    this.host = game.sdk;
    this.isDemo = false;
    this.timers = [];
    this.bots = [
      { id: 'bot_amy', name: '🤖 에이미', color: '#FF4444' },
      { id: 'bot_bob', name: '🤖 밥', color: '#33B5E5' },
      { id: 'bot_charles', name: '🤖 찰스', color: '#AA66CC' }
    ];
    this.botThrowInterval = null;
    this.isTearingDown = false;
  }

  addTimer(timerId) {
    this.timers.push(timerId);
  }

  clearTimers() {
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
    if (this.botThrowInterval) {
      clearInterval(this.botThrowInterval);
      this.botThrowInterval = null;
    }
  }

  startDemo() {
    if (this.isDemo) return;
    this.isDemo = true;
    this.isTearingDown = false;
    console.log('[Dice Demo] Attract mode started.');

    // Show floating demo stop banner
    this.showDemoBanner();

    // Blur QR code containers to visually show demo state
    this.toggleQRBlur(true);

    // Sequence 1: Bot login sequence
    let delay = 500;
    this.bots.forEach((bot, idx) => {
      const t = setTimeout(() => {
        if (!this.isDemo) return;
        
        // Push virtual bots to HostSDK structures
        this.host._players.set(bot.id, { id: bot.id, color: bot.color });
        this.game.setPlayerName(bot.id, bot.name);
        
        // Dispatch SDK playerJoin event
        this.host.dispatchEvent(new CustomEvent('playerJoin', {
          detail: { id: bot.id, color: bot.color }
        }));

        // Send ready update ticks
        const readyT = setTimeout(() => {
          if (!this.isDemo) return;
          this.host.dispatchEvent(new CustomEvent('readyUpdate', {
            detail: { readyCount: idx + 1, total: this.bots.length }
          }));
        }, 300);
        this.addTimer(readyT);

      }, delay);
      
      this.addTimer(t);
      delay += 800;
    });

    // Sequence 2: Start Game trigger
    const startT = setTimeout(() => {
      if (!this.isDemo) return;
      this.host.dispatchEvent(new CustomEvent('allReady', { detail: {} }));
      this.runGameLoopMonitor();
    }, delay + 600);
    this.addTimer(startT);
  }

  runGameLoopMonitor() {
    // Monitor game turn and auto throw for bots
    this.botThrowInterval = setInterval(() => {
      if (!this.isDemo || this.game.phase !== 'waitingThrow') return;
      if (this.game.isRolling) return;

      const activeId = this.game.turnOrder[this.game.currentTurnIdx];
      if (activeId && activeId.startsWith('bot_')) {
        const bot = this.bots.find(b => b.id === activeId);
        if (bot) {
          console.log(`[Dice Demo] Bot ${bot.name} is thinking...`);
          // Mark as rolling so no double throws occur
          this.game.isRolling = true;
          
          const throwT = setTimeout(() => {
            if (!this.isDemo || this.game.phase !== 'waitingThrow') {
              this.game.isRolling = false;
              return;
            }
            // Reset rolling flag so handleThrow isn't locked by game validation
            this.game.isRolling = false;
            
            const strength = 0.6 + Math.random() * 1.2;
            this.game.handleThrow(bot.id, strength, bot.color);
          }, 1200 + Math.random() * 800);
          
          this.addTimer(throwT);
        }
      }
    }, 1000);

    // Watch for match result and trigger restart
    const watchMatchResult = setInterval(() => {
      if (!this.isDemo) {
        clearInterval(watchMatchResult);
        return;
      }
      if (this.game.phase === 'matchResult' && !this.isTearingDown) {
        this.isTearingDown = true;
        console.log('[Dice Demo] Match finished. Restarting demo lobby in 6 seconds.');
        const restartT = setTimeout(() => {
          if (!this.isDemo) return;
          this.game.resetSession();
          this.stopDemo();
          // Restart clean loop if idle
          const loopT = setTimeout(() => {
            if (this.game.players.size === 0 && !this.game.demoSimulator.isDemo) {
              this.startDemo();
            }
          }, 2000);
          this.game.demoSimulator.addTimer(loopT);
        }, 6000);
        this.addTimer(restartT);
      }
    }, 1500);
  }

  stopDemo() {
    if (!this.isDemo) return;
    this.isDemo = false;
    this.clearTimers();
    this.toggleQRBlur(false);
    this.hideDemoBanner();
    console.log('[Dice Demo] Demo mode stopped. Cleaning up bot structures.');

    // Remove bots from structures and dispatch leaves
    this.bots.forEach(bot => {
      if (this.host._players.has(bot.id)) {
        this.host._players.delete(bot.id);
        this.host.dispatchEvent(new CustomEvent('playerLeave', { detail: bot.id }));
      }
    });

    this.game.resetGameData();
    this.game.setPhase('lobby');
    this.game.updateLobbyUI();
  }

  toggleQRBlur(shouldBlur) {
    const qrContainers = document.querySelectorAll('.qr-container');
    qrContainers.forEach(container => {
      if (shouldBlur) {
        container.style.filter = 'blur(8px)';
        container.style.pointerEvents = 'none';

        if (!container.querySelector('.demo-qr-overlay')) {
          const overlay = document.createElement('div');
          overlay.className = 'demo-qr-overlay';
          overlay.style.position = 'absolute';
          overlay.style.inset = '0';
          overlay.style.background = 'rgba(0,0,0,0.7)';
          overlay.style.color = '#F59E0B';
          overlay.style.display = 'flex';
          overlay.style.alignItems = 'center';
          overlay.style.justifyContent = 'center';
          overlay.style.fontSize = '0.8rem';
          overlay.style.fontWeight = 'bold';
          overlay.style.borderRadius = '8px';
          overlay.style.zIndex = '10';
          overlay.textContent = '🤖 데모 중';
          container.style.position = 'relative';
          container.appendChild(overlay);
        }
      } else {
        container.style.filter = '';
        container.style.pointerEvents = '';
        const overlay = container.querySelector('.demo-qr-overlay');
        if (overlay) {
          overlay.parentNode.removeChild(overlay);
        }
      }
    });
  }

  showDemoBanner() {
    if (document.getElementById('demo-stop-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'demo-stop-banner';
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0;
      background: linear-gradient(90deg, #d97706, #f59e0b);
      color: #000; padding: 12px; text-align: center;
      font-weight: bold; font-size: 1.1rem; z-index: 10000;
      display: flex; justify-content: center; align-items: center; gap: 20px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.5);
      pointer-events: auto;
    `;
    banner.innerHTML = `
      <span>🤖 데모 시뮬레이션이 진행 중입니다. (실제 플레이어가 접속하면 자동 중단됩니다)</span>
      <button id="btn-banner-stop-demo" style="
        background: #000; color: #fff; border: none; padding: 6px 16px;
        border-radius: 6px; font-weight: bold; cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3); transition: all 0.2s;
      ">데모 중단</button>
    `;
    document.body.appendChild(banner);
    
    document.getElementById('btn-banner-stop-demo').addEventListener('click', () => {
      this.stopDemo();
    });
  }

  hideDemoBanner() {
    const banner = document.getElementById('demo-stop-banner');
    if (banner) banner.remove();
  }
}
