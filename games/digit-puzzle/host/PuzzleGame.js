import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';

const SIZE = 4;
const MIN_PLAYERS = 2;

export class PuzzleGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'dp-overlay', qrContainerId: null });

    this._profiles = new Map();   // id → { nickname }
    this._progress = new Map();   // id → { correctCount, progress, moves, seconds, board }
    this._board = null;           // number[16] shared shuffled board
    this._winner = null;          // { id, nickname, color, moves, seconds }
    this._readyCount = 0;
    this._gameStarted = false;
    this._gameStartTime = null;
    this._timerInterval = null;

    this._wireGameMessages();
  }

  // ─── HostBaseGame hooks ──────────────────────────────────────────────────

  async onSetup() {
    if (this._lobbyEl) {
      this._lobbyEl.onStart = () => { if (this._canStart()) this._startGame(); };
    }

    const appbar = document.querySelector('game-appbar');
    appbar.onRestart = () => this.resetSession();

    const timerEl = document.createElement('span');
    timerEl.id = 'dashboard-timer';
    timerEl.className = 'dp-timer';
    timerEl.textContent = '00:00';
    appbar.prependRight(timerEl);

    document.getElementById('btn-restart-result').addEventListener('click', () => {
      this.resetSession();
    });

    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    if (this._gameStarted) return;
    this._renderLobby();
    this.updateLobbyReady(this._readyCount);
  }

  onPlayerRejoin(player) {
    // 재연결 시 현재 상태 전송
    if (this._gameStarted) {
      const profile = this._profiles.get(player.id);
      if (profile) {
        this.sendToPlayer(player.id, 'gameStarted', { board: this._board });
      }
    }
  }

  onPlayerLeave(playerId) {
    this._profiles.delete(playerId);
    this._progress.delete(playerId);
    this._renderLobby();
  }

  onReadyUpdate({ readyCount }) {
    this._readyCount = readyCount;
    this.updateLobbyReady(readyCount);
  }

  onAllReady() {
    if (!this._gameStarted) {
      this._startGame();
    }
  }

  onReset() {
    this._profiles.clear();
    this._progress.clear();
    this._board = null;
    this._winner = null;
    this._readyCount = 0;
    this._gameStarted = false;
    this._gameStartTime = null;
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
    this._renderLobby();
    this.updateLobbyReady(0);
    this.setPhase('lobby');
  }

  // ─── Game messages ───────────────────────────────────────────────────────

  _wireGameMessages() {
    this.onMessage('setProfile', (player, { nickname }) => {
      this._profiles.set(player.id, { nickname: nickname.trim() || '익명' });
      this._renderLobby();
      this._broadcastPlayerList();
    });

    this.onMessage('progressUpdate', (player, { correctCount, moves, seconds, board }) => {
      const progress = Math.round((correctCount / 15) * 100);
      this._progress.set(player.id, { correctCount, progress, moves, seconds, board: board || null });
      this._renderDashboard();
    });

    this.onMessage('puzzleComplete', (player, { moves, seconds }) => {
      if (this._winner) return; // already have a winner
      const profile = this._profiles.get(player.id) || { nickname: '익명' };
      const p = this.getPlayer(player.id);
      this._winner = {
        id: player.id,
        nickname: profile.nickname,
        color: p?.color ?? '#fff',
        moves,
        seconds,
      };
      // 완료된 보드 상태: 정렬된 상태
      const solvedBoard = [...Array(15).keys()].map(i => i + 1);
      solvedBoard.push(0);
      this._progress.set(player.id, { correctCount: 15, progress: 100, moves, seconds, board: solvedBoard });

      // Build rankings
      const rankings = this._buildRankings();

      this.broadcast('gameFinished', { winner: this._winner, rankings });
      this._renderResult();
    });

    this.onMessage('requestRematch', () => {
      this.resetSession();
    });
  }

  // ─── Lobby ───────────────────────────────────────────────────────────────

  _canStart() {
    return this.playerCount >= MIN_PLAYERS && this._readyCount === this.playerCount && this.playerCount > 0;
  }

  _renderLobby() {
    this.renderLobbyPlayers(this._profiles);
  }

  _broadcastPlayerList() {
    const players = [...this.players.values()].map(p => ({
      id: p.id,
      color: p.color,
      nickname: this._profiles.get(p.id)?.nickname ?? '익명',
    }));
    this.broadcast('playerListUpdated', { players });
  }

  // ─── Game flow ───────────────────────────────────────────────────────────

  _startGame() {
    this._gameStarted = true;
    this._winner = null;
    this._board = this._generateBoard();
    this._gameStartTime = Date.now();

    // Init progress for all players
    for (const id of this.players.keys()) {
      this._progress.set(id, { correctCount: 0, progress: 0, moves: 0, seconds: 0, board: [...this._board] });
    }

    this.broadcast('gameStarted', { board: this._board });

    // Hide overlays, show dashboard
    this.setPhase('playing');
    this._renderDashboard();

    // Start elapsed timer for dashboard
    this._timerInterval = setInterval(() => {
      this._renderDashboardTime();
    }, 1000);
  }

  _generateBoard() {
    // Start from solved state: [1,2,...,15,0]
    const board = [...Array(15).keys()].map(i => i + 1);
    board.push(0);
    let emptyIndex = 15;

    // 300 random valid moves from solved state → always solvable
    let lastEmpty = -1;
    for (let i = 0; i < 300; i++) {
      const neighbors = this._getNeighbors(emptyIndex).filter(n => n !== lastEmpty);
      const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
      lastEmpty = emptyIndex;
      [board[pick], board[emptyIndex]] = [board[emptyIndex], board[pick]];
      emptyIndex = pick;
    }

    return board;
  }

  _getNeighbors(idx) {
    const row = Math.floor(idx / SIZE);
    const col = idx % SIZE;
    const result = [];
    if (row > 0) result.push(idx - SIZE);
    if (row < SIZE - 1) result.push(idx + SIZE);
    if (col > 0) result.push(idx - 1);
    if (col < SIZE - 1) result.push(idx + 1);
    return result;
  }

  _buildRankings() {
    return [...this.players.values()]
      .map(p => {
        const profile = this._profiles.get(p.id) || { nickname: '익명' };
        const prog = this._progress.get(p.id) || { correctCount: 0, progress: 0, moves: 0, seconds: 0 };
        return {
          id: p.id,
          color: p.color,
          nickname: profile.nickname,
          ...prog,
        };
      })
      .sort((a, b) => {
        // Winner first (100%), then by progress desc, then by moves asc
        if (b.progress !== a.progress) return b.progress - a.progress;
        return a.moves - b.moves;
      });
  }

  // ─── Dashboard rendering ─────────────────────────────────────────────────

  _renderMiniBoard(board) {
    if (!board || board.length !== 16) {
      return '<div class="dp-mini-board">' + Array(16).fill('<div class="dp-mini-tile empty"></div>').join('') + '</div>';
    }
    let html = '<div class="dp-mini-board">';
    for (let i = 0; i < 16; i++) {
      const v = board[i];
      if (v === 0) {
        html += '<div class="dp-mini-tile empty"></div>';
      } else {
        const isCorrect = v === i + 1;
        html += `<div class="dp-mini-tile${isCorrect ? ' correct' : ''}">${v}</div>`;
      }
    }
    html += '</div>';
    return html;
  }

  _renderDashboard() {
    const grid = document.getElementById('dashboard-grid');
    if (!grid) return;
    grid.innerHTML = '';

    for (const [id, player] of this.players) {
      const profile = this._profiles.get(id);
      const prog = this._progress.get(id) || { correctCount: 0, progress: 0, moves: 0, seconds: 0, board: null };
      const isWinner = this._winner?.id === id;

      const card = document.createElement('div');
      card.className = `dp-dash-card ${isWinner ? 'winner' : ''}`;
      card.innerHTML = `
        <div class="dp-dash-header">
          <div class="dp-dash-avatar" style="background:${player.color}">${profile?.nickname?.charAt(0) ?? '?'}</div>
          <div class="dp-dash-name">${profile?.nickname ?? '...'}</div>
          ${isWinner ? '<span class="dp-dash-crown">&#x1F451;</span>' : ''}
        </div>
        <div class="dp-dash-bar-wrap">
          <div class="dp-dash-bar" style="width:${prog.progress}%; background:${player.color}; transition: width 0.3s ease"></div>
        </div>
        <div class="dp-dash-stats">
          <span>${prog.correctCount ?? 0}/15</span>
          <span>${prog.moves}수</span>
          <span>${this._formatTime(prog.seconds)}</span>
        </div>
        ${this._renderMiniBoard(prog.board)}
      `;
      grid.appendChild(card);
    }
  }

  _renderDashboardTime() {
    // Only update time display, not full re-render
    if (!this._gameStarted || this._winner) return;
    // Elapsed seconds from game start
    const elapsed = Math.floor((Date.now() - this._gameStartTime) / 1000);
    const timerEl = document.getElementById('dashboard-timer');
    if (timerEl) timerEl.textContent = this._formatTime(elapsed);
  }

  _renderResult() {
    this._renderDashboard(); // Update dashboard with winner state

    const winnerEl = document.getElementById('winner-display');
    if (winnerEl && this._winner) {
      winnerEl.innerHTML = `
        <div class="dp-winner-crown">&#x1F3C6;</div>
        <div class="dp-winner-name" style="color:${this._winner.color}">${this._winner.nickname}</div>
        <div class="dp-winner-stats">${this._winner.moves}수 / ${this._formatTime(this._winner.seconds)}</div>
      `;
      winnerEl.classList.remove('hidden');
    }

    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  _formatTime(s) {
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${m}:${sec}`;
  }
}
