/**
 * DavinciGame.js — 다빈치 코드 호스트 게임 클래스 (docs/games/davinci-code/plan.md)
 * HostBaseGame을 상속. 게임 상태의 단일 권위(authority).
 *
 * 턴 순서(this._turnOrder)는 게임 시작 후 불변이다. 탈락/이탈은
 * playerMeta.eliminated/left 플래그로만 표시하고, 다음 차례를 찾을 때
 * 그 플래그를 보고 건너뛴다(§_advanceTurnOrder) — 배열을 잘라내며 인덱스를
 * 보정하는 방식(루미큐브 등)은 "내 턴 처리 중 다른 사람이 탈락"할 때
 * 인덱스가 밀리는 사고가 나기 쉬워, 이 게임은 애초에 그 클래스의 버그가
 * 구조적으로 생길 수 없게 불변 배열 + 스킵 방식을 택했다.
 */

import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import {
  createPools, poolCounts, poolKey, officialInsertIndex, insertPosition,
  judgeGuess, isEliminated, publicBoards, finalRevealTiles,
  startTileCountFor, colorRank,
} from '../shared/DavinciEngine.js';
import { renderTile } from '../shared/TileRenderer.js';
import { drumrollMs } from '../shared/motion.js';
import { DemoSimulator } from './DemoSimulator.js';

function reject(reason) { return { accepted: false, reason }; }

