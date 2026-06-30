export class OmokDemoSimulator {
  constructor(game) {
    this.game = game;
    this.demoTimeouts = [];
  }

  get isDemo() {
    return this.game._isDemo;
  }

  startDemo() {
    if (this.game._isDemo) return;
    this.game._isDemo = true;

    // 1. 가상 봇 2명 등록 (흑/백)
    const bots = [
      { id: 'bot_black', nickname: '🤖 알파오목(흑)', color: '#10B981' },
      { id: 'bot_white', nickname: '🤖 베타오목(백)', color: '#3B82F6' }
    ];

    bots.forEach(b => {
      this.game._playerNicknames.set(b.id, b.nickname);
      this.game.players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
      this.game.sdk._players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
    });

    this.game._blackPlayer = bots[0];
    this.game._whitePlayer = bots[1];

    // QR 블러 가드
    const qrWrap = document.querySelector('.qr-container') || document.querySelector('game-lobby')?.parentNode;
    if (qrWrap) {
      qrWrap.style.filter = 'blur(8px)';
      qrWrap.style.pointerEvents = 'none';
    }

    this.game._startGame();
  }

  stopDemo() {
    if (!this.game._isDemo) return;
    this.game._isDemo = false;

    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];

    const qrWrap = document.querySelector('.qr-container') || document.querySelector('game-lobby')?.parentNode;
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }

    this.game.players.clear();
    this.game.sdk._players.clear();
    this.game.resetSession();
  }

  triggerBotMove() {
    if (!this.game._isDemo || !this.game._gameActive) return;

    const color = this.game._currentPlayerColor; // 'black' or 'white'
    const opponentColor = color === 'black' ? 'white' : 'black';

    const move = this.game._ai.calculateBestMove(this.game._board, color, opponentColor);
    if (move) {
      const t = setTimeout(() => {
        if (this.game._isDemo && this.game._gameActive) {
          this.game._placeStone(move.r, move.c);
        }
      }, 1000);
      this.demoTimeouts.push(t);
    }
  }
}
