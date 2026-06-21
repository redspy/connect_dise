export class OmokDemoSimulator {
  constructor(gameController) {
    this.game = gameController;
    this.isDemo = false;
    this.demoTimeouts = [];
  }

  startDemo() {
    if (this.isDemo) return;
    this.isDemo = true;
    this.game.setDemoMode(true);
    this.game.initGame();
  }

  stopDemo() {
    if (!this.isDemo) return;
    this.isDemo = false;
    this.game.setDemoMode(false);
    this.game.initGame();

    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];
  }

  scheduleNextMove(callback, delay = 800) {
    if (!this.isDemo) return;
    const t = setTimeout(() => {
      if (this.isDemo) callback();
    }, delay);
    this.demoTimeouts.push(t);
  }

  scheduleRestart(callback, delay = 5000) {
    if (!this.isDemo) return;
    const t = setTimeout(() => {
      if (this.isDemo) callback();
    }, delay);
    this.demoTimeouts.push(t);
  }
}
