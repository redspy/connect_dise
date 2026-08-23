/**
 * DavinciMobile.js — 다빈치 코드 모바일 클라이언트 (docs/games/davinci-code/plan.md §11.2/§11.3)
 *
 * 내 소유 타일의 진짜 값(비공개 숫자/조커 여부)은 서버가 나에게만 유니캐스트로
 * 보내주는 handDealt/drawnTilePrivate를 통해서만 알 수 있다. 이후 boardsUpdate로
 * 오는 "공개 뷰"는 비공개 타일의 값을 아예 담고 있지 않으므로(§9), 내 자리는
 * 항상 "공개 뷰(위치·공개여부) + 로컬에 저장해둔 내 진짜 값(_myValues)"을
 * 병합해서 그린다 — 이 병합이 이 클라이언트 전체에서 가장 중요한 불변식이다.
 */
import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';
import { renderTile, guessLabel } from '../shared/TileRenderer.js';
import { renderQR } from '../../../platform/client/shared/QRDisplay.js';
import { drumrollMs } from '../shared/motion.js';

export class DavinciMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'dv-screen' });

    this._nickname = '';
    this._playersList = []; // [{id,color,nickname}]
    this._roomQrUrl = null;

    this._myValues = new Map(); // uid -> { number } | { joker:true } — 내 타일의 진짜 값(§9 로컬 보관)
    this._myTiles = [];         // 내 타일판(병합된 뷰, 항상 값 포함)
    this._boards = {};          // 전원의 공개 뷰(§9) — boardsUpdate 최신본
    this._drawnTile = null;     // 이번 턴에 뽑아 아직 삽입 안 된 내 타일(내 턴일 때만)

    this._options = { tieRule: 'official', guessTimerSec: 60, includeJokers: false };
    this._startTileCount = 4;
    this._poolCounts = { black: 0, white: 0 };
    this._turnOrderIds = [];
    this._stateName = 'setupPick'; // 'setupPick' | 'turns'
    this._myTurn = false;
    this._turnPhase = null;
    this._currentTurnPlayerId = null;
    this._setupPickPlayerId = null;
    this._deadlineTs = null;
    this._eliminated = false;

    this._pickBlack = 0;
    this._numpadSelection = null; // { targetPlayerId, tileIndex, color }
    this._numpadValue = null;
    this._tiebreakSlots = null;
    this._jokerSlots = null;

    this._timerInterval = null;
    this._resultTimer = null;
    this._vibratedLow = false;

    // 드럼롤(§11.4) 동기화 — guessMade~guessResult 사이엔 아직 "판정을 보여주면
    // 안 되는" 구간이다. 이 구간에 boardsUpdate(이미 revealed:true로 갱신된
    // 최신 공개 뷰)나 phasePrompt(choose 등)가 도착해도 즉시 반영하지 않고
    // 쌓아뒀다가, guessResult의 드럼롤 타이머가 끝나는 순간 한꺼번에 반영한다
    // (codex 헤드리스 리뷰로 발견 — 예전엔 boardsUpdate/phasePrompt가 각자
    // 즉시 반영돼 드럼롤이 끝나기도 전에 숫자·"한 번 더" 버튼이 먼저 떴음,
    // 2026-08-23).
    this._revealPending = false;
    this._revealTimer = null;
    this._pendingBoardsUpdate = null;
    this._deferredPhasePrompt = null;

    this._wireUI();
    this._wireMessages();
    this._prefillNickname();
  }

  // ─── MobileBaseGame 훅 ────────────────────────────────────────────────────

  onJoin() { this.showScreen('setup'); }
  onRejoin() {
    if (this._nickname) this._sendProfile();
    this.sendToHost('requestState', {});
  }
  onAllReady() {}

  onReset() {
    this._myValues.clear();
    this._myTiles = [];
    this._boards = {};
    this._drawnTile = null;
    this._myTurn = false;
    this._stateName = 'setupPick';
    this._turnPhase = null;
    this._eliminated = false;
    this._numpadSelection = null;
    this._numpadValue = null;
    this._tiebreakSlots = null;
    this._jokerSlots = null;
    this._stopTimerTick();
    if (this._resultTimer) { clearTimeout(this._resultTimer); this._resultTimer = null; }
    if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }
    this._revealPending = false;
    this._pendingBoardsUpdate = null;
    this._deferredPhasePrompt = null;
    if (this._nickname) this._sendProfile();
    else this.showScreen('setup');
  }

  // ─── 메시지 핸들러 ────────────────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('playerListUpdated', ({ players }) => {
      this._playersList = players || [];
      this._renderWaitingPlayers(players);
    });

    this.onMessage('gameStarted', ({ turnOrder, startTileCount, options, poolCounts }) => {
      this._turnOrderIds = turnOrder || [];
      this._startTileCount = startTileCount || 4;
      this._options = options || this._options;
      this._poolCounts = poolCounts || { black: 0, white: 0 };
      this._stateName = 'setupPick';
      this.showScreen('game');
      this._renderPoolCounts();
      this._renderHand();
    });

    this.onMessage('pickPhase', ({ playerId, deadlineTs, poolCounts }) => {
      this._setupPickPlayerId = playerId;
      this._poolCounts = poolCounts || this._poolCounts;
      this._deadlineTs = deadlineTs;
      this._renderPoolCounts();
      if (playerId === this.playerId) {
        this._pickBlack = Math.max(0, Math.min(this._startTileCount, this._poolCounts.black));
        this._renderSetupPickUI();
      } else {
        const p = this._playersList.find(pl => pl.id === playerId);
        document.getElementById('dv-m-setup-wait-name').textContent = p?.nickname || '???';
        this._showEl('dv-m-setup-wait', true);
        this._showEl('dv-m-setup-pick', false);
      }
      this._startTimerTick(15);
    });

    this.onMessage('handDealt', ({ tiles }) => {
      for (const t of tiles) this._myValues.set(t.uid, t.joker ? { joker: true } : { number: t.number });
      this._myTiles = tiles.map(t => ({ ...t }));
      // 조커 위치선택(§5.3, §6.7)까지 전부 끝나야 handDealt가 오므로, 여기
      // 도달한 시점엔 세팅 중 진행 중이던 페이즈(jokerPlace)가 더 이상 유효하지
      // 않다 — 리셋하지 않으면 본인이 위치를 확정한 뒤에도 간격 마커 UI와
      // 안내 문구가 계속 남아있었다(codex 헤드리스 리뷰로 발견, 2026-08-23).
      this._turnPhase = null;
      this._renderActionUI(); // 내부에서 _renderHand()까지 다시 그림
      this._showEl('dv-m-setup-pick', false);
      this._showEl('dv-m-setup-wait', false);
    });

    this.onMessage('phasePrompt', (payload) => {
      // choose 페이즈는 정답 추측 직후(guessMade~guessResult 드럼롤 구간)에
      // 곧바로 이어서 올 수 있다 — 드럼롤이 아직 진행 중이면 "한 번 더/멈추기"
      // 버튼을 바로 띄우지 않고 드럼롤이 끝날 때 같이 반영한다(codex 헤드리스
      // 리뷰로 발견, 2026-08-23). revealOwn/tiebreak/jokerPlace는 오답으로 턴이
      // 끝난 뒤에 오는데, 그 경로도 동일한 드럼롤 구간을 거치므로 이 게이트
      // 하나로 전부 커버된다.
      if (this._revealPending) { this._deferredPhasePrompt = payload; return; }
      this._applyPhasePrompt(payload);
    });

    this.onMessage('boardsUpdate', (payload) => {
      if (this._revealPending) { this._pendingBoardsUpdate = payload; return; }
      this._applyBoardsUpdate(payload);
    });

    this.onMessage('turnStarted', ({ playerId, turnPhase, deadlineTs, poolCounts }) => {
      this._stateName = 'turns';
      this._currentTurnPlayerId = playerId;
      this._myTurn = playerId === this.playerId;
      this._turnPhase = turnPhase;
      this._deadlineTs = deadlineTs;
      this._poolCounts = poolCounts || this._poolCounts;
      this._drawnTile = null;
      this._numpadSelection = null;
      this._numpadValue = null;
      if (this._myTurn) { this._showToast('🎯 내 차례예요!'); this.vibrate('light'); }
      this._renderTurnBanner();
      this._renderPoolCounts();
      this._renderOpponentsVisibility();
      this._renderActionUI();
      this._renderHand();
      this._startTimerTick(this._myTurn && turnPhase === 'draw' ? 15 : this._options.guessTimerSec);
    });

    this.onMessage('tileDrawn', ({ playerId, color, poolCounts, deadlineTs }) => {
      this._poolCounts = poolCounts || this._poolCounts;
      if (playerId === this._currentTurnPlayerId) this._turnPhase = 'guess';
      if (deadlineTs) this._deadlineTs = deadlineTs;
      this._renderPoolCounts();
      this._renderActionUI();
      this._startTimerTick(this._options.guessTimerSec);
      void color;
    });

    this.onMessage('drawnTilePrivate', (tile) => {
      this._myValues.set(tile.uid, tile.joker ? { joker: true } : { number: tile.number });
      this._drawnTile = { ...tile };
      this._renderDrawnSlot();
    });

    this.onMessage('guessMade', ({ guesserId, targetPlayerId, tileIndex, number, comboCount }) => {
      void comboCount;
      const iAmTarget = targetPlayerId === this.playerId;
      const iAmGuesser = guesserId === this.playerId;
      // 이 시점부터 guessResult의 드럼롤이 끝날 때까지는 판정을 미리 알려주는
      // boardsUpdate/phasePrompt를 즉시 반영하면 안 된다(§11.4, 위 boardsUpdate/
      // phasePrompt 핸들러 참고).
      this._revealPending = true;
      this._showToast(`🗣 ${this._nick(guesserId)} → ${this._nick(targetPlayerId)}의 ${tileIndex + 1}번째: ${guessLabel(number)}?`);
      if (iAmTarget) { this.vibrate('heavy'); this._spotlightMyTile(tileIndex, true); }
      else if (iAmGuesser) { this._spotlightOpponentTile(targetPlayerId, tileIndex, true); }
      else if (!this._myTurn) { this._shakeScreen(false); }
    });

    this.onMessage('guessResult', ({ correct, targetPlayerId, tileIndex, tileUid, revealedNumber, revealedJoker }) => {
      const iAmTarget = targetPlayerId === this.playerId;
      clearTimeout(this._revealTimer);
      this._revealTimer = setTimeout(() => {
        this._revealTimer = null;
        // 판정 시각 효과보다 먼저 최신 상태(boardsUpdate)와 다음 페이즈
        // (phasePrompt)를 반영해야 "정답 플립"과 "한 번 더/멈추기 버튼"이
        // 동시에 뜬다 — 순서가 바뀌면 버튼이 반 박자 먼저 보인다.
        this._flushDeferredReveal();
        if (iAmTarget) this._spotlightMyTile(tileIndex, false);
        else this._spotlightOpponentTile(targetPlayerId, tileIndex, false);
        this._showToast(correct ? '⭕ 정답!' : '❌ 오답!');
        if (!correct && !iAmTarget) this._shakeScreen(true);
        void tileUid; void revealedNumber; void revealedJoker;
      }, drumrollMs());
    });

    this.onMessage('turnPhaseSync', ({ playerId, phase, deadlineTs }) => {
      if (playerId !== this._currentTurnPlayerId) return;
      this._turnPhase = phase;
      this._deadlineTs = deadlineTs;
      this._renderActionUI();
      this._startTimerTick(this._options.guessTimerSec);
    });

    this.onMessage('tileInserted', ({ playerId, revealed }) => {
      if (playerId === this.playerId) this._drawnTile = null;
      this._renderDrawnSlot();
      void revealed;
    });

    this.onMessage('selfRevealResolved', ({ playerId }) => {
      if (playerId === this.playerId) this._showToast('💥 내 타일이 공개됐어요');
    });

    this.onMessage('playerEliminated', ({ playerId, reason }) => {
      const p = this._playersList.find(pl => pl.id === playerId);
      this._showToast(`💀 ${p?.nickname || '???'} 탈락${reason === 'left' ? '(이탈)' : ''}`);
      if (playerId === this.playerId) { this._eliminated = true; this._renderEliminatedOverlay(); }
    });

    this.onMessage('actionAck', ({ accepted, reason }) => {
      if (!accepted) this._showToast('❌ ' + this._reasonText(reason));
    });

    this.onMessage('stateSync', (data) => {
      if (data.players) this._playersList = data.players;
      this._options = data.options || this._options;
      this._boards = data.boards || {};
      this._poolCounts = data.poolCounts || this._poolCounts;
      this._startTileCount = data.turnInfo?.startTileCount || this._startTileCount;
      this._myValues.clear();
      for (const t of data.myTiles || []) this._myValues.set(t.uid, t.joker ? { joker: true } : { number: t.number });
      this._myTiles = (data.myTiles || []).map(t => ({ ...t }));
      this._drawnTile = data.drawnTile ? { ...data.drawnTile } : null;
      if (this._drawnTile) this._myValues.set(this._drawnTile.uid, this._drawnTile.joker ? { joker: true } : { number: this._drawnTile.number });
      this._stateName = data.stateName || 'turns';
      this._currentTurnPlayerId = data.turnInfo?.playerId ?? null;
      this._myTurn = this._stateName === 'turns' && this._currentTurnPlayerId === this.playerId;
      this._turnPhase = data.turnInfo?.turnPhase ?? null;
      this._setupPickPlayerId = data.turnInfo?.setupPickPlayerId ?? null;
      this._deadlineTs = data.turnInfo?.deadlineTs ?? null;

      // 재접속은 항상 서버 권위 상태로 완전히 다시 그리는 시점이라, 그 순간에
      // "드럼롤 끝날 때까지 대기 중"이던 로컬 게이트는 더 이상 의미가 없다 —
      // 정리하지 않으면 재접속 직전에 마침 드럼롤 구간이었을 경우 이후 진짜
      // boardsUpdate/phasePrompt가 영원히 큐에 갇혀 반영 안 되는 상태가 될 수 있음.
      this._revealPending = false;
      if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }
      this._pendingBoardsUpdate = null;
      this._deferredPhasePrompt = null;

      // 호스트가 stateSync에 eliminatedRanks를 실어 보내는데(§_buildStateSyncPayload)
      // 여기서 안 읽고 있어서, 탈락한 플레이어가 새로고침/재접속하면 관전
      // 뷰(§7.1)가 아니라 일반 플레이어 화면으로 떴다(codex 헤드리스 리뷰로
      // 발견, 2026-08-23) — 본인 포함 여부로 갱신.
      this._eliminated = !!(data.eliminatedRanks && data.eliminatedRanks[this.playerId] != null);

      if (data.phase === 'playing') {
        this.showScreen('game');
        this._renderPoolCounts();
        this._renderHand();
        this._renderDrawnSlot();
        this._renderTurnBanner();
        this._renderOpponentsVisibility();
        if (this._myTurn) this._renderOpponents();
        if (this._stateName === 'setupPick' && this._setupPickPlayerId === this.playerId) this._renderSetupPickUI();
        this._renderActionUI();
        if (this._eliminated) this._renderEliminatedOverlay();
        this._startTimerTick(this._options.guessTimerSec);
      } else if (data.phase === 'result') {
        if (this._resultTimer) { clearTimeout(this._resultTimer); this._resultTimer = null; }
        if (data.result) this._showResult(data.result.winnerId, data.result.ranking, data.result.revealedBoards);
        else this.showScreen('waiting');
      }
    });

    this.onMessage('gameFinished', ({ winnerId, ranking, revealedBoards }) => {
      this._stopTimerTick();
      this._showToast(winnerId === this.playerId ? '🏆 승리!' : '🏁 게임 종료');
      this._resultTimer = setTimeout(() => {
        this._resultTimer = null;
        this._showResult(winnerId, ranking, revealedBoards);
      }, 1500);
    });
  }

  // ─── 내 자리 병합(§9의 핵심 불변식) ───────────────────────────────────────

  _mergeMyBoard(publicMyTiles) {
    this._myTiles = publicMyTiles.map(t => {
      if (t.revealed) return { ...t };
      const known = this._myValues.get(t.uid) || {};
      return { ...t, ...known };
    });
  }

  /** boardsUpdate를 실제로 화면에 반영. _revealPending 게이트를 통과한 뒤(또는 게이트가 없을 때)만 호출됨. */
  _applyBoardsUpdate({ boards, poolCounts }) {
    this._boards = boards || {};
    this._poolCounts = poolCounts || this._poolCounts;
    if (this._boards[this.playerId]) this._mergeMyBoard(this._boards[this.playerId]);
    this._renderPoolCounts();
    this._renderHand();
    if (this._myTurn) this._renderOpponents();
  }

  /** phasePrompt를 실제로 화면에 반영. _revealPending 게이트를 통과한 뒤(또는 게이트가 없을 때)만 호출됨. */
  _applyPhasePrompt({ phase, deadlineTs, tiebreakSlots, jokerSlots }) {
    this._turnPhase = phase;
    this._deadlineTs = deadlineTs;
    this._tiebreakSlots = tiebreakSlots || null;
    this._jokerSlots = jokerSlots ?? null;
    this._renderActionUI();
    // choose는 원작 룰상 draw/revealOwn/tiebreak/jokerPlace(15초 고정)와 달리
    // 로비 설정 guessTimerSec을 써야 하는데(§6.8), 여기서 무조건 15로 넘기고
    // 있었다(pre-commit 리뷰로 발견, 2026-08-23) — choose만 예외 처리.
    this._startTimerTick(phase === 'choose' ? this._options.guessTimerSec : 15);
  }

  /** 드럼롤(§11.4) 종료 시점에 쌓여있던 boardsUpdate/phasePrompt를 한꺼번에 반영("최신 상태로 빨리감기"). */
  _flushDeferredReveal() {
    this._revealPending = false;
    if (this._pendingBoardsUpdate) { this._applyBoardsUpdate(this._pendingBoardsUpdate); this._pendingBoardsUpdate = null; }
    if (this._deferredPhasePrompt) { this._applyPhasePrompt(this._deferredPhasePrompt); this._deferredPhasePrompt = null; }
  }

  // ─── UI 배선 ─────────────────────────────────────────────────────────────

  _wireUI() {
    document.getElementById('btn-join')?.addEventListener('click', () => {
      const nick = document.getElementById('nickname-input')?.value.trim();
      if (!nick) { alert('닉네임을 입력해주세요'); return; }
      this._nickname = nick;
      this._sendProfile();
    });

    document.getElementById('btn-ready')?.addEventListener('click', () => {
      const btn = document.getElementById('btn-ready');
      btn.disabled = true;
      btn.textContent = '준비완료 ✓';
      this.ready();
    });

    document.getElementById('btn-room-start')?.addEventListener('click', () => this.sendToHost('requestStart', {}));
    document.getElementById('btn-rematch')?.addEventListener('click', () => this.sendToHost('requestRematch', {}));

    document.getElementById('dv-m-black-minus')?.addEventListener('click', () => this._adjustPickBlack(-1));
    document.getElementById('dv-m-black-plus')?.addEventListener('click', () => this._adjustPickBlack(1));
    document.getElementById('dv-m-btn-confirm-pick')?.addEventListener('click', () => {
      this.sendToHost('pickTiles', { black: this._pickBlack });
      this._showEl('dv-m-setup-pick', false);
    });

    document.getElementById('dv-m-btn-draw-black')?.addEventListener('click', () => this._draw('B'));
    document.getElementById('dv-m-btn-draw-white')?.addEventListener('click', () => this._draw('W'));

    document.getElementById('dv-m-btn-continue')?.addEventListener('click', () => this.sendToHost('turnChoice', { action: 'continue' }));
    document.getElementById('dv-m-btn-stop')?.addEventListener('click', () => this.sendToHost('turnChoice', { action: 'stop' }));

    document.getElementById('dv-m-btn-tiebreak-left')?.addEventListener('click', () => this.sendToHost('placeTiebreak', { side: 'left' }));
    document.getElementById('dv-m-btn-tiebreak-right')?.addEventListener('click', () => this.sendToHost('placeTiebreak', { side: 'right' }));

    document.getElementById('dv-m-btn-numpad-cancel')?.addEventListener('click', () => this._closeNumpad());
    document.getElementById('dv-m-btn-declare')?.addEventListener('click', () => this._confirmDeclare());
  }

  _draw(color) {
    if (!this._myTurn || this._turnPhase !== 'draw') return;
    if (this._poolCounts[color === 'B' ? 'black' : 'white'] <= 0) return;
    this.sendToHost('drawTile', { color });
  }

  // ─── 닉네임/로비 ─────────────────────────────────────────────────────────

  _prefillNickname() {
    const saved = localStorage.getItem('dv_nickname');
    if (saved) { this._nickname = saved; const el = document.getElementById('nickname-input'); if (el) el.value = saved; return; }
    const adjs = ['비밀스런', '침착한', '눈치빠른', '대담한', '조용한', '집요한', '차분한', '예리한'];
    const nouns = ['화가', '탐정', '암호학자', '학자', '수도사', '기사', '연금술사', '서기'];
    const el = document.getElementById('nickname-input');
    if (el) el.value = `${adjs[Math.floor(Math.random() * adjs.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}`;
  }

  _sendProfile() {
    this.sendToHost('setProfile', { nickname: this._nickname });
    localStorage.setItem('dv_nickname', this._nickname);
    const el = document.getElementById('waiting-nickname');
    if (el) el.textContent = this._nickname;
    this.showScreen('waiting');
    const btn = document.getElementById('btn-ready');
    if (btn) { btn.disabled = false; btn.textContent = '준비하기'; }
    this._renderRoomQr();
  }

  setRoomCreatorQr(qrUrl) { this._roomQrUrl = qrUrl; this._renderRoomQr(); }

  _renderRoomQr() {
    const box = document.getElementById('room-qr-box');
    const canvas = document.getElementById('room-qr-canvas');
    if (!box || !canvas || !this._roomQrUrl) return;
    box.classList.remove('hidden');
    renderQR(canvas, this._roomQrUrl, { width: 140 });
    document.getElementById('btn-room-start')?.classList.remove('hidden');
    const hint = document.getElementById('waiting-hint');
    if (hint) hint.textContent = '모두 준비되면 아래 버튼으로 게임을 시작하세요';
  }

  _renderWaitingPlayers(players) {
    const list = document.getElementById('waiting-players');
    if (!list) return;
    const others = players.filter(p => p.id !== this.playerId);
    list.innerHTML = others.map(p => `
      <div class="dv-wait-player"><span class="dv-wait-dot" style="background:${p.color}"></span><span>${p.nickname}</span></div>
    `).join('');
  }

  _nick(pid) { return this._playersList.find(p => p.id === pid)?.nickname || '???'; }

  // ─── 세팅: 색 구성 선택 ───────────────────────────────────────────────────

  _adjustPickBlack(delta) {
    const maxBlack = Math.min(this._startTileCount, this._poolCounts.black);
    const minBlack = Math.max(0, this._startTileCount - this._poolCounts.white);
    this._pickBlack = Math.max(minBlack, Math.min(maxBlack, this._pickBlack + delta));
    this._renderSetupPickUI();
  }

  _renderSetupPickUI() {
    this._showEl('dv-m-setup-pick', true);
    this._showEl('dv-m-setup-wait', false);
    document.getElementById('dv-m-black-count').textContent = String(this._pickBlack);
    document.getElementById('dv-m-white-count').textContent = String(this._startTileCount - this._pickBlack);
  }

  // ─── 헤더/타이머 ─────────────────────────────────────────────────────────

  _renderPoolCounts() {
    const b = document.getElementById('dv-m-pool-black');
    const w = document.getElementById('dv-m-pool-white');
    if (b) b.textContent = String(this._poolCounts.black ?? 0);
    if (w) w.textContent = String(this._poolCounts.white ?? 0);
    const db = document.getElementById('dv-m-draw-black-count');
    const dw = document.getElementById('dv-m-draw-white-count');
    if (db) db.textContent = String(this._poolCounts.black ?? 0);
    if (dw) dw.textContent = String(this._poolCounts.white ?? 0);
  }

  _renderTurnBanner() {
    const banner = document.getElementById('dv-m-turn-banner');
    if (!banner) return;
    if (this._eliminated) { banner.textContent = '👁 관전 중'; banner.classList.remove('dv-m-turn-banner-mine'); return; }
    if (this._myTurn) { banner.textContent = '🎯 내 차례예요!'; banner.classList.add('dv-m-turn-banner-mine'); }
    else { banner.textContent = `${this._nick(this._currentTurnPlayerId)}님 차례`; banner.classList.remove('dv-m-turn-banner-mine'); }
  }

  _startTimerTick(totalSec) {
    this._stopTimerTick();
    const label = document.getElementById('dv-m-timer-label');
    if (!label) return;
    if (!this._deadlineTs || !Number.isFinite(totalSec)) { label.textContent = '∞'; return; }
    const update = () => {
      const remain = Math.max(0, this._deadlineTs - Date.now());
      label.textContent = String(Math.ceil(remain / 1000));
      const danger = remain <= 10000;
      label.classList.toggle('dv-m-timer-danger', danger);
      if (danger && !this._vibratedLow) { this._vibratedLow = true; this.vibrate('light'); }
      if (remain <= 0) this._stopTimerTick();
    };
    this._vibratedLow = false;
    update();
    this._timerInterval = setInterval(update, 250);
  }
  _stopTimerTick() { if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; } }

  // ─── 내 타일판 (하단, 상시) ───────────────────────────────────────────────

  _renderHand() {
    const tray = document.getElementById('dv-m-hand');
    if (!tray) return;
    tray.innerHTML = '';

    // jokerPlace는 세팅 단계(§5.3)에서도 뜰 수 있어 this._myTurn이 아직 true가
    // 아닌 상태일 수 있다(§_renderActionUI의 동일한 버그와 같은 원인, 2026-08-23
    // 수정) — phasePrompt로 나에게만 온 것이므로 turnPhase 값 자체로 충분하다.
    const revealOwnInteractive = this._myTurn && this._turnPhase === 'revealOwn';
    if (this._turnPhase === 'jokerPlace') {
      this._renderHandWithGaps(tray);
      return;
    }

    this._myTiles.forEach((tile, idx) => {
      const el = renderTile(tile, { size: 'lg' });
      if (revealOwnInteractive && !tile.revealed) {
        el.classList.add('dv-tile-selectable');
        el.addEventListener('click', () => this.sendToHost('revealOwnTile', { tileIndex: idx }));
      }
      el.dataset.myIndex = String(idx);
      tray.appendChild(el);
    });
  }

  _renderHandWithGaps(tray) {
    const gap = (idx) => {
      const g = document.createElement('div');
      g.className = 'dv-m-gap-slot';
      g.textContent = '＋';
      g.addEventListener('click', () => this.sendToHost('placeJoker', { position: idx }));
      return g;
    };
    tray.appendChild(gap(0));
    this._myTiles.forEach((tile, idx) => {
      tray.appendChild(renderTile(tile, { size: 'lg' }));
      tray.appendChild(gap(idx + 1));
    });
  }

  _renderDrawnSlot() {
    const slot = document.getElementById('dv-m-drawn-slot');
    if (!slot) return;
    if (!this._drawnTile) { slot.classList.add('hidden'); slot.innerHTML = ''; return; }
    slot.classList.remove('hidden');
    slot.innerHTML = '';
    // 뽑은 타일은 아직 공개(publicly revealed)된 게 아니라 나만 아는 상태라
    // revealed는 강제하지 않는다(강제하면 아직 공개 안 됐는데 "공개됨" 모서리
    // 마킹이 붙는 오표시가 생김) — number/joker 필드만 있어도 소유자 화면엔
    // 숫자가 보이므로 그걸로 충분(§11.2).
    const el = renderTile({ ...this._drawnTile }, { size: 'lg' });
    el.classList.add('dv-tile-floating');
    slot.appendChild(el);
  }

  _spotlightMyTile(tileIndex, on) {
    const el = document.querySelector(`#dv-m-hand [data-my-index="${tileIndex}"]`);
    el?.classList.toggle('dv-tile-spotlight', on);
  }

  // ─── 상대 타일판 (내 차례일 때만, D8/D9) ─────────────────────────────────

  _computeOpponentSeats() {
    const n = this._turnOrderIds.length;
    const myIdx = this._turnOrderIds.indexOf(this.playerId);
    if (myIdx === -1 || n < 2) return [];
    const others = [];
    for (let i = 1; i < n; i++) others.push(this._turnOrderIds[(myIdx + i) % n]);
    const layout = n === 4 ? ['left', 'top', 'right'] : n === 3 ? ['left', 'right'] : ['top'];
    return others.map((pid, i) => ({ pid, seat: layout[i] }));
  }

  _renderOpponentsVisibility() {
    const showOpp = this._myTurn && this._stateName === 'turns';
    this._showEl('dv-m-opponents-wrap', showOpp);
    this._showEl('dv-m-not-my-turn', !showOpp && this._stateName === 'turns');
    if (showOpp) this._renderOpponents();
  }

  _renderOpponents() {
    const seats = this._computeOpponentSeats();
    ['top', 'left', 'right'].forEach(seat => {
      const wrap = document.getElementById(`dv-m-opp-${seat}`);
      wrap?.classList.add('hidden');
    });
    for (const { pid, seat } of seats) {
      const wrap = document.getElementById(`dv-m-opp-${seat}`);
      const label = document.getElementById(`dv-m-opp-${seat}-label`);
      const board = document.getElementById(`dv-m-opp-${seat}-board`);
      if (!wrap || !board) continue;
      wrap.classList.remove('hidden');
      const meta = this._playersList.find(p => p.id === pid);
      if (label) label.textContent = meta?.nickname || '???';
      board.innerHTML = '';
      const tiles = this._boards[pid] || [];
      tiles.forEach((tile, idx) => {
        const el = renderTile(tile, { size: 'md' });
        if (this._myTurn && this._turnPhase === 'guess' && !tile.revealed) {
          el.classList.add('dv-tile-selectable');
          el.addEventListener('click', () => this._openNumpad(pid, idx, tile.color));
        }
        board.appendChild(el);
      });
    }
  }

  _spotlightOpponentTile(pid, tileIndex, on) {
    const seats = this._computeOpponentSeats();
    const seat = seats.find(s => s.pid === pid)?.seat;
    if (!seat) return;
    const board = document.getElementById(`dv-m-opp-${seat}-board`);
    const el = board?.children?.[tileIndex];
    el?.classList.toggle('dv-tile-spotlight', on);
  }

  // ─── 숫자 패드 (§6.2, D12) ────────────────────────────────────────────────

  _isDimmed(color, value) {
    for (const tiles of Object.values(this._boards)) {
      for (const t of tiles) {
        if (t.color !== color || !t.revealed) continue;
        if (value === 'joker') { if (t.joker) return true; }
        else if (!t.joker && t.number === value) return true;
      }
    }
    return false;
  }

  _openNumpad(targetPlayerId, tileIndex, color) {
    this._numpadSelection = { targetPlayerId, tileIndex, color };
    this._numpadValue = null;
    const pad = document.getElementById('dv-m-numpad');
    const overlay = document.getElementById('dv-m-numpad-overlay');
    const title = document.getElementById('dv-m-numpad-title');
    if (title) title.textContent = `${this._nick(targetPlayerId)}의 ${tileIndex + 1}번째 타일 — 숫자는?`;
    pad.innerHTML = '';
    const values = [...Array(12).keys()];
    if (this._options.includeJokers) values.push('joker');
    for (const v of values) {
      const btn = document.createElement('button');
      btn.className = 'dv-m-numpad-key';
      if (this._isDimmed(color, v)) btn.classList.add('dv-m-numpad-key-dim');
      btn.textContent = guessLabel(v);
      btn.addEventListener('click', () => this._selectNumpadValue(v));
      pad.appendChild(btn);
    }
    overlay.classList.remove('hidden');
    document.getElementById('dv-m-numpad-confirm').classList.add('hidden');
  }

  _selectNumpadValue(v) {
    this._numpadValue = v;
    document.querySelectorAll('.dv-m-numpad-key').forEach(k => k.classList.remove('dv-m-numpad-key-selected'));
    [...document.querySelectorAll('.dv-m-numpad-key')].find(k => k.textContent === guessLabel(v))?.classList.add('dv-m-numpad-key-selected');
    const confirmText = document.getElementById('dv-m-numpad-confirm-text');
    if (confirmText) confirmText.textContent = `${this._nick(this._numpadSelection.targetPlayerId)}의 ${this._numpadSelection.tileIndex + 1}번째 타일을 ${guessLabel(v)}(으)로 선언`;
    document.getElementById('dv-m-numpad-confirm').classList.remove('hidden');
  }

  _confirmDeclare() {
    if (!this._numpadSelection || this._numpadValue === null) return;
    const { targetPlayerId, tileIndex } = this._numpadSelection;
    this.sendToHost('guess', { targetPlayerId, tileIndex, number: this._numpadValue });
    this._closeNumpad();
  }

  _closeNumpad() {
    document.getElementById('dv-m-numpad-overlay')?.classList.add('hidden');
    this._numpadSelection = null;
    this._numpadValue = null;
  }

  // ─── 페이즈별 액션 UI ─────────────────────────────────────────────────────

  _renderActionUI() {
    const show = (id, on) => this._showEl(id, on);
    const my = this._myTurn && this._stateName === 'turns';
    // choose/revealOwn/tiebreak/jokerPlace는 호스트가 phasePrompt로 "나에게만"
    // 유니캐스트하는 페이즈라, this._turnPhase가 그 값이 됐다는 사실 자체가 이미
    // "나에게 온 요청"이라는 뜻이다. jokerPlace는 세팅 단계(§5.3, stateName이
    // 아직 'setupPick')에서도 뜰 수 있는데, my(=stateName==='turns' 전제)로
    // 게이트를 걸면 세팅 중 조커 위치선택 UI가 영원히 안 뜨는 버그가 있었다
    // (2인 결정적 RNG E2E로 재현·발견, 2026-08-23) — 이 네 가지는 my 게이트를
    // 걸지 않는다.
    const promptedToMe = (phase) => this._turnPhase === phase;
    show('dv-m-draw-bar', my && this._turnPhase === 'draw');
    show('dv-m-choose-bar', promptedToMe('choose'));
    show('dv-m-revealown-hint', promptedToMe('revealOwn'));
    show('dv-m-jokerplace-hint', promptedToMe('jokerPlace'));
    show('dv-m-tiebreak-bar', promptedToMe('tiebreak'));
    if (my && this._turnPhase === 'draw') {
      document.getElementById('dv-m-btn-draw-black')?.classList.toggle('dv-m-action-btn-disabled', this._poolCounts.black <= 0);
      document.getElementById('dv-m-btn-draw-white')?.classList.toggle('dv-m-action-btn-disabled', this._poolCounts.white <= 0);
    }
    if (!(my && this._turnPhase === 'guess')) this._closeNumpad();
    // 상대판의 탭 가능 여부(dv-tile-selectable)는 현재 turnPhase에 달려있는데,
    // boardsUpdate가 phasePrompt보다 먼저 도착하는 메시지 순서상(§12) choose로
    // 전환된 뒤에도 잠깐 이전 렌더의 리스너가 남아있을 수 있다 — 페이즈가 바뀔
    // 때마다 다시 그려서 그 틈을 없앤다(어차피 서버도 거부하지만, 클릭 자체를
    // 막는 게 더 일관된 UX).
    if (my) this._renderOpponents();
    this._renderHand();
  }

  // ─── 연출 헬퍼 ───────────────────────────────────────────────────────────

  _shakeScreen(strong) {
    const scr = document.querySelector('.dv-screen[data-screen="game"]');
    if (!scr) return;
    scr.classList.add(strong ? 'dv-shake' : 'dv-shake-light');
    setTimeout(() => scr.classList.remove('dv-shake', 'dv-shake-light'), 420);
  }

  _renderEliminatedOverlay() {
    this._renderTurnBanner();
    this._showEl('dv-m-opponents-wrap', false);
    this._showEl('dv-m-not-my-turn', false);
  }

  _showEl(id, on) { document.getElementById(id)?.classList.toggle('hidden', !on); }

  _reasonText(reason) {
    const map = {
      NOT_YOUR_TURN: '내 차례가 아니에요', WRONG_PHASE: '지금은 할 수 없는 행동이에요',
      SELF_TARGET: '자기 자신은 추측할 수 없어요', INVALID_TARGET: '추측할 수 없는 대상이에요',
      INVALID_TILE: '이미 공개됐거나 없는 타일이에요', BAD_GUESS: '올바르지 않은 숫자예요',
      BAD_COLOR: '색을 다시 골라주세요', COLOR_EMPTY: '그 색은 더미가 비었어요',
      BAD_COUNT: '장수를 다시 확인해주세요', INSUFFICIENT_POOL: '더미에 남은 타일이 부족해요',
      BAD_ACTION: '올바르지 않은 선택이에요', BAD_SIDE: '왼쪽/오른쪽 중 골라주세요',
      BAD_POSITION: '그 위치엔 놓을 수 없어요',
    };
    return map[reason] || reason;
  }

  _showToast(msg) {
    let c = document.getElementById('dv-toast-container');
    if (!c) { c = document.createElement('div'); c.id = 'dv-toast-container'; c.className = 'dv-toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div');
    t.className = 'dv-toast';
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('dv-toast-fadeout'); setTimeout(() => t.remove(), 400); }, 2200);
  }

  // ─── 결과 화면 ───────────────────────────────────────────────────────────

  _showResult(winnerId, ranking, revealedBoards) {
    const titleEl = document.getElementById('result-title');
    const iWon = winnerId === this.playerId;
    if (titleEl) titleEl.textContent = iWon ? '🏆 승리!' : '🏁 결과';
    const myRankIdx = ranking.indexOf(this.playerId);
    const rankEl = document.getElementById('result-my-rank');
    if (rankEl) rankEl.textContent = myRankIdx >= 0 ? `${myRankIdx + 1}위` : '-';

    const listEl = document.getElementById('result-ranking-list');
    if (listEl) {
      listEl.innerHTML = ranking.map((pid, i) => {
        const p = this._playersList.find(pl => pl.id === pid);
        const tiles = revealedBoards[pid] || [];
        const tilesHtml = tiles.map(t => `<span class="dv-result-tile dv-result-tile-${t.color === 'B' ? 'black' : 'white'}">${t.joker ? '★' : t.number}</span>`).join('');
        return `
          <div class="dv-result-row ${pid === this.playerId ? 'dv-result-me' : ''}">
            <span class="dv-result-rank">${i + 1}위</span>
            <span class="dv-result-dot" style="background:${p?.color || '#888'}"></span>
            <span class="dv-result-nick">${p?.nickname || '???'}</span>
            <div class="dv-result-tiles">${tilesHtml}</div>
          </div>
        `;
      }).join('');
    }
    this.showScreen('result');
  }
}
