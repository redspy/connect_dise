export class OmokDemoSimulator {
  constructor(game) {
    this.game = game;
    this.demoTimeouts = [];
  }

  get isDemoActive() {
    return this.game._isDemo;
  }

  startDemo() {
    if (this.game._isDemo) return;
    
    // 1. 가상 봇 2명 등록 (흑/백)
    const bots = [
      { id: 'bot_black', nickname: '🤖 알파오목(흑)', color: '#10B981' },
      { id: 'bot_white', nickname: '🤖 베타오목(백)', color: '#3B82F6' }
    ];

    this.game.setDemoMode(true);
    this.game.beginDemoMatch(bots);
  }

  stopDemo() {
    if (!this.game._isDemo) return;
    this.clearDemoTimeouts();
    this.game.endDemoMatch({ resetToLobby: true });
    this.game.setDemoMode(false);
  }

  triggerBotMove() {
    if (!this.game._isDemo || !this.game._gameActive) return;

    const color = this.game._currentPlayerColor; // 'black' or 'white'
    const opponentColor = color === 'black' ? 'white' : 'black';

    // 개선점 5: 봇 수읽기보다 "보기 좋은 대국" 우선
    // 첫 4수는 중앙 근처 우선
    let move = null;
    const center = Math.floor(this.game._ai.size / 2);
    
    // 보드 빈칸 수 세기
    let emptyCount = 0;
    for (let r = 0; r < this.game._ai.size; r++) {
      for (let c = 0; c < this.game._ai.size; c++) {
        if (this.game._board[r][c] === null) emptyCount++;
      }
    }
    const totalCells = this.game._ai.size * this.game._ai.size;
    const stonesPlaced = totalCells - emptyCount;

    if (stonesPlaced < 4) {
      // 중앙 5x5 영역 중 빈칸 랜덤 선택
      const centerMoves = [];
      const offset = 2; // 5x5
      for (let r = center - offset; r <= center + offset; r++) {
        for (let c = center - offset; c <= center + offset; c++) {
          if (this.game._ai.isValid(r, c) && this.game._board[r][c] === null) {
            centerMoves.push({ r, c });
          }
        }
      }
      if (centerMoves.length > 0) {
        move = centerMoves[Math.floor(Math.random() * centerMoves.length)];
      }
    }

    if (!move) {
      // 즉시 승리 또는 수비 검사
      const winMove = this.game._ai.findWinningMove(this.game._board, color);
      if (winMove) {
        move = winMove;
      } else {
        const blockMove = this.game._ai.findWinningMove(this.game._board, opponentColor);
        if (blockMove) {
          move = blockMove;
        } else {
          // 휴리스틱 계산
          move = this.game._ai.getBestHeuristicMove(this.game._board, color, opponentColor);
        }
      }
    }

    if (move) {
      // 착수 딜레이를 0.8초 ~ 1.4초 범위로 랜덤화
      const delay = 800 + Math.random() * 600;
      const t = setTimeout(() => {
        if (this.game._isDemo && this.game._gameActive) {
          this.forceDemoMove(move.r, move.c);
        }
      }, delay);
      this.demoTimeouts.push(t);
    }
  }

  // 테스트 훅 및 헬퍼
  getDemoStateSnapshot() {
    return {
      isDemo: this.game._isDemo,
      gameActive: this.game._gameActive,
      currentPlayerColor: this.game._currentPlayerColor,
      timeoutsCount: this.demoTimeouts.length
    };
  }

  forceDemoMove(r, c) {
    if (this.game._isDemo && this.game._gameActive) {
      this.game.forceDemoMove(r, c);
    }
  }

  clearDemoTimeouts() {
    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];
  }
}
