import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';

const SIZE = 4;
const PROGRESS_THROTTLE_MS = 500;

export class PuzzleMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'dp-screen' });

    this._nickname = '';
    this._board = [];
    this._emptyIndex = 15;
    this._moves = 0;
    this._seconds = 0;
    this._timerInterval = null;
    this._isAnimating = false;
    this._tileElements = {};
    this._lastProgressSend = 0;
    this._gameActive = false;
    this._solved = false;

    // Touch state
    this._touchStartX = 0;
    this._touchStartY = 0;

    this._wireUI();
    this._wireMessages();
    this._prefillNickname();
  }

  // ─── MobileBaseGame hooks ────────────────────────────────────────────────

  onJoin(player) {
    this.showScreen('setup');
  }

  onRejoin(player) {
    if (this._nickname) {
      this._sendProfile();
    }
  }

  onAllReady() {
    // Game start is controlled by host
  }

  onReset() {
    this._board = [];
    this._emptyIndex = 15;
    this._moves = 0;
    this._seconds = 0;
    this._isAnimating = false;
    this._gameActive = false;
    this._solved = false;
    this._stopTimer();

    if (this._nickname) {
      this._sendProfile();
    } else {
      this.showScreen('setup');
    }
  }

  // ─── Message handlers ────────────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('playerListUpdated', ({ players }) => {
      this._renderWaitingPlayers(players);
    });

    this.onMessage('gameStarted', ({ board }) => {
      this._initBoard(board);
      this.showScreen('game');
      // Board needs to render after screen is visible
      requestAnimationFrame(() => {
        this._createTileElements();
        this._renderBoard(false);
        this._bindBoardEvents();
      });
    });

    this.onMessage('gameFinished', ({ winner, rankings }) => {
      this._stopTimer();
      this._gameActive = false;
      this._showResult(winner, rankings);
    });
  }

  // ─── UI setup ────────────────────────────────────────────────────────────

  _wireUI() {
    document.getElementById('btn-join').addEventListener('click', () => {
      const nick = document.getElementById('nickname-input').value.trim();
      if (!nick) { alert('닉네임을 입력해주세요'); return; }
      this._nickname = nick;
      this._sendProfile();
    });

    document.getElementById('btn-ready').addEventListener('click', () => {
      document.getElementById('btn-ready').disabled = true;
      document.getElementById('btn-ready').textContent = '준비완료 ✓';
      this.ready();
    });

    document.getElementById('btn-rematch').addEventListener('click', () => {
      this.sendToHost('requestRematch', {});
    });
  }

  _prefillNickname() {
    const saved = localStorage.getItem('dp_nickname');
    if (saved) {
      this._nickname = saved;
      const input = document.getElementById('nickname-input');
      if (input) input.value = saved;
      return;
    }

    const adjectives = ['빠른', '느린', '용감한', '조용한', '귀여운', '날카로운', '엉뚱한', '현명한'];
    const nouns = ['판다', '여우', '펭귄', '곰', '고블린', '기사', '마법사', '로봇'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const input = document.getElementById('nickname-input');
    if (input) input.value = `${adj}${noun}`;
  }

  _sendProfile() {
    this.sendToHost('setProfile', { nickname: this._nickname });
    localStorage.setItem('dp_nickname', this._nickname);
    document.getElementById('waiting-nickname').textContent = this._nickname;
    this.showScreen('waiting');

    // Reset ready button
    const btnReady = document.getElementById('btn-ready');
    if (btnReady) {
      btnReady.disabled = false;
      btnReady.textContent = '준비하기';
    }
  }

  _renderWaitingPlayers(players) {
    const list = document.getElementById('waiting-players');
    if (!list) return;
    const others = players.filter(p => p.id !== this.playerId);
    list.innerHTML = others.map(p => `
      <div class="dp-waiting-player">
        <div class="dp-wp-dot" style="background:${p.color}"></div>
        <span>${p.nickname}</span>
      </div>
    `).join('');
  }

  // ─── Puzzle logic (ported from puzzle.js) ────────────────────────────────

  _initBoard(boardArray) {
    this._board = [...boardArray];
    this._emptyIndex = this._board.indexOf(0);
    this._moves = 0;
    this._seconds = 0;
    this._isAnimating = false;
    this._gameActive = false;
    this._solved = false;

    document.getElementById('game-moves').textContent = '0';
    document.getElementById('game-timer').textContent = '00:00';
  }

  _createTileElements() {
    const boardEl = document.getElementById('puzzle-board');
    boardEl.innerHTML = '';
    this._tileElements = {};
    for (let v = 1; v <= 15; v++) {
      const el = document.createElement('div');
      el.className = 'dp-tile';
      el.textContent = v;
      boardEl.appendChild(el);
      this._tileElements[v] = el;
    }
  }

  _getTilePosition(idx) {
    const boardEl = document.getElementById('puzzle-board');
    const cw = boardEl.clientWidth;
    const ch = boardEl.clientHeight;
    const style = getComputedStyle(boardEl);
    const gap = parseFloat(style.gap) || 6;
    const padL = parseFloat(style.paddingLeft) || 0;
    const padR = parseFloat(style.paddingRight) || 0;
    const padT = parseFloat(style.paddingTop) || 0;
    const padB = parseFloat(style.paddingBottom) || 0;

    const contentW = cw - padL - padR;
    const contentH = ch - padT - padB;
    const sizeByW = (contentW - gap * (SIZE - 1)) / SIZE;
    const sizeByH = (contentH - gap * (SIZE - 1)) / SIZE;
    const size = Math.min(sizeByW, sizeByH);

    const gridW = size * SIZE + gap * (SIZE - 1);
    const gridH = size * SIZE + gap * (SIZE - 1);
    const offsetX = padL + (contentW - gridW) / 2;
    const offsetY = padT + (contentH - gridH) / 2;

    const col = idx % SIZE;
    const row = Math.floor(idx / SIZE);
    return {
      x: offsetX + col * (size + gap),
      y: offsetY + row * (size + gap),
      size,
    };
  }

  _renderBoard(animated = true) {
    const boardEl = document.getElementById('puzzle-board');
    if (boardEl.clientWidth === 0) {
      requestAnimationFrame(() => this._renderBoard(animated));
      return;
    }

    if (!animated) {
      Object.values(this._tileElements).forEach(el => { el.style.transition = 'none'; });
    }

    for (let i = 0; i < this._board.length; i++) {
      const v = this._board[i];
      if (v === 0) continue;
      const el = this._tileElements[v];
      if (!el) continue;
      const { x, y, size } = this._getTilePosition(i);
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.fontSize = Math.floor(size * 0.38) + 'px';
    }

    if (!animated) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          Object.values(this._tileElements).forEach(el => { el.style.transition = ''; });
        });
      });
    }
  }

  _bindBoardEvents() {
    const boardEl = document.getElementById('puzzle-board');

    // Tile click
    boardEl.addEventListener('click', (e) => {
      const tile = e.target.closest('.dp-tile');
      if (!tile) return;
      const value = parseInt(tile.textContent);
      const idx = this._board.indexOf(value);
      this._handleTileClick(idx);
    });

    // Touch events
    boardEl.addEventListener('touchstart', (e) => {
      this._touchStartX = e.touches[0].clientX;
      this._touchStartY = e.touches[0].clientY;
    }, { passive: true });

    boardEl.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - this._touchStartX;
      const dy = e.changedTouches[0].clientY - this._touchStartY;
      const threshold = 30;

      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
        // Tap
        const el = document.elementFromPoint(
          e.changedTouches[0].clientX,
          e.changedTouches[0].clientY
        );
        const tile = el && el.closest('.dp-tile');
        if (tile) {
          const value = parseInt(tile.textContent);
          const idx = this._board.indexOf(value);
          this._handleTileClick(idx);
        }
        return;
      }

      // Swipe
      if (Math.abs(dx) > Math.abs(dy)) {
        this._moveDirKey(dx > 0 ? 'right' : 'left');
      } else {
        this._moveDirKey(dy > 0 ? 'down' : 'up');
      }
    }, { passive: true });

    // Resize
    window.addEventListener('resize', () => this._renderBoard(false));
  }

  _handleTileClick(tileIndex) {
    if (this._isAnimating || this._solved) return;
    if (this._board[tileIndex] === 0) return;

    const eRow = Math.floor(this._emptyIndex / SIZE);
    const eCol = this._emptyIndex % SIZE;
    const tRow = Math.floor(tileIndex / SIZE);
    const tCol = tileIndex % SIZE;

    let sequence = [];

    if (tRow === eRow && tCol !== eCol) {
      const step = tCol < eCol ? 1 : -1;
      for (let c = tCol; c !== eCol; c += step) {
        sequence.push(tRow * SIZE + c);
      }
    } else if (tCol === eCol && tRow !== eRow) {
      const step = tRow < eRow ? 1 : -1;
      for (let r = tRow; r !== eRow; r += step) {
        sequence.push(r * SIZE + tCol);
      }
    } else {
      return;
    }

    if (sequence.length === 0) return;

    if (!this._gameActive) {
      this._gameActive = true;
      this._startTimer();
    }

    const destinations = sequence.map((_, k) =>
      k < sequence.length - 1 ? sequence[k + 1] : this._emptyIndex
    );

    for (let k = sequence.length - 1; k >= 0; k--) {
      this._board[destinations[k]] = this._board[sequence[k]];
    }
    this._board[sequence[0]] = 0;
    this._emptyIndex = sequence[0];

    this._moves += sequence.length;
    document.getElementById('game-moves').textContent = this._moves;

    this._animateTiles(sequence, destinations);
  }

  _moveDirKey(dir) {
    if (this._isAnimating || this._solved) return;
    const eRow = Math.floor(this._emptyIndex / SIZE);
    const eCol = this._emptyIndex % SIZE;
    let targetIdx = -1;

    switch (dir) {
      case 'up':    if (eRow < SIZE - 1) targetIdx = this._emptyIndex + SIZE; break;
      case 'down':  if (eRow > 0)        targetIdx = this._emptyIndex - SIZE; break;
      case 'left':  if (eCol < SIZE - 1) targetIdx = this._emptyIndex + 1;    break;
      case 'right': if (eCol > 0)        targetIdx = this._emptyIndex - 1;    break;
    }
    if (targetIdx !== -1) this._handleTileClick(targetIdx);
  }

  _animateTiles(sequence, destinations) {
    this._isAnimating = true;
    let pending = sequence.length;

    sequence.forEach((fromIdx, k) => {
      const value = this._board[destinations[k]];
      const el = this._tileElements[value];
      el.classList.add('dp-moving');

      const { x, y, size } = this._getTilePosition(destinations[k]);
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.fontSize = Math.floor(size * 0.38) + 'px';

      const done = () => {
        el.classList.remove('dp-moving');
        pending--;
        if (pending === 0) {
          this._isAnimating = false;
          this._sendProgress();
          if (this._isSolved()) {
            this._onPuzzleSolved();
          }
        }
      };

      const safetyTimer = setTimeout(done, 500);
      el.addEventListener('transitionend', () => {
        clearTimeout(safetyTimer);
        done();
      }, { once: true });
    });
  }

  _isSolved() {
    for (let i = 0; i < 15; i++) {
      if (this._board[i] !== i + 1) return false;
    }
    return this._board[15] === 0;
  }

  _getCorrectCount() {
    let count = 0;
    for (let i = 0; i < 15; i++) {
      if (this._board[i] === i + 1) count++;
    }
    return count;
  }

  _onPuzzleSolved() {
    this._solved = true;
    this._stopTimer();
    this._gameActive = false;

    try { navigator.vibrate?.([200, 100, 200, 100, 400]); } catch (_) {}

    this.sendToHost('puzzleComplete', {
      moves: this._moves,
      seconds: this._seconds,
    });
  }

  // ─── Progress reporting (500ms throttle) ─────────────────────────────────

  _sendProgress() {
    const now = Date.now();
    if (now - this._lastProgressSend < PROGRESS_THROTTLE_MS) return;
    this._lastProgressSend = now;

    this.sendToHost('progressUpdate', {
      correctCount: this._getCorrectCount(),
      moves: this._moves,
      seconds: this._seconds,
      board: [...this._board],
    });
  }

  // ─── Timer ───────────────────────────────────────────────────────────────

  _startTimer() {
    this._timerInterval = setInterval(() => {
      this._seconds++;
      document.getElementById('game-timer').textContent = this._formatTime(this._seconds);
    }, 1000);
  }

  _stopTimer() {
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

  // ─── Result screen ──────────────────────────────────────────────────────

  _showResult(winner, rankings) {
    const isMe = winner.id === this.playerId;

    document.getElementById('result-status').textContent = isMe ? '축하합니다!' : `${winner.nickname} 승리!`;
    document.getElementById('result-status').style.color = isMe ? '#ffd700' : '#bb86fc';
    document.getElementById('result-moves').textContent = `${this._moves}수`;
    document.getElementById('result-time').textContent = this._formatTime(this._seconds);

    this.showScreen('result');
  }
}
