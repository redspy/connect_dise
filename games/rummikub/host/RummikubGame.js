/**
 * RummikubGame.js — 루미큐브 호스트 게임 클래스 (docs/games/rummikub/plan.md)
 * HostBaseGame을 상속. 게임 상태의 단일 권위(authority)를 가짐.
 */

import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import {
  createDeck, shuffle, dealHands, tileSetModeForPlayerCount,
  validateBoard, sumOfMelds, flattenBoard, scoreHand, parseTileId,
} from '../shared/RummikubEngine.js';
import { renderTile } from '../shared/TileRenderer.js';
import { withStagger, STAGGER_MS, meldJitter, seededRandom, DRAW_FLY_MS } from '../shared/motion.js';
import { DemoSimulator } from './DemoSimulator.js';

function cloneBoard(board) {
  return board.map(m => ({ meldId: m.meldId, tiles: [...m.tiles] }));
}

export class RummikubGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'rk-overlay', qrContainerId: null });

    this._profiles = new Map(); // id -> { nickname }
    this._gameStarted = false;
    this._readyCount = 0;
    this._isDemo = false;

    // 로비 옵션
    this._turnTimerSec = 60;       // 30 | 60 | 120 | Infinity
    this._initialMeldThreshold = 30; // 10 | 20 | 30

    // 게임 상태 (§9.1)
    this._tileSetMode = 'standard';
    this._pool = [];
    this._hands = new Map();        // playerId -> tileId[]
    this._playerMeta = new Map();   // playerId -> { initialMeldDone, color, left, nickname }
    this._turnOrder = [];
    this._turnIdx = 0;
    this._turnNo = 0;
    this._currentTurnPlayerId = null;
    this._turnDeadlineTs = null;
    this._board = [];
    this._nextMeldId = 1;
    this._noChangeStreak = 0;

    // 턴 임시 영역
    this._snapshot = null;
    this._provisional = null;
    this._opLog = [];
    this._newMeldIdsThisTurn = new Set();
    this._placedFromHandThisTurn = new Set();

    this._turnTimer = null;
    this._countdownTimer = null;
    this._countdownOverlay = null;

    this._demoSimulator = new DemoSimulator(this);
    this._wireGameMessages();
  }

  // ─── HostBaseGame 훅 ──────────────────────────────────────────────────────

  async onSetup() {
    document.querySelectorAll('input[name="rk-timer"]').forEach(el => {
      el.addEventListener('change', () => {
        if (el.checked) this._turnTimerSec = el.value === 'inf' ? Infinity : parseInt(el.value, 10);
      });
    });
    document.querySelectorAll('input[name="rk-threshold"]').forEach(el => {
      el.addEventListener('change', () => {
        if (el.checked) this._initialMeldThreshold = parseInt(el.value, 10);
      });
    });

    if (this._lobbyEl) {
      this._lobbyEl.onStart = () => { if (this._canStart()) this._startCountdown(); };
    }

    document.getElementById('btn-restart-result')?.addEventListener('click', () => this.resetSession());
    document.getElementById('btn-restart-game')?.addEventListener('click', () => this.resetSession());

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.onclick = () => {
        if (!this._isDemo) {
          if (this.playerCount > 0) return; // 필수 처리 사항: 실플레이어 있으면 데모 금지
          this._demoSimulator.startDemo();
        } else {
          this._demoSimulator.stopDemo();
        }
      };
    }

    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    if (this._isDemo) {
      this._demoSimulator.stopDemo();
      this.resetSession();
      return;
    }
    if (this._gameStarted) return;
    this._renderLobby();
    this._updateReadyStatus();
    this._broadcastPlayerList();
  }

  onPlayerRejoin(player) {
    if (!this._gameStarted) return;
    const hand = this._hands.get(player.id);
    if (!hand) return;
    this.sendToPlayer(player.id, 'stateSync', this._buildStateSyncPayload(player.id));
  }

  onPlayerLeave(playerId) {
    if (!this._gameStarted) {
      this._profiles.delete(playerId);
      this._renderLobby();
      this._updateReadyStatus();
      this._broadcastPlayerList();
      return;
    }
    if (!this._playerMeta.has(playerId)) return;

    const wasCurrentTurn = playerId === this._currentTurnPlayerId;
    const removedIdx = this._turnOrder.indexOf(playerId);
    const meta = this._playerMeta.get(playerId);
    meta.left = true;
    meta.leftScore = -scoreHand(this._hands.get(playerId) || []);
    this._turnOrder = this._turnOrder.filter(id => id !== playerId);
    if (removedIdx !== -1 && removedIdx < this._turnIdx) this._turnIdx--;

    if (this._turnOrder.length < 2) {
      clearTimeout(this._turnTimer);
      const winner = this._turnOrder[0] || null;
      this._endGame('forfeit', winner);
      return;
    }

    this._renderPlayersPanel();

    if (wasCurrentTurn) {
      clearTimeout(this._turnTimer);
      this._turnIdx = this._turnIdx % this._turnOrder.length;
      this._startTurn(this._turnOrder[this._turnIdx]);
    }
  }

  onReadyUpdate({ readyCount }) {
    this._readyCount = readyCount;
    this._updateReadyStatus();
  }

  onAllReady() {
    this._updateReadyStatus();
  }

  onReset() {
    this._demoSimulator.stopDemo();
    this._stopCountdown();
    clearTimeout(this._turnTimer);
    this._profiles.clear();
    this._gameStarted = false;
    this._readyCount = 0;
    this._pool = [];
    this._hands.clear();
    this._playerMeta.clear();
    this._turnOrder = [];
    this._board = [];
    this._turnIdx = 0;
    this._turnNo = 0;
    this._currentTurnPlayerId = null;
    this._noChangeStreak = 0;
    document.getElementById('rk-pool-pile')?.replaceChildren();
    this._renderLobby();
    this.updateLobbyReady(0);
    this.setPhase('lobby');
  }

  onPhaseChange(from, to) {
    if (this._isDemo) this._demoSimulator.onPhaseChange(to);
  }

  // ─── 메시지 처리 ──────────────────────────────────────────────────────────

  _wireGameMessages() {
    this.onMessage('setProfile', (player, { nickname }) => {
      this._profiles.set(player.id, { nickname });
      this.setPlayerName(player.id, nickname);
      if (!this._gameStarted) {
        this._renderLobby();
        this._broadcastPlayerList();
      }
    });

    this.onMessage('boardOp', (player, { seq, op }) => {
      if (player.id !== this._currentTurnPlayerId) {
        this.sendToPlayer(player.id, 'opAck', { seq, accepted: false, reason: 'NOT_YOUR_TURN' });
        return;
      }
      const result = this._applyOp(player.id, op);
      if (result.accepted) {
        this._opLog.push(op);
        this.sendToPlayer(player.id, 'opAck', { seq, accepted: true, newMeldId: result.newMeldId ?? undefined });
        this._broadcastBoardPreview();
      } else {
        this.sendToPlayer(player.id, 'opAck', { seq, accepted: false, reason: result.reason });
      }
    });

    this.onMessage('resetTurn', (player) => {
      if (player.id !== this._currentTurnPlayerId || !this._snapshot) return;
      this._provisional = { board: cloneBoard(this._snapshot.board), hand: [...this._snapshot.hand] };
      this._opLog = [];
      this._newMeldIdsThisTurn = new Set();
      this._placedFromHandThisTurn = new Set();
      this._broadcastBoardPreview();
    });

    this.onMessage('endTurn', (player) => {
      if (player.id !== this._currentTurnPlayerId) return;
      this._commitTurn(player.id);
    });

    this.onMessage('drawAndPass', (player) => {
      if (player.id !== this._currentTurnPlayerId) return;
      this._doPass(player.id);
    });

    this.onMessage('requestState', (player) => {
      if (!this._gameStarted || !this._hands.has(player.id)) return;
      this.sendToPlayer(player.id, 'stateSync', this._buildStateSyncPayload(player.id));
    });

    this.onMessage('requestRematch', () => this.resetSession());

    // 호스트리스 모드 대응(플랫폼 공통 컨벤션) — 이 게임은 <game-lobby> 시작
    // 버튼이 항상 호스트 화면에 있지만, 다른 게임과의 일관성을 위해 동일 메시지도 지원.
    this.onMessage('requestStart', () => { if (this._canStart()) this._startCountdown(); });
  }

  // ─── 시작 ─────────────────────────────────────────────────────────────────

  _canStart() {
    return this.playerCount >= 2 && this._readyCount === this.playerCount;
  }

  _startCountdown() {
    if (this._gameStarted) return;
    this._gameStarted = true;
    let count = 3;
    this.broadcast('gameCountdown', { count });
    const overlay = document.createElement('div');
    overlay.className = 'rk-countdown-overlay';
    overlay.innerHTML = `<div class="rk-countdown-num">${count}</div>`;
    document.body.appendChild(overlay);
    this._countdownOverlay = overlay;
    this._countdownTimer = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(this._countdownTimer);
        this._countdownTimer = null;
        overlay.remove();
        this._countdownOverlay = null;
        this._startGame();
      } else {
        this.broadcast('gameCountdown', { count });
        const numEl = overlay.querySelector('.rk-countdown-num');
        if (numEl) { numEl.textContent = count; numEl.classList.remove('rk-countdown-beat'); void numEl.offsetWidth; numEl.classList.add('rk-countdown-beat'); }
      }
    }, 1000);
  }

  _stopCountdown() {
    if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
    if (this._countdownOverlay) { this._countdownOverlay.remove(); this._countdownOverlay = null; }
  }

  _startGame() {
    const playerIds = [...this.players.keys()];
    this._tileSetMode = tileSetModeForPlayerCount(playerIds.length);
    const deck = shuffle(createDeck(this._tileSetMode));
    const { hands, pool } = dealHands(deck, playerIds, 14);
    this._hands = new Map(Object.entries(hands));
    this._pool = pool;
    this._board = [];
    this._nextMeldId = 1;
    this._turnOrder = shuffle(playerIds);
    this._turnIdx = 0;
    this._turnNo = 0;
    this._noChangeStreak = 0;
    this._playerMeta = new Map(playerIds.map(id => [id, {
      initialMeldDone: false,
      color: this.players.get(id).color,
      nickname: this._profiles.get(id)?.nickname ?? '???',
      left: false,
    }]));

    for (const pid of playerIds) {
      this.sendToPlayer(pid, 'handDealt', { tiles: this._hands.get(pid) });
    }
    this.broadcast('gameStarted', {
      turnOrder: this._turnOrder,
      tileSetMode: this._tileSetMode,
      poolCount: this._pool.length,
      turnTimerSec: Number.isFinite(this._turnTimerSec) ? this._turnTimerSec : 0,
      initialMeldThreshold: this._initialMeldThreshold,
    });

    this._renderPlayersPanel();
    this._renderBoard([]);
    this._renderPoolPile(this._pool.length);
    this.setPhase('playing');
    this._startTurn(this._turnOrder[0]);
  }

  // ─── 턴 라이프사이클 (§6) ────────────────────────────────────────────────

  _startTurn(playerId) {
    clearTimeout(this._turnTimer);
    this._currentTurnPlayerId = playerId;
    this._snapshot = { board: cloneBoard(this._board), hand: [...(this._hands.get(playerId) || [])] };
    this._provisional = { board: cloneBoard(this._board), hand: [...(this._hands.get(playerId) || [])] };
    this._opLog = [];
    this._newMeldIdsThisTurn = new Set();
    this._placedFromHandThisTurn = new Set();
    this._turnNo++;
    this._turnDeadlineTs = Number.isFinite(this._turnTimerSec) ? Date.now() + this._turnTimerSec * 1000 : null;

    this.broadcast('turnStarted', {
      playerId, turnNo: this._turnNo, deadlineTs: this._turnDeadlineTs, poolCount: this._pool.length,
    });
    this._renderTurnHeader();
    this._renderPlayersPanel();

    if (this._turnDeadlineTs) {
      this._turnTimer = setTimeout(() => this._onTimeout(playerId), this._turnTimerSec * 1000);
    }
    if (this._isDemo) this._demoSimulator.onTurnStart(playerId);
  }

  _onTimeout(playerId) {
    if (playerId !== this._currentTurnPlayerId) return;
    this._failTurn(playerId, '시간이 초과됐어요');
  }

  // ─── op 적용 (§6.2, §6.3, §9.2) ─────────────────────────────────────────

  _applyOp(playerId, op) {
    const { tileId, from, to } = op || {};
    if (!tileId || !from || !to) return { accepted: false, reason: 'BAD_OP' };
    const prov = this._provisional;
    const meta = this._playerMeta.get(playerId);
    const initialMeldDone = meta?.initialMeldDone;

    // from 검증
    if (from.zone === 'hand') {
      if (!prov.hand.includes(tileId)) return { accepted: false, reason: 'NOT_IN_HAND' };
    } else if (from.zone === 'meld') {
      const meld = prov.board.find(m => m.meldId === from.meldId);
      if (!meld || !meld.tiles.includes(tileId)) return { accepted: false, reason: 'TILE_NOT_FOUND' };
      if (!initialMeldDone && !this._newMeldIdsThisTurn.has(from.meldId)) {
        return { accepted: false, reason: 'BOARD_LOCKED' };
      }
    } else {
      return { accepted: false, reason: 'BAD_FROM' };
    }

    // to 검증
    if (to.zone === 'hand') {
      const t = parseTileId(tileId);
      if (!t.isJoker && !this._placedFromHandThisTurn.has(tileId)) {
        return { accepted: false, reason: 'BOARD_TO_HAND_FORBIDDEN' };
      }
    } else if (to.zone === 'meld') {
      if (!initialMeldDone && !this._newMeldIdsThisTurn.has(to.meldId)) {
        return { accepted: false, reason: 'BOARD_LOCKED' };
      }
      if (!prov.board.find(m => m.meldId === to.meldId)) return { accepted: false, reason: 'MELD_NOT_FOUND' };
    } else if (to.zone !== 'newMeld') {
      return { accepted: false, reason: 'BAD_TO' };
    }

    // 제거
    if (from.zone === 'hand') {
      prov.hand.splice(prov.hand.indexOf(tileId), 1);
    } else {
      const meld = prov.board.find(m => m.meldId === from.meldId);
      meld.tiles.splice(meld.tiles.indexOf(tileId), 1);
      if (meld.tiles.length === 0) prov.board = prov.board.filter(m => m.meldId !== meld.meldId);
    }

    // 삽입
    let newMeldId;
    if (to.zone === 'hand') {
      prov.hand.push(tileId);
      this._placedFromHandThisTurn.delete(tileId);
    } else if (to.zone === 'newMeld') {
      newMeldId = this._nextMeldId++;
      prov.board.push({ meldId: newMeldId, tiles: [tileId] });
      this._newMeldIdsThisTurn.add(newMeldId);
      if (from.zone === 'hand') this._placedFromHandThisTurn.add(tileId);
    } else {
      const meld = prov.board.find(m => m.meldId === to.meldId);
      const idx = Math.max(0, Math.min(to.index ?? meld.tiles.length, meld.tiles.length));
      meld.tiles.splice(idx, 0, tileId);
      if (from.zone === 'hand') this._placedFromHandThisTurn.add(tileId);
    }

    return { accepted: true, newMeldId };
  }

  _broadcastBoardPreview() {
    this.broadcast('boardPreview', { board: this._provisional.board });
    this._renderBoard(this._provisional.board, { preview: true });
  }

  // ─── 커밋 검증 파이프라인 (§10) ──────────────────────────────────────────

  _commitTurn(playerId) {
    const prov = this._provisional;
    const snap = this._snapshot;
    const meta = this._playerMeta.get(playerId);

    if (this._opLog.length === 0) { this._doPass(playerId); return; }

    // 1. 타일 보존
    const provAll = [...flattenBoard(prov.board), ...prov.hand].sort().join(',');
    const snapAll = [...flattenBoard(snap.board), ...snap.hand].sort().join(',');
    if (provAll !== snapAll) { this._failTurn(playerId, '타일 정합성 오류가 감지됐어요'); return; }

    // 2. 세트 유효성
    const bv = validateBoard(prov.board);
    if (!bv.valid) { this._failTurn(playerId, '보드에 유효하지 않은 조합이 있어요'); return; }

    // 4. 초기 착수 검사
    if (!meta.initialMeldDone) {
      const sum = sumOfMelds(prov.board, [...this._newMeldIdsThisTurn]);
      if (sum < this._initialMeldThreshold) {
        this._failTurn(playerId, `초기 착수 합계가 ${sum}점으로 ${this._initialMeldThreshold}점 미달이에요`);
        return;
      }
    }

    // 5. 조커 완결성
    const jokersAtStart = flattenBoard(snap.board).filter(id => id[0] === 'j');
    const jokersAtEnd = flattenBoard(prov.board).filter(id => id[0] === 'j');
    const stranded = jokersAtStart.filter(j => !jokersAtEnd.includes(j));
    if (stranded.length > 0) { this._failTurn(playerId, '조커를 다시 보드에 사용해야 해요'); return; }

    // 성공
    this._board = prov.board;
    this._hands.set(playerId, prov.hand);
    if (!meta.initialMeldDone) meta.initialMeldDone = true;
    this._noChangeStreak = 0;

    this.sendToPlayer(playerId, 'turnResult', { accepted: true, hand: [...prov.hand] });
    this.broadcast('boardCommitted', {
      board: this._board,
      poolCount: this._pool.length,
      handCounts: this._handCounts(),
      initialMeldFlags: this._initialMeldFlags(),
    });
    this._renderBoard(this._board, { flash: true });
    this._renderPlayersPanel();

    if (prov.hand.length === 0) { this._endGame('rummikub', playerId); return; }
    this._advanceTurn();
  }

  _failTurn(playerId, reasonText) {
    const drawn = this._drawTile();
    if (drawn) this._flyTileFromPool(playerId);
    const hand = this._hands.get(playerId) || [];
    if (drawn) hand.push(drawn);
    this._noChangeStreak++;
    this.sendToPlayer(playerId, 'turnResult', { accepted: false, reason: reasonText, drawnTile: drawn ?? null, hand: [...hand] });
    this.broadcast('boardCommitted', {
      board: this._board,
      poolCount: this._pool.length,
      handCounts: this._handCounts(),
      initialMeldFlags: this._initialMeldFlags(),
    });
    this._renderBoard(this._board, { rollback: true });
    this._renderPlayersPanel();
    this._advanceTurn();
  }

  _doPass(playerId) {
    const drawn = this._drawTile();
    if (drawn) this._flyTileFromPool(playerId);
    const hand = this._hands.get(playerId) || [];
    if (drawn) hand.push(drawn);
    this._noChangeStreak++;
    this.sendToPlayer(playerId, 'turnResult', { accepted: true, drawnTile: drawn ?? null, hand: [...hand] });
    this.broadcast('boardCommitted', {
      board: this._board,
      poolCount: this._pool.length,
      handCounts: this._handCounts(),
      initialMeldFlags: this._initialMeldFlags(),
    });
    this._renderPlayersPanel();
    this._advanceTurn();
  }

  _drawTile() {
    if (this._pool.length === 0) return null;
    return this._pool.shift();
  }

  _advanceTurn() {
    if (this._pool.length === 0 && this._noChangeStreak >= this._turnOrder.length) {
      this._endGame('stalemate');
      return;
    }
    if (this._pool.length === 0) {
      this.broadcast('stalemateWarning', { passStreak: this._noChangeStreak, needed: this._turnOrder.length });
    }
    if (this._turnOrder.length === 0) return;
    this._turnIdx = (this._turnIdx + 1) % this._turnOrder.length;
    this._startTurn(this._turnOrder[this._turnIdx]);
  }

  // ─── 종료/점수 (§8) ──────────────────────────────────────────────────────

  _endGame(endType, forcedWinnerId = null) {
    clearTimeout(this._turnTimer);
    this._gameStarted = false;
    const scores = {};
    let winnerIds = [];

    if (endType === 'rummikub') {
      let total = 0;
      for (const [pid, meta] of this._playerMeta) {
        if (meta.left || pid === forcedWinnerId) continue;
        const s = scoreHand(this._hands.get(pid) || []);
        scores[pid] = -s;
        total += s;
      }
      scores[forcedWinnerId] = total;
      winnerIds = [forcedWinnerId];
    } else if (endType === 'stalemate') {
      const active = [...this._playerMeta.entries()].filter(([, m]) => !m.left);
      const sums = active.map(([pid]) => [pid, scoreHand(this._hands.get(pid) || [])]);
      const minSum = Math.min(...sums.map(([, s]) => s));
      winnerIds = sums.filter(([, s]) => s === minSum).map(([pid]) => pid);
      const losers = sums.filter(([, s]) => s !== minSum);
      const loserTotal = losers.reduce((a, [, s]) => a + s, 0);
      for (const [pid, s] of losers) scores[pid] = -s;
      const share = winnerIds.length ? Math.floor(loserTotal / winnerIds.length) : 0;
      for (const wid of winnerIds) {
        const mySum = sums.find(([pid]) => pid === wid)[1];
        scores[wid] = share - mySum;
      }
    } else if (endType === 'forfeit') {
      winnerIds = forcedWinnerId ? [forcedWinnerId] : [];
      for (const [pid, meta] of this._playerMeta) {
        if (meta.left) { scores[pid] = meta.leftScore ?? 0; continue; }
        if (pid === forcedWinnerId) { scores[pid] = 0; continue; }
      }
    }

    const revealedHands = {};
    for (const [pid] of this._playerMeta) revealedHands[pid] = this._hands.get(pid) || [];

    this.broadcast('gameFinished', { endType, winnerIds, scores, revealedHands });
    this._renderResult(endType, winnerIds, scores, revealedHands);
    this.setPhase('result');
  }

  // ─── 상태 조회 헬퍼 ──────────────────────────────────────────────────────

  _handCounts() {
    const out = {};
    for (const [pid, hand] of this._hands) out[pid] = hand.length;
    return out;
  }

  _initialMeldFlags() {
    const out = {};
    for (const [pid, meta] of this._playerMeta) out[pid] = !!meta.initialMeldDone;
    return out;
  }

  _buildStateSyncPayload(playerId) {
    return {
      board: this._board,
      hand: this._hands.get(playerId) || [],
      poolCount: this._pool.length,
      turnInfo: { playerId: this._currentTurnPlayerId, deadlineTs: this._turnDeadlineTs, initialMeldThreshold: this._initialMeldThreshold },
      handCounts: this._handCounts(),
      initialMeldFlags: this._initialMeldFlags(),
      phase: this.phase,
    };
  }

  // ─── 로비 UI ─────────────────────────────────────────────────────────────

  _renderLobby() { this.renderLobbyPlayers(this._profiles); }
  _updateReadyStatus() { this.updateLobbyReady(this._readyCount); }
  _broadcastPlayerList() {
    const players = [...this.players.values()].map(p => ({
      id: p.id, color: p.color, nickname: this._profiles.get(p.id)?.nickname ?? '...',
    }));
    this.broadcast('playerListUpdated', { players });
  }

  // ─── 호스트 화면 렌더 (§11.1, §11.4) ────────────────────────────────────

  _renderTurnHeader() {
    const meta = this._playerMeta.get(this._currentTurnPlayerId);
    const nameEl = document.getElementById('rk-turn-player-name');
    if (nameEl) nameEl.textContent = meta?.nickname ?? '-';
    const dot = document.getElementById('rk-turn-player-dot');
    if (dot) dot.style.background = meta?.color ?? '#888';
    const poolEl = document.getElementById('rk-pool-count');
    if (poolEl) poolEl.textContent = `🂠 × ${this._pool.length}`;
    this._tickTimerRing();
  }

  _tickTimerRing() {
    clearInterval(this._timerTickInterval);
    const ring = document.getElementById('rk-timer-ring');
    const label = document.getElementById('rk-timer-label');
    if (!ring || !label) return;
    if (!this._turnDeadlineTs) { label.textContent = '∞'; ring.style.setProperty('--rk-pct', '1'); return; }
    const totalMs = this._turnTimerSec * 1000;
    const update = () => {
      const remain = Math.max(0, this._turnDeadlineTs - Date.now());
      const pct = totalMs > 0 ? remain / totalMs : 0;
      ring.style.setProperty('--rk-pct', String(pct));
      label.textContent = String(Math.ceil(remain / 1000));
      ring.classList.toggle('rk-timer-danger', remain <= 10000);
    };
    update();
    this._timerTickInterval = setInterval(update, 250);
  }

  _renderPlayersPanel() {
    const panel = document.getElementById('rk-players-panel');
    if (!panel) return;
    panel.innerHTML = '';
    for (const pid of this._turnOrder) {
      const meta = this._playerMeta.get(pid);
      if (!meta || meta.left) continue;
      const handCount = (this._hands.get(pid) || []).length;
      const card = document.createElement('div');
      card.className = 'rk-player-card';
      card.id = `rk-pcard-${pid}`;
      if (pid === this._currentTurnPlayerId) card.classList.add('rk-player-card-active');
      if (handCount === 1) card.classList.add('rk-player-card-warn');
      card.innerHTML = `
        <span class="rk-pcard-dot" style="background:${meta.color}"></span>
        <span class="rk-pcard-nick">${meta.nickname}</span>
        <span class="rk-pcard-badge ${meta.initialMeldDone ? 'rk-pcard-badge-done' : ''}">${meta.initialMeldDone ? '착수완료' : '착수 전'}</span>
        <span class="rk-pcard-count">${handCount}장</span>
      `;
      panel.appendChild(card);
    }
  }

  _renderBoard(board, opts = {}) {
    const container = document.getElementById('rk-board');
    if (!container) return;
    const prevRects = new Map();
    if (opts.rollback) {
      container.querySelectorAll('.rk-tile').forEach(el => prevRects.set(el.dataset.tileId, el.getBoundingClientRect()));
    }

    // innerHTML='' 대신 .rk-meld만 제거 — #rk-pool-pile(더미 시각화)는
    // 이 컨테이너의 자식으로 같이 있어서 통째로 지우면 매 커밋/롤백마다
    // 더미가 사라짐.
    container.querySelectorAll('.rk-meld').forEach(el => el.remove());
    for (const meld of board) {
      const meldEl = document.createElement('div');
      meldEl.className = 'rk-meld';
      meldEl.dataset.meldId = meld.meldId;
      // 불규칙하고 다이나믹한 배치: meldId로 결정적 시드를 만들어 회전/세로
      // 오프셋을 부여 — 재렌더링마다 값이 바뀌지 않고(같은 세트는 항상 같은
      // 흐트러짐 유지), 매번 Math.random()을 쓰면 커밋할 때마다 안 바뀐
      // 세트까지 덜컹거려 보이는 문제를 피함.
      const { rot, dx, dy } = meldJitter(meld.meldId);
      meldEl.style.setProperty('--rk-jrot', `${rot}deg`);
      meldEl.style.setProperty('--rk-jdx', `${dx}px`);
      meldEl.style.setProperty('--rk-jdy', `${dy}px`);
      const tileEls = meld.tiles.map(tid => renderTile(tid, { size: 'md' }));
      tileEls.forEach(el => meldEl.appendChild(el));
      container.appendChild(meldEl);
      if (opts.flash) {
        meldEl.classList.add('rk-meld-flash');
        setTimeout(() => meldEl.classList.remove('rk-meld-flash'), 500);
      }
    }

    if (opts.rollback && prevRects.size) {
      const els = [...container.querySelectorAll('.rk-tile')].filter(el => prevRects.has(el.dataset.tileId));
      withStagger(els, (el) => {
        const first = prevRects.get(el.dataset.tileId);
        if (first) {
          el.style.transition = 'none';
          el.style.transform = `translate(${first.left - el.getBoundingClientRect().left}px, ${first.top - el.getBoundingClientRect().top}px)`;
          void el.offsetWidth;
          requestAnimationFrame(() => {
            el.classList.add('rk-tile-rollback');
            el.style.transition = '';
            el.style.transform = '';
            setTimeout(() => el.classList.remove('rk-tile-rollback'), 450);
          });
        }
      }, STAGGER_MS);
      const flashEl = document.getElementById('rk-vignette');
      if (flashEl) { flashEl.classList.add('rk-vignette-flash'); setTimeout(() => flashEl.classList.remove('rk-vignette-flash'), 220); }
    }
  }

  /**
   * 더미(pool)를 흐트러진 뒷면 타일 더미로 시각화한다(사용자 요청).
   * 실제 개수만큼 다 그리면 DOM이 과도하게 커지므로 최대 POOL_VISUAL_CAP
   * 개까지만 렌더링 — 정확한 개수는 헤더의 텍스트 카운터가 이미 보여준다.
   * 게임 시작/리셋 시 1회만 전체 렌더링하고, 이후 뽑기마다는 이 함수를
   * 다시 부르지 않는다(_flyTileFromPool이 낱장씩 제거하며 개수를 맞춤).
   */
  _renderPoolPile(count) {
    const pile = document.getElementById('rk-pool-pile');
    if (!pile) return;
    pile.innerHTML = '';
    const POOL_VISUAL_CAP = 40;
    const visible = Math.min(count, POOL_VISUAL_CAP);
    for (let i = 0; i < visible; i++) {
      const t = document.createElement('div');
      t.className = 'rk-pool-tile';
      const rx = (seededRandom(i * 3.7) - 0.5) * 90;   // -45~45px
      const ry = (seededRandom(i * 9.1 + 2) - 0.5) * 70; // -35~35px
      const rot = (seededRandom(i * 5.3 + 4) - 0.5) * 50; // -25~25deg
      t.style.transform = `translate(${rx}px, ${ry}px) rotate(${rot}deg)`;
      t.style.zIndex = String(i);
      pile.appendChild(t);
    }
  }

  /**
   * 더미에서 실제로 한 장을 뽑을 때, 쌓여있는 뒷면 타일 중 하나를 무작위로
   * 골라 해당 플레이어 패널 쪽으로 날아가는 이펙트를 재생한다(사용자 요청).
   * 뒷면 타일은 전부 겉보기가 동일하므로 "어떤 실제 타일이 뽑혔는지"와
   * 무관하게 아무 DOM 조각이나 하나 골라도 됨 — 카드 자체의 정체성은 이미
   * this._pool.shift()에서 정해져 있고, 여기선 순수 연출만 담당.
   */
  _flyTileFromPool(playerId) {
    const pile = document.getElementById('rk-pool-pile');
    if (!pile) return;
    const tiles = [...pile.querySelectorAll('.rk-pool-tile')];
    if (tiles.length === 0) return;
    const tile = tiles[Math.floor(Math.random() * tiles.length)];
    const startRect = tile.getBoundingClientRect();
    tile.remove();

    const target = document.getElementById(`rk-pcard-${playerId}`);
    const targetRect = target ? target.getBoundingClientRect() : null;
    const dx = targetRect ? (targetRect.left + targetRect.width / 2 - startRect.left - startRect.width / 2) : 0;
    const dy = targetRect ? (targetRect.top + targetRect.height / 2 - startRect.top - startRect.height / 2) : -80;

    const ghost = document.createElement('div');
    ghost.className = 'rk-pool-tile rk-pool-tile-flying';
    ghost.style.setProperty('--rk-draw-fly-ms', `${DRAW_FLY_MS}ms`);
    ghost.style.left = `${startRect.left}px`;
    ghost.style.top = `${startRect.top}px`;
    ghost.style.transform = 'translate(0, 0) scale(1) rotate(0deg)';
    ghost.style.opacity = '1';
    document.body.appendChild(ghost);
    void ghost.offsetWidth;
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(${dx}px, ${dy}px) scale(0.3) rotate(520deg)`;
      ghost.style.opacity = '0';
    });
    setTimeout(() => ghost.remove(), DRAW_FLY_MS + 60);
  }

  _renderResult(endType, winnerIds, scores, revealedHands) {
    const list = document.getElementById('rk-result-list');
    if (!list) return;
    const rows = [...this._playerMeta.entries()].map(([pid, meta]) => ({
      pid, nickname: meta.nickname, color: meta.color,
      score: scores[pid] ?? 0, isWinner: winnerIds.includes(pid), left: meta.left,
      hand: revealedHands[pid] || [],
    })).sort((a, b) => b.score - a.score);

    const titleEl = document.getElementById('rk-result-title');
    if (titleEl) {
      titleEl.textContent = endType === 'rummikub' ? '🏆 Rummikub!' : endType === 'stalemate' ? '🤝 교착' : '🏁 경기 종료';
    }

    list.innerHTML = rows.map(r => `
      <div class="rk-result-row ${r.isWinner ? 'rk-result-winner' : ''}">
        <span class="rk-result-dot" style="background:${r.color}"></span>
        <span class="rk-result-nick">${r.nickname}${r.left ? ' (이탈)' : ''}</span>
        <span class="rk-result-score">${r.score >= 0 ? '+' : ''}${r.score}</span>
        <span class="rk-result-tiles">${r.hand.length}장 남음</span>
      </div>
    `).join('');
  }
}
