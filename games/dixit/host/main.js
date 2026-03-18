import { HostSDK }       from '../../../platform/client/HostSDK.js';
import { HostBaseGame }  from '../../../platform/client/HostBaseGame.js';
import { DeckManager }   from '../shared/deck.js';
import { calculateRoundScores } from '../shared/scoring.js';
import { getHandSize, WIN_SCORE, MIN_PLAYERS } from '../shared/constants.js';

class DixitGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'game-overlay', qrContainerId: 'qr-box' });

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

    this._wireHandlers();
  }

  // ── HostBaseGame hooks ────────────────────────────────────────────────────

  async onSetup({ sessionId }) {
    document.getElementById('join-url').textContent =
      location.origin + '/mobile/#' + sessionId;
    document.getElementById('next-round-btn')
      .addEventListener('click', () => this._nextRound());
    document.getElementById('restart-btn')
      .addEventListener('click', () => this.resetSession());
    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    this._scores.set(player.id, 0);
    this._updateLobby();
  }

  onPlayerLeave(playerId) {
    this._profiles.delete(playerId);
    this._scores.delete(playerId);
    this._hands.delete(playerId);
    this._updateLobby();
  }

  onPlayerRejoin(player) {
    this._sendRejoinState(player.id);
  }

  onAllReady() {
    if (!this._gameStarted) this._startGame();
  }

  onReset() {
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
    for (const p of this.players.values()) this._scores.set(p.id, 0);
    this._updateLobby();
    this.setPhase('lobby');
  }

  // ── Message handlers ─────────────────────────────────────────────────────

  _wireHandlers() {
    this.onMessage('setProfile', (player, { nickname }) => {
      this._profiles.set(player.id, { nickname: nickname?.trim() || '익명' });
      this._updateLobby();
      this._broadcastPlayerList();
      if (this._gameStarted) this._sendRejoinState(player.id);
    });

    this.onMessage('submitClue', (player, { cardId, clue }) => {
      if (this.phase !== 'storytelling') return;
      if (player.id !== this._storytellerId) return;
      if (!clue?.trim() || !cardId) return;

      this._clue = clue.trim();
      this._submissions.push({ playerId: player.id, cardId });

      this.setPhase('card-selection');
      document.getElementById('current-clue').textContent = `"${this._clue}"`;
      this._renderSubmissionGrid();
      this.broadcast('clueSubmitted', { clue: this._clue });
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
  }

  _revealResults() {
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

  _updateLobby() {
    document.getElementById('player-count').textContent = this.playerCount;
    const grid = document.getElementById('player-grid');
    grid.innerHTML = '';
    for (const [id, player] of this.players) {
      const nick = this._profiles.get(id)?.nickname;
      const el   = document.createElement('div');
      el.className = 'player-card glass';
      el.style.borderTop = `4px solid ${player.color}`;
      el.innerHTML = `<div class="player-name">${nick ?? '접속 중...'}</div>`;
      grid.appendChild(el);
    }
    const status = document.getElementById('ready-status');
    if (this.playerCount < MIN_PLAYERS) {
      status.textContent = `최소 ${MIN_PLAYERS}명의 플레이어가 필요합니다.`;
    } else {
      status.textContent = '모든 플레이어가 준비되면 시작합니다.';
    }
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
      el.className    = `submission-status-card ${submitted ? 'done' : 'waiting'}`;
      el.style.borderColor = player.color;
      el.innerHTML = `
        <span class="ss-nick">${nick}</span>
        <span class="ss-icon">${isStory ? '✍️' : (submitted ? '✅' : '⌛')}</span>
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
      img.className = 'dixit-card';
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
      wrap.className  = `result-card-wrap${isStory ? ' storyteller-card' : ''}`;
      wrap.innerHTML  = `
        <img class="dixit-card" src="/games/dixit/assets/cards/${cardId}.png" alt="${cardId}">
        <div class="card-owner" style="border-color:${ownerColor}">${ownerNick}${isStory ? ' 👑' : ''}</div>
        ${voteCount > 0 ? `<div class="vote-count">${voteCount}표</div>` : ''}
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
      el.className = 'score-update-row';
      el.style.borderLeft = `4px solid ${player.color}`;
      el.innerHTML = `
        <span class="su-nick">${nick}</span>
        <span class="su-delta ${delta > 0 ? 'plus' : ''}">${delta > 0 ? '+' : ''}${delta}점</span>
        <span class="su-total">→ ${total}점</span>
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
        <div class="rank-row ${displayRank === 1 ? 'winner' : ''}">
          <span class="rank-medal">${medal}</span>
          <div class="rank-dot" style="background:${p.color}"></div>
          <span class="rank-name">${p.nickname}</span>
          <span class="rank-score">${p.score}점</span>
        </div>
      `;
    }).join('');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _broadcastPlayerList() {
    this.broadcast('playerListUpdated', { players: this._buildPlayerList() });
  }

  _buildPlayerList() {
    return [...this.players.values()].map(p => ({
      id:       p.id,
      color:    p.color,
      nickname: this._profiles.get(p.id)?.nickname ?? '익명',
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
      phase:           this.phase,
      players:         this._buildPlayerList(),
      round:           this._round,
      storytellerId:   this._storytellerId,
      clue:            this._clue,
      hand:            this._hands.get(playerId) ?? [],
      boardCards:      (this.phase === 'voting' || this.phase === 'round-result') ? this._boardCards : [],
      alreadySubmitted: this._submissions.some(s => s.playerId === playerId),
      alreadyVoted:    this._votes.some(v => v.voterId === playerId),
      mySubmittedCard: this._submissions.find(s => s.playerId === playerId)?.cardId ?? null,
      myProfile:       this._profiles.get(playerId) ?? null,
      totals:          Object.fromEntries(this._scores),
      storyCardId:     this.phase === 'round-result' ? storyCardId : null,
    });
  }
}

const sdk  = new HostSDK();
new DixitGame(sdk);
