import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';

const _chooseNumberAudio = new Audio('/games/nunchi-ten/assets/choose_number.mp3');
function _playChooseNumber() {
  _chooseNumberAudio.currentTime = 0;
  _chooseNumberAudio.play().catch(() => {});
}

const MAX_ROUNDS = 10;
const MIN_PLAYERS = 2;
const REVEAL_DURATION_MS = 6000;

export const AVATARS = [
  { id: 1, file: '01_bear_explorer.png', name: '곰 탐험가' },
  { id: 2, file: '02_robot.png', name: '로봇' },
  { id: 3, file: '03_wizard_cat.png', name: '마법사 고양이' },
  { id: 4, file: '04_goblin.png', name: '고블린' },
  { id: 5, file: '05_ghost.png', name: '유령' },
  { id: 6, file: '06_knight.png', name: '기사' },
  { id: 7, file: '07_fox_pilot.png', name: '여우 조종사' },
  { id: 8, file: '08_penguin.png', name: '펭귄' },
];

export function avatarUrl(id) {
  const avatar = AVATARS.find(a => a.id === Number(id));
  return `/games/nunchi-ten/assets/avatars/${avatar?.file ?? '01_bear_explorer.png'}`;
}

export class NunchiGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'n-overlay', qrContainerId: 'qr-container' });

    // Per-player profile & game data (lives outside this.players which platform manages)
    this._profiles = new Map();  // id → { nickname, avatarId }
    this._data = new Map();      // id → { totalScore, remainingCards, doublesLeft, highestRound }
    this._readyCount = 0;
    this._currentRound = 0;
    this._submissions = new Map(); // id → { card, useDouble }
    this._revealing = false;
    this._gameStarted = false;
    this._lastRoundResult = null;
    this._lastRankings = null;

    this._wireGameMessages();
  }

  // ─── HostBaseGame hooks ──────────────────────────────────────────────────

  async onSetup({ sessionId, qrUrl }) {
    document.getElementById('session-code').textContent = sessionId;
    document.getElementById('qr-url-display').textContent = qrUrl;
    document.getElementById('btn-start').addEventListener('click', () => {
      if (this._canStart()) this._startGame();
    });
    document.getElementById('btn-restart-game').addEventListener('click', () => {
      this.resetSession();
    });
    document.getElementById('btn-restart').addEventListener('click', () => {
      this.resetSession();
    });
    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    if (this._gameStarted) {
      // 게임 중 합류 — 현재 라운드에 맞게 사용 카드 처리
      this._initPlayerDataForRound(player.id, this._currentRound);
      this._renderSubmissionStatus();
    } else {
      this._initPlayerData(player.id);
      this._renderLobby();
      this._updateReadyStatus();
    }
  }

  onPlayerRejoin(player) {
    this._sendRejoinState(player.id);
  }

  onPlayerLeave(playerId) {
    this._profiles.delete(playerId);
    this._data.delete(playerId);
    this._submissions.delete(playerId);
    this._renderLobby();
    if (this.phase === 'round_input') this._checkAllSubmitted();
  }

  onReadyUpdate({ readyCount, total }) {
    this._readyCount = readyCount;
    this._updateReadyStatus();
    this._updateStartBtn();
  }

  _updateReadyStatus() {
    const total = this.playerCount;
    const el = document.getElementById('ready-status');
    if (!el) return;
    el.textContent = total === 0
      ? '플레이어를 기다리는 중...'
      : `${this._readyCount}/${total}명 준비완료`;
  }

  onAllReady() {
    if (!this._gameStarted) {
      this._startGame();
    }
  }

  onReset() {
    this._profiles.clear();
    this._data.clear();
    this._submissions.clear();
    this._readyCount = 0;
    this._currentRound = 0;
    this._revealing = false;
    this._gameStarted = false;
    this._lastRoundResult = null;
    this._lastRankings = null;
    for (const p of this.players.values()) this._initPlayerData(p.id);
    document.getElementById('ready-status').textContent = '플레이어를 기다리는 중...';
    this._renderLobby();
    this.setPhase('lobby');
  }

  // ─── Game messages ───────────────────────────────────────────────────────

  _wireGameMessages() {
    this.onMessage('setProfile', (player, { nickname, avatarId }) => {
      this._profiles.set(player.id, { nickname: nickname.trim() || '익명', avatarId: Number(avatarId) || 1 });
      this._renderLobby();
      this._broadcastPlayerList();
      // 게임 진행 중에 합류한 경우 → 즉시 게임 상태 전송
      if (this._gameStarted) {
        this._sendRejoinState(player.id);
        this._renderSubmissionStatus();
      }
    });

    this.onMessage('submitChoice', (player, { card, useDouble }) => {
      this._handleSubmission(player.id, Number(card), Boolean(useDouble));
    });

    this.onMessage('requestRematch', () => {
      this.resetSession();
    });
  }

  // ─── Lobby ───────────────────────────────────────────────────────────────

  _initPlayerData(id) {
    this._data.set(id, {
      totalScore: 0,
      remainingCards: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      doublesLeft: 3,
      highestRound: 0,
    });
  }

  // 게임 중 참가자 — 지나간 라운드만큼 임의 카드를 사용한 것으로 초기화
  _initPlayerDataForRound(id, round) {
    const usedCount = Math.min(Math.max(0, round - 1), 10);
    const allCards = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = [...allCards].sort(() => Math.random() - 0.5);
    const remaining = shuffled.slice(usedCount).sort((a, b) => a - b);
    this._data.set(id, {
      totalScore: 0,
      remainingCards: remaining,
      doublesLeft: Math.max(0, 3 - Math.floor(usedCount / 3)),
      highestRound: 0,
    });
  }

  // 재연결한 플레이어에게 현재 게임 상태 전송
  _sendRejoinState(playerId) {
    const data = this._data.get(playerId);
    if (!data) return;

    const players = this._buildPlayerList();

    // 로비 단계: 프로필이 있으면 대기 화면으로, 없으면 설정 화면으로
    if (!this._gameStarted) {
      const profile = this._profiles.get(playerId);
      this.sendToPlayer(playerId, 'rejoinState', {
        phase: 'lobby',
        players,
        myData: data,
        round: 0,
        maxRounds: MAX_ROUNDS,
        myProfile: profile ?? null,
        rankings: null,
        alreadySubmitted: null,
        lastRoundResult: null,
      });
      return;
    }

    if (this.phase === 'game_result') {
      this.sendToPlayer(playerId, 'rejoinState', {
        phase: 'game_result',
        players,
        myData: data,
        round: this._currentRound,
        maxRounds: MAX_ROUNDS,
        rankings: this._lastRankings,
        alreadySubmitted: null,
        lastRoundResult: null,
      });
      return;
    }

    const sub = this._submissions.get(playerId);
    const alreadySubmitted = sub
      ? { ...sub, submittedCount: this._submissions.size, total: this.playerCount }
      : null;

    this.sendToPlayer(playerId, 'rejoinState', {
      phase: this.phase,
      players,
      myData: data,
      round: this._currentRound,
      maxRounds: MAX_ROUNDS,
      rankings: null,
      alreadySubmitted,
      lastRoundResult: this.phase === 'round_reveal' ? this._lastRoundResult : null,
    });
  }

  _canStart() {
    return this.playerCount >= MIN_PLAYERS && this._readyCount === this.playerCount && this.playerCount > 0;
  }

  _updateStartBtn() {
    const btn = document.getElementById('btn-start');
    if (!btn) return;
    const can = this._canStart();
    btn.disabled = !can;
    if (this.playerCount < MIN_PLAYERS) {
      btn.textContent = `최소 ${MIN_PLAYERS}명 필요 (현재 ${this.playerCount}명)`;
    } else if (this._readyCount < this.playerCount) {
      btn.textContent = `${this._readyCount}/${this.playerCount}명 준비 중...`;
    } else {
      btn.textContent = '🎮 게임 시작!';
    }
  }

  _renderLobby() {
    const grid = document.getElementById('lobby-players');
    if (!grid) return;
    grid.innerHTML = '';
    for (const [id, player] of this.players) {
      const profile = this._profiles.get(id);
      const card = document.createElement('div');
      card.className = 'lobby-player-card';
      card.innerHTML = `
        <div class="lp-avatar" style="border-color:${player.color}">
          ${profile ? `<img src="${avatarUrl(profile.avatarId)}" alt="">` : '<span class="lp-placeholder">?</span>'}
        </div>
        <div class="lp-name">${profile?.nickname ?? '대기 중...'}</div>
      `;
      grid.appendChild(card);
    }
    this._updateStartBtn();
  }

  _broadcastPlayerList() {
    this.broadcast('playerListUpdated', { players: this._buildPlayerList() });
  }

  _buildPlayerList() {
    return [...this.players.values()].map(p => ({
      id: p.id,
      color: p.color,
      nickname: this._profiles.get(p.id)?.nickname ?? '익명',
      avatarId: this._profiles.get(p.id)?.avatarId ?? 1,
      totalScore: this._data.get(p.id)?.totalScore ?? 0,
    }));
  }

  // ─── Dev helpers ─────────────────────────────────────────────────────────

  devJumpToRound(round) {
    if (this.playerCount === 0) return;
    // 이미 사용한 카드 수 = round - 1, 남은 카드 = 10 - (round - 1)장
    const usedCount = round - 1;
    for (const [id, data] of this._data) {
      // 앞 usedCount 장을 사용한 것으로 처리 (1~usedCount 제거)
      data.remainingCards = Array.from({ length: 10 - usedCount }, (_, i) => usedCount + 1 + i);
      data.doublesLeft = Math.max(0, 3 - Math.floor(usedCount / 3));
      data.totalScore = Math.floor(Math.random() * usedCount * 3);
    }
    // 게임이 로비/대기 상태면 gameStarted도 함께 전송
    if (this.phase === 'lobby' || this.phase === 'loading') {
      const players = this._buildPlayerList();
      this.broadcast('gameStarted', { players });
    }
    this._startRound(round);
  }

  // ─── Game flow ───────────────────────────────────────────────────────────

  _startGame() {
    this._gameStarted = true;
    // Reset data for all players
    for (const id of this.players.keys()) this._initPlayerData(id);
    const players = this._buildPlayerList();
    this.broadcast('gameStarted', { players });
    this._startRound(1);
  }

  _startRound(round) {
    this._currentRound = round;
    this._submissions.clear();
    this._revealing = false;

    _playChooseNumber();
    this._renderBoard();
    this.setPhase('round_input');

    this.broadcast('roundStarted', {
      round,
      maxRounds: MAX_ROUNDS,
      playerData: Object.fromEntries(
        [...this.players.keys()].map(id => [id, this._data.get(id)])
      ),
    });
  }

  _handleSubmission(playerId, card, useDouble) {
    if (this.phase !== 'round_input' || this._revealing) return;
    if (this._submissions.has(playerId)) return; // already submitted

    const data = this._data.get(playerId);
    if (!data) return;
    if (!data.remainingCards.includes(card)) return;
    if (useDouble && data.doublesLeft <= 0) return;

    this._submissions.set(playerId, { card, useDouble });
    this._renderSubmissionStatus();

    // Tell all mobiles who has submitted (not what card)
    this.broadcast('submissionStatus', {
      submitted: [...this._submissions.keys()],
      total: this.playerCount,
    });

    this._checkAllSubmitted();
  }

  _checkAllSubmitted() {
    if (this._revealing) return;
    if (this._submissions.size >= this.playerCount) {
      this._revealing = true;
      this._revealRound();
    }
  }

  _revealRound() {
    this._setGameMessage('');
    const entries = [...this._submissions.entries()];

    // Calculate scores
    const roundScores = {};
    for (const [id, sub] of entries) {
      const lowerCount = entries.filter(([, s]) => s.card < sub.card).length;
      roundScores[id] = {
        card: sub.card,
        useDouble: sub.useDouble,
        base: lowerCount,
        final: sub.useDouble ? lowerCount * 2 : lowerCount,
      };
    }

    // Apply to player data
    for (const [id, score] of Object.entries(roundScores)) {
      const data = this._data.get(id);
      if (!data) continue;
      data.totalScore += score.final;
      data.remainingCards = data.remainingCards.filter(c => c !== score.card);
      if (score.useDouble) data.doublesLeft--;
      if (score.final > data.highestRound) data.highestRound = score.final;
    }

    const totals = Object.fromEntries(
      [...this.players.keys()].map(id => [id, this._data.get(id)?.totalScore ?? 0])
    );

    const roundResult = {
      round: this._currentRound,
      scores: roundScores,
      totals,
    };

    this._lastRoundResult = roundResult;
    this.broadcast('roundRevealed', { roundResult });
    this._renderReveal(roundResult);
    this.setPhase('round_reveal');

    const isLastRound = this._currentRound >= MAX_ROUNDS;
    setTimeout(() => {
      if (isLastRound) {
        this._endGame();
      } else {
        this._startRound(this._currentRound + 1);
      }
    }, REVEAL_DURATION_MS);
  }

  _endGame() {
    const ranked = [...this.players.values()]
      .map(p => ({
        id: p.id,
        color: p.color,
        nickname: this._profiles.get(p.id)?.nickname ?? '익명',
        avatarId: this._profiles.get(p.id)?.avatarId ?? 1,
        ...this._data.get(p.id),
      }))
      .sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        if (a.doublesLeft !== b.doublesLeft) return a.doublesLeft - b.doublesLeft;
        return b.highestRound - a.highestRound;
      });

    this._lastRankings = ranked;
    this.broadcast('gameFinished', { rankings: ranked });
    this._renderGameResult(ranked);
    this.setPhase('game_result');
  }

  // ─── Rendering ───────────────────────────────────────────────────────────

  _setGameMessage(text) {
    const el = document.getElementById('game-message');
    if (el) el.textContent = text;
  }

  _renderBoard() {
    document.getElementById('round-display').textContent = `Round ${this._currentRound} / ${MAX_ROUNDS}`;
    this._setGameMessage('숫자를 선택하세요');
    this._renderSubmissionStatus();
  }

  _renderSubmissionStatus() {
    const grid = document.getElementById('player-status-grid');
    if (!grid) return;

    // 순위 계산 (점수 기준 정렬)
    const ranked = [...this.players.values()]
      .map(p => ({ id: p.id, score: this._data.get(p.id)?.totalScore ?? 0 }))
      .sort((a, b) => b.score - a.score);
    const rankMap = new Map(ranked.map((p, i) => [p.id, i + 1]));

    const rankLabel = r => r === 1 ? '1위' : r === 2 ? '2위' : r === 3 ? '3위' : `${r}위`;

    grid.innerHTML = '';
    for (const [id, player] of this.players) {
      const profile = this._profiles.get(id);
      const data = this._data.get(id);
      const submitted = this._submissions.has(id);
      const rank = rankMap.get(id) ?? '-';
      const card = document.createElement('div');
      card.className = `player-status-card ${submitted ? 'submitted' : 'waiting'}`;
      card.innerHTML = `
        <div class="ps-rank" data-rank="${rank}">${rankLabel(rank)}</div>
        <div class="ps-avatar" style="border-color:${player.color}">
          <img src="${avatarUrl(profile?.avatarId ?? 1)}" alt="">
        </div>
        <div class="ps-name">${profile?.nickname ?? '...'}</div>
        <div class="ps-score">${data?.totalScore ?? 0}점</div>
        <div class="ps-status">${submitted ? '✅ 제출완료' : '⌛ 선택 중'}</div>
      `;
      grid.appendChild(card);
    }
  }

  _renderReveal(roundResult) {
    const container = document.getElementById('reveal-cards');
    if (!container) return;
    document.getElementById('reveal-round-title').textContent = `Round ${roundResult.round} 결과`;

    const sorted = [...this.players.values()]
      .map(p => {
        const score = roundResult.scores[p.id] || { card: '?', useDouble: false, base: 0, final: 0 };
        const profile = this._profiles.get(p.id);
        return { ...p, profile, score, total: roundResult.totals[p.id] ?? 0 };
      })
      .sort((a, b) => b.score.final - a.score.final);

    container.innerHTML = sorted.map(p => `
      <div class="reveal-card">
        <div class="rc-avatar" style="border-color:${p.color}">
          <img src="${avatarUrl(p.profile?.avatarId ?? 1)}" alt="">
        </div>
        <div class="rc-name">${p.profile?.nickname ?? '익명'}</div>
        <div class="rc-number">${p.score.card}</div>
        ${p.score.useDouble ? '<div class="rc-double">× 2 더블!</div>' : ''}
        <div class="rc-score-gained">+${p.score.final}점</div>
        <div class="rc-total">누적 ${p.total}점</div>
      </div>
    `).join('');
  }

  _renderGameResult(ranked) {
    const container = document.getElementById('final-rankings');
    if (!container) return;
    const medals = ['🥇', '🥈', '🥉'];
    let displayRank = 1;
    container.innerHTML = ranked.map((p, i) => {
      if (i > 0 && p.totalScore < ranked[i - 1].totalScore) displayRank = i + 1;
      const medal = medals[displayRank - 1] ?? `${displayRank}위`;
      return `
      <div class="final-rank-row ${displayRank === 1 ? 'winner' : ''}">
        <span class="fr-medal">${medal}</span>
        <div class="fr-avatar" style="border-color:${p.color}">
          <img src="${avatarUrl(p.avatarId ?? 1)}" alt="">
        </div>
        <span class="fr-name">${p.nickname}</span>
        <span class="fr-score">${p.totalScore}점</span>
      </div>
    `}).join('');
  }
}
