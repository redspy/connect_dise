/**
 * TetrisMobile.js — Give You Fire 모바일 게임 클래스
 *
 * 조작 방식: 스와이프 풀 제스처 (버튼 없음)
 *  - 탭 (15px 이내)           → 블록 회전
 *  - 좌/우 드래그             → 블록 이동 (셀 단위 실시간 추적)
 *  - 아래 드래그 유지         → 소프트 드롭
 *  - 빠른 아래 스와이프       → 하드 드롭 (즉시 착지)
 *
 * 제스처 잠금(gestureMode):
 *  첫 번째로 GESTURE_LOCK_PX 이상 움직인 방향으로 모드가 결정되어,
 *  한 제스처 안에서 이동과 소프트드롭이 동시에 발생하지 않습니다.
 */

import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';
import { TetrisEngine, dropInterval, BOARD_COLS } from '../shared/TetrisEngine.js';
import { renderBoard, renderNextPiece } from '../shared/BoardRenderer.js';

// ─── 제스처 감도 상수 ─────────────────────────────────────────────────────
const TAP_THRESHOLD      = 15;   // px: 이 이내 움직임은 탭으로 판정
const GESTURE_LOCK_PX    = 12;   // px: 이 이상 움직이면 제스처 방향 결정
const HARD_DROP_MIN_Y    = 60;   // px: 하드 드롭으로 판정할 최소 하향 거리
const HARD_DROP_VEL      = 0.55; // px/ms: 하드 드롭 최소 속도
const SOFT_DROP_THRESH_Y = 25;   // px: 소프트 드롭 활성화 하향 거리

// ─── 게임 타이밍 상수 ────────────────────────────────────────────────────
const SOFT_DROP_MS  = 50;   // ms: 소프트 드롭 낙하 간격
const BOARD_SEND_MS = 100;  // ms: boardUpdate 전송 스로틀
const LEVEL_TICK_MS = 5000; // ms: 자동 레벨 상승 간격

