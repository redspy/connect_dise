import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';
import {
  getSymbolPath,
  hanjaSymbols, hanjaMeanings,
  hiraganaSymbols, katakanaSymbols, kanaHangulFeedback,
} from '../shared/DobbleEngine.js';

const FREEZE_MS = 3000;

export class DobbleMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'db-screen' });

    this._nickname      = '';
    this._mode          = 'image';
    this._winScore      = 10;
    this._myCard        = [];
    this._score         = 0;
    this._frozen        = false;
    this._freezeInterval = null;
    this._feedbackTimer  = null;

    this._wireUI();
    this._wireMessages();
    this._prefillNickname();
  }

  // ─── MobileBaseGame hooks ────────────────────────────────────────────────

  onJoin() {
    this.showScreen('setup');
  }

  onRejoin() {
    if (this._nickname) this._sendProfile();
  }

  onAllReady() {
    // Game start is controlled by host
  }

  onReset() {
    this._myCard  = [];
    this._score   = 0;
    this._frozen  = false;
    this._clearFreeze();

    const btn = document.getElementById('btn-ready');
    if (btn) { btn.disabled = false; btn.textContent = '준비하기'; }

    if (this._nickname) {
      this._sendProfile();
    } else {
      this.showScreen('setup');
    }
  }

  // ─── Message handlers ────────────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('gameStarted', ({ mode, winScore }) => {
      this._mode     = mode;
      this._winScore = winScore;
      this._score    = 0;
      this._frozen   = false;
      this._clearFreeze();
      this._updateScore();
    });

    this.onMessage('cardDealt', ({ card }) => {
      this._myCard = card;
      this._renderCard();
      this.showScreen('game');
    });

    this.onMessage('tapResult', ({ correct, newCard, symbolIndex, penaltyMs }) => {
      if (correct) {
        this.vibrate('light');
        this._myCard = newCard;
        this._showFeedback(true, symbolIndex);
        setTimeout(() => this._renderCard(), 300);
      } else {
        this.vibrate('double');
        this._applyFreeze(penaltyMs ?? FREEZE_MS);
        this._showFeedback(false, null);
      }
    });

    this.onMessage('stateUpdate', ({ scores }) => {
      if (scores && scores[this.playerId] !== undefined) {
        this._score = scores[this.playerId];
        this._updateScore();
      }
    });

    this.onMessage('gameFinished', ({ rankings }) => {
      this._clearFreeze();
      this._renderResult(rankings);
      this.showScreen('result');

      const myRank = rankings.findIndex(p => p.id === this.playerId);
      if (myRank === 0) {
        this.vibrate([100, 50, 100, 50, 300]);
      } else {
        this.vibrate('medium');
      }
    });

    this.onMessage('playerListUpdated', ({ players }) => {
      this._renderWaitingPlayers(players);
    });

    this.onMessage('rejoinState', (payload) => {
      this._applyRejoinState(payload);
    });
  }

  // ─── UI wiring ────────────────────────────────────────────────────────────

  _wireUI() {
    document.getElementById('btn-join')?.addEventListener('click', () => {
      const nick = document.getElementById('nickname-input')?.value.trim();
      if (!nick) { alert('닉네임을 입력해주세요'); return; }
      this._nickname = nick;
      this._sendProfile();
    });

    document.getElementById('btn-ready')?.addEventListener('click', () => {
      const btn = document.getElementById('btn-ready');
      if (btn) { btn.disabled = true; btn.textContent = '준비완료 ✓'; }
      this.ready();
    });

    document.getElementById('btn-rematch')?.addEventListener('click', () => {
      this.sendToHost('requestRematch', {});
    });
  }

  _prefillNickname() {
    const saved = localStorage.getItem('dobble_nickname');
    if (saved) {
      this._nickname = saved;
      const input = document.getElementById('nickname-input');
      if (input) input.value = saved;
    }
  }

  _sendProfile() {
    this.sendToHost('setProfile', { nickname: this._nickname });
    localStorage.setItem('dobble_nickname', this._nickname);
    const el = document.getElementById('waiting-nickname');
    if (el) el.textContent = this._nickname;
    this.showScreen('waiting');
  }

  // ─── Card rendering ──────────────────────────────────────────────────────

  _renderCard() {
    const container = document.getElementById('my-card');
    if (!container) return;
    container.innerHTML = '';
    for (const symbolIdx of this._myCard) {
      const cell = document.createElement('div');
      cell.className = 'db-symbol-cell';
      cell.dataset.symbolIndex = symbolIdx;
      cell.appendChild(this._makeSymbol(symbolIdx));
      cell.addEventListener('click', () => {
        if (this._frozen) return;
        this.sendToHost('tapSymbol', { symbolIndex: symbolIdx });
      });
      container.appendChild(cell);
    }
  }

  _makeSymbol(symbolIdx) {
    if (this._mode === 'image') {
      const img = document.createElement('img');
      img.src = getSymbolPath(symbolIdx);
      img.className = 'db-symbol-img-m';
      img.draggable = false;
      return img;
    }
    const div = document.createElement('div');
    div.className = 'db-symbol-text-m';
    if (this._mode === 'hanja') {
      div.textContent = hanjaSymbols[symbolIdx] ?? '?';
    } else if (this._mode === 'hiragana') {
      div.textContent = hiraganaSymbols[symbolIdx] ?? '?';
    } else {
      div.textContent = katakanaSymbols[symbolIdx] ?? '?';
    }
    return div;
  }

  // ─── Feedback ─────────────────────────────────────────────────────────────

  _showFeedback(correct, symbolIndex) {
    const el = document.getElementById('tap-feedback');
    if (!el) return;
    el.classList.remove('hidden', 'correct', 'wrong');

    if (correct) {
      let text = '정답! ✓';
      if (symbolIndex != null) {
        if (this._mode === 'hanja') {
          text = `${hanjaSymbols[symbolIndex]} — ${hanjaMeanings[symbolIndex]}`;
        } else if (this._mode === 'hiragana') {
          text = `${hiraganaSymbols[symbolIndex]} (${kanaHangulFeedback[symbolIndex]})`;
        } else if (this._mode === 'katakana') {
          text = `${katakanaSymbols[symbolIndex]} (${kanaHangulFeedback[symbolIndex]})`;
        }
      }
      el.textContent = text;
      el.classList.add('correct');
    } else {
      el.textContent = '오답! ❌';
      el.classList.add('wrong');
    }

    clearTimeout(this._feedbackTimer);
    this._feedbackTimer = setTimeout(() => {
      el.classList.add('hidden');
    }, 1500);
  }

  _updateScore() {
    const el = document.getElementById('game-score');
    if (el) el.textContent = `${this._score} / ${this._winScore}점`;
  }

  // ─── Freeze ───────────────────────────────────────────────────────────────

  _applyFreeze(penaltyMs) {
    this._frozen = true;
    this._clearFreeze();

    const msg      = document.getElementById('game-freeze-msg');
    const countdown = document.getElementById('freeze-countdown');
    const card     = document.getElementById('my-card');
    if (msg) msg.classList.remove('hidden');
    if (card) card.classList.add('frozen');

    let remaining = Math.ceil(penaltyMs / 1000);
    if (countdown) countdown.textContent = remaining;

    this._freezeInterval = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        if (countdown) countdown.textContent = remaining;
      } else {
        this._clearFreeze();
      }
    }, 1000);
  }

  _clearFreeze() {
    if (this._freezeInterval) {
      clearInterval(this._freezeInterval);
      this._freezeInterval = null;
    }
    this._frozen = false;
    const msg  = document.getElementById('game-freeze-msg');
    const card = document.getElementById('my-card');
    if (msg)  msg.classList.add('hidden');
    if (card) card.classList.remove('frozen');
  }

  // ─── Waiting players ─────────────────────────────────────────────────────

  _renderWaitingPlayers(players) {
    const list = document.getElementById('waiting-players');
    if (!list) return;
    list.innerHTML = players
      .filter(p => p.id !== this.playerId)
      .map(p => `
        <div class="db-waiting-player">
          <span class="db-wp-dot" style="background:${p.color}"></span>
          <span>${p.nickname}</span>
        </div>
      `).join('');
  }

  // ─── Rejoin state ─────────────────────────────────────────────────────────

  _applyRejoinState({ phase, mode, winScore, myCard, centerCard, score, frozenPlayers }) {
    if (phase !== 'playing') return;
    this._mode     = mode;
    this._winScore = winScore;
    this._myCard   = myCard ?? [];
    this._score    = score ?? 0;
    this._updateScore();

    if (frozenPlayers && frozenPlayers.includes(this.playerId)) {
      this._applyFreeze(FREEZE_MS);
    } else {
      this._clearFreeze();
    }

    if (this._myCard.length > 0) {
      this._renderCard();
      this.showScreen('game');
    }
  }

  // ─── Result ──────────────────────────────────────────────────────────────

  _renderResult(rankings) {
    const medals  = ['🥇', '🥈', '🥉'];
    const myRank  = rankings.findIndex(p => p.id === this.playerId);

    const icon   = document.getElementById('result-icon');
    const status = document.getElementById('result-status');
    if (icon)   icon.textContent   = myRank === 0 ? '🏆' : (medals[myRank] ?? '🎮');
    if (status) status.textContent = myRank === 0 ? '우승!' : `${myRank + 1}위`;

    const list = document.getElementById('result-rankings');
    if (list) {
      list.innerHTML = rankings.map((p, i) => `
        <div class="db-result-row${p.id === this.playerId ? ' me' : ''}">
          <span class="db-result-medal">${medals[i] ?? `${i + 1}위`}</span>
          <span class="db-result-dot" style="background:${p.color}"></span>
          <span class="db-result-name">${p.nickname}</span>
          <span class="db-result-score">${p.score}점</span>
        </div>
      `).join('');
    }
  }
}
