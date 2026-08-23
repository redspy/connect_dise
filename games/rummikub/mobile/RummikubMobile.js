/**
 * RummikubMobile.js — 루미큐브 모바일 클라이언트 (docs/games/rummikub/plan.md §11.2/§11.3)
 *
 * 조작: 탭-탭(선택 후 목적지 탭)을 기본 파이프라인으로 하고, 같은 포인터
 * 이벤트 위에서 일정 거리 이상 이동하면 드래그로 전환되는 통합 입력.
 * 서버 op 반영은 "opAck 수신 후에만 로컬에 적용"하는 비관적(pessimistic)
 * 방식 — 원 설계는 낙관적 반영이었으나, 롤백 로직 복잡도를 낮추기 위해
 * 이번 구현에서는 이렇게 단순화함(README 격 보고에 명시).
 */
import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';
import { renderTile } from '../shared/TileRenderer.js';
import { renderQR } from '../../../platform/client/shared/QRDisplay.js';
import { flipTween } from '../shared/motion.js';
import { validateBoard, sumOfMelds, computeAutoSortIndex } from '../shared/RummikubEngine.js';

const DRAG_THRESHOLD_PX = 10;

export class RummikubMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'rk-screen' });

    this._nickname = '';
    this._playersList = [];
    this._roomQrUrl = null;

    this._hand = [];       // 표시 순서(로컬 정렬 반영)
    this._board = [];      // 마지막으로 커밋된(권위) 보드
    this._workBoard = [];  // 내 턴 동안의 작업본(opAck 성공분만 반영)
    this._newMeldIdsThisTurn = new Set(); // 이번 턴에 새로 만든 세트(초기 착수 미완료 시에도 잠금 예외)
    this._placedFromHandThisTurn = new Set(); // 이번 턴에 손패→보드로 놓인 타일(강조 표시 + 제출 가능 조건, 호스트 로직과 동일하게 유지)
    this._jokerRetrievalTarget = null; // 조커 회수 진행 중 상태 — 턴 시작/리셋 시 반드시 함께 정리
    this._myTurn = false;
    this._initialMeldDone = false;
    this._initialMeldThreshold = 30;
    this._turnTimerSec = 60;
    this._turnDeadlineTs = null;
    this._poolCount = 0;
    this._handCounts = {};
    this._seq = 0;
    this._pendingOps = new Map();
    this._selection = null; // { tileId, zone:'hand'|'meld', meldId? }
    this._timerInterval = null;
    this._resultTimer = null;

    this._wireUI();
    this._wireMessages();
    this._prefillNickname();
  }

  // ─── MobileBaseGame 훅 ────────────────────────────────────────────────────

  onJoin() { this.showScreen('setup'); }
  onRejoin() {
    // 세트분할/조커회수 같은 다단계 op 체인이 끊긴 상태로 재연결되면, 늦게
    // 도착하는 옛 opAck이 방금 stateSync로 새로 받은 workBoard 위에서
    // 뒤늦게 콜백 체인을 이어갈 수 있다(pre-commit 리뷰로 발견, 낮은
    // 확률이지만 onReset()에 이미 있는 것과 동일하게 정리, 2026-08-24).
    this._pendingOps.clear();
    if (this._nickname) this._sendProfile();
    this.sendToHost('requestState', {});
  }
  onAllReady() {}

  onReset() {
    this._myTurn = false;
    this._hand = [];
    this._board = [];
    this._workBoard = [];
    this._selection = null;
    this._newMeldIdsThisTurn = new Set();
    this._placedFromHandThisTurn = new Set();
    this._jokerRetrievalTarget = null;
    // "다시 시작" 버튼 핸들러는 이미 클리어하지만, 게임 종료 직후 즉시
    // 재대결(rematch)로 세션이 리셋되는 경로에는 미처리로 남아 있었다 —
    // 그 시점에 아직 응답이 안 온 opAck 콜백이 계속 Map에 붙어 있으면
    // 다음 판과 무관한 참조가 새 상태 위에서 굴러다니게 된다.
    this._pendingOps.clear();
    this._stopTimerTick();
    // gameFinished 수신 시 예약한 2초 지연 결과화면 전환 타이머(_resultTimer)를
    // 여기서도 반드시 clear해야 함 — 안 그러면 게임 종료 직후 2초 이내에
    // 재시작이 들어왔을 때(호스트가 바로 resetSession) waiting 화면으로
    // 전환된 뒤에도 뒤늦게 발화해 지난 판 결과 화면이 다시 튀어나온다
    // (claude 헤드리스 리뷰로 발견, AGENTS.md의 "setTimeout 체인은 인스턴스
    // 필드에 저장하고 onReset()에서 clear" 규칙과 동일 패턴, 2026-08-24).
    if (this._resultTimer) { clearTimeout(this._resultTimer); this._resultTimer = null; }
    if (this._nickname) this._sendProfile();
    else this.showScreen('setup');
  }

  // ─── 메시지 핸들러 ────────────────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('playerListUpdated', ({ players }) => {
      this._playersList = players || [];
      this._renderWaitingPlayers(players);
    });

    this.onMessage('handDealt', ({ tiles }) => {
      this._hand = this._reconcileHandOrder(tiles);
      this._renderHand();
      this.showScreen('game');
    });

    this.onMessage('gameStarted', ({ turnTimerSec, initialMeldThreshold, poolCount }) => {
      this._turnTimerSec = turnTimerSec || 0;
      this._initialMeldThreshold = initialMeldThreshold || 30;
      this._poolCount = poolCount || 0;
      this._initialMeldDone = false;
      this._renderPoolCount();
    });

    this.onMessage('turnStarted', ({ playerId, deadlineTs, poolCount }) => {
      this._myTurn = playerId === this.playerId;
      this._turnDeadlineTs = deadlineTs;
      this._poolCount = poolCount;
      this._renderPoolCount();
      this._selection = null;
      this._newMeldIdsThisTurn = new Set();
      this._placedFromHandThisTurn = new Set();
      this._jokerRetrievalTarget = null;
      if (this._myTurn) {
        this._workBoard = this._board.map(m => ({ meldId: m.meldId, tiles: [...m.tiles] }));
        this._handSnapshotAtTurnStart = [...this._hand];
        this._showToast('🎲 내 차례예요!');
        this.vibrate('light');
      } else {
        this._workBoard = this._board;
      }
      this._renderTurnBanner(playerId);
      this._renderBoard();
      this._renderMeldBadge();
      this._renderActionButtons();
      this._startTimerTick();
    });

    this.onMessage('opAck', ({ seq, accepted, newMeldId, reason }) => {
      const pending = this._pendingOps.get(seq);
      if (!pending) return;
      this._pendingOps.delete(seq);
      if (accepted) {
        this._applyOpLocally(pending.op, newMeldId, pending.onAck);
        this._renderBoard();
        this._renderMeldBadge();
      } else {
        this._flashReject(pending.op.tileId);
        if (reason) this._showToast('❌ ' + this._reasonText(reason));
      }
      this._clearGhost();
    });

    this.onMessage('turnResult', ({ accepted, reason, drawnTile, hand }) => {
      this._hand = this._reconcileHandOrder(hand);
      this._myTurn = false;
      this._selection = null;
      this._stopTimerTick();
      if (!accepted) {
        this._showToast(`↩️ ${reason || '되돌렸어요'}${drawnTile ? ' — 1장 뽑았어요' : ''}`);
        this._shakeScreen();
      } else if (drawnTile) {
        this._showToast('🂠 낼 게 없어 1장 뽑았어요');
      }
      this._renderHand();
      this._renderActionButtons();
    });

    this.onMessage('boardCommitted', ({ board, poolCount, handCounts, initialMeldFlags }) => {
      this._board = board;
      this._workBoard = board;
      this._poolCount = poolCount;
      this._handCounts = handCounts || {};
      this._initialMeldDone = !!(initialMeldFlags && initialMeldFlags[this.playerId]);
      this._renderBoard({ flash: true });
      this._renderMeldBadge();
      this._renderOpponentCounts();
      this._renderPoolCount();
    });

    this.onMessage('stalemateWarning', ({ passStreak, needed }) => {
      this._showToast(`⚠️ 무변경 ${passStreak}/${needed}턴 — 교착 임박`);
    });

    this.onMessage('stateSync', (data) => {
      // _showResult()가 닉네임/색상을 _playersList에서 찾으므로(§11.1과
      // 동일 패턴), 재접속 시 이 목록이 비어 있으면 결과 화면이 전부
      // "???"·회색 점으로만 뜨는 반쪽짜리 재구성이 된다(pre-commit 리뷰로
      // 발견, 2026-08-24) — stateSync에 항상 실려오는 players로 갱신.
      if (data.players) this._playersList = data.players;
      this._board = data.board || [];
      this._workBoard = this._board;
      this._hand = this._reconcileHandOrder(data.hand || []);
      this._poolCount = data.poolCount || 0;
      this._handCounts = data.handCounts || {};
      this._initialMeldDone = !!(data.initialMeldFlags && data.initialMeldFlags[this.playerId]);
      this._initialMeldThreshold = data.turnInfo?.initialMeldThreshold || 30;
      this._turnDeadlineTs = data.turnInfo?.deadlineTs || null;
      this._myTurn = data.turnInfo?.playerId === this.playerId;
      if (data.phase === 'playing') {
        this.showScreen('game');
        this._renderHand();
        this._renderBoard();
        this._renderMeldBadge();
        this._renderActionButtons();
        this._renderOpponentCounts();
        this._renderPoolCount();
        this._startTimerTick();
      } else if (data.phase === 'result') {
        // 결과 화면 도중 재접속하면 예전엔 그냥 "waiting"에 멈춰 있었다 —
        // 호스트가 _lastResult를 캐싱해 stateSync에 실어 보내므로, 있으면
        // 곧바로 결과 화면을 재구성한다(codex 헤드리스 리뷰로 발견,
        // 2026-08-24).
        if (this._resultTimer) { clearTimeout(this._resultTimer); this._resultTimer = null; }
        if (data.result) {
          this._showResult(data.result.endType, data.result.winnerIds, data.result.scores, data.result.revealedHands);
        } else {
          this.showScreen('waiting');
        }
      }
    });

    this.onMessage('gameFinished', ({ endType, winnerIds, scores, revealedHands }) => {
      this._stopTimerTick();
      this._showToast(endType === 'rummikub' ? '🏆 경기 종료!' : '🤝 교착 종료!');
      this._resultTimer = setTimeout(() => {
        this._resultTimer = null;
        this._showResult(endType, winnerIds, scores, revealedHands);
      }, 2000);
    });
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

    document.getElementById('btn-room-start')?.addEventListener('click', () => {
      this.sendToHost('requestStart', {});
    });

    document.getElementById('btn-rematch')?.addEventListener('click', () => {
      this.sendToHost('requestRematch', {});
    });

    document.getElementById('rk-m-sort-color')?.addEventListener('click', () => this._sortHand('color'));
    document.getElementById('rk-m-sort-num')?.addEventListener('click', () => this._sortHand('num'));

    document.getElementById('rk-m-btn-reset-turn')?.addEventListener('click', () => {
      if (!this._myTurn) return;
      this.sendToHost('resetTurn', {});
      this._workBoard = this._board.map(m => ({ meldId: m.meldId, tiles: [...m.tiles] }));
      this._hand = [...(this._handSnapshotAtTurnStart || this._hand)];
      this._newMeldIdsThisTurn = new Set();
      this._placedFromHandThisTurn = new Set();
      this._jokerRetrievalTarget = null;
      this._selection = null;
      this._pendingOps.clear();
      this._renderBoard();
      this._renderHand();
      this._renderMeldBadge();
      this._updateEndTurnButtonState();
      this._showToast('↺ 이번 턴을 처음부터 다시 시작해요');
    });

    document.getElementById('rk-m-btn-draw')?.addEventListener('click', () => {
      if (!this._myTurn) return;
      this.sendToHost('drawAndPass', {});
    });

    document.getElementById('rk-m-btn-end-turn')?.addEventListener('click', () => {
      if (!this._myTurn || !this._canEndTurn()) return;
      if (!confirm('이대로 제출할까요?')) return;
      this.sendToHost('endTurn', {});
    });

    document.getElementById('rk-m-new-meld-zone')?.addEventListener('click', () => this._onZoneTap({ zone: 'newMeld' }));
    document.getElementById('rk-m-hand')?.addEventListener('click', (e) => {
      if (e.target.closest('.rk-tile')) return; // 타일 자체 클릭은 개별 핸들러가 처리
      this._onZoneTap({ zone: 'hand' });
    });
  }

  // ─── 닉네임/로비 ─────────────────────────────────────────────────────────

  _prefillNickname() {
    const saved = localStorage.getItem('rk_nickname');
    if (saved) { this._nickname = saved; const el = document.getElementById('nickname-input'); if (el) el.value = saved; return; }
    const adjs = ['빠른', '느린', '용감한', '조용한', '귀여운', '뜨거운', '차가운', '엉뚱한'];
    const nouns = ['판다', '여우', '펭귄', '용', '고블린', '기사', '로봇', '타일러'];
    const el = document.getElementById('nickname-input');
    if (el) el.value = `${adjs[Math.floor(Math.random() * adjs.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}`;
  }

  _sendProfile() {
    this.sendToHost('setProfile', { nickname: this._nickname });
    localStorage.setItem('rk_nickname', this._nickname);
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
      <div class="rk-wait-player"><span class="rk-wait-dot" style="background:${p.color}"></span><span>${p.nickname}</span></div>
    `).join('');
  }

  // ─── 손패 ────────────────────────────────────────────────────────────────

  _reconcileHandOrder(serverTiles) {
    const set = new Set(serverTiles);
    const kept = this._hand.filter(id => set.has(id));
    const known = new Set(kept);
    const added = serverTiles.filter(id => !known.has(id));
    return [...kept, ...added];
  }

  _sortHand(mode) {
    const parse = (id) => id[0] === 'j' ? { isJoker: true, color: 'zz', num: 99 } : { isJoker: false, color: id[0], num: parseInt(id.slice(1, 3), 10) };
    this._hand.sort((a, b) => {
      const pa = parse(a), pb = parse(b);
      if (mode === 'color') return (pa.color + String(pa.num).padStart(2, '0')).localeCompare(pb.color + String(pb.num).padStart(2, '0'));
      return (pa.num - pb.num) || pa.color.localeCompare(pb.color);
    });
    localStorage.setItem('rk_hand_sort', mode);
    this._renderHand({ animate: true });
  }

  _renderHand(opts = {}) {
    const tray = document.getElementById('rk-m-hand');
    if (!tray) return;
    const prevRects = new Map();
    if (opts.animate) tray.querySelectorAll('.rk-tile').forEach(el => prevRects.set(el.dataset.tileId, el.getBoundingClientRect()));

    tray.innerHTML = '';
    for (const tileId of this._hand) {
      const el = renderTile(tileId, { size: 'lg' });
      el.classList.add('rk-hand-tile');
      if (this._selection?.tileId === tileId && this._selection?.zone === 'hand') el.classList.add('rk-tile-selected');
      this._bindTilePointer(el, { zone: 'hand' });
      tray.appendChild(el);
      if (opts.animate) { const first = prevRects.get(tileId); if (first) flipTween(el, first); }
    }
  }

  // ─── 보드 ────────────────────────────────────────────────────────────────

  _renderBoard(opts = {}) {
    // 보드는 "내 차례"일 때만 폰 화면에 노출 — 그 외(남의 차례/제출 직후)엔
    // TV 화면에서만 확인 가능하게 숨긴다(사용자 요청).
    document.getElementById('rk-m-board-wrap')?.classList.toggle('hidden', !this._myTurn);
    document.getElementById('rk-m-board-hidden-hint')?.classList.toggle('hidden', this._myTurn);
    if (!this._myTurn) return;

    const container = document.getElementById('rk-m-board');
    if (!container) return;
    container.innerHTML = '';
    const board = this._workBoard;
    for (const meld of board) {
      const meldEl = document.createElement('div');
      meldEl.className = 'rk-m-meld';
      meldEl.dataset.meldId = meld.meldId;
      if (!this._initialMeldDone && !this._newMeldIdsThisTurn.has(meld.meldId)) meldEl.classList.add('rk-m-meld-locked');
      meld.tiles.forEach((tileId, idx) => {
        const el = renderTile(tileId, { size: 'sm' });
        if (this._selection?.tileId === tileId && this._selection?.zone === 'meld') el.classList.add('rk-tile-selected');
        // 이번 턴에 내 손패에서 새로 놓은 타일 강조 표시(사용자 요청)
        if (this._placedFromHandThisTurn.has(tileId)) el.classList.add('rk-tile-mine-new');
        this._bindTilePointer(el, { zone: 'meld', meldId: meld.meldId });
        el.addEventListener('contextmenu', (e) => e.preventDefault());
        this._bindLongPress(el, () => this._onTileLongPress(tileId, meld, idx));
        meldEl.appendChild(el);
      });
      meldEl.addEventListener('click', (e) => {
        if (e.target.closest('.rk-tile')) return;
        this._onZoneTap({ zone: 'meld', meldId: meld.meldId });
      });
      container.appendChild(meldEl);
      if (opts.flash) { meldEl.classList.add('rk-meld-flash'); setTimeout(() => meldEl.classList.remove('rk-meld-flash'), 500); }
    }
  }

  _renderMeldBadge() {
    const badge = document.getElementById('rk-m-meld-badge');
    if (!badge) return;
    if (this._initialMeldDone || !this._myTurn) { badge.classList.add('hidden'); return; }
    badge.classList.remove('hidden');
    const sum = this._computeNewMeldSum();
    badge.textContent = `이번 착수 합계 ${sum}/${this._initialMeldThreshold}점`;
    badge.classList.toggle('rk-badge-ready', sum >= this._initialMeldThreshold);
  }

  _computeNewMeldSum() {
    // 다른 플레이어가 이미 착수를 마쳤다면 내 턴이 와도 workBoard는 기존
    // 보드 전체를 복제해 시작한다(_workBoard = this._board.map(...)) — 즉
    // "초기 착수 미완료 = workBoard 전체가 새 세트"라는 이전 가정은
    // 틀렸었다. 호스트 _commitTurn()과 동일하게 이번 턴에 실제로 새로
    // 만든 세트(_newMeldIdsThisTurn)만 sumOfMelds()로 계산해야 배지 합계와
    // 서버 판정이 항상 일치한다(codex 헤드리스 리뷰로 발견, 2026-08-24).
    return sumOfMelds(this._workBoard, [...this._newMeldIdsThisTurn]);
  }

  _renderPoolCount() {
    const el = document.getElementById('rk-m-pool');
    if (el) el.textContent = `🂠 × ${this._poolCount}`;
  }

  _renderOpponentCounts() {
    const el = document.getElementById('rk-m-opponents');
    if (!el) return;
    const others = this._playersList.filter(p => p.id !== this.playerId);
    el.innerHTML = others.map(p => `
      <span class="rk-m-opp-chip"><span class="rk-m-opp-dot" style="background:${p.color}"></span>${p.nickname} ${this._handCounts[p.id] ?? '-'}장</span>
    `).join('');
  }

  _renderTurnBanner(playerId) {
    const banner = document.getElementById('rk-m-turn-banner');
    if (!banner) return;
    if (this._myTurn) {
      banner.textContent = '🎯 내 차례예요!';
      banner.classList.add('rk-m-turn-banner-mine');
    } else {
      const p = this._playersList.find(pl => pl.id === playerId);
      banner.textContent = `${p?.nickname || '상대'}님 차례`;
      banner.classList.remove('rk-m-turn-banner-mine');
    }
  }

  _renderActionButtons() {
    const bar = document.getElementById('rk-m-action-bar');
    if (!bar) return;
    bar.classList.toggle('hidden', !this._myTurn);
    this._updateEndTurnButtonState();
  }

  /**
   * "제출(턴 종료)" 가능 조건 — 사용자 요청 2가지를 모두 만족해야 함:
   *  1. 현재 작업 중인 보드(workBoard)의 모든 세트가 유효(그룹/런)해야 함.
   *  2. 이번 턴에 내 손패에서 보드로 최소 1장 이상 놓아야 함(보드만 재배치
   *     하고 아무것도 안 낸 채로는 제출 불가).
   * 호스트의 §10 커밋 검증과 반드시 같은 판정을 내려야(그래야 "제출
   * 가능"으로 보이는데 서버가 거부하는 혼란이 없음) shared/RummikubEngine.js
   * 의 동일한 validateBoard()를 그대로 재사용한다.
   */
  _canEndTurn() {
    if (!this._myTurn) return false;
    if (this._placedFromHandThisTurn.size === 0) return false;
    if (!validateBoard(this._workBoard).valid) return false;
    // 호스트 _commitTurn()의 "4. 초기 착수 검사"와 동일 기준(§5) — 이게
    // 없으면 임계값 미달 상태에서도 버튼이 활성화됐다가 제출 즉시
    // 서버에 거부당하는 혼란이 있었다(codex 헤드리스 리뷰로 발견,
    // 2026-08-24).
    if (!this._initialMeldDone && this._computeNewMeldSum() < this._initialMeldThreshold) return false;
    return true;
  }

  _updateEndTurnButtonState() {
    const btn = document.getElementById('rk-m-btn-end-turn');
    if (!btn) return;
    const can = this._canEndTurn();
    btn.disabled = !can;
  }

  _startTimerTick() {
    this._stopTimerTick();
    const label = document.getElementById('rk-m-timer-label');
    if (!label) return;
    if (!this._turnDeadlineTs) { label.textContent = '∞'; return; }
    const update = () => {
      const remain = Math.max(0, this._turnDeadlineTs - Date.now());
      label.textContent = String(Math.ceil(remain / 1000));
      const danger = remain <= 10000;
      label.classList.toggle('rk-m-timer-danger', danger);
      if (danger && this._myTurn && !this._vibratedLow) { this._vibratedLow = true; this.vibrate('light'); }
      if (remain <= 0) this._stopTimerTick();
    };
    this._vibratedLow = false;
    update();
    this._timerInterval = setInterval(update, 250);
  }
  _stopTimerTick() { if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; } }

  // ─── 입력 파이프라인 (탭-탭 + 드래그 통합) ───────────────────────────────

  _bindTilePointer(el, source) {
    const tileId = el.dataset.tileId;
    let startX = 0, startY = 0, dragging = false, ghost = null;

    const onDown = (e) => {
      if (!this._myTurn) return;
      const pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX; startY = pt.clientY; dragging = false;
      const move = (ev) => {
        const p2 = ev.touches ? ev.touches[0] : ev;
        const dx = p2.clientX - startX, dy = p2.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
          dragging = true;
          ghost = this._createGhost(el, p2.clientX, p2.clientY);
        }
        if (dragging && ghost) this._moveGhost(ghost, p2.clientX, p2.clientY);
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', up);
        if (dragging) {
          const p2 = ev.changedTouches ? ev.changedTouches[0] : ev;
          this._clearGhost();
          const dest = this._resolveDropTarget(p2.clientX, p2.clientY, tileId);
          if (dest) this._sendMoveTile(tileId, source, dest);
        } else {
          this._onTileTap(tileId, source);
        }
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('touchmove', move, { passive: true });
      document.addEventListener('touchend', up);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('touchstart', onDown, { passive: true });
  }

  _createGhost(el, x, y) {
    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add('rk-tile-ghost');
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);
    this._offsetX = x - rect.left; this._offsetY = y - rect.top;
    return ghost;
  }
  _moveGhost(ghost, x, y) {
    ghost.style.left = `${x - this._offsetX}px`;
    ghost.style.top = `${y - this._offsetY}px`;
  }
  _clearGhost() { document.querySelectorAll('.rk-tile-ghost').forEach(g => g.remove()); }

  /**
   * @param {number} x @param {number} y
   * @param {string} [tileId] 드롭 중인 타일 — 있으면 숫자 순서에 맞는 자리를
   *   자동 계산해서 넣는다(사용자 요청: 정확한 위치를 겨냥할 필요 없이
   *   세트 아무 데나 놓아도 알아서 정렬됨). §9.2 computeAutoSortIndex 참고.
   */
  _resolveDropTarget(x, y, tileId) {
    this._clearGhost();
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const meldEl = el.closest('.rk-m-meld');
    if (meldEl) {
      const meldId = parseInt(meldEl.dataset.meldId, 10);
      const meld = this._workBoard.find(m => m.meldId === meldId);
      const idx = tileId && meld ? computeAutoSortIndex(meld.tiles, tileId) : (meld?.tiles.length ?? 0);
      return { zone: 'meld', meldId, index: idx };
    }
    if (el.closest('#rk-m-new-meld-zone')) return { zone: 'newMeld' };
    if (el.closest('#rk-m-hand')) return { zone: 'hand' };
    return null;
  }

  _onZoneTap(dest) {
    if (!this._selection || !this._myTurn) return;
    if (dest.zone === 'meld' && dest.index === undefined) {
      // 탭-탭 모드로 세트를 목적지로 골랐을 때도 드래그와 동일하게 숫자
      // 순서 자동 정렬을 적용(사용자 요청) — 세트 아무 데나 탭해도 됨.
      const meld = this._workBoard.find(m => m.meldId === dest.meldId);
      if (meld) dest = { ...dest, index: computeAutoSortIndex(meld.tiles, this._selection.tileId) };
    }
    this._sendMoveTile(this._selection.tileId, this._selection, dest);
    this._selection = null;
    this._renderBoard(); this._renderHand();
  }

  _onTileTap(tileId, source) {
    if (!this._myTurn) return;
    if (this._jokerRetrievalTarget) {
      if (source.zone === 'hand') {
        this._completeJokerRetrieval(tileId);
        return;
      }
      // 회수 모드가 켜진 채로 손패가 아닌 보드 타일을 탭하면(예: 다른
      // 세트를 만지려는 것) 대기 중이던 회수 요청을 취소한다. 그냥
      // 무시하고 넘어가면 회수 모드가 계속 살아있는 채로 이 탭이 일반
      // 보드 조작으로 처리되고, 한참 뒤에 무관한 손패 탭이 뜬금없이
      // 조커 교체로 잘못 처리될 수 있었다(claude 헤드리스 리뷰로 발견,
      // 2026-08-24).
      this._jokerRetrievalTarget = null;
      this._showToast('조커 회수를 취소했어요');
    }
    if (this._selection?.tileId === tileId) { this._selection = null; this._renderBoard(); this._renderHand(); return; }
    if (this._selection) {
      // 이미 선택된 타일이 있으면 이번 탭한 자리를 목적지로 이동 시도.
      // 세트 안의 "타일 하나"를 직접 탭한 경우(빈 배경이 아니라)에도
      // _onZoneTap과 동일하게 숫자 순서 자동 정렬을 적용한다(사용자 요청)
      // — 이게 빠져 있으면 세트를 꽉 채운 타일 위를 탭했을 때만 정렬이
      // 안 먹는 사각지대가 생긴다(실측으로 발견, 2026-08-24).
      let dest = { zone: 'hand' };
      if (source.zone === 'meld') {
        const meld = this._workBoard.find(m => m.meldId === source.meldId);
        const idx = meld ? computeAutoSortIndex(meld.tiles, this._selection.tileId) : meld?.tiles.length ?? 0;
        dest = { zone: 'meld', meldId: source.meldId, index: idx };
      }
      this._sendMoveTile(this._selection.tileId, this._selection, dest);
      this._selection = null;
    } else {
      this._selection = { tileId, ...source };
    }
    this._renderBoard(); this._renderHand();
  }

  _onTileLongPress(tileId, meld, idx) {
    const t = tileId[0] === 'j';
    if (t) { this._startJokerRetrieval(tileId, meld); return; }
    if (idx > 0 && idx < meld.tiles.length - 1) this._splitMeldAt(meld, idx);
  }

  _bindLongPress(el, fn) {
    let timer = null;
    const start = () => { timer = setTimeout(fn, 550); };
    const cancel = () => { if (timer) clearTimeout(timer); };
    el.addEventListener('pointerdown', start);
    el.addEventListener('touchstart', start, { passive: true });
    ['pointerup', 'pointerleave', 'touchend', 'touchmove'].forEach(ev => el.addEventListener(ev, cancel));
  }

  _splitMeldAt(meld, idx) {
    if (!this._myTurn) return;
    const tail = meld.tiles.slice(idx);
    this._sendSplitStep(meld.meldId, tail, 0, null);
  }

  /**
   * 세트 분할은 op 여러 건을 순차 전송해야 한다(§9.2 "moveTile 다건").
   * 원래는 for 루프로 전부 한 번에 보내면서 새로 만들 세트의 meldId를
   * 첫 op의 opAck(비동기, 네트워크 왕복 후 도착)이 채워주길 기대했는데,
   * 루프 자체는 동기적으로 전부 즉시 실행되므로 2번째 타일부터는 아직
   * null인 meldId로 전송돼 호스트가 매번 MELD_NOT_FOUND로 거부했다 —
   * 3장 이상인 세트를 분할하면(가운데 롱프레스는 항상 꼬리가 2장 이상)
   * 100% 재현되는 버그였음(claude 헤드리스 리뷰로 발견, 2026-08-24).
   * onAck 콜백 안에서 다음 타일을 보내는 재귀 체인으로 바꿔 각 op가
   * 이전 op의 opAck을 받은 뒤에만 전송되도록 수정. 거부된 op가 있으면
   * 그 자리에서 체인이 멈춘다(부분 분할 상태로 남되, "처음부터" 버튼으로
   * 복구 가능 — 상태를 더 망가뜨리지 않는 안전한 실패).
   */
  _sendSplitStep(sourceMeldId, tail, i, newMeldId) {
    if (i >= tail.length) return;
    const tileId = tail[i];
    const dest = i === 0 ? { zone: 'newMeld' } : { zone: 'meld', meldId: newMeldId, index: 9999 };
    this._sendMoveTile(tileId, { zone: 'meld', meldId: sourceMeldId }, dest, (ackNewMeldId) => {
      const resolvedMeldId = i === 0 ? ackNewMeldId : newMeldId;
      this._sendSplitStep(sourceMeldId, tail, i + 1, resolvedMeldId);
    });
  }

  _startJokerRetrieval(jokerId, meld) {
    this._showToast('🃏 대체할 손패 타일을 탭하세요');
    this._jokerRetrievalTarget = { jokerId, meldId: meld.meldId };
    // 손패 타일 각각에 매번 새 리스너를 붙였다 지우는 대신(리스너 참조가
    // 타일마다 달라서 removeEventListener가 실제로는 하나도 안 지워지던
    // 버그가 있었음 — claude 헤드리스 리뷰로 발견, 2026-08-24), 이미
    // 모든 손패 탭을 받는 _onTileTap()에서 _jokerRetrievalTarget 존재
    // 여부만 확인하는 방식으로 통합. 별도 리스너 등록/해제가 필요 없어짐.
  }

  _completeJokerRetrieval(replacementTileId) {
    const target = this._jokerRetrievalTarget;
    this._jokerRetrievalTarget = null;
    if (!target) return;
    // 대체 타일은 반드시 조커가 있던 그 자리에 끼워 넣어야 한다 — 세트 끝
    // (index:9999)에 넣고 조커만 빼면, 런(run) 세트에서 순서가
    // [5,7,6]처럼 뒤섞여 커밋이 영구히 실패하는 버그가 있었음(실측 확인,
    // 2026-08-24). 완료 시점 기준으로 조커의 현재 위치를 다시 조회해
    // (탭 사이 다른 조작으로 밀렸을 가능성 대비) 그 인덱스에 삽입한다.
    const meld = this._workBoard.find(m => m.meldId === target.meldId);
    const jokerIdx = meld ? meld.tiles.indexOf(target.jokerId) : -1;
    const insertIndex = jokerIdx >= 0 ? jokerIdx : (meld?.tiles.length ?? 0);
    // 고정 60ms setTimeout으로 두 번째 op(조커 빼내기)를 쏘던 방식은
    // _splitMeldAt과 동일한 계열의 비동기 경합 버그였다 — 첫 op의 opAck가
    // 네트워크 지연 등으로 60ms보다 늦게 오면 workBoard에 대체 타일이 아직
    // 반영되지 않은 상태로 두 번째 op가 나가 순서가 꼬일 수 있었다.
    // 여기서도 같은 해법(onAck 콜백 체이닝)을 적용한다(codex 헤드리스
    // 리뷰로 발견, 2026-08-24).
    this._sendMoveTile(replacementTileId, { zone: 'hand' }, { zone: 'meld', meldId: target.meldId, index: insertIndex }, () => {
      this._sendMoveTile(target.jokerId, { zone: 'meld', meldId: target.meldId }, { zone: 'hand' });
    });
  }

  // ─── op 전송/적용 (비관적: opAck 성공 후에만 반영) ──────────────────────

  _sendMoveTile(tileId, from, to, onAck) {
    const seq = ++this._seq;
    const op = { tileId, from: this._normalizeZone(from), to: this._normalizeZone(to) };
    this._pendingOps.set(seq, { seq, op, onAck });
    this.sendToHost('boardOp', { seq, op });
  }

  _normalizeZone(z) {
    if (z.zone === 'meld') return { zone: 'meld', meldId: z.meldId, index: z.index };
    if (z.zone === 'newMeld') return { zone: 'newMeld' };
    return { zone: 'hand' };
  }

  _applyOpLocally(op, newMeldId, onAck) {
    const { tileId, from, to } = op;
    if (from.zone === 'hand') {
      const i = this._hand.indexOf(tileId);
      if (i >= 0) this._hand.splice(i, 1);
    } else {
      const meld = this._workBoard.find(m => m.meldId === from.meldId);
      if (meld) {
        meld.tiles.splice(meld.tiles.indexOf(tileId), 1);
        if (meld.tiles.length === 0) this._workBoard = this._workBoard.filter(m => m.meldId !== meld.meldId);
      }
    }
    if (to.zone === 'hand') {
      this._hand.push(tileId);
      this._placedFromHandThisTurn.delete(tileId);
    } else if (to.zone === 'newMeld') {
      this._workBoard.push({ meldId: newMeldId, tiles: [tileId] });
      this._newMeldIdsThisTurn.add(newMeldId);
      if (from.zone === 'hand') this._placedFromHandThisTurn.add(tileId);
    } else {
      const meld = this._workBoard.find(m => m.meldId === to.meldId);
      if (meld) {
        const idx = Math.max(0, Math.min(to.index ?? meld.tiles.length, meld.tiles.length));
        meld.tiles.splice(idx, 0, tileId);
        if (from.zone === 'hand') this._placedFromHandThisTurn.add(tileId);
      }
    }
    if (onAck) onAck(newMeldId);
    this._renderHand();
    this._updateEndTurnButtonState();
  }

  _flashReject(tileId) {
    const el = document.querySelector(`.rk-tile[data-tile-id="${tileId}"]`);
    if (el) { el.classList.add('rk-tile-reject'); setTimeout(() => el.classList.remove('rk-tile-reject'), 500); }
  }

  _reasonText(reason) {
    const map = {
      NOT_IN_HAND: '손패에 없는 타일이에요', TILE_NOT_FOUND: '타일을 찾을 수 없어요',
      BOARD_LOCKED: '아직 초기 착수 전이라 보드를 만질 수 없어요',
      BOARD_TO_HAND_FORBIDDEN: '보드에서 손패로 가져올 수 없어요', NOT_YOUR_TURN: '내 차례가 아니에요',
      MELD_NOT_FOUND: '세트를 찾을 수 없어요',
      JOKER_REPLACEMENT_INVALID: '조커가 대신하던 값과 같은 타일로 먼저 채워야 해요',
    };
    return map[reason] || reason;
  }

  _shakeScreen() {
    const scr = document.querySelector('.rk-screen[data-screen="game"]');
    if (!scr) return;
    scr.classList.add('rk-shake');
    setTimeout(() => scr.classList.remove('rk-shake'), 420);
  }

  _showToast(msg) {
    let c = document.getElementById('rk-toast-container');
    if (!c) { c = document.createElement('div'); c.id = 'rk-toast-container'; c.className = 'rk-toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div');
    t.className = 'rk-toast';
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('rk-toast-fadeout'); setTimeout(() => t.remove(), 400); }, 2200);
  }

  // ─── 결과 화면 ───────────────────────────────────────────────────────────

  _showResult(endType, winnerIds, scores, revealedHands) {
    const titleEl = document.getElementById('result-title');
    if (titleEl) titleEl.textContent = endType === 'rummikub' ? '🏆 결과' : '🤝 교착 결과';
    const myScore = scores[this.playerId] ?? 0;
    const rankEl = document.getElementById('result-my-score');
    if (rankEl) rankEl.textContent = `${myScore >= 0 ? '+' : ''}${myScore}점`;

    const rows = Object.entries(scores).map(([pid, score]) => {
      const p = this._playersList.find(pl => pl.id === pid);
      return { pid, nickname: p?.nickname || '???', color: p?.color || '#888', score, hand: (revealedHands[pid] || []).length };
    }).sort((a, b) => b.score - a.score);

    const listEl = document.getElementById('result-ranking-list');
    if (listEl) {
      listEl.innerHTML = rows.map(r => `
        <div class="rk-result-row ${r.pid === this.playerId ? 'rk-result-me' : ''}">
          <span class="rk-result-dot" style="background:${r.color}"></span>
          <span>${r.nickname}</span>
          <span class="rk-result-score">${r.score >= 0 ? '+' : ''}${r.score}</span>
          <span class="rk-result-tiles">${r.hand}장</span>
        </div>
      `).join('');
    }
    this.showScreen('result');
  }
}