export class TetrisMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'gyf-screen' });

    this._engine        = null;
    this._level         = 1;
    this._totalLines    = 0;
    this._alive         = true;
    this._gameActive    = false;
    this._showNextPiece = false;

    // 타이머 핸들
    this._dropTimer  = null;
    this._levelTimer = null;
    this._softTimer  = null;

    // 제스처 상태
    this._gestStartX    = 0;
    this._gestStartY    = 0;
    this._gestStartTime = 0;
    this._gestMode      = null;   // null | 'horizontal' | 'vertical'
    this._gestCellsDone = 0;      // 현재 제스처에서 이미 이동한 셀 수
    this._gestCellPx    = 30;     // 1셀당 픽셀 (제스처 시작 시 계산)
    this._isSoftDropping = false;

    // boardUpdate 스로틀
    this._lastBoardSend = 0;

    this._nickname = '';

    this._wireUI();
    this._wireMessages();
    this._prefillNickname();
  }

  // ─── MobileBaseGame 훅 ────────────────────────────────────────────────────

  onJoin()    { this.showScreen('setup'); }
  onRejoin()  { if (this._nickname) this._sendProfile(); }
  onAllReady() { /* 게임 시작은 호스트가 제어 */ }

  onReset() {
    this._stopAllTimers();
    this._engine     = null;
    this._level      = 1;
    this._totalLines = 0;
    this._alive      = true;
    this._gameActive = false;
    if (this._nickname) this._sendProfile();
    else this.showScreen('setup');
  }

  // ─── 메시지 핸들러 ────────────────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('playerListUpdated', ({ players }) => {
      this._renderWaitingPlayers(players);
    });

    this.onMessage('gameStarted', ({ showNextPiece }) => {
      this._showNextPiece = showNextPiece;
      this._startGame();
    });

    this.onMessage('levelUp', ({ newLevel }) => {
      if (!this._gameActive || !this._alive) return;
      const prev  = this._level;
      this._level = Math.min(100, Math.max(this._level, newLevel));
      if (this._level > prev) {
        this._updateLevelUI();
        this._restartDropTimer();
        this._flashLevelUp();
      }
    });

    this.onMessage('gameFinished', ({ rankings }) => {
      this._stopAllTimers();
      this._gameActive = false;
      this._showResult(rankings);
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
      btn.disabled    = true;
      btn.textContent = '준비완료 ✓';
      this.ready();
    });

    document.getElementById('btn-rematch')?.addEventListener('click', () => {
      this.sendToHost('requestRematch', {});
    });
  }

  // ─── 제스처 컨트롤 ──────────────────────────────────────────────────────

  /**
   * 게임 화면 전체에 터치 제스처 이벤트를 등록합니다.
   * 게임 시작 시 한 번만 호출됩니다.
   */
  _bindGestureControls() {
    const area = document.getElementById('gesture-area');
    if (!area || area._gestureBound) return;
    area._gestureBound = true;

    area.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this._onTouchStart(e.touches[0]);
    }, { passive: false });

    area.addEventListener('touchmove', (e) => {
      e.preventDefault();
      this._onTouchMove(e.touches[0]);
    }, { passive: false });

    area.addEventListener('touchend', (e) => {
      e.preventDefault();
      this._onTouchEnd(e.changedTouches[0]);
    }, { passive: false });

    area.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      this._stopSoftDrop();
      this._resetGesture();
    }, { passive: false });

    // 마우스 지원 (데스크톱 테스트용)
    let mouseDown = false;
    area.addEventListener('mousedown', (e) => {
      mouseDown = true;
      this._onTouchStart(e);
    });
    area.addEventListener('mousemove', (e) => {
      if (!mouseDown) return;
      this._onTouchMove(e);
    });
    area.addEventListener('mouseup', (e) => {
      if (!mouseDown) return;
      mouseDown = false;
      this._onTouchEnd(e);
    });
    area.addEventListener('mouseleave', () => {
      if (!mouseDown) return;
      mouseDown = false;
      this._stopSoftDrop();
      this._resetGesture();
    });
  }

  _onTouchStart(pt) {
    if (!this._gameActive || !this._alive) return;

    this._gestStartX    = pt.clientX;
    this._gestStartY    = pt.clientY;
    this._gestStartTime = Date.now();
    this._gestMode      = null;
    this._gestCellsDone = 0;

    // 셀 너비: 보드 캔버스의 실제 CSS 너비 / 10열
    const canvas = document.getElementById('game-board-canvas');
    if (canvas) {
      this._gestCellPx = canvas.getBoundingClientRect().width / BOARD_COLS;
    }
  }

  _onTouchMove(pt) {
    if (!this._gameActive || !this._alive) return;

    const dx = pt.clientX - this._gestStartX;
    const dy = pt.clientY - this._gestStartY;

    // 제스처 방향 결정 (아직 미결정인 경우)
    if (!this._gestMode) {
      if (Math.abs(dx) >= GESTURE_LOCK_PX) {
        this._gestMode = 'horizontal';
      } else if (dy >= GESTURE_LOCK_PX) {
        this._gestMode = 'vertical';
      } else {
        return; // 아직 방향 미결정
      }
    }

    if (this._gestMode === 'horizontal') {
      // 드래그 거리를 셀 단위로 변환하여 실시간 이동
      const targetCells = Math.trunc(dx / this._gestCellPx);
      const delta       = targetCells - this._gestCellsDone;

      if (delta !== 0) {
        const moveDir = delta > 0 ? 'right' : 'left';
        for (let i = 0; i < Math.abs(delta); i++) {
          if (moveDir === 'left')  this._engine.moveLeft();
          else                     this._engine.moveRight();
        }
        this._gestCellsDone = targetCells;
        this._render();
      }
    }

    if (this._gestMode === 'vertical') {
      // 일정 거리 이상 내려가면 소프트 드롭 활성화
      if (dy >= SOFT_DROP_THRESH_Y && !this._isSoftDropping) {
        this._startSoftDrop();
      } else if (dy < SOFT_DROP_THRESH_Y && this._isSoftDropping) {
        this._stopSoftDrop();
      }
    }
  }

  _onTouchEnd(pt) {
    if (!this._gameActive || !this._alive) {
      this._resetGesture();
      return;
    }

    this._stopSoftDrop();

    const dx       = pt.clientX - this._gestStartX;
    const dy       = pt.clientY - this._gestStartY;
    const dist     = Math.sqrt(dx * dx + dy * dy);
    const elapsed  = Date.now() - this._gestStartTime;

    if (dist < TAP_THRESHOLD) {
      // 탭 → 회전
      this._doRotate();
    } else if (this._gestMode === 'vertical') {
      // 빠른 하향 스와이프 → 하드 드롭
      const vel = dy / elapsed;
      if (dy >= HARD_DROP_MIN_Y && vel >= HARD_DROP_VEL) {
        this._doHardDrop();
      }
    }
    // horizontal 제스처는 touchmove에서 이미 처리됨

    this._resetGesture();
  }

  _resetGesture() {
    this._gestMode      = null;
    this._gestCellsDone = 0;
  }

  // ─── 닉네임 ──────────────────────────────────────────────────────────────

  _prefillNickname() {
    const saved = localStorage.getItem('gyf_nickname');
    if (saved) {
      this._nickname = saved;
      const input = document.getElementById('nickname-input');
      if (input) input.value = saved;
      return;
    }
    const adjs  = ['빠른', '느린', '용감한', '조용한', '귀여운', '뜨거운', '차가운', '엉뚱한'];
    const nouns = ['판다', '여우', '펭귄', '용', '고블린', '기사', '로봇', '불꽃'];
    const input = document.getElementById('nickname-input');
    if (input) {
      const adj  = adjs[Math.floor(Math.random() * adjs.length)];
      const noun = nouns[Math.floor(Math.random() * nouns.length)];
      input.value = `${adj}${noun}`;
    }
  }

  _sendProfile() {
    this.sendToHost('setProfile', { nickname: this._nickname });
    localStorage.setItem('gyf_nickname', this._nickname);
    const el = document.getElementById('waiting-nickname');
    if (el) el.textContent = this._nickname;
    this.showScreen('waiting');
    const btn = document.getElementById('btn-ready');
    if (btn) { btn.disabled = false; btn.textContent = '준비하기'; }
  }

  _renderWaitingPlayers(players) {
    const list = document.getElementById('waiting-players');
    if (!list) return;
    const others = players.filter(p => p.id !== this.playerId);
    list.innerHTML = others.map(p => `
      <div class="gyf-wait-player">
        <span class="gyf-wait-dot" style="background:${p.color}"></span>
        <span>${p.nickname}</span>
      </div>
    `).join('');
  }

  // ─── 게임 시작 ───────────────────────────────────────────────────────────

  _startGame() {
    this._engine     = new TetrisEngine();
    this._level      = 1;
    this._totalLines = 0;
    this._alive      = true;
    this._gameActive = true;

    // 다음 블록 미리보기 표시/숨김
    const nextPanel = document.getElementById('next-panel');
    if (nextPanel) nextPanel.style.display = this._showNextPiece ? 'flex' : 'none';

    this.showScreen('game');

    requestAnimationFrame(() => {
      this._resizeCanvas();
      this._engine.spawn();
      this._render();
      this._startDropTimer();
      this._startLevelTimer();
      this._bindGestureControls();
      this._showGestureHint();
    });

    window.addEventListener('resize', () => this._resizeCanvas());
  }

  // ─── 제스처 힌트 (처음 게임 시작 시 3초간 표시) ─────────────────────────

  _showGestureHint() {
    const hint = document.getElementById('gesture-hint');
    if (!hint) return;
    hint.classList.remove('gyf-hint-hidden');

    // 첫 터치 또는 3초 후 사라짐
    const hide = () => {
      hint.classList.add('gyf-hint-hidden');
      hint.removeEventListener('touchstart', hide);
    };
    hint.addEventListener('touchstart', hide, { once: true, passive: true });
    setTimeout(hide, 3000);
  }

  // ─── 캔버스 크기 조정 ────────────────────────────────────────────────────

  _resizeCanvas() {
    const canvas = document.getElementById('game-board-canvas');
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const maxW = parent.clientWidth;
    const maxH = parent.clientHeight;
    // 보드 비율 10:20 (1:2) 유지
    const size = Math.min(maxW, maxH / 2);

    canvas.width  = size;
    canvas.height = size * 2;

    this._render();
  }

  // ─── 렌더링 ──────────────────────────────────────────────────────────────

  _render() {
    if (!this._engine) return;

    const canvas = document.getElementById('game-board-canvas');
    if (canvas) {
      renderBoard(canvas, this._engine.getBoardSnapshot(), {
        ghostCells: this._alive ? this._engine.getGhostCells() : [],
        isDead: !this._alive,
      });
    }

    if (this._showNextPiece) {
      const nextCanvas = document.getElementById('next-piece-canvas');
      if (nextCanvas) renderNextPiece(nextCanvas, this._engine.getNextPieceCells());
    }
  }

  // ─── 낙하 타이머 ────────────────────────────────────────────────────────

  _startDropTimer() {
    this._clearTimer('_dropTimer');
    this._dropTimer = setTimeout(() => this._dropTick(), dropInterval(this._level));
  }

  _restartDropTimer() {
    this._clearTimer('_dropTimer');
    if (this._isSoftDropping) return;
    this._dropTimer = setTimeout(() => this._dropTick(), dropInterval(this._level));
  }

  _dropTick() {
    if (!this._gameActive || !this._alive || !this._engine) return;
    const moved = this._engine.moveDown();
    if (!moved) {
      this._lockAndNext();
    } else {
      this._render();
      this._scheduleBoardSend();
      this._startDropTimer();
    }
  }

  _lockAndNext() {
    const cleared = this._engine.lock();
    this._totalLines += cleared;

    if (cleared > 0) this.sendToHost('linesCleared', { count: cleared });

    const canSpawn = this._engine.spawn();
    if (!canSpawn) {
      this._onGameOver();
      return;
    }

    this._render();
    this._forceBoardSend();
    this._startDropTimer();

    if (this._level >= 100) this._onSoloClear();
  }

  // ─── 자동 레벨 상승 ──────────────────────────────────────────────────────

  _startLevelTimer() {
    this._clearTimer('_levelTimer');
    this._levelTimer = setInterval(() => {
      if (!this._gameActive || !this._alive || this._level >= 100) return;
      this._level++;
      this._updateLevelUI();
      this._restartDropTimer();
      if (this._level >= 100) this._onSoloClear();
    }, LEVEL_TICK_MS);
  }

  // ─── 소프트 드롭 ─────────────────────────────────────────────────────────

  _startSoftDrop() {
    if (this._isSoftDropping) return;
    this._isSoftDropping = true;
    this._clearTimer('_dropTimer');
    this._softTimer = setInterval(() => {
      if (!this._gameActive || !this._alive) { this._stopSoftDrop(); return; }
      const moved = this._engine.moveDown();
      if (!moved) {
        this._stopSoftDrop();
        this._lockAndNext();
      } else {
        this._render();
      }
    }, SOFT_DROP_MS);
  }

  _stopSoftDrop() {
    if (!this._isSoftDropping) return;
    this._isSoftDropping = false;
    if (this._softTimer) { clearInterval(this._softTimer); this._softTimer = null; }
    if (this._gameActive && this._alive) this._startDropTimer();
  }

  // ─── 회전 / 하드드롭 ────────────────────────────────────────────────────

  _doRotate() {
    if (!this._gameActive || !this._alive || !this._engine) return;
    this._engine.rotate();
    this._render();
    try { navigator.vibrate?.(20); } catch (_) {}
  }

  _doHardDrop() {
    if (!this._gameActive || !this._alive || !this._engine) return;
    this._engine.hardDrop();
    this._render();
    this._clearTimer('_dropTimer');
    this._lockAndNext();
    try { navigator.vibrate?.([30, 20, 30]); } catch (_) {}
  }

  // ─── 게임 오버 / 솔로 클리어 ─────────────────────────────────────────────

  _onGameOver() {
    this._alive      = false;
    this._gameActive = false;
    this._stopAllTimers();
    this.sendToHost('gameOver', {});
    this._render();
    this.showScreen('eliminated');
  }

  _onSoloClear() {
    this._alive      = false;
    this._gameActive = false;
    this._stopAllTimers();
    this.sendToHost('soloClear', {});
    this.showScreen('solo-clear');
  }

  // ─── boardUpdate 전송 ────────────────────────────────────────────────────

  _scheduleBoardSend() {
    if (Date.now() - this._lastBoardSend >= BOARD_SEND_MS) this._forceBoardSend();
  }

  _forceBoardSend() {
    if (!this._engine) return;
    this._lastBoardSend = Date.now();
    this.sendToHost('boardUpdate', {
      board: this._engine.getBoardSnapshot(),
      level: this._level,
      lines: this._totalLines,
    });
  }

  // ─── UI 갱신 ─────────────────────────────────────────────────────────────

  _updateLevelUI() {
    const lvlEl = document.getElementById('game-level');
    if (lvlEl) lvlEl.textContent = `Lv.${this._level}`;
    const barEl = document.getElementById('level-bar-fill');
    if (barEl) barEl.style.width = `${this._level}%`;
  }

  _flashLevelUp() {
    const barEl = document.getElementById('level-bar-fill');
    if (!barEl) return;
    barEl.classList.add('gyf-level-flash');
    setTimeout(() => barEl.classList.remove('gyf-level-flash'), 600);
    try { navigator.vibrate?.([80, 40, 80]); } catch (_) {}
  }

  // ─── 결과 화면 ───────────────────────────────────────────────────────────

  _showResult(rankings) {
    const myRank = rankings.find(r => r.id === this.playerId);
    const rankEl = document.getElementById('result-my-rank');
    if (rankEl && myRank) rankEl.textContent = `${myRank.rank}위`;

    const listEl = document.getElementById('result-ranking-list');
    if (listEl) {
      const medals = ['🥇', '🥈', '🥉', ''];
      listEl.innerHTML = rankings.map((r, i) => `
        <div class="gyf-result-row ${r.id === this.playerId ? 'gyf-result-me' : ''}">
          <span>${medals[Math.min(i, 3)]}</span>
          <span class="gyf-result-dot" style="background:${r.color}"></span>
          <span>${r.nickname}</span>
          <span class="gyf-result-detail">Lv.${r.level}</span>
        </div>
      `).join('');
    }
    this.showScreen('result');
  }

  // ─── 타이머 유틸리티 ─────────────────────────────────────────────────────

  _clearTimer(name) {
    if (!this[name]) return;
    if (name === '_levelTimer' || name === '_softTimer') clearInterval(this[name]);
    else clearTimeout(this[name]);
    this[name] = null;
  }

  _stopAllTimers() {
    this._clearTimer('_dropTimer');
    this._clearTimer('_levelTimer');
    this._stopSoftDrop();
  }
}
