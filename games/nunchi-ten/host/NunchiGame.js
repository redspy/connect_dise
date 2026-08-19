import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { NunchiDemoSimulator } from './NunchiDemoSimulator.js';

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
    super(sdk, { overlayClass: 'n-overlay' });

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
    this._demoSimulator = new NunchiDemoSimulator(this);
    this._isDemo = false;

    this._wireGameMessages();
  }

  // ─── HostBaseGame hooks ──────────────────────────────────────────────────

  async onSetup({ sessionId, qrUrl }) {
    // AppBar 초기화
    this._appbar = document.querySelector('game-appbar');
    this._appbar.onRestart = () => this.resetSession();

    // 라운드 표시 요소를 AppBar 오른쪽 슬롯에 삽입
    const roundEl = document.createElement('div');
    roundEl.id = 'round-display';
    roundEl.className = 'round-display';
    roundEl.textContent = 'Round - / 10';
    this._appbar.prependRight(roundEl);

    const lobby = document.querySelector('game-lobby');
    lobby.onStart = () => this._startGame();
    lobby.onKick = (playerId) => this.kickPlayer(playerId);
    document.getElementById('btn-restart').addEventListener('click', () => {
      this.resetSession();
    });

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.onclick = () => {
        if (!this._isDemo) {
          this._demoSimulator.startDemo();
        }
      };
    }

    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    if (this._isDemo) {
      this._demoSimulator.stopDemo();
    }
    if (this._gameStarted) {
      // 게임 중 합류 — 관전자로 초기화 (카드 없음)
      this._initPlayerDataForSpectator(player.id);
      this._renderSubmissionStatus();
    } else {
      this._initPlayerData(player.id);
      this.renderLobbyPlayers(this._getLobbyProfiles());
      this.updateLobbyReady(this._readyCount);
    }
  }

  onPlayerRejoin(player) {
    this._sendRejoinState(player.id);
  }

  onPlayerLeave(playerId) {
    this._profiles.delete(playerId);
    this._data.delete(playerId);
    this._submissions.delete(playerId);
    this.renderLobbyPlayers(this._getLobbyProfiles());
    this.updateLobbyReady(this._readyCount);
    if (this.phase === 'round_input') this._checkAllSubmitted();
  }

  onReadyUpdate({ readyCount, total }) {
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
    if (this._revealTimeout) {
      clearTimeout(this._revealTimeout);
      this._revealTimeout = null;
    }
    if (this._revealTimers) {
      this._revealTimers.forEach(t => clearTimeout(t));
      this._revealTimers = [];
    }
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
    this.renderLobbyPlayers(this._getLobbyProfiles());
    this.updateLobbyReady(0);
    this.setPhase('lobby');
  }

  // ─── Game messages ───────────────────────────────────────────────────────

  _wireGameMessages() {
    this.onMessage('setProfile', (player, { nickname, avatarId }) => {
      const name = nickname.trim() || '익명';

      // 중복 닉네임 검사 (자신을 제외한 다른 유저들의 닉네임과 중복 여부 확인)
      const duplicated = [...this._profiles.entries()].some(([pid, p]) => p.nickname === name && pid !== player.id);
      if (duplicated) {
        this.sendToPlayer(player.id, 'setProfileResult', { success: false, reason: 'nickname_taken' });
        return;
      }

      this._profiles.set(player.id, { nickname: name, avatarId: Number(avatarId) || 1 });
      this.setPlayerName(player.id, name);
      this.renderLobbyPlayers(this._getLobbyProfiles());
      this._broadcastPlayerList();
      this.sendToPlayer(player.id, 'setProfileResult', { success: true });

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
      isSpectator: false,
    });
  }

  // 게임 중 참가자 — 관전자로 초기화 (카드 없음, 제출 대상 제외)
  _initPlayerDataForSpectator(id) {
    this._data.set(id, {
      totalScore: 0,
      remainingCards: [],
      doublesLeft: 0,
      highestRound: 0,
      isSpectator: true,
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

    // 관전자로 참여 중인 경우: 관전자 화면 노출
    if (data.isSpectator) {
      this.sendToPlayer(playerId, 'rejoinState', {
        phase: 'waiting_next_game',
        players,
        myData: data,
        round: this._currentRound,
        maxRounds: MAX_ROUNDS,
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
      ? { ...sub, submittedCount: this._submissions.size, total: this._getActivePlayerCount() }
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

  _getLobbyProfiles() {
    const map = new Map();
    for (const [id, profile] of this._profiles) {
      map.set(id, { nickname: profile.nickname, avatarUrl: avatarUrl(profile.avatarId) });
    }
    return map;
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

  _getActivePlayerCount() {
    let count = 0;
    for (const [id, data] of this._data) {
      if (data && !data.isSpectator) {
        count++;
      }
    }
    return count || this.playerCount;
  }

  _startGame() {
    this._gameStarted = true;
    if (this._revealTimeout) {
      clearTimeout(this._revealTimeout);
      this._revealTimeout = null;
    }
    if (this._revealTimers) {
      this._revealTimers.forEach(t => clearTimeout(t));
      this._revealTimers = [];
    }
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

    // 🤖 데모 모드 일 때 가상 봇들의 자동 카드 선택 시뮬레이션
    // (demoSimulator.schedule()을 거쳐야 stopDemo()의 "모든 예약된 데모 타이머 제거"가
    // 실제로 이 타이머까지 포함함 — 순수 setTimeout이면 추적 밖이라 stopDemo 직후에도
    // 발화할 수 있었음. simulateChoices 내부에 state 가드가 있어 크래시는 안 나지만
    // 트래킹 불일치였음. Claude CLI 리뷰로 발견.)
    if (this._isDemo) {
      this._demoSimulator.schedule(() => {
        this._demoSimulator.simulateChoices();
      }, 1500 + Math.random() * 1000);
    }
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
      total: this._getActivePlayerCount(),
    });

    this._checkAllSubmitted();
  }

  _checkAllSubmitted() {
    if (this._revealing) return;
    if (this._submissions.size >= this._getActivePlayerCount()) {
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
    const revealTime = 8000; // staggered 연출을 위해 8초 대기
    this._revealTimeout = setTimeout(() => {
      if (isLastRound) {
        this._endGame();
      } else {
        this._startRound(this._currentRound + 1);
      }
    }, revealTime);
  }

  _endGame() {
    const ranked = [...this.players.values()]
      .filter(p => {
        const data = this._data.get(p.id);
        return data && !data.isSpectator;
      })
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

    // 데모가 10라운드까지 자동 진행돼 여기 도달한 경우, 별도 중단 조작 없이도
    // QR 블러/배너/봇 정리까지 마치고 로비로 복귀시킴 (Claude CLI 리뷰로 발견 —
    // 이전엔 resetSession() 전까지 데모 UI가 결과 화면 위에 계속 남아있었음).
    if (this._isDemo) {
      this._demoSimulator.stopDemo();
    }
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

    // 순위 계산 (관전자 제외한 점수 기준 정렬)
    const ranked = [...this.players.values()]
      .filter(p => {
        const data = this._data.get(p.id);
        return data && !data.isSpectator;
      })
      .map(p => ({ id: p.id, score: this._data.get(p.id)?.totalScore ?? 0 }))
      .sort((a, b) => b.score - a.score);
    const rankMap = new Map(ranked.map((p, i) => [p.id, i + 1]));

    const rankLabel = r => r === 1 ? '1위' : r === 2 ? '2위' : r === 3 ? '3위' : `${r}위`;

    grid.innerHTML = '';
    for (const [id, player] of this.players) {
      const data = this._data.get(id);
      if (data && data.isSpectator) continue; // 관전자는 호스트 보드판 상태 카드에서 노출 제외

      const profile = this._profiles.get(id);
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
      .filter(p => {
        const data = this._data.get(p.id);
        return data && !data.isSpectator;
      })
      .map(p => {
        const score = roundResult.scores[p.id] || { card: '?', useDouble: false, base: 0, final: 0 };
        const profile = this._profiles.get(p.id);
        return { ...p, profile, score, total: roundResult.totals[p.id] ?? 0 };
      })
      .sort((a, b) => b.score.final - a.score.final); // 득점 순으로 노출 정렬

    // 이전 리빌 타이머 소탕
    if (this._revealTimers) {
      this._revealTimers.forEach(t => clearTimeout(t));
    }
    this._revealTimers = [];

    // 동점 충돌 판정용 카운트
    const cardCounts = {};
    Object.values(roundResult.scores).forEach(s => {
      if (s.card !== '?') {
        cardCounts[s.card] = (cardCounts[s.card] || 0) + 1;
      }
    });

    // 1. 비공개 상태 카드로 초기화 렌더링 (flipped 제거 상태)
    container.innerHTML = sorted.map(p => `
      <div class="reveal-card" id="rc-${p.id}">
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

    const maxScore = Math.max(...sorted.map(p => p.score.final));

    // 오디오 정의
    const playFlipAudio = () => {
      try {
        const a = new Audio('/games/nunchi-ten/assets/card_flip.mp3');
        a.volume = 0.5;
        a.play().catch(() => {});
      } catch (_) {}
    };
    const playDoubleAudio = () => {
      try {
        const a = new Audio('/games/nunchi-ten/assets/double_active.mp3');
        a.volume = 0.6;
        a.play().catch(() => {});
      } catch (_) {}
    };
    const playPointAudio = () => {
      try {
        const a = new Audio('/games/nunchi-ten/assets/point_gain.mp3');
        a.volume = 0.4;
        a.play().catch(() => {});
      } catch (_) {}
    };

    // 2. 0.8초 후부터 staggered flip 순차 뒤집기 진행
    sorted.forEach((p, idx) => {
      const t = setTimeout(() => {
        const el = document.getElementById(`rc-${p.id}`);
        if (!el) return;

        el.classList.add('flipped');
        playFlipAudio();

        const tSub = setTimeout(() => {
          const isCrashed = cardCounts[p.score.card] > 1 || p.score.final === 0;
          if (isCrashed) {
            el.classList.add('crashed');
          } else {
            playPointAudio();
            if (p.score.final === maxScore && maxScore > 0) {
              el.classList.add('winner-card');
            }
          }

          if (p.score.useDouble) {
            el.classList.add('double-active');
            playDoubleAudio();
          }
        }, 300);
        this._revealTimers.push(tSub);

      }, 800 + idx * 180);
      this._revealTimers.push(t);
    });
  }

  _renderGameResult(ranked) {
    const container = document.getElementById('final-rankings');
    if (!container) return;
    const medals = ['🥇', '🥈', '🥉'];
    let displayRank = 1;

    // 타이브레이커 일치 비교 헬퍼
    const isSameRank = (a, b) => 
      a.totalScore === b.totalScore && 
      a.doublesLeft === b.doublesLeft && 
      a.highestRound === b.highestRound;

    container.innerHTML = ranked.map((p, i) => {
      if (i > 0 && !isSameRank(p, ranked[i - 1])) displayRank = i + 1;
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

    // 우승자 축하 사운드 재생
    try {
      const winAudio = new Audio('/games/nunchi-ten/assets/winner.mp3');
      winAudio.volume = 0.7;
      winAudio.play().catch(() => {});
    } catch (_) {}
  }
}
