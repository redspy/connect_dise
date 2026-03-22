import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';

export class DixitMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'dx-screen' });

    this._nickname        = '';
    this._isStoryteller   = false;
    this._hand            = [];
    this._selectedCard    = null;
    this._mySubmittedCard = null;
    this._selectedVote    = null;
    this._submitted       = false;
    this._voted           = false;
    this._players         = [];
    this._round           = 0;
    this._storytellerId   = null;
    this._clue            = '';
    this._boardCards      = [];
    this._myScore         = 0;

    this._clientTimerInterval = null;

    this._wireUI();
    this._wireMessages();
    this._prefillNickname();
  }

  // ── MobileBaseGame hooks ──────────────────────────────────────────────────

  onJoin() {
    this.showScreen('setup');
  }

  onRejoin() {
    if (this._nickname) this._sendProfile();
  }

  onReset() {
    this._clearClientTimer();
    this._isStoryteller   = false;
    this._hand            = [];
    this._selectedCard    = null;
    this._mySubmittedCard = null;
    this._selectedVote    = null;
    this._submitted       = false;
    this._voted           = false;
    this._round           = 0;
    this._storytellerId   = null;
    this._clue            = '';
    this._boardCards      = [];
    this._myScore         = 0;

    const readyBtn = document.getElementById('btn-ready');
    if (readyBtn) {
      readyBtn.disabled    = false;
      readyBtn.textContent = '준비하기';
    }

    if (this._nickname) {
      this._sendProfile();
    } else {
      this.showScreen('setup');
    }
  }

  // ── UI wiring ─────────────────────────────────────────────────────────────

  _wireUI() {
    document.getElementById('btn-join').addEventListener('click', () => {
      const nick = document.getElementById('nickname-input').value.trim();
      if (!nick) return;
      this._nickname = nick;
      this._sendProfile();
    });
    document.getElementById('nickname-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-join').click();
    });

    document.getElementById('btn-ready').addEventListener('click', () => {
      document.getElementById('btn-ready').disabled    = true;
      document.getElementById('btn-ready').textContent = '준비 완료 ✓';
      this.ready();
    });

    document.getElementById('clue-input').addEventListener('input', () => this._updateClueBtn());
    document.getElementById('submit-clue-btn').addEventListener('click', () => {
      if (!this._selectedCard) return;
      const clue = document.getElementById('clue-input').value.trim();
      if (!clue) return;
      this.sendToHost('submitClue', { cardId: this._selectedCard, clue });
      document.getElementById('submit-clue-btn').disabled    = true;
      document.getElementById('submit-clue-btn').textContent = '제출 완료! 기다리는 중...';
    });

    document.getElementById('submit-card-btn').addEventListener('click', () => {
      if (!this._selectedCard || this._submitted) return;
      this._submitted       = true;
      this._mySubmittedCard = this._selectedCard;
      this.sendToHost('submitCard', { cardId: this._selectedCard });
      document.getElementById('submit-card-btn').disabled    = true;
      document.getElementById('submit-card-btn').textContent = '제출 완료! 기다리는 중...';
    });

    document.getElementById('submit-vote-btn').addEventListener('click', () => {
      if (!this._selectedVote || this._voted) return;
      this._voted = true;
      this.sendToHost('submitVote', { cardId: this._selectedVote });
      document.getElementById('submit-vote-btn').disabled    = true;
      document.getElementById('submit-vote-btn').textContent = '투표 완료! 기다리는 중...';
    });
  }

  _updateClueBtn() {
    const clue  = document.getElementById('clue-input').value.trim();
    const btn   = document.getElementById('submit-clue-btn');
    const ready = !!(clue && this._selectedCard);
    btn.disabled    = !ready;
    btn.textContent = ready ? '힌트와 카드 제출' : '카드와 힌트를 선택하세요';
  }

  // ── Message handlers ──────────────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('playerListUpdated', ({ players }) => {
      this._players = players;
      this._renderWaitingPlayers();
    });

    this.onMessage('roundStarted', ({ round, storytellerId }) => {
      this._round           = round;
      this._storytellerId   = storytellerId;
      this._isStoryteller   = storytellerId === this.playerId;
      this._selectedCard    = null;
      this._mySubmittedCard = null;
      this._selectedVote    = null;
      this._submitted       = false;
      this._voted           = false;
    });

    this.onMessage('dealHand', ({ hand }) => {
      this._hand = hand;
      if (this._isStoryteller) {
        this._showStorytellerClueScreen();
      } else {
        this._setWaitingHint('이야기꾼이 힌트를 고르는 중...');
        this.showScreen('waiting');
      }
    });

    this.onMessage('clueSubmitted', ({ clue }) => {
      this._clue = clue;
      if (!this._isStoryteller) this._showCardSelectScreen();
    });

    this.onMessage('votingStarted', ({ clue, boardCards }) => {
      this._clue       = clue;
      this._boardCards = boardCards;
      if (!this._isStoryteller) {
        this._showVoteScreen();
      } else {
        this._setWaitingHint('플레이어들이 투표하는 중...');
        this.showScreen('waiting');
      }
    });

    this.onMessage('phaseTimer', ({ duration, phase }) => {
      this._startClientTimer(duration, phase);
    });

    this.onMessage('roundResult', ({ deltas, totals }) => {
      this._clearClientTimer();
      const delta   = deltas[this.playerId] ?? 0;
      this._myScore = totals[this.playerId] ?? this._myScore;
      this._showRoundResultScreen(delta, false);
    });

    this.onMessage('gameFinished', ({ rankings }) => {
      this._myScore = rankings.find(r => r.id === this.playerId)?.score ?? this._myScore;
      this._showRoundResultScreen(0, true);
    });

    this.onMessage('rejoinState', payload => this._applyRejoinState(payload));
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  _sendProfile() {
    this.sendToHost('setProfile', { nickname: this._nickname });
    localStorage.setItem('dixit_nickname', this._nickname);
    document.getElementById('waiting-nickname').textContent = this._nickname;
    this._setWaitingHint('게임 시작을 기다리는 중...');
    this.showScreen('waiting');
  }

  _prefillNickname() {
    const saved = localStorage.getItem('dixit_nickname');
    if (saved) {
      this._nickname = saved;
      document.getElementById('nickname-input').value = saved;
    }
  }

  // ── Screen helpers ────────────────────────────────────────────────────────

  _setWaitingHint(text) {
    const el = document.getElementById('waiting-hint');
    if (el) el.textContent = text;
  }

  _renderWaitingPlayers() {
    const el = document.getElementById('waiting-players');
    if (!el) return;
    el.innerHTML = this._players.map(p => `
      <div class="dx-waiting-player" style="border-left: 3px solid ${p.color}">
        <span>${p.nickname}</span>
        <span class="dx-player-score">${p.score}점</span>
      </div>
    `).join('');
  }

  _showStorytellerClueScreen() {
    this._selectedCard = null;
    const handEl = document.getElementById('storyteller-hand');
    handEl.innerHTML = '';
    document.getElementById('clue-input').value = '';
    const btn = document.getElementById('submit-clue-btn');
    btn.disabled    = true;
    btn.textContent = '카드와 힌트를 선택하세요';

    for (const cardId of this._hand) {
      const img = this._createCardImg(cardId, () => {
        this._selectedCard = cardId;
        handEl.querySelectorAll('.dx-card-img').forEach(c => c.classList.remove('selected'));
        img.classList.add('selected');
        this._updateClueBtn();
      });
      handEl.appendChild(img);
    }
    this.showScreen('storyteller-clue');
  }

  _showCardSelectScreen() {
    this._selectedCard = null;
    this._submitted    = false;
    const handEl = document.getElementById('follower-hand');
    handEl.innerHTML = '';
    document.getElementById('current-clue').textContent = `"${this._clue}"`;
    const btn = document.getElementById('submit-card-btn');
    btn.disabled    = true;
    btn.textContent = '카드를 선택하세요';

    for (const cardId of this._hand) {
      const img = this._createCardImg(cardId, () => {
        this._selectedCard = cardId;
        handEl.querySelectorAll('.dx-card-img').forEach(c => c.classList.remove('selected'));
        img.classList.add('selected');
        btn.disabled    = false;
        btn.textContent = '이 카드 제출';
      });
      handEl.appendChild(img);
    }
    this.showScreen('card-select');
  }

  _showVoteScreen() {
    this._selectedVote = null;
    this._voted        = false;
    document.getElementById('voting-clue').textContent = `"${this._clue}"`;
    const boardEl = document.getElementById('voting-board');
    boardEl.innerHTML = '';
    const btn = document.getElementById('submit-vote-btn');
    btn.disabled    = true;
    btn.textContent = '투표하기';

    // 카드 수에 따라 그리드 열·행 동적 설정
    const n    = this._boardCards.length;
    const cols = (n === 4) ? 2 : 3;
    const rows = Math.ceil(n / cols);
    boardEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    boardEl.style.gridAutoRows        = rows > 1 ? '1fr' : 'auto';

    for (const cardId of this._boardCards) {
      const isMine = cardId === this._mySubmittedCard;
      const img    = this._createCardImg(cardId, isMine ? null : () => {
        this._selectedVote = cardId;
        boardEl.querySelectorAll('.dx-card-img').forEach(c => c.classList.remove('selected'));
        img.classList.add('selected');
        btn.disabled    = false;
        btn.textContent = '이 카드에 투표';
      });
      if (isMine) img.classList.add('my-submitted');
      boardEl.appendChild(img);
    }
    this.showScreen('vote');
  }

  _showRoundResultScreen(delta, isGameEnd) {
    const titleEl = document.getElementById('result-title');
    if (titleEl) titleEl.textContent = isGameEnd ? '게임 종료! 🎉' : '라운드 종료';

    const msgEl = document.getElementById('result-msg');
    if (msgEl) {
      msgEl.textContent = isGameEnd
        ? 'PC 화면에서 최종 순위를 확인하세요!'
        : `이번 라운드: ${delta > 0 ? '+' : ''}${delta}점`;
    }

    const scoreEl = document.getElementById('my-score');
    if (scoreEl) scoreEl.textContent = this._myScore;

    const waitEl = document.getElementById('waiting-next');
    if (waitEl) waitEl.textContent = isGameEnd ? '' : '다음 라운드를 기다리고 있습니다...';

    this.showScreen('round-result');
  }

  _createCardImg(cardId, onClick) {
    const img          = document.createElement('img');
    img.className      = 'dx-card-img';
    img.src            = `/games/dixit/assets/cards/${cardId}.png`;
    img.alt            = cardId;
    img.dataset.cardId = cardId;
    if (onClick) {
      img.addEventListener('click', onClick);
    } else {
      img.style.cursor = 'not-allowed';
    }
    return img;
  }

  // ── Client Timer ──────────────────────────────────────────────────────────

  _startClientTimer(duration, phase) {
    this._clearClientTimer();
    const timerIds = {
      'storytelling':  'dx-timer-clue',
      'card-selection': 'dx-timer-card',
      'voting':         'dx-timer-vote',
    };
    const timerId = timerIds[phase];
    if (!timerId) return;
    const el = document.getElementById(timerId);
    if (!el) return;

    let remaining = Math.ceil(duration);
    const update = () => {
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      el.textContent = `⏱ ${mins}:${secs.toString().padStart(2, '0')}`;
      el.classList.remove('hidden');
      el.classList.toggle('dx-timer-warning', remaining <= 30);
    };
    update();

    this._clientTimerInterval = setInterval(() => {
      remaining--;
      update();
      if (remaining <= 0) this._clearClientTimer();
    }, 1000);
  }

  _clearClientTimer() {
    if (this._clientTimerInterval) {
      clearInterval(this._clientTimerInterval);
      this._clientTimerInterval = null;
    }
    ['dx-timer-clue', 'dx-timer-card', 'dx-timer-vote'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.add('hidden'); el.textContent = ''; }
    });
  }

  // ── Rejoin ────────────────────────────────────────────────────────────────

  _applyRejoinState({
    phase, players, round, storytellerId, clue, hand,
    boardCards, alreadySubmitted, alreadyVoted, mySubmittedCard,
    myProfile, totals, phaseTimerRemaining,
  }) {
    if (players)          { this._players = players; this._renderWaitingPlayers(); }
    if (round)              this._round           = round;
    if (storytellerId)    {
      this._storytellerId = storytellerId;
      this._isStoryteller = storytellerId === this.playerId;
    }
    if (clue)               this._clue            = clue;
    if (hand)               this._hand            = hand;
    if (boardCards?.length) this._boardCards       = boardCards;
    if (totals)             this._myScore         = totals[this.playerId] ?? this._myScore;
    if (mySubmittedCard)    this._mySubmittedCard  = mySubmittedCard;
    if (myProfile?.nickname) {
      this._nickname = myProfile.nickname;
      document.getElementById('nickname-input').value    = this._nickname;
      document.getElementById('waiting-nickname').textContent = this._nickname;
    }

    if (phase === 'lobby') {
      if (this._nickname) {
        this._setWaitingHint('게임 시작을 기다리는 중...');
        this.showScreen('waiting');
      } else {
        this.showScreen('setup');
      }
      return;
    }

    if (phase === 'storytelling') {
      if (this._isStoryteller) this._showStorytellerClueScreen();
      else { this._setWaitingHint('이야기꾼이 힌트를 고르는 중...'); this.showScreen('waiting'); }
      if (phaseTimerRemaining > 0) this._startClientTimer(phaseTimerRemaining, 'storytelling');
      return;
    }

    if (phase === 'card-selection') {
      if (alreadySubmitted) {
        this._submitted = true;
        this._setWaitingHint('카드를 제출했습니다. 다른 플레이어를 기다리는 중...');
        this.showScreen('waiting');
      } else if (this._isStoryteller) {
        this._setWaitingHint('플레이어들이 카드를 제출하는 중...');
        this.showScreen('waiting');
      } else {
        this._showCardSelectScreen();
      }
      if (phaseTimerRemaining > 0) this._startClientTimer(phaseTimerRemaining, 'card-selection');
      return;
    }

    if (phase === 'voting') {
      if (alreadyVoted) {
        this._voted = true;
        this._setWaitingHint('투표했습니다. 다른 플레이어를 기다리는 중...');
        this.showScreen('waiting');
      } else if (this._isStoryteller) {
        this._setWaitingHint('플레이어들이 투표하는 중...');
        this.showScreen('waiting');
      } else {
        this._showVoteScreen();
      }
      if (phaseTimerRemaining > 0) this._startClientTimer(phaseTimerRemaining, 'voting');
      return;
    }

    if (phase === 'round-result' || phase === 'final') {
      this._showRoundResultScreen(0, phase === 'final');
      return;
    }
  }
}
