import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { DemoSimulator } from './DemoSimulator.js';

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

    this._demoSimulator = new DemoSimulator(this);
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

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.onclick = () => {
        if (!this._demoSimulator.isDemo) {
          this._demoSimulator.startDemo();
        } else {
          this._demoSimulator.stopDemo();
        }
      };
    }

    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    if (this._gameStarted) return;
    this._renderLobby();
    this.updateLobbyReady(this._readyCount);

    // 데모 실행 중 실제 플레이어가 난입한 경우 안전하게 데모 중단
    if (this._isDemo && !player.id.startsWith('bot_')) {
      this._demoSimulator.stopDemo();
    }
  }

  onPlayerRejoin(player) {
    if (this._gameStarted) {
      const prog = this._progress.get(player.id);
      this.sendToPlayer(player.id, 'rejoinState', {
        phase:        'playing',
        board:        this._board,
        currentBoard: prog?.board ?? [...this._board],
        moves:        prog?.moves ?? 0,
        seconds:      prog?.seconds ?? 0,
      });
    } else if (this.phase === 'result' && this._winner) {
      const rankings = this._buildRankings();
      this.sendToPlayer(player.id, 'gameFinished', { winner: this._winner, rankings });
    } else {
      // 로비 재연결 프리징 가드 및 준비 상태 복구
      const profile = this._profiles.get(player.id);
      this.sendToPlayer(player.id, 'lobbyState', {
        nickname: profile?.nickname ?? '',
        ready: player.ready ?? false,
      });
      this._broadcastPlayerList();
    }
  }

  onPlayerLeave(playerId) {
    this._profiles.delete(playerId);
    this._progress.delete(playerId);
    this._renderLobby();
    if (this._gameStarted) {
      this._renderDashboard();
    }
    this._broadcastPlayerList();
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
    this._demoSimulator.stopDemo();
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

    const winnerEl = document.getElementById('winner-display');
    if (winnerEl) {
      winnerEl.classList.add('hidden');
    }
  }

  onPhaseChange(from, to) {
    if (this._demoSimulator.isDemo) {
      this._demoSimulator.onPhaseChange(to);
    }
  }

  // ─── Demo Mode API ────────────────────────────────────────────────────────

  enterDemoLobby(bots) {
    this._isDemo = true;
    bots.forEach(b => {
      this._profiles.set(b.id, { nickname: b.nickname });
      this.players.set(b.id, { id: b.id, color: b.color });
      this.sdk._players.set(b.id, { id: b.id, color: b.color });
    });
    this._renderLobby();
    this.updateLobbyReady(bots.length);
  }

  applyDemoProgress(botId, snapshot) {
    const { correctCount, progress, moves, seconds, board } = snapshot;
    this._progress.set(botId, { correctCount, progress, moves, seconds, board });
    this._renderDashboard();
  }

  finishDemoRound(botId, result) {
    const { moves, seconds } = result;
    if (this._winner) return;

    const profile = this._profiles.get(botId) || { nickname: '익명' };
    const p = this.getPlayer(botId);
    this._winner = {
      id: botId,
      nickname: profile.nickname,
      color: p?.color ?? '#fff',
      moves,
      seconds,
    };

    const solvedBoard = [...Array(15).keys()].map(i => i + 1);
    solvedBoard.push(0);
    this._progress.set(botId, { correctCount: 15, progress: 100, moves, seconds, board: solvedBoard });

    const rankings = this._buildRankings();
    this.broadcast('gameFinished', { winner: this._winner, rankings });
    this._gameStarted = false;
    this._renderResult();
  }

  exitDemoMode() {
    this._isDemo = false;
    this._profiles.clear();
    this._progress.clear();
    this.players.clear();
    this.sdk._players.clear();
    this._renderLobby();
    this.updateLobbyReady(0);
    this.setPhase('lobby');
  }

  // ─── Game messages ───────────────────────────────────────────────────────

  _wireGameMessages() {
    this.onMessage('setProfile', (player, { nickname }) => {
      const name = nickname.trim() || '익명';
      this._profiles.set(player.id, { nickname: name });
      this.setPlayerName(player.id, name);
      this._renderLobby();
      this._broadcastPlayerList();
    });

    this.onMessage('progressUpdate', (player, { correctCount, moves, seconds, board }) => {
      const progress = Math.round((correctCount / 15) * 100);
      this._progress.set(player.id, { correctCount, progress, moves, seconds, board: board || null });
      this._renderDashboard();
    });

    this.onMessage('puzzleComplete', (player, { moves, seconds }) => {
      if (this._winner) return; 
      const profile = this._profiles.get(player.id) || { nickname: '익명' };
      const p = this.getPlayer(player.id);
      this._winner = {
        id: player.id,
        nickname: profile.nickname,
        color: p?.color ?? '#fff',
        moves,
        seconds,
      };
      
      const solvedBoard = [...Array(15).keys()].map(i => i + 1);
      solvedBoard.push(0);
      this._progress.set(player.id, { correctCount: 15, progress: 100, moves, seconds, board: solvedBoard });

      const rankings = this._buildRankings();

      this.broadcast('gameFinished', { winner: this._winner, rankings });
      this._gameStarted = false;
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

    for (const id of this.players.keys()) {
      this._progress.set(id, { correctCount: 0, progress: 0, moves: 0, seconds: 0, board: [...this._board] });
    }

    this.broadcast('gameStarted', { board: this._board });

    this.setPhase('playing');
    this._renderDashboard();

    this._timerInterval = setInterval(() => {
      this._renderDashboardTime();
    }, 1000);
  }

  _generateBoard() {
    const board = [...Array(15).keys()].map(i => i + 1);
    board.push(0);
    let emptyIndex = 15;

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
        if (b.progress !== a.progress) return b.progress - a.progress;
        if (a.moves !== b.moves) return a.moves - b.moves;
        return a.seconds - b.seconds;
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

    const rankings = this._buildRankings();
    const top1Player = rankings[0];
    const chasePlayer = rankings[1];

    for (const [id, player] of this.players) {
      const profile = this._profiles.get(id);
      const prog = this._progress.get(id) || { correctCount: 0, progress: 0, moves: 0, seconds: 0, board: null };
      const isWinner = this._winner?.id === id;

      let badgeHtml = '';
      if (this._gameStarted && !this._winner) {
        if (top1Player && top1Player.id === id && top1Player.progress > 0) {
          badgeHtml = '<span class="dp-dash-badge top1">TOP 1</span>';
        } else if (chasePlayer && chasePlayer.id === id && chasePlayer.progress > 0) {
          badgeHtml = '<span class="dp-dash-badge chase">CHASE</span>';
        }
      }

      const isCloseToSolve = prog.correctCount >= 12 && !isWinner;

      const card = document.createElement('div');
      card.className = `dp-dash-card ${isWinner ? 'winner' : ''} ${isCloseToSolve ? 'pulse-glow' : ''}`;
      card.innerHTML = `
        <div class="dp-dash-header">
          <div class="dp-dash-avatar" style="background:${player.color}">${profile?.nickname?.charAt(0) ?? '?'}</div>
          <div class="dp-dash-name">${profile?.nickname ?? '...'}</div>
          ${badgeHtml}
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
    if (!this._gameStarted || this._winner) return;
    const elapsed = Math.floor((Date.now() - this._gameStartTime) / 1000);
    const timerEl = document.getElementById('dashboard-timer');
    if (timerEl) timerEl.textContent = this._formatTime(elapsed);
  }

  _renderResult() {
    this._renderDashboard();

    const winnerEl = document.getElementById('winner-display');
    if (winnerEl && this._winner) {
      winnerEl.innerHTML = `
        <div class="dp-winner-crown">&#x1F3C6;</div>
        <div class="dp-winner-name" style="color:${this._winner.color}">${this._winner.nickname}</div>
        <div class="dp-winner-stats">${this._winner.moves}수 / ${this._formatTime(this._winner.seconds)}</div>
      `;
      winnerEl.classList.remove('hidden');
    }

    const rankingsEl = document.getElementById('result-rankings');
    if (rankingsEl) {
      const rankings = this._buildRankings();
      rankingsEl.innerHTML = rankings.map((r, idx) => {
        let diffText = '';
        if (idx > 0 && this._winner) {
          const movesDiff = r.moves - this._winner.moves;
          const secDiff = r.seconds - this._winner.seconds;
          const pDiff = this._winner.progress - r.progress;
          if (r.progress === 100) {
            diffText = `<span class="dp-rank-diff">+${movesDiff}수 / +${secDiff}초</span>`;
          } else {
            diffText = `<span class="dp-rank-diff">${pDiff}% 뒤처짐</span>`;
          }
        } else {
          diffText = `<span class="dp-rank-diff winner">우승!</span>`;
        }

        const medals = ['🥇', '🥈', '🥉'];
        const medal = medals[idx] ?? `${idx + 1}등`;

        return `
          <div class="dp-rank-item ${idx === 0 ? 'winner-row' : ''}">
            <div class="dp-rank-medal">${medal}</div>
            <div class="dp-rank-avatar" style="background:${r.color}">${r.nickname.charAt(0)}</div>
            <div class="dp-rank-name">${r.nickname}</div>
            <div class="dp-rank-details">
              <span class="dp-rank-stats">${r.progress}% 완료 (${r.moves}수)</span>
              ${diffText}
            </div>
          </div>
        `;
      }).join('');
    }

    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }

    setTimeout(() => {
      if (this.phase === 'playing') {
        this.setPhase('result');
      }
    }, 3000);
  }

  _formatTime(s) {
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${m}:${sec}`;
  }
}