export class DavinciGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'dv-overlay', qrContainerId: null });

    this._profiles = new Map(); // id -> { nickname }
    this._gameStarted = false;
    this._readyCount = 0;
    this._isDemo = false;

    // 로비 옵션 (§0 D3, D4, D13)
    this._guessTimerSec = 60; // 30 | 60 | 120 | Infinity
    this._tieRule = 'official'; // 'official' | 'free'
    this._includeJokers = false;

    // 게임 상태 (§8)
    this._pools = { black: [], white: [] };
    this._playerTiles = new Map();  // playerId -> tile[] (§3 정렬 유지, 호스트 내부 표현=진짜 값 포함)
    this._playerMeta = new Map();   // playerId -> { nickname, color, eliminated, eliminatedRank, left, connected }
    this._turnOrder = [];           // 불변(게임 시작 시 확정)
    this._turnIdx = 0;
    this._currentTurnPlayerId = null;
    this._turnDeadlineTs = null;
    this._startTileCount = 4;
    this._eliminatedCount = 0;
    this._totalPlayers = 0;
    this._lastResult = null;

    this._stateName = 'lobby'; // 'setupPick' | 'turns' (playing 오버레이 내부 상태)
    this._setupPickIdx = 0;
    this._pendingSetupPlacement = null; // { playerId, tile, remainingQueue }

    // 턴 임시 상태
    this._turn = null; // { phase, drawnTile, comboCount, pendingTile?, pendingReveal?, tiebreakPos? }

    this._turnTimer = null;
    this._countdownTimer = null;
    this._countdownOverlay = null;
    this._timerTickInterval = null;
    this._pendingRevealTimer = null; // 드럼롤(§11.4) 종료 후 실행할 예약 렌더/연쇄
    this._wakeLock = null;
    this._wantWakeLock = false;

    // Wake Lock은 visibilitychange:hidden에서 자동 해제되고 재취득은 안 해줌
    // (루미큐브에서 실사용자 리포트로 확인된 브라우저 동작) — 이 게임도 TV가
    // 게임 내내 상시 표시돼야 하므로 동일 패턴 적용.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this._wantWakeLock && !this._wakeLock) {
        this._requestWakeLock();
      }
    });

    this._demoSimulator = new DemoSimulator(this);
    this._wireGameMessages();
  }

  // ─── HostBaseGame 훅 ──────────────────────────────────────────────────────

  async onSetup() {
    document.querySelectorAll('input[name="dv-timer"]').forEach(el => {
      el.addEventListener('change', () => {
        if (el.checked) this._guessTimerSec = el.value === 'inf' ? Infinity : parseInt(el.value, 10);
      });
    });
    document.querySelectorAll('input[name="dv-tierule"]').forEach(el => {
      el.addEventListener('change', () => { if (el.checked) this._tieRule = el.value; });
    });
    document.querySelectorAll('input[name="dv-jokers"]').forEach(el => {
      el.addEventListener('change', () => { this._includeJokers = el.checked; });
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
          if (this.playerCount > 0) return; // 실플레이어 있으면 데모 금지
          this._demoSimulator.startDemo();
        } else {
          this._demoSimulator.stopDemo();
        }
      };
    }

    this.setPhase('lobby');
  }

  onPlayerJoin() {
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
    if (!this._gameStarted && this.phase !== 'result') return;
    if (!this._playerMeta.has(player.id)) return;
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
    this._onPlayerLeaveElim(playerId);
  }

  onReadyUpdate({ readyCount }) {
    this._readyCount = readyCount;
    this._updateReadyStatus();
  }

  onAllReady() { this._updateReadyStatus(); }

  onReset() {
    this._demoSimulator.stopDemo();
    this._stopCountdown();
    this._releaseWakeLock();
    clearTimeout(this._turnTimer);
    clearInterval(this._timerTickInterval);
    clearTimeout(this._pendingRevealTimer);
    this._pendingRevealTimer = null;
    this._profiles.clear();
    this._gameStarted = false;
    this._readyCount = 0;
    this._pools = { black: [], white: [] };
    this._playerTiles.clear();
    this._playerMeta.clear();
    this._turnOrder = [];
    this._turnIdx = 0;
    this._currentTurnPlayerId = null;
    this._eliminatedCount = 0;
    this._totalPlayers = 0;
    this._lastResult = null;
    this._stateName = 'lobby';
    this._setupPickIdx = 0;
    this._pendingSetupPlacement = null;
    this._turn = null;
    this._renderLobby();
    this.updateLobbyReady(0);
    this.setPhase('lobby');
  }

  onPhaseChange(from, to) {
    if (this._isDemo) this._demoSimulator.onPhaseChange(to);
  }

  // ─── 메시지 처리 (§10, §12) ───────────────────────────────────────────────

  _wireGameMessages() {
    this.onMessage('setProfile', (player, { nickname }) => {
      this._profiles.set(player.id, { nickname });
      this.setPlayerName(player.id, nickname);
      if (!this._gameStarted) {
        this._renderLobby();
        this._broadcastPlayerList();
      }
    });

    this.onMessage('pickTiles', (player, { black }) => {
      const r = this._tryPickTiles(player.id, black);
      if (!r.accepted) this.sendToPlayer(player.id, 'actionAck', { accepted: false, reason: r.reason });
    });
    this.onMessage('drawTile', (player, { color }) => {
      const r = this._tryDrawTile(player.id, color);
      if (!r.accepted) this.sendToPlayer(player.id, 'actionAck', { accepted: false, reason: r.reason });
    });
    this.onMessage('guess', (player, { targetPlayerId, tileIndex, number }) => {
      const r = this._tryGuess(player.id, targetPlayerId, tileIndex, number);
      if (!r.accepted) this.sendToPlayer(player.id, 'actionAck', { accepted: false, reason: r.reason });
    });
    this.onMessage('turnChoice', (player, { action }) => {
      const r = this._tryTurnChoice(player.id, action);
      if (!r.accepted) this.sendToPlayer(player.id, 'actionAck', { accepted: false, reason: r.reason });
    });
    this.onMessage('revealOwnTile', (player, { tileIndex }) => {
      const r = this._tryRevealOwnTile(player.id, tileIndex);
      if (!r.accepted) this.sendToPlayer(player.id, 'actionAck', { accepted: false, reason: r.reason });
    });
    this.onMessage('placeTiebreak', (player, { side }) => {
      const r = this._tryPlaceTiebreak(player.id, side);
      if (!r.accepted) this.sendToPlayer(player.id, 'actionAck', { accepted: false, reason: r.reason });
    });
    this.onMessage('placeJoker', (player, { position }) => {
      const r = this._tryPlaceJoker(player.id, position);
      if (!r.accepted) this.sendToPlayer(player.id, 'actionAck', { accepted: false, reason: r.reason });
    });

    this.onMessage('requestState', (player) => {
      if (!this._gameStarted && this.phase !== 'result') return;
      if (!this._playerMeta.has(player.id)) return;
      this.sendToPlayer(player.id, 'stateSync', this._buildStateSyncPayload(player.id));
    });

    this.onMessage('requestRematch', () => this.resetSession());
    this.onMessage('requestStart', () => { if (this._canStart()) this._startCountdown(); });
  }

  // ─── 시작 ─────────────────────────────────────────────────────────────────

  _canStart() { return this.playerCount >= 2 && this._readyCount === this.playerCount; }

  _startCountdown() {
    if (this._gameStarted) return;
    this._gameStarted = true;
    let count = 3;
    this.broadcast('gameCountdown', { count });
    const overlay = document.createElement('div');
    overlay.className = 'dv-countdown-overlay';
    overlay.innerHTML = `<div class="dv-countdown-num">${count}</div>`;
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
        const numEl = overlay.querySelector('.dv-countdown-num');
        if (numEl) { numEl.textContent = count; numEl.classList.remove('dv-countdown-beat'); void numEl.offsetWidth; numEl.classList.add('dv-countdown-beat'); }
      }
    }, 1000);
  }

  _stopCountdown() {
    if (this._countdownTimer) { clearInterval(this._countdownTimer); this._countdownTimer = null; }
    if (this._countdownOverlay) { this._countdownOverlay.remove(); this._countdownOverlay = null; }
  }

  async _requestWakeLock() {
    this._wantWakeLock = true;
    try {
      if (!('wakeLock' in navigator)) return;
      this._wakeLock = await navigator.wakeLock.request('screen');
      this._wakeLock.addEventListener('release', () => { this._wakeLock = null; });
    } catch (err) {
      console.warn('[DavinciCode] Wake Lock 요청 실패:', err);
    }
  }

  _releaseWakeLock() {
    this._wantWakeLock = false;
    this._wakeLock?.release().catch(() => {});
    this._wakeLock = null;
  }

  _startGame() {
    this._requestWakeLock();
    const playerIds = [...this.players.keys()];
    this._totalPlayers = playerIds.length;
    this._startTileCount = startTileCountFor(playerIds.length);
    this._pools = createPools({ includeJokers: this._includeJokers });
    this._playerTiles = new Map(playerIds.map(id => [id, []]));
    this._turnOrder = this._shuffleIds(playerIds);
    this._turnIdx = 0;
    this._eliminatedCount = 0;
    this._playerMeta = new Map(playerIds.map(id => [id, {
      nickname: this._profiles.get(id)?.nickname ?? '???',
      color: this.players.get(id).color,
      eliminated: false, eliminatedRank: null, left: false,
    }]));

    this.broadcast('gameStarted', {
      turnOrder: this._turnOrder,
      startTileCount: this._startTileCount,
      options: { tieRule: this._tieRule, guessTimerSec: Number.isFinite(this._guessTimerSec) ? this._guessTimerSec : 0, includeJokers: this._includeJokers },
      poolCounts: poolCounts(this._pools),
    });

    this._stateName = 'setupPick';
    this._setupPickIdx = 0;
    this.setPhase('playing');
    this._renderTableSeats();
    this._renderPlayersPanel();
    this._renderPoolStacks();
    this._startSetupPick(this._turnOrder[0]);
  }

  _shuffleIds(ids) {
    const a = [...ids];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ─── 세팅: 색 구성 선택 (§5.3) ────────────────────────────────────────────

  _startSetupPick(playerId) {
    clearTimeout(this._turnTimer);
    this._turnDeadlineTs = Date.now() + 15000;
    this.broadcast('pickPhase', { playerId, deadlineTs: this._turnDeadlineTs, poolCounts: poolCounts(this._pools) });
    this._renderSetupBanner(playerId);
    this._tickTimerRing(15);
    this._turnTimer = setTimeout(() => this._onPickTimeout(playerId), 15000);
    if (this._isDemo) this._demoSimulator.onSetupPick(playerId);
  }

  _onPickTimeout(playerId) {
    if (this._turnOrder[this._setupPickIdx] !== playerId) return;
    const avail = poolCounts(this._pools);
    const maxBlack = Math.min(this._startTileCount, avail.black);
    const minBlack = Math.max(0, this._startTileCount - avail.white);
    const black = Math.floor(Math.random() * (maxBlack - minBlack + 1)) + minBlack;
    this._resolvePick(playerId, black, this._startTileCount - black);
  }

  _tryPickTiles(playerId, blackCount) {
    if (this._stateName !== 'setupPick') return reject('WRONG_PHASE');
    if (this._turnOrder[this._setupPickIdx] !== playerId) return reject('NOT_YOUR_TURN');
    const whiteCount = this._startTileCount - blackCount;
    if (!Number.isInteger(blackCount) || blackCount < 0 || whiteCount < 0) return reject('BAD_COUNT');
    const avail = poolCounts(this._pools);
    if (blackCount > avail.black || whiteCount > avail.white) return reject('INSUFFICIENT_POOL');
    clearTimeout(this._turnTimer);
    this._resolvePick(playerId, blackCount, whiteCount);
    return { accepted: true };
  }

  _resolvePick(playerId, blackCount, whiteCount) {
    const drawnBlack = this._pools.black.splice(0, blackCount);
    const drawnWhite = this._pools.white.splice(0, whiteCount);
    const drawn = [...drawnBlack, ...drawnWhite];
    const jokers = drawn.filter(t => t.joker);
    const numbered = drawn.filter(t => !t.joker)
      .sort((a, b) => (a.number - b.number) || (colorRank(a.color) - colorRank(b.color)));
    this._playerTiles.set(playerId, numbered);
    this.broadcast('boardsUpdate', { boards: this._publicBoardsView(), poolCounts: poolCounts(this._pools) });
    this._renderTV();
    // 조커가 남아있어도 숫자 타일은 이미 확정됐으므로 즉시 알려준다 — 안 그러면
    // 조커 위치 선택 UI가 "내 기존 타일이 몇 번인지도 모르는 채" 뜨게 된다.
    // _finalizeSetupPick()에서 조커까지 반영된 최종본을 다시 한 번 보낸다.
    this._sendHandDealt(playerId);

    if (jokers.length > 0) {
      this._startJokerPlaceForSetup(playerId, jokers[0], jokers.slice(1));
    } else {
      this._finalizeSetupPick(playerId);
    }
  }

  _sendHandDealt(playerId) {
    const tiles = this._playerTiles.get(playerId);
    this.sendToPlayer(playerId, 'handDealt', {
      tiles: tiles.map(t => ({ uid: t.uid, color: t.color, ...(t.joker ? { joker: true } : { number: t.number }), revealed: false })),
    });
  }

  _startJokerPlaceForSetup(playerId, tile, remainingQueue) {
    clearTimeout(this._turnTimer);
    this._pendingSetupPlacement = { playerId, tile, remainingQueue };
    const tiles = this._playerTiles.get(playerId);
    const jokerSlots = tiles.length + 1;
    this._turnDeadlineTs = Date.now() + 15000;
    this.sendToPlayer(playerId, 'phasePrompt', { phase: 'jokerPlace', deadlineTs: this._turnDeadlineTs, jokerSlots });
    this._renderSetupBanner(playerId, { jokerPlace: true });
    this._tickTimerRing(15);
    this._turnTimer = setTimeout(() => this._resolveSetupJokerPlacement(playerId, tiles.length), 15000);
    if (this._isDemo) this._demoSimulator.onJokerPlacePrompt(playerId, jokerSlots);
  }

  _resolveSetupJokerPlacement(playerId, position) {
    if (!this._pendingSetupPlacement || this._pendingSetupPlacement.playerId !== playerId) return;
    clearTimeout(this._turnTimer);
    const { tile, remainingQueue } = this._pendingSetupPlacement;
    this._pendingSetupPlacement = null;
    const tiles = this._playerTiles.get(playerId);
    const idx = Math.max(0, Math.min(position, tiles.length));
    tiles.splice(idx, 0, tile);
    this.broadcast('boardsUpdate', { boards: this._publicBoardsView(), poolCounts: poolCounts(this._pools) });
    this._renderTV();

    if (remainingQueue.length > 0) {
      this._startJokerPlaceForSetup(playerId, remainingQueue[0], remainingQueue.slice(1));
    } else {
      this._finalizeSetupPick(playerId);
    }
  }

  _finalizeSetupPick(playerId) {
    this._sendHandDealt(playerId);
    this._advanceSetupPick();
  }

  _advanceSetupPick() {
    do {
      this._setupPickIdx++;
      if (this._setupPickIdx >= this._turnOrder.length) { this._beginTurns(); return; }
    } while (this._isSkipped(this._turnOrder[this._setupPickIdx]));
    this._startSetupPick(this._turnOrder[this._setupPickIdx]);
  }

  // ─── 턴 루프 (§6) ────────────────────────────────────────────────────────

  _isSkipped(pid) {
    const meta = this._playerMeta.get(pid);
    return !meta || meta.eliminated || meta.left;
  }

  _beginTurns() {
    this._stateName = 'turns';
    // 세팅에서 시작 플레이어가 이탈했을 가능성에 대비해 첫 유효 인덱스를 찾음
    this._turnIdx = 0;
    while (this._isSkipped(this._turnOrder[this._turnIdx]) && this._turnIdx < this._turnOrder.length) this._turnIdx++;
    this._startTurn(this._turnOrder[this._turnIdx]);
  }

  _startTurn(playerId) {
    clearTimeout(this._turnTimer);
    this._currentTurnPlayerId = playerId;
    const hasPool = this._pools.black.length + this._pools.white.length > 0;
    this._turn = { phase: hasPool ? 'draw' : 'guess', drawnTile: null, comboCount: 0 };
    const ms = hasPool ? 15000 : this._guessTimerSecMs();
    this._turnDeadlineTs = Number.isFinite(ms) ? Date.now() + ms : null;
    this.broadcast('turnStarted', {
      playerId, turnPhase: this._turn.phase, deadlineTs: this._turnDeadlineTs, poolCounts: poolCounts(this._pools),
    });
    this._renderTurnBanner(playerId);
    this._renderPlayersPanel();
    this._tickTimerRing(hasPool ? 15 : this._guessTimerSec);
    if (this._turnDeadlineTs) {
      const onTimeout = hasPool ? () => this._onDrawTimeout(playerId) : () => this._onGuessTimeout(playerId);
      this._turnTimer = setTimeout(onTimeout, ms);
    }
    if (this._isDemo) this._demoSimulator.onTurnStart(playerId);
  }

  _guessTimerSecMs() { return Number.isFinite(this._guessTimerSec) ? this._guessTimerSec * 1000 : null; }

  // ── draw (§6.1) ──
  _onDrawTimeout(playerId) {
    if (playerId !== this._currentTurnPlayerId || this._turn.phase !== 'draw') return;
    const avail = poolCounts(this._pools);
    const color = avail.black === avail.white ? (Math.random() < 0.5 ? 'B' : 'W') : (avail.black > avail.white ? 'B' : 'W');
    this._resolveDraw(playerId, color);
  }

  _tryDrawTile(playerId, color) {
    if (playerId !== this._currentTurnPlayerId || this._stateName !== 'turns') return reject('NOT_YOUR_TURN');
    if (this._turn.phase !== 'draw') return reject('WRONG_PHASE');
    if (color !== 'B' && color !== 'W') return reject('BAD_COLOR');
    if (this._pools[poolKey(color)].length === 0) return reject('COLOR_EMPTY');
    clearTimeout(this._turnTimer);
    this._resolveDraw(playerId, color);
    return { accepted: true };
  }

  _resolveDraw(playerId, color) {
    const tile = this._pools[poolKey(color)].shift();
    this._turn.drawnTile = tile;
    this._turn.phase = 'guess';
    const deadlineTs = this._guessTimerSecMs() != null ? Date.now() + this._guessTimerSecMs() : null;
    this._turnDeadlineTs = deadlineTs;
    this.broadcast('tileDrawn', { playerId, color, poolCounts: poolCounts(this._pools), deadlineTs });
    this.sendToPlayer(playerId, 'drawnTilePrivate', { uid: tile.uid, color: tile.color, ...(tile.joker ? { joker: true } : { number: tile.number }) });
    this._renderTV();
    this._tickTimerRing(this._guessTimerSec);
    if (deadlineTs) this._turnTimer = setTimeout(() => this._onGuessTimeout(playerId), deadlineTs - Date.now());
    if (this._isDemo) this._demoSimulator.onDrawResolved(playerId);
  }

  // ── guess (§6.2) ──
  _onGuessTimeout(playerId) {
    if (playerId !== this._currentTurnPlayerId || this._turn.phase !== 'guess') return;
    this._endTurnAfterGuess(playerId, { success: this._turn.comboCount > 0 });
  }

  _tryGuess(playerId, targetPlayerId, tileIndex, number) {
    if (playerId !== this._currentTurnPlayerId || this._stateName !== 'turns') return reject('NOT_YOUR_TURN');
    if (this._turn.phase !== 'guess') return reject('WRONG_PHASE');
    if (targetPlayerId === playerId) return reject('SELF_TARGET');
    if (this._isSkipped(targetPlayerId)) return reject('INVALID_TARGET');
    const targetTiles = this._playerTiles.get(targetPlayerId);
    const tile = targetTiles?.[tileIndex];
    if (!tile || tile.revealed) return reject('INVALID_TILE');
    if (number === 'joker') { if (!this._includeJokers) return reject('BAD_GUESS'); }
    else if (!Number.isInteger(number) || number < 0 || number > 11) return reject('BAD_GUESS');
    clearTimeout(this._turnTimer);
    this._resolveGuess(playerId, targetPlayerId, tileIndex, number);
    return { accepted: true };
  }

  _resolveGuess(guesserId, targetPlayerId, tileIndex, guessValue) {
    const targetTile = this._playerTiles.get(targetPlayerId)[tileIndex];
    const comboBefore = this._turn.comboCount;
    this.broadcast('guessMade', {
      guesserId, targetPlayerId, tileIndex, tileUid: targetTile.uid, number: guessValue, comboCount: comboBefore,
    });
    this._renderGuessStage(guesserId, targetPlayerId, tileIndex, guessValue);

    const correct = judgeGuess(targetTile, guessValue);
    // 판정 직후 실제 UI 반영(choose 진입/턴 종료)은 드럼롤 뒤로 미루지만,
    // "이 턴에 또 추측을 받아줄지"는 절대 미루면 안 된다 — turn.phase를 여기서
    // 바로 바꾸지 않고 'guess'로 남겨두면, 드럼롤이 재생되는 ~1초 동안
    // _tryGuess()가 여전히 새 추측을 정상 요청으로 받아들여 두 번째 판정이
    // _scheduleReveal의 pending 타이머를 즉시 취소·교체해버리고, 첫 번째
    // 정답의 탈락 판정·승리 체크·choose 진입이 통째로 증발하는 경합이 있었다
    // (3/4인 실플레이 E2E에서 재현 — "정답만 계속 선언"하는 자동 진행 루프가
    // 드럼롤 창을 기다리지 않고 바로 다음 추측을 눌러 재현됨, 2026-08-23).
    // 'resolving'은 draw/guess/choose 등 어떤 검증 분기와도 일치하지 않아
    // 이 창 동안의 모든 액션이 자연히 WRONG_PHASE로 거부된다.
    this._turn.phase = 'resolving';
    if (correct) {
      targetTile.revealed = true;
      this._turn.comboCount++;
      this.broadcast('guessResult', {
        correct: true, targetPlayerId, tileIndex, tileUid: targetTile.uid,
        ...(targetTile.joker ? { revealedJoker: true } : { revealedNumber: targetTile.number }),
      });
      this.broadcast('boardsUpdate', { boards: this._publicBoardsView(), poolCounts: poolCounts(this._pools) });
      // §11.4 "판정은 즉시 보여주지 않는다": 상태 갱신·브로드캐스트(위 두 줄)는
      // 원칙 그대로 즉시 내보내되, TV가 실제로 타일을 뒤집어 보여주는 것과 그
      // 뒤에 이어지는 연쇄(탈락 판정·승리 체크·choose 진입=phasePrompt 발송)는
      // 드럼롤이 끝난 뒤로 미룬다 — 안 그러면 _renderTV()가 publicBoards()의
      // 최신 상태(이미 revealed:true)를 즉시 다시 그리면서 드럼롤이 채 끝나기도
      // 전에 숫자가 노출돼버리고, choose 프롬프트도 모바일의 드럼롤 연출이
      // 끝나기 전에 도착해 "한 번 더/멈추기" 버튼이 먼저 떠버린다(codex 헤드리스
      // 리뷰로 발견, 2026-08-23).
      this._scheduleReveal(() => {
        this._clearGuessStage();
        this._renderTV({ comboFlash: true });
        this._maybeEliminate(targetPlayerId, 'revealed');
        if (this._checkForWinner()) return;
        this._enterChoose(guesserId);
      });
    } else {
      this.broadcast('guessResult', { correct: false, targetPlayerId, tileIndex, tileUid: targetTile.uid });
      this._scheduleReveal(() => {
        this._clearGuessStage();
        this._renderTV({ missFlash: true });
        this._endTurnAfterGuess(guesserId, { success: false });
      });
    }
  }

  /**
   * 드럼롤(§11.4)이 끝난 뒤에만 실행해야 하는 후속 렌더/연쇄를 예약한다.
   * 이미 예약된 게 있으면 취소하고 최신 것으로 교체(§11.4 구현지침 "최신
   * 상태로 빨리감기") — 이 게임은 턴 페이즈가 반드시 순차적이라(다음 추측은
   * choose/guess 페이즈로 되돌아간 뒤에만 가능) 실제로 겹칠 일은 없지만,
   * 방어적으로 항상 clearTimeout 후 재예약한다.
   */
  _scheduleReveal(fn) {
    clearTimeout(this._pendingRevealTimer);
    this._pendingRevealTimer = setTimeout(() => {
      this._pendingRevealTimer = null;
      fn();
    }, drumrollMs());
  }

  // ── choose (§6.3) ──
  _enterChoose(playerId) {
    this._turn.phase = 'choose';
    const deadlineTs = this._guessTimerSecMs() != null ? Date.now() + this._guessTimerSecMs() : null;
    this._turnDeadlineTs = deadlineTs;
    this.sendToPlayer(playerId, 'phasePrompt', { phase: 'choose', deadlineTs });
    this._tickTimerRing(this._guessTimerSec);
    if (deadlineTs) this._turnTimer = setTimeout(() => this._onChooseTimeout(playerId), deadlineTs - Date.now());
    if (this._isDemo) this._demoSimulator.onChoosePrompt(playerId);
  }

  _onChooseTimeout(playerId) {
    if (playerId !== this._currentTurnPlayerId || this._turn.phase !== 'choose') return;
    this._endTurnAfterGuess(playerId, { success: true });
  }

  _tryTurnChoice(playerId, action) {
    if (playerId !== this._currentTurnPlayerId || this._turn?.phase !== 'choose') return reject('WRONG_PHASE');
    if (action !== 'continue' && action !== 'stop') return reject('BAD_ACTION');
    clearTimeout(this._turnTimer);
    if (action === 'continue') {
      this._turn.phase = 'guess';
      const deadlineTs = this._guessTimerSecMs() != null ? Date.now() + this._guessTimerSecMs() : null;
      this._turnDeadlineTs = deadlineTs;
      this.broadcast('turnPhaseSync', { playerId, phase: 'guess', deadlineTs });
      this._tickTimerRing(this._guessTimerSec);
      if (deadlineTs) this._turnTimer = setTimeout(() => this._onGuessTimeout(playerId), deadlineTs - Date.now());
      if (this._isDemo) this._demoSimulator.onTurnStart(playerId, { chained: true });
    } else {
      this._endTurnAfterGuess(playerId, { success: true });
    }
    return { accepted: true };
  }

  // ── 턴 종료 분기 (§6.4, §6.5) ──
  _endTurnAfterGuess(playerId, { success }) {
    if (!success) {
      if (this._turn.drawnTile) this._insertTileForTurnEnd(playerId, this._turn.drawnTile, { reveal: true });
      else this._enterRevealOwn(playerId);
      return;
    }
    // 성공(멈춤): 뽑은 타일이 있으면 비공개 삽입. 더미 소진으로 이번 턴에
    // 뽑은 것 자체가 없었다면(§4 다이어그램은 "뽑은 타일→멈춤" 경로만
    // 명시하고 더미 소진 상태의 멈춤은 다루지 않음 — 삽입할 대상 자체가
    // 없으므로 원작 정신상 아무 페널티 없이 턴만 종료하는 것이 유일하게
    // 일관된 해석: 오답(§6.5)은 "뽑은 타일 대신 벌칙으로 자기 타일 공개"라는
    // 명시적 대체 규칙이 있지만, 자발적 멈춤에는 그런 대체 규칙이 없음).
    if (this._turn.drawnTile) this._insertTileForTurnEnd(playerId, this._turn.drawnTile, { reveal: false });
    else this._finishTurnAndAdvance();
  }

  _enterRevealOwn(playerId) {
    this._turn.phase = 'revealOwn';
    const deadlineTs = Date.now() + 15000;
    this._turnDeadlineTs = deadlineTs;
    this.sendToPlayer(playerId, 'phasePrompt', { phase: 'revealOwn', deadlineTs });
    this._tickTimerRing(15);
    this._turnTimer = setTimeout(() => this._onRevealOwnTimeout(playerId), 15000);
    if (this._isDemo) this._demoSimulator.onRevealOwnPrompt(playerId);
  }

  _onRevealOwnTimeout(playerId) {
    if (playerId !== this._currentTurnPlayerId || this._turn.phase !== 'revealOwn') return;
    const tiles = this._playerTiles.get(playerId);
    const hiddenIdx = tiles.map((t, i) => [t, i]).filter(([t]) => !t.revealed).map(([, i]) => i);
    if (hiddenIdx.length === 0) { this._finishTurnAndAdvance(); return; }
    const idx = hiddenIdx[Math.floor(Math.random() * hiddenIdx.length)];
    this._resolveRevealOwn(playerId, idx);
  }

  _tryRevealOwnTile(playerId, tileIndex) {
    if (playerId !== this._currentTurnPlayerId || this._turn?.phase !== 'revealOwn') return reject('WRONG_PHASE');
    const tiles = this._playerTiles.get(playerId);
    const tile = tiles?.[tileIndex];
    if (!tile || tile.revealed) return reject('INVALID_TILE');
    clearTimeout(this._turnTimer);
    this._resolveRevealOwn(playerId, tileIndex);
    return { accepted: true };
  }

  _resolveRevealOwn(playerId, tileIndex) {
    const tile = this._playerTiles.get(playerId)[tileIndex];
    tile.revealed = true;
    this.broadcast('selfRevealResolved', {
      playerId, tileIndex, tileUid: tile.uid, ...(tile.joker ? { revealedJoker: true } : { revealedNumber: tile.number }),
    });
    this.broadcast('boardsUpdate', { boards: this._publicBoardsView(), poolCounts: poolCounts(this._pools) });
    this._renderTV({ revealOwnFlash: true });
    this._maybeEliminate(playerId, 'revealed');
    if (this._checkForWinner()) return;
    this._finishTurnAndAdvance();
  }

  // ── 삽입(오답 공개삽입 / 멈춤 비공개삽입) 및 동점/조커 위치선택 (§6.4, §6.6, §6.7) ──
  _insertTileForTurnEnd(playerId, tile, { reveal }) {
    tile.revealed = reveal;
    if (tile.joker) { this._enterJokerPlace(playerId, tile, { reveal }); return; }
    const tiles = this._playerTiles.get(playerId);
    const pos = insertPosition(tiles, tile, this._tieRule);
    if (pos.ambiguous) { this._enterTiebreak(playerId, tile, pos, { reveal }); return; }
    tiles.splice(pos.index, 0, tile);
    this._finalizeInsert(playerId, tile, pos.index, reveal);
  }

  _finalizeInsert(playerId, tile, index, reveal) {
    this.broadcast('tileInserted', {
      playerId, tileUid: tile.uid, color: tile.color, insertIndex: index, revealed: reveal,
      ...(reveal ? (tile.joker ? { joker: true } : { number: tile.number }) : {}),
    });
    this.broadcast('boardsUpdate', { boards: this._publicBoardsView(), poolCounts: poolCounts(this._pools) });
    this._renderTV({ insertFlash: reveal });
    this._turn.drawnTile = null;
    this._finishTurnAndAdvance();
  }

  _enterTiebreak(playerId, tile, pos, { reveal }) {
    this._turn.phase = 'tiebreak';
    this._turn.pendingTile = tile;
    this._turn.pendingReveal = reveal;
    this._turn.tiebreakPos = pos;
    const deadlineTs = Date.now() + 15000;
    this._turnDeadlineTs = deadlineTs;
    this.sendToPlayer(playerId, 'phasePrompt', { phase: 'tiebreak', deadlineTs, tiebreakSlots: [pos.leftIndex, pos.rightIndex] });
    this._tickTimerRing(15);
    this._turnTimer = setTimeout(() => this._onTiebreakTimeout(playerId), 15000);
    if (this._isDemo) this._demoSimulator.onTiebreakPrompt(playerId);
  }

  _onTiebreakTimeout(playerId) {
    if (playerId !== this._currentTurnPlayerId || this._turn.phase !== 'tiebreak') return;
    const officialIdx = officialInsertIndex(this._playerTiles.get(playerId), this._turn.pendingTile);
    const side = officialIdx === this._turn.tiebreakPos.leftIndex ? 'left' : 'right';
    this._resolveTiebreak(playerId, side);
  }

  _tryPlaceTiebreak(playerId, side) {
    if (playerId !== this._currentTurnPlayerId || this._turn?.phase !== 'tiebreak') return reject('WRONG_PHASE');
    if (side !== 'left' && side !== 'right') return reject('BAD_SIDE');
    clearTimeout(this._turnTimer);
    this._resolveTiebreak(playerId, side);
    return { accepted: true };
  }

  _resolveTiebreak(playerId, side) {
    const { pendingTile, pendingReveal, tiebreakPos } = this._turn;
    const index = side === 'left' ? tiebreakPos.leftIndex : tiebreakPos.rightIndex;
    const tiles = this._playerTiles.get(playerId);
    tiles.splice(index, 0, pendingTile);
    this._finalizeInsert(playerId, pendingTile, index, pendingReveal);
  }

  _enterJokerPlace(playerId, tile, { reveal }) {
    this._turn.phase = 'jokerPlace';
    this._turn.pendingTile = tile;
    this._turn.pendingReveal = reveal;
    const tiles = this._playerTiles.get(playerId);
    const jokerSlots = tiles.length + 1;
    const deadlineTs = Date.now() + 15000;
    this._turnDeadlineTs = deadlineTs;
    this.sendToPlayer(playerId, 'phasePrompt', { phase: 'jokerPlace', deadlineTs, jokerSlots });
    this._tickTimerRing(15);
    this._turnTimer = setTimeout(() => this._resolveJokerPlace(playerId, tiles.length), 15000);
    if (this._isDemo) this._demoSimulator.onJokerPlacePrompt(playerId, jokerSlots);
  }

  _tryPlaceJoker(playerId, position) {
    if (this._pendingSetupPlacement?.playerId === playerId) {
      const tiles = this._playerTiles.get(playerId);
      if (!Number.isInteger(position) || position < 0 || position > tiles.length) return reject('BAD_POSITION');
      this._resolveSetupJokerPlacement(playerId, position);
      return { accepted: true };
    }
    if (playerId !== this._currentTurnPlayerId || this._turn?.phase !== 'jokerPlace') return reject('WRONG_PHASE');
    const tiles = this._playerTiles.get(playerId);
    if (!Number.isInteger(position) || position < 0 || position > tiles.length) return reject('BAD_POSITION');
    clearTimeout(this._turnTimer);
    this._resolveJokerPlace(playerId, position);
    return { accepted: true };
  }

  _resolveJokerPlace(playerId, position) {
    if (this._turn?.phase !== 'jokerPlace' || playerId !== this._currentTurnPlayerId) return;
    const { pendingTile, pendingReveal } = this._turn;
    const tiles = this._playerTiles.get(playerId);
    const idx = Math.max(0, Math.min(position, tiles.length));
    tiles.splice(idx, 0, pendingTile);
    this._finalizeInsert(playerId, pendingTile, idx, pendingReveal);
  }

  // ─── 턴 진행 ──────────────────────────────────────────────────────────────

  _finishTurnAndAdvance() {
    this._turn = null;
    if (this._checkForWinner()) return;
    do {
      this._turnIdx = (this._turnIdx + 1) % this._turnOrder.length;
    } while (this._isSkipped(this._turnOrder[this._turnIdx]));
    this._startTurn(this._turnOrder[this._turnIdx]);
  }

  // ─── 탈락/승리 (§7) ──────────────────────────────────────────────────────

  _maybeEliminate(playerId, reason) {
    const meta = this._playerMeta.get(playerId);
    if (!meta || meta.eliminated) return false;
    const tiles = this._playerTiles.get(playerId);
    if (!isEliminated(tiles)) return false;
    meta.eliminated = true;
    this._eliminatedCount++;
    meta.eliminatedRank = this._totalPlayers - this._eliminatedCount + 1;
    this.broadcast('playerEliminated', { playerId, rank: meta.eliminatedRank, reason });
    this._renderPlayersPanel();
    return true;
  }

  _survivors() {
    return [...this._playerMeta.entries()].filter(([, m]) => !m.eliminated && !m.left);
  }

  _checkForWinner() {
    const alive = this._survivors();
    if (alive.length <= 1) {
      clearTimeout(this._turnTimer);
      this._endGame(alive[0]?.[0] ?? null);
      return true;
    }
    return false;
  }

  _endGame(winnerId) {
    clearTimeout(this._turnTimer);
    clearInterval(this._timerTickInterval);
    this._gameStarted = false;
    this._releaseWakeLock();

    // 연속 성공 체인 도중 마지막 상대의 마지막 타일을 맞혀 즉시 승리하는
    // 경로(§6.3)에서는, 이번 턴에 뽑았지만 아직 판에 삽입되지 않은 타일이
    // 하나 떠 있을 수 있다(§_checkForWinner가 insert 단계 전에 조기 종료).
    // 삽입 규칙(§3)까지 정확히 지킬 필요는 없음(게임은 이미 끝났고 순수히
    // 결과 화면 타일 총량 보존을 위한 마무리) — 승자 판에 붙여 정합성만 맞춘다.
    if (this._turn?.drawnTile && this._currentTurnPlayerId) {
      const tile = this._turn.drawnTile;
      tile.revealed = true;
      this._playerTiles.get(this._currentTurnPlayerId)?.push(tile);
      this._turn.drawnTile = null;
    }

    // 원작 관례대로 종료 시 전원의 남은 타일까지 전부 공개(§7.2)
    for (const tiles of this._playerTiles.values()) for (const t of tiles) t.revealed = true;

    const ranking = [...this._turnOrder].sort((a, b) => {
      const ra = a === winnerId ? 1 : (this._playerMeta.get(a)?.eliminatedRank ?? 999);
      const rb = b === winnerId ? 1 : (this._playerMeta.get(b)?.eliminatedRank ?? 999);
      return ra - rb;
    });
    const revealedBoards = {};
    for (const [pid, tiles] of this._playerTiles) revealedBoards[pid] = finalRevealTiles(tiles);

    this._lastResult = { winnerId, ranking, revealedBoards };
    this.broadcast('gameFinished', { winnerId, ranking, revealedBoards });
    this._renderResult(winnerId, ranking, revealedBoards);
    this.setPhase('result');
  }

  _onPlayerLeaveElim(playerId) {
    const meta = this._playerMeta.get(playerId);
    if (!meta || meta.left) return;
    meta.left = true;
    const tiles = this._playerTiles.get(playerId);
    if (tiles) for (const t of tiles) t.revealed = true;
    this._maybeEliminate(playerId, 'left');
    this.broadcast('boardsUpdate', { boards: this._publicBoardsView(), poolCounts: poolCounts(this._pools) });
    this._renderTV();
    if (this._checkForWinner()) return;

    if (this._stateName === 'setupPick') {
      if (this._pendingSetupPlacement?.playerId === playerId) { clearTimeout(this._turnTimer); this._pendingSetupPlacement = null; }
      if (this._turnOrder[this._setupPickIdx] === playerId) { clearTimeout(this._turnTimer); this._advanceSetupPick(); }
    } else if (this._stateName === 'turns' && playerId === this._currentTurnPlayerId) {
      clearTimeout(this._turnTimer);
      this._finishTurnAndAdvance();
    }
  }

  // ─── 상태 조회 헬퍼 ──────────────────────────────────────────────────────

  _publicBoardsView() { return publicBoards(this._playerTiles); }

  _buildStateSyncPayload(playerId) {
    const myTiles = this._playerTiles.get(playerId) || [];
    const isMyTurn = this._stateName === 'turns' && playerId === this._currentTurnPlayerId;
    return {
      phase: this.phase,
      stateName: this._stateName,
      options: { tieRule: this._tieRule, guessTimerSec: Number.isFinite(this._guessTimerSec) ? this._guessTimerSec : 0, includeJokers: this._includeJokers },
      boards: this._publicBoardsView(),
      // 소유자 본인은 공개 여부와 무관하게 자기 타일의 진짜 값을 항상 앎.
      myTiles: myTiles.map(t => ({ uid: t.uid, color: t.color, revealed: t.revealed, ...(t.joker ? { joker: true } : { number: t.number }) })),
      drawnTile: (isMyTurn && this._turn?.drawnTile) ? { uid: this._turn.drawnTile.uid, color: this._turn.drawnTile.color, ...(this._turn.drawnTile.joker ? { joker: true } : { number: this._turn.drawnTile.number }) } : null,
      turnInfo: {
        playerId: this._currentTurnPlayerId, deadlineTs: this._turnDeadlineTs,
        turnPhase: this._turn?.phase ?? null, setupPickPlayerId: this._stateName === 'setupPick' ? this._turnOrder[this._setupPickIdx] : null,
        startTileCount: this._startTileCount,
      },
      poolCounts: poolCounts(this._pools),
      eliminatedRanks: Object.fromEntries([...this._playerMeta.entries()].map(([pid, m]) => [pid, m.eliminatedRank])),
      players: this._turnOrder.map(pid => ({ id: pid, color: this._playerMeta.get(pid)?.color, nickname: this._playerMeta.get(pid)?.nickname })),
      result: this._lastResult || null,
    };
  }

  // ─── 로비 UI ─────────────────────────────────────────────────────────────

  _renderLobby() { this.renderLobbyPlayers(this._profiles); }
  _updateReadyStatus() { this.updateLobbyReady(this._readyCount); }
  _broadcastPlayerList() {
    const players = [...this.players.values()].map(p => ({ id: p.id, color: p.color, nickname: this._profiles.get(p.id)?.nickname ?? '...' }));
    this.broadcast('playerListUpdated', { players });
  }

  // ─── 호스트 화면 렌더 (§11.1, §11.4) ─────────────────────────────────────

  /**
   * TV는 원작을 실제 테이블에서 볼 때의 관전자 시점과 동일하게 항상 전원의
   * 타일판을 보여준다(§11.1, D9의 근거 — 모바일과 달리 숨길 이유가 없음).
   * 좌석 배치는 인원수별로 테이블에 둘러앉은 모양을 흉내낸다.
   */
  _renderTableSeats() {
    const table = document.getElementById('dv-table');
    if (!table) return;
    table.innerHTML = '';
    const n = this._turnOrder.length;
    const seatClasses = n === 2 ? ['dv-seat-bottom', 'dv-seat-top']
      : n === 3 ? ['dv-seat-bottom', 'dv-seat-left', 'dv-seat-right']
      : ['dv-seat-bottom', 'dv-seat-left', 'dv-seat-top', 'dv-seat-right'];
    table.className = `dv-table dv-table-n${n}`;
    this._turnOrder.forEach((pid, i) => {
      const meta = this._playerMeta.get(pid);
      const seat = document.createElement('div');
      seat.className = `dv-seat ${seatClasses[i] || ''}`;
      seat.id = `dv-seat-${pid}`;
      seat.innerHTML = `
        <div class="dv-seat-label"><span class="dv-seat-dot" style="background:${meta?.color ?? '#888'}"></span>${meta?.nickname ?? '???'}</div>
        <div class="dv-board" id="dv-board-${pid}"></div>
      `;
      table.appendChild(seat);
    });
  }

  _renderPoolStacks() {
    const b = document.getElementById('dv-pool-black-count');
    const w = document.getElementById('dv-pool-white-count');
    const counts = poolCounts(this._pools);
    if (b) b.textContent = String(counts.black);
    if (w) w.textContent = String(counts.white);
  }

  _renderSetupBanner(playerId, opts = {}) {
    const meta = this._playerMeta.get(playerId);
    const el = document.getElementById('dv-setup-banner');
    if (el) el.textContent = opts.jokerPlace ? `${meta?.nickname ?? '???'}님이 조커 위치를 정하는 중...` : `${meta?.nickname ?? '???'}님이 시작 타일 색을 고르는 중...`;
    this._renderPlayersPanel();
    this._renderPoolStacks();
  }

  _renderTurnBanner(playerId) {
    const meta = this._playerMeta.get(playerId);
    const nameEl = document.getElementById('dv-turn-player-name');
    if (nameEl) nameEl.textContent = meta?.nickname ?? '-';
    const dot = document.getElementById('dv-turn-player-dot');
    if (dot) dot.style.background = meta?.color ?? '#888';
    this._renderPoolStacks();
  }

  _tickTimerRing(totalSec) {
    clearInterval(this._timerTickInterval);
    const ring = document.getElementById('dv-timer-ring');
    const label = document.getElementById('dv-timer-label');
    if (!ring || !label) return;
    if (!this._turnDeadlineTs || !Number.isFinite(totalSec)) { label.textContent = '∞'; ring.style.setProperty('--dv-pct', '1'); return; }
    const totalMs = totalSec * 1000;
    const update = () => {
      const remain = Math.max(0, this._turnDeadlineTs - Date.now());
      const pct = totalMs > 0 ? remain / totalMs : 0;
      ring.style.setProperty('--dv-pct', String(pct));
      label.textContent = String(Math.ceil(remain / 1000));
      ring.classList.toggle('dv-timer-danger', remain <= 10000);
    };
    update();
    this._timerTickInterval = setInterval(update, 250);
  }

  _renderPlayersPanel() {
    const panel = document.getElementById('dv-players-panel');
    if (!panel) return;
    panel.innerHTML = '';
    for (const pid of this._turnOrder) {
      const meta = this._playerMeta.get(pid);
      if (!meta) continue;
      const tiles = this._playerTiles.get(pid) || [];
      const hiddenCount = tiles.filter(t => !t.revealed).length;
      const card = document.createElement('div');
      card.className = 'dv-player-card';
      card.id = `dv-pcard-${pid}`;
      if (pid === this._currentTurnPlayerId && this._stateName === 'turns') card.classList.add('dv-player-card-active');
      if (meta.eliminated || meta.left) card.classList.add('dv-player-card-out');
      if (hiddenCount === 1) card.classList.add('dv-player-card-warn');
      card.innerHTML = `
        <span class="dv-pcard-dot" style="background:${meta.color}"></span>
        <span class="dv-pcard-nick">${meta.nickname}</span>
        <span class="dv-pcard-count">${meta.eliminated ? '탈락' : `비공개 ${hiddenCount}`}</span>
      `;
      panel.appendChild(card);
    }
  }

  _renderTV(opts = {}) {
    const boards = this._publicBoardsView();
    for (const pid of this._turnOrder) {
      const container = document.getElementById(`dv-board-${pid}`);
      if (!container) continue;
      const tiles = boards[pid] || [];
      container.innerHTML = '';
      tiles.forEach((tile) => {
        const el = renderTile(tile, { size: 'md' });
        container.appendChild(el);
      });
    }
    this._renderPoolStacks();
    this._renderPlayersPanel();
    if (opts.comboFlash) this._flashVignette('dv-vignette-good');
    if (opts.missFlash) this._flashVignette('dv-vignette-bad');
    if (opts.revealOwnFlash) this._flashVignette('dv-vignette-bad');
  }

  _flashVignette(cls) {
    const el = document.getElementById('dv-vignette');
    if (!el) return;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 260);
  }

  /**
   * 드럼롤 연출의 "시작" 상태만 그린다. 예전엔 여기서 자체적으로
   * setTimeout(drumrollMs())을 하나 더 예약해 스포트라이트를 껐는데, 그
   * 타이머와 _scheduleReveal()의 타이머가 별개로 굴러가다 보니 _renderTV()가
   * innerHTML=''로 타일 DOM을 통째로 새로 그리면 이 함수가 캡처해둔 targetEl이
   * 고아 노드가 돼버리는 경합이 있었다(codex 헤드리스 리뷰로 발견, 2026-08-23).
   * 이제는 타이머를 하나(_scheduleReveal)로 통일하고, 종료 처리는
   * _clearGuessStage()가 그 콜백 안에서 담당한다.
   */
  _renderGuessStage(guesserId, targetPlayerId, tileIndex, guessValue) {
    const stage = document.getElementById('dv-guess-stage');
    if (!stage) return;
    const guesser = this._playerMeta.get(guesserId);
    const target = this._playerMeta.get(targetPlayerId);
    const label = guessValue === 'joker' ? '★ 조커' : String(guessValue);
    stage.innerHTML = `<span class="dv-guess-bubble">🗣 ${guesser?.nickname ?? '?'} → ${target?.nickname ?? '?'}의 ${tileIndex + 1}번째: <b>${label}</b>?</span>`;
    stage.classList.remove('hidden');
    stage.classList.add('dv-guess-stage-drumroll');
    const targetEl = document.querySelector(`#dv-board-${targetPlayerId} [data-tile-id]:nth-child(${tileIndex + 1})`);
    targetEl?.classList.add('dv-tile-spotlight');
  }

  /** _scheduleReveal() 콜백 안(=드럼롤 종료 시점)에서 호출 — 무대 정리는 여기서 한 곳에만 있다. */
  _clearGuessStage() {
    const stage = document.getElementById('dv-guess-stage');
    if (!stage) return;
    stage.classList.remove('dv-guess-stage-drumroll');
    setTimeout(() => stage.classList.add('hidden'), 900);
  }

  _renderResult(winnerId, ranking, revealedBoards) {
    const list = document.getElementById('dv-result-list');
    if (!list) return;
    const titleEl = document.getElementById('dv-result-title');
    const winnerMeta = this._playerMeta.get(winnerId);
    if (titleEl) titleEl.textContent = winnerMeta ? `🏆 ${winnerMeta.nickname} 승리!` : '🏁 경기 종료';

    list.innerHTML = ranking.map((pid, i) => {
      const meta = this._playerMeta.get(pid);
      const tiles = revealedBoards[pid] || [];
      const tilesHtml = tiles.map(t => `<span class="dv-result-tile dv-result-tile-${t.color === 'B' ? 'black' : 'white'}">${t.joker ? '★' : t.number}</span>`).join('');
      return `
        <div class="dv-result-row ${pid === winnerId ? 'dv-result-winner' : ''}">
          <span class="dv-result-rank">${i + 1}위</span>
          <span class="dv-result-dot" style="background:${meta?.color ?? '#888'}"></span>
          <span class="dv-result-nick">${meta?.nickname ?? '???'}${meta?.left ? ' (이탈)' : ''}</span>
          <span class="dv-result-tiles">${tilesHtml}</span>
        </div>
      `;
    }).join('');
  }
}
