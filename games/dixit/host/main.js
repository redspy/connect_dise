import { HostSDK }       from '../../../platform/client/HostSDK.js';
import { HostBaseGame }  from '../../../platform/client/HostBaseGame.js';
import { DeckManager }   from '../shared/deck.js';
import { calculateRoundScores } from '../shared/scoring.js';
import { getHandSize, WIN_SCORE, MIN_PLAYERS, CARD_COUNT } from '../shared/constants.js';

class DixitGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'dx-overlay' });

    this._profiles      = new Map();  // id → { nickname }
    this._hands         = new Map();  // id → cardId[]
    this._scores        = new Map();  // id → number
    this._deck          = null;

    this._round          = 0;
    this._storytellerIdx = 0;
    this._storytellerId  = null;
    this._clue           = '';
    this._submissions    = [];  // [{ playerId, cardId }]
    this._votes          = [];  // [{ voterId, cardId }]
    this._boardCards     = [];  // 투표용 셔플 배열
    this._gameStarted    = false;
    this._readyCount     = 0;

    this._phaseTimeLimit    = 120;  // seconds (기본 2분)
    this._phaseTimerTimeout = null;
    this._phaseTimerInterval = null;
    this._phaseTimerStart   = 0;

    this._wireHandlers();
  }

  // ── HostBaseGame hooks ────────────────────────────────────────────────────

  async onSetup() {
    const appbar = document.querySelector('game-appbar');
    if (appbar) appbar.onRestart = () => this.resetSession();

    const lobby = document.querySelector('game-lobby');
    if (lobby) lobby.onStart = () => this._startGame();

    document.getElementById('next-round-btn')
      .addEventListener('click', () => this._nextRound());
    document.getElementById('restart-btn')
      .addEventListener('click', () => this.resetSession());

    this._initCardGallery();
    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    this._scores.set(player.id, 0);
    this.renderLobbyPlayers(this._getLobbyProfiles());
    this.updateLobbyReady(this._readyCount);
  }

  onPlayerLeave(playerId) {
    this._profiles.delete(playerId);
    this._scores.delete(playerId);
    this._hands.delete(playerId);
    this.renderLobbyPlayers(this._getLobbyProfiles());
    this.updateLobbyReady(this._readyCount);
  }

  onReadyUpdate({ readyCount }) {
    this._readyCount = readyCount;
    this.updateLobbyReady(readyCount);
  }

  onPlayerRejoin(player) {
    this._sendRejoinState(player.id);
  }

  onAllReady() {
    if (!this._gameStarted) this._startGame();
  }

  onReset() {
    this._clearPhaseTimer();
    this._profiles.clear();
    this._hands.clear();
    this._scores.clear();
    this._deck          = null;
    this._round          = 0;
    this._storytellerIdx = 0;
    this._storytellerId  = null;
    this._clue           = '';
    this._submissions    = [];
    this._votes          = [];
    this._boardCards     = [];
    this._gameStarted    = false;
    this._readyCount     = 0;
    for (const p of this.players.values()) this._scores.set(p.id, 0);
    this.renderLobbyPlayers(this._getLobbyProfiles());
    this.updateLobbyReady(0);
    this.setPhase('lobby');
  }

  // ── Message handlers ─────────────────────────────────────────────────────

  _wireHandlers() {
    this.onMessage('setProfile', (player, { nickname }) => {
      const name = nickname?.trim() || '익명';
      this._profiles.set(player.id, { nickname: name });
      this.setPlayerName(player.id, name);
      this.renderLobbyPlayers(this._getLobbyProfiles());
      this._broadcastPlayerList();
      if (this._gameStarted) this._sendRejoinState(player.id);
    });

    this.onMessage('submitClue', (player, { cardId, clue }) => {
      if (this.phase !== 'storytelling') return;
      if (player.id !== this._storytellerId) return;
      if (!clue?.trim() || !cardId) return;

      this._clue = clue.trim();
      this._submissions.push({ playerId: player.id, cardId });

      this._transitionToCardSelection();
    });

    this.onMessage('submitCard', (player, { cardId }) => {
      if (this.phase !== 'card-selection') return;
      if (player.id === this._storytellerId) return;
      if (this._submissions.find(s => s.playerId === player.id)) return;
      if (!this._hands.get(player.id)?.includes(cardId)) return;

      this._submissions.push({ playerId: player.id, cardId });
      this._renderSubmissionGrid();

      if (this._submissions.length === this.playerCount) {
        this._startVoting();
      }
    });

    this.onMessage('submitVote', (player, { cardId }) => {
      if (this.phase !== 'voting') return;
      if (player.id === this._storytellerId) return;
      if (this._votes.find(v => v.voterId === player.id)) return;
      const myCard = this._submissions.find(s => s.playerId === player.id)?.cardId;
      if (cardId === myCard) return;

      this._votes.push({ voterId: player.id, cardId });
      this._renderVoteProgress();

      const nonStorytellers = [...this.players.keys()].filter(id => id !== this._storytellerId);
      if (this._votes.length === nonStorytellers.length) {
        this._revealResults();
      }
    });
  }

  // ── Game flow ─────────────────────────────────────────────────────────────

  _startGame() {
    const timeSel = document.getElementById('sel-time-limit');
    this._phaseTimeLimit = timeSel ? Number(timeSel.value) : 120;

    this._gameStarted = true;
    this._deck = new DeckManager();

    const playerIds = [...this.players.keys()];
    const handSize  = getHandSize(playerIds.length);
    const needed    = playerIds.length * handSize;

    if (!this._deck.canDraw(needed)) {
      const msg = `카드가 부족합니다! ${playerIds.length}인 게임에 ${needed}장 필요 (현재 ${this._deck.remaining}장)`;
      document.getElementById('ready-status').textContent = msg;
      this._gameStarted = false;
      return;
    }

    for (const id of playerIds) {
      this._scores.set(id, 0);
      this._hands.set(id, this._deck.draw(handSize));
    }

    this._startRound(1);
  }

  _startRound(round) {
    this._round         = round;
    this._clue          = '';
    this._submissions   = [];
    this._votes         = [];
    this._boardCards    = [];

    const playerIds       = [...this.players.keys()];
    this._storytellerIdx  = (round - 1) % playerIds.length;
    this._storytellerId   = playerIds[this._storytellerIdx];

    const name = this._profiles.get(this._storytellerId)?.nickname ?? '?';
    document.getElementById('storyteller-name').textContent = `${name}의 턴 (이야기꾼)`;

    this.setPhase('storytelling');
    this.broadcast('roundStarted', { round, storytellerId: this._storytellerId });

    // 각 플레이어에게 손패 비공개 전송
    for (const [id, hand] of this._hands) {
      this.sendToPlayer(id, 'dealHand', { hand });
    }

    this._startPhaseTimer('storytelling');
  }

  _transitionToCardSelection() {
    this.setPhase('card-selection');
    document.getElementById('current-clue').textContent = `"${this._clue}"`;
    this._renderSubmissionGrid();
    this.broadcast('clueSubmitted', { clue: this._clue });
    this._startPhaseTimer('card-selection');
  }

  _startVoting() {
    this._boardCards = [...this._submissions]
      .sort(() => Math.random() - 0.5)
      .map(s => s.cardId);

    this.setPhase('voting');
    document.getElementById('voting-clue').textContent = `"${this._clue}"`;
    this._renderCardBoard();
    this._renderVoteProgress();

    this.broadcast('votingStarted', {
      clue: this._clue,
      boardCards: this._boardCards,
    });

    this._startPhaseTimer('voting');
  }

  _revealResults() {
    this._clearPhaseTimer();
    const allPlayerIds = [...this.players.keys()];
    const { deltas, scoringCase } = calculateRoundScores(
      this._storytellerId, this._submissions, this._votes, allPlayerIds
    );

    for (const [id, delta] of Object.entries(deltas)) {
      this._scores.set(id, (this._scores.get(id) ?? 0) + delta);
    }

    const totals       = Object.fromEntries([...this._scores]);
    const cardOwnerMap = Object.fromEntries(this._submissions.map(s => [s.cardId, s.playerId]));
    const votesOnCard  = {};
    for (const v of this._votes) {
      votesOnCard[v.cardId] = (votesOnCard[v.cardId] ?? 0) + 1;
    }

    this.setPhase('round-result');
    this._renderRoundResult(scoringCase, deltas, totals, cardOwnerMap, votesOnCard);

    const storyCardId = this._submissions.find(s => s.playerId === this._storytellerId)?.cardId;
    this.broadcast('roundResult', {
      storytellerCardId: storyCardId,
      boardCards:  this._boardCards,
      cardOwnerMap,
      clue:        this._clue,
      deltas,
      totals,
      scoringCase,
    });
  }

  _nextRound() {
    // 사용한 카드 디스카드
    const usedCards = this._submissions.map(s => s.cardId);
    this._deck.discard(usedCards);

    const playerIds = [...this.players.keys()];

    // 종료 조건 확인
    const maxScore = Math.max(...playerIds.map(id => this._scores.get(id) ?? 0));
    if (maxScore >= WIN_SCORE || !this._deck.canDraw(playerIds.length)) {
      this._endGame();
      return;
    }

    // 손패 보충 (1인 1장)
    for (const id of playerIds) {
      const hand    = this._hands.get(id) ?? [];
      const usedCard = this._submissions.find(s => s.playerId === id)?.cardId;
      if (usedCard) {
        const idx = hand.indexOf(usedCard);
        if (idx !== -1) hand.splice(idx, 1);
      }
      if (this._deck.canDraw(1)) {
        const [newCard] = this._deck.draw(1);
        hand.push(newCard);
      }
      this._hands.set(id, hand);
    }

    this._startRound(this._round + 1);
  }

  _endGame() {
    const ranked = [...this.players.values()]
      .map(p => ({
        id:       p.id,
        color:    p.color,
        nickname: this._profiles.get(p.id)?.nickname ?? '익명',
        score:    this._scores.get(p.id) ?? 0,
      }))
      .sort((a, b) => b.score - a.score);

    this.setPhase('final');
    this._renderFinalRanking(ranked);
    this.broadcast('gameFinished', { rankings: ranked });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  _getLobbyProfiles() {
    const map = new Map();
    for (const [id, profile] of this._profiles) {
      map.set(id, { nickname: profile.nickname });
    }
    return map;
  }

  _renderSubmissionGrid() {
    const grid = document.getElementById('submission-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const [id, player] of this.players) {
      const submitted = this._submissions.some(s => s.playerId === id);
      const nick      = this._profiles.get(id)?.nickname ?? '익명';
      const isStory   = id === this._storytellerId;
      const el        = document.createElement('div');
      el.className    = `dx-submission-card ${submitted ? 'done' : 'waiting'}`;
      el.style.borderColor = player.color;
      el.innerHTML = `
        <span class="dx-ss-nick">${nick}</span>
        <span class="dx-ss-icon">${isStory ? '✍️' : (submitted ? '✅' : '⌛')}</span>
      `;
      grid.appendChild(el);
    }
  }

  _renderCardBoard() {
    const board = document.getElementById('card-board');
    if (!board) return;
    board.innerHTML = '';
    for (const cardId of this._boardCards) {
      const img = document.createElement('img');
      img.className = 'dx-card';
      img.src = `/games/dixit/assets/cards/${cardId}.png`;
      img.alt = cardId;
      board.appendChild(img);
    }
  }

  _renderVoteProgress() {
    const bar = document.getElementById('vote-progress');
    if (!bar) return;
    const nonStorytellers = [...this.players.keys()].filter(id => id !== this._storytellerId);
    bar.innerHTML = nonStorytellers.map(id => {
      const nick  = this._profiles.get(id)?.nickname ?? '익명';
      const voted = this._votes.some(v => v.voterId === id);
      const color = this.players.get(id)?.color ?? '#fff';
      return `<span class="vote-dot ${voted ? 'voted' : ''}" style="--color:${color}" title="${nick}"></span>`;
    }).join('');
  }

  _renderRoundResult(scoringCase, deltas, totals, cardOwnerMap, votesOnCard) {
    const caseText = {
      'partial':     '일부 정답! 이야기꾼 +3, 정답자 +3',
      'all-correct': '전원 정답! 이야기꾼 점수 없음, 모두 +2',
      'all-wrong':   '전원 오답! 이야기꾼 점수 없음, 모두 +2',
    };
    document.getElementById('round-conclusion').textContent = caseText[scoringCase] ?? '';

    const storyCardId  = this._submissions.find(s => s.playerId === this._storytellerId)?.cardId;
    const resultCards  = document.getElementById('result-cards');
    resultCards.innerHTML = '';
    for (const cardId of this._boardCards) {
      const ownerId   = cardOwnerMap[cardId];
      const ownerNick = this._profiles.get(ownerId)?.nickname ?? '익명';
      const ownerColor = this.players.get(ownerId)?.color ?? '#fff';
      const isStory   = cardId === storyCardId;
      const voteCount = votesOnCard[cardId] ?? 0;
      const wrap      = document.createElement('div');
      wrap.className  = `dx-result-card-wrap${isStory ? ' storyteller-card' : ''}`;
      wrap.innerHTML  = `
        <img class="dx-card" src="/games/dixit/assets/cards/${cardId}.png" alt="${cardId}">
        <div class="dx-card-owner" style="border-color:${ownerColor}">${ownerNick}${isStory ? ' 👑' : ''}</div>
        ${voteCount > 0 ? `<div class="dx-vote-count">${voteCount}표</div>` : ''}
      `;
      resultCards.appendChild(wrap);
    }

    const scoresEl = document.getElementById('score-updates');
    scoresEl.innerHTML = '';
    for (const [id, player] of this.players) {
      const nick  = this._profiles.get(id)?.nickname ?? '익명';
      const delta = deltas[id] ?? 0;
      const total = totals[id] ?? 0;
      const el    = document.createElement('div');
      el.className = 'dx-score-row';
      el.style.borderLeft = `4px solid ${player.color}`;
      el.innerHTML = `
        <span class="dx-su-nick">${nick}</span>
        <span class="dx-su-delta ${delta > 0 ? 'plus' : ''}">${delta > 0 ? '+' : ''}${delta}점</span>
        <span class="dx-su-total">→ ${total}점</span>
      `;
      scoresEl.appendChild(el);
    }
  }

  _renderFinalRanking(ranked) {
    const list   = document.getElementById('ranking-list');
    const medals = ['🥇', '🥈', '🥉'];
    let displayRank = 1;
    list.innerHTML = ranked.map((p, i) => {
      if (i > 0 && p.score < ranked[i - 1].score) displayRank = i + 1;
      const medal = medals[displayRank - 1] ?? `${displayRank}위`;
      return `
        <div class="dx-rank-row ${displayRank === 1 ? 'winner' : ''}">
          <span class="dx-rank-medal">${medal}</span>
          <div class="dx-rank-dot" style="background:${p.color}"></div>
          <span class="dx-rank-name">${p.nickname}</span>
          <span class="dx-rank-score">${p.score}점</span>
        </div>
      `;
    }).join('');
  }

  // ── Card Gallery ──────────────────────────────────────────────────────────

  _initCardGallery() {
    const overlay  = document.getElementById('dx-card-gallery');
    const grid     = document.getElementById('dx-gallery-grid');
    const zoomEl   = document.getElementById('dx-card-zoom');
    const zoomImg  = document.getElementById('dx-zoom-img');
    const zoomLbl  = document.getElementById('dx-zoom-label');

    // 버튼 텍스트 및 헤더 카운트를 CARD_COUNT 기준으로 동적 설정
    const viewBtn   = document.getElementById('btn-view-all-cards');
    const countSpan = document.getElementById('dx-gallery-count');
    if (viewBtn)   viewBtn.textContent   = `🃏 모든 카드 보기 (${CARD_COUNT}장)`;
    if (countSpan) countSpan.textContent = `${CARD_COUNT}장`;

    // 카드 그리드 채우기 (lazy: 첫 오픈 시 1회만)
    let built = false;
    const buildGrid = () => {
      if (built) return;
      built = true;
      for (let i = 1; i <= CARD_COUNT; i++) {
        const id  = `card_${String(i).padStart(3, '0')}`;
        const src = `/games/dixit/assets/cards/${id}.png`;

        const card = document.createElement('div');
        card.className = 'dx-gallery-card';
        card.innerHTML = `
          <img src="${src}" alt="${id}" loading="lazy">
          <div class="dx-gallery-card-num">${i}</div>
        `;
        card.addEventListener('click', () => {
          zoomImg.src = src;
          zoomLbl.textContent = `카드 #${i}`;
          zoomEl.classList.remove('hidden');
        });
        grid.appendChild(card);
      }
    };

    // 열기
    document.getElementById('btn-view-all-cards')
      .addEventListener('click', () => {
        buildGrid();
        overlay.classList.remove('hidden');
      });

    // 닫기 — X 버튼
    document.getElementById('btn-close-gallery')
      .addEventListener('click', () => overlay.classList.add('hidden'));

    // 닫기 — 오버레이 배경 클릭
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });

    // 줌 닫기 — 클릭
    zoomEl.addEventListener('click', () => zoomEl.classList.add('hidden'));

    // ESC 닫기
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (!zoomEl.classList.contains('hidden')) {
          zoomEl.classList.add('hidden');
        } else {
          overlay.classList.add('hidden');
        }
      }
    });
  }

  // ── Phase Timer ───────────────────────────────────────────────────────────

  _startPhaseTimer(phase) {
    this._clearPhaseTimer();
    if (!this._phaseTimeLimit) return;

    this._phaseTimerStart = Date.now();
    this.broadcast('phaseTimer', { duration: this._phaseTimeLimit, phase });

    let remaining = this._phaseTimeLimit;
    this._updateHostTimerDisplay(remaining);

    this._phaseTimerInterval = setInterval(() => {
      remaining--;
      this._updateHostTimerDisplay(remaining);
      if (remaining <= 0) {
        clearInterval(this._phaseTimerInterval);
        this._phaseTimerInterval = null;
      }
    }, 1000);

    this._phaseTimerTimeout = setTimeout(() => {
      this._phaseTimerTimeout = null;
      this._onPhaseTimeout(phase);
    }, this._phaseTimeLimit * 1000);
  }

  _clearPhaseTimer() {
    if (this._phaseTimerTimeout) {
      clearTimeout(this._phaseTimerTimeout);
      this._phaseTimerTimeout = null;
    }
    if (this._phaseTimerInterval) {
      clearInterval(this._phaseTimerInterval);
      this._phaseTimerInterval = null;
    }
    this._updateHostTimerDisplay(0, true);
  }

  _updateHostTimerDisplay(remaining, hide = false) {
    const el = document.getElementById('dx-host-timer');
    if (!el) return;
    if (hide || remaining <= 0) {
      el.classList.add('hidden');
      return;
    }
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    el.textContent = `⏱ ${mins}:${secs.toString().padStart(2, '0')}`;
    el.classList.remove('hidden');
    el.classList.toggle('dx-timer-warning', remaining <= 30);
  }

  _onPhaseTimeout(phase) {
    if (phase === 'storytelling') {
      if (this.phase !== 'storytelling') return;
      // 이야기꾼이 제출하지 않았으면 랜덤 카드로 자동 처리
      if (!this._submissions.find(s => s.playerId === this._storytellerId)) {
        const hand = this._hands.get(this._storytellerId) ?? [];
        if (hand.length === 0) return;
        const cardId = hand[Math.floor(Math.random() * hand.length)];
        this._clue = '(시간 초과)';
        this._submissions.push({ playerId: this._storytellerId, cardId });
      }
      this._transitionToCardSelection();

    } else if (phase === 'card-selection') {
      if (this.phase !== 'card-selection') return;
      // 미제출 플레이어 랜덤 카드로 자동 처리
      for (const [id, hand] of this._hands) {
        if (id === this._storytellerId) continue;
        if (this._submissions.find(s => s.playerId === id)) continue;
        const used = new Set(this._submissions.map(s => s.cardId));
        const available = hand.filter(c => !used.has(c));
        const cardId = available.length > 0
          ? available[Math.floor(Math.random() * available.length)]
          : hand[0];
        if (cardId) this._submissions.push({ playerId: id, cardId });
      }
      this._renderSubmissionGrid();
      this._startVoting();

    } else if (phase === 'voting') {
      if (this.phase !== 'voting') return;
      this._revealResults();
    }
  }

  _getPhaseTimerRemaining() {
    if (!this._phaseTimerStart || !this._phaseTimeLimit || !this._phaseTimerTimeout) return null;
    return Math.max(0, Math.ceil((this._phaseTimerStart + this._phaseTimeLimit * 1000 - Date.now()) / 1000));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _broadcastPlayerList() {
    this.broadcast('playerListUpdated', { players: this._buildPlayerList() });
  }

  _buildPlayerList() {
    // 프로필을 아직 보내지 않은 플레이어는 목록에서 제외 (새로 접속 중인 플레이어의 '익명' 노출 방지)
    return [...this.players.values()]
      .filter(p => this._profiles.has(p.id))
      .map(p => ({
        id:       p.id,
        color:    p.color,
        nickname: this._profiles.get(p.id).nickname,
        score:    this._scores.get(p.id) ?? 0,
      }));
  }

  _sendRejoinState(playerId) {
    if (!this._gameStarted) {
      this.sendToPlayer(playerId, 'rejoinState', {
        phase:    'lobby',
        players:  this._buildPlayerList(),
        myProfile: this._profiles.get(playerId) ?? null,
      });
      return;
    }
    const storyCardId = this._submissions.find(s => s.playerId === this._storytellerId)?.cardId;
    this.sendToPlayer(playerId, 'rejoinState', {
      phase:              this.phase,
      players:            this._buildPlayerList(),
      round:              this._round,
      storytellerId:      this._storytellerId,
      clue:               this._clue,
      hand:               this._hands.get(playerId) ?? [],
      boardCards:         (this.phase === 'voting' || this.phase === 'round-result') ? this._boardCards : [],
      alreadySubmitted:   this._submissions.some(s => s.playerId === playerId),
      alreadyVoted:       this._votes.some(v => v.voterId === playerId),
      mySubmittedCard:    this._submissions.find(s => s.playerId === playerId)?.cardId ?? null,
      myProfile:          this._profiles.get(playerId) ?? null,
      totals:             Object.fromEntries(this._scores),
      storyCardId:        this.phase === 'round-result' ? storyCardId : null,
      phaseTimerRemaining: this._getPhaseTimerRemaining(),
    });
  }
}

const sdk  = new HostSDK({ gameId: 'dixit' });
new DixitGame(sdk);
