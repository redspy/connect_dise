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
  onRejoin() { if (this._nickname) this._sendProfile(); this.sendToHost('requestState', {}); }
  onAllReady() {}

  onReset() {
    this._myTurn = false;
    this._hand = [];
    this._board = [];
    this._workBoard = [];
    this._selection = null;
    this._stopTimerTick();
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
        this.showScreen('waiting');
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
      this._selection = null;
      this._pendingOps.clear();
      this._renderBoard();
      this._renderHand();
      this._renderMeldBadge();
      this._showToast('↺ 이번 턴을 처음부터 다시 시작해요');
    });

    document.getElementById('rk-m-btn-draw')?.addEventListener('click', () => {
      if (!this._myTurn) return;
      this.sendToHost('drawAndPass', {});
    });

    document.getElementById('rk-m-btn-end-turn')?.addEventListener('click', () => {
      if (!this._myTurn) return;
      if (!confirm('이대로 턴을 종료할까요?')) return;
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
    const container = document.getElementById('rk-m-board');
    if (!container) return;
    container.innerHTML = '';
    const board = this._myTurn ? this._workBoard : this._board;
    for (const meld of board) {
      const meldEl = document.createElement('div');
      meldEl.className = 'rk-m-meld';
      meldEl.dataset.meldId = meld.meldId;
      if (!this._initialMeldDone && !this._newMeldIdsThisTurn.has(meld.meldId)) meldEl.classList.add('rk-m-meld-locked');
      meld.tiles.forEach((tileId, idx) => {
        const el = renderTile(tileId, { size: 'sm' });
        if (this._selection?.tileId === tileId && this._selection?.zone === 'meld') el.classList.add('rk-tile-selected');
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
    // 초기 착수 미완료 상태에서는 workBoard 전체가 이번 턴 새 세트뿐(보드가 잠겨있으므로)
    const parse = (id) => id[0] === 'j' ? { isJoker: true, num: null } : { isJoker: false, num: parseInt(id.slice(1, 3), 10) };
    let sum = 0;
    for (const meld of this._workBoard) {
      const reals = meld.tiles.map(parse).filter(t => !t.isJoker);
      if (reals.length === 0) continue;
      const jokerCount = meld.tiles.length - reals.length;
      // 그룹 추정(같은 숫자) 우선, 아니면 런으로 간주해 실물 합 + 조커는 실물 평균값으로 근사
      const sameNum = reals.every(t => t.num === reals[0].num);
      if (sameNum && meld.tiles.length <= 4) {
        sum += reals[0].num * meld.tiles.length;
      } else {
        sum += reals.reduce((s, t) => s + t.num, 0) + jokerCount * (reals.length ? Math.round(reals.reduce((s, t) => s + t.num, 0) / reals.length) : 0);
      }
    }
    return sum;
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
          const dest = this._resolveDropTarget(p2.clientX, p2.clientY);
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

  _resolveDropTarget(x, y) {
    this._clearGhost();
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const meldEl = el.closest('.rk-m-meld');
    if (meldEl) {
      const rect = meldEl.getBoundingClientRect();
      const meldId = parseInt(meldEl.dataset.meldId, 10);
      const meld = this._workBoard.find(m => m.meldId === meldId);
      const idx = (x - rect.left) < rect.width / 2 ? 0 : (meld?.tiles.length ?? 0);
      return { zone: 'meld', meldId, index: idx };
    }
    if (el.closest('#rk-m-new-meld-zone')) return { zone: 'newMeld' };
    if (el.closest('#rk-m-hand')) return { zone: 'hand' };
    return null;
  }

  _onZoneTap(dest) {
    if (!this._selection || !this._myTurn) return;
    this._sendMoveTile(this._selection.tileId, this._selection, dest);
    this._selection = null;
    this._renderBoard(); this._renderHand();
  }

  _onTileTap(tileId, source) {
    if (!this._myTurn) return;
    if (this._selection?.tileId === tileId) { this._selection = null; this._renderBoard(); this._renderHand(); return; }
    if (this._selection) {
      // 이미 선택된 타일이 있으면 이번 탭한 자리를 목적지로 이동 시도
      const dest = source.zone === 'meld'
        ? { zone: 'meld', meldId: source.meldId, index: 9999 }
        : { zone: 'hand' };
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
    let firstOfTail = true;
    let newMeldId = null;
    for (const tileId of tail) {
      const dest = firstOfTail ? { zone: 'newMeld' } : { zone: 'meld', meldId: newMeldId, index: 9999 };
      firstOfTail = false;
      this._sendMoveTile(tileId, { zone: 'meld', meldId: meld.meldId }, dest, (ackNewMeldId) => {
        if (ackNewMeldId !== undefined) newMeldId = ackNewMeldId;
      });
    }
  }

  _startJokerRetrieval(jokerId, meld) {
    this._showToast('🃏 대체할 손패 타일을 탭하세요');
    this._jokerRetrievalTarget = { jokerId, meldId: meld.meldId };
    document.querySelectorAll('#rk-m-hand .rk-tile').forEach(el => {
      const once = () => {
        this._completeJokerRetrieval(el.dataset.tileId);
        document.querySelectorAll('#rk-m-hand .rk-tile').forEach(t => t.removeEventListener('click', once));
      };
      el.addEventListener('click', once, { once: true });
    });
  }

  _completeJokerRetrieval(replacementTileId) {
    const target = this._jokerRetrievalTarget;
    this._jokerRetrievalTarget = null;
    if (!target) return;
    this._sendMoveTile(replacementTileId, { zone: 'hand' }, { zone: 'meld', meldId: target.meldId, index: 9999 });
    setTimeout(() => {
      this._sendMoveTile(target.jokerId, { zone: 'meld', meldId: target.meldId }, { zone: 'hand' });
    }, 60);
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
    } else if (to.zone === 'newMeld') {
      this._workBoard.push({ meldId: newMeldId, tiles: [tileId] });
      this._newMeldIdsThisTurn.add(newMeldId);
    } else {
      const meld = this._workBoard.find(m => m.meldId === to.meldId);
      if (meld) {
        const idx = Math.max(0, Math.min(to.index ?? meld.tiles.length, meld.tiles.length));
        meld.tiles.splice(idx, 0, tileId);
      }
    }
    if (onAck) onAck(newMeldId);
    this._renderHand();
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
