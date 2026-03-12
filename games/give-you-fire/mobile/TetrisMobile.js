/**
 * TetrisMobile.js — Give You Fire 모바일 게임 클래스
 * MobileBaseGame을 상속하여 테트리스 게임 플레이 전체를 관리합니다.
 *
 * 주요 기능:
 *  - TetrisEngine으로 게임 로직 처리
 *  - BoardRenderer로 캔버스 렌더링 (고스트 피스 포함)
 *  - 5버튼 조작 + 보드 탭 회전
 *  - DAS (Delayed Auto Shift): 방향키 홀드 시 연속 이동
 *  - 소프트 드롭: ←↓ / →↓ 홀드 중 가속 낙하
 *  - 5초마다 자동 레벨 상승, 호스트로부터 레벨업 공격 수신
 *  - boardUpdate 100ms 스로틀 전송
 */

import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';
import { TetrisEngine, dropInterval } from '../shared/TetrisEngine.js';
import { renderBoard, renderNextPiece } from '../shared/BoardRenderer.js';

// ─── 조작 타이밍 상수 ──────────────────────────────────────────────────────
const DAS_DELAY      = 150;  // ms: 방향키 홀드 후 첫 연속 이동까지 지연
const DAS_REPEAT     = 50;   // ms: 이후 연속 이동 간격
const SOFT_DROP_MS   = 50;   // ms: 소프트 드롭 낙하 간격
const BOARD_SEND_MS  = 100;  // ms: boardUpdate 전송 스로틀
const LEVEL_TICK_MS  = 5000; // ms: 자동 레벨 상승 간격

export class TetrisMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'gyf-screen' });

    this._engine       = null;  // TetrisEngine 인스턴스 (게임 시작 시 생성)
    this._level        = 1;
    this._totalLines   = 0;
    this._alive        = true;
    this._gameActive   = false;
    this._showNextPiece = false;

    // 타이머 핸들
    this._dropTimer    = null;  // 중력 낙하 타이머
    this._levelTimer   = null;  // 자동 레벨 상승 타이머
    this._softTimer    = null;  // 소프트 드롭 타이머

    // DAS (Delayed Auto Shift) 상태
    this._dasDir       = null;  // 'left' | 'right' | null
    this._dasInitTimer = null;
    this._dasRepTimer  = null;

    // boardUpdate 스로틀
    this._lastBoardSend    = 0;
    this._pendingBoardSend = false;

    this._nickname = '';

    this._wireUI();
    this._wireMessages();
    this._prefillNickname();
  }

  // ─── MobileBaseGame 훅 ────────────────────────────────────────────────────

  onJoin() {
    this.showScreen('setup');
  }

  onRejoin() {
    if (this._nickname) this._sendProfile();
  }

  onAllReady() { /* 게임 시작은 호스트가 제어 */ }

  onReset() {
    this._stopAllTimers();
    this._engine     = null;
    this._level      = 1;
    this._totalLines = 0;
    this._alive      = true;
    this._gameActive = false;

    if (this._nickname) {
      this._sendProfile();
    } else {
      this.showScreen('setup');
    }
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
      const prev = this._level;
      this._level = Math.min(100, Math.max(this._level, newLevel));
      if (this._level > prev) {
        this._updateLevelUI();
        this._restartDropTimer();
        this._flashLevelUp();
      }
    });

    this.onMessage('playerEliminated', ({ playerId }) => {
      if (playerId !== this.playerId) {
        this._updateAliveCount();
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
    // 셋업 화면
    document.getElementById('btn-join')?.addEventListener('click', () => {
      const nick = document.getElementById('nickname-input')?.value.trim();
      if (!nick) { alert('닉네임을 입력해주세요'); return; }
      this._nickname = nick;
      this._sendProfile();
    });

    // 대기 화면
    document.getElementById('btn-ready')?.addEventListener('click', () => {
      const btn = document.getElementById('btn-ready');
      btn.disabled  = true;
      btn.textContent = '준비완료 ✓';
      this.ready();
    });

    // 다시하기
    document.getElementById('btn-rematch')?.addEventListener('click', () => {
      this.sendToHost('requestRematch', {});
    });

    // 게임 버튼 (touchstart / touchend)
    this._bindControlButtons();

    // 보드 탭 → 회전
    const boardEl = document.getElementById('game-board-canvas');
    if (boardEl) {
      boardEl.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (this._gameActive && this._alive) this._doRotate();
      }, { passive: false });
      boardEl.addEventListener('click', () => {
        if (this._gameActive && this._alive) this._doRotate();
      });
    }
  }

  _bindControlButtons() {
    // [←] 왼쪽 이동 (DAS)
    this._bindDAS('btn-left', 'left');
    // [→] 오른쪽 이동 (DAS)
    this._bindDAS('btn-right', 'right');
    // [↓↓] 하드 드롭
    this._bindTap('btn-hard-drop', () => this._doHardDrop());
    // [←↓] 소프트 드롭 (왼쪽)
    this._bindSoftDrop('btn-soft-left');
    // [→↓] 소프트 드롭 (오른쪽)
    this._bindSoftDrop('btn-soft-right');
  }

  /**
   * DAS 버튼 바인딩 (touchstart로 즉시 이동 + 홀드 시 연속 이동)
   */
  _bindDAS(id, dir) {
    const el = document.getElementById(id);
    if (!el) return;
    const start = () => {
      if (!this._gameActive || !this._alive) return;
      this._stopDAS();
      this._dasDir = dir;
      this._doMove(dir);
      this._dasInitTimer = setTimeout(() => {
        this._dasRepTimer = setInterval(() => this._doMove(dir), DAS_REPEAT);
      }, DAS_DELAY);
    };
    const stop = () => this._stopDAS();
    el.addEventListener('touchstart', (e) => { e.preventDefault(); start(); }, { passive: false });
    el.addEventListener('touchend',   stop);
    el.addEventListener('touchcancel',stop);
    el.addEventListener('mousedown',  start);
    el.addEventListener('mouseup',    stop);
    el.addEventListener('mouseleave', stop);
  }

  /**
   * 소프트 드롭 버튼 바인딩 (누르는 동안 빠르게 낙하)
   */
  _bindSoftDrop(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const start = () => {
      if (!this._gameActive || !this._alive) return;
      this._startSoftDrop();
    };
    const stop = () => this._stopSoftDrop();
    el.addEventListener('touchstart',  (e) => { e.preventDefault(); start(); }, { passive: false });
    el.addEventListener('touchend',    stop);
    el.addEventListener('touchcancel', stop);
    el.addEventListener('mousedown',   start);
    el.addEventListener('mouseup',     stop);
    el.addEventListener('mouseleave',  stop);
  }

  /**
   * 단순 탭 버튼 바인딩
   */
  _bindTap(id, fn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
    el.addEventListener('click', fn);
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
    // 준비 버튼 초기화
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

    // 다음 블록 미리보기 패널 표시/숨김
    const nextPanel = document.getElementById('next-panel');
    if (nextPanel) nextPanel.style.display = this._showNextPiece ? 'flex' : 'none';

    this.showScreen('game');

    // 화면 전환 후 캔버스 크기 조정
    requestAnimationFrame(() => {
      this._resizeCanvas();
      this._engine.spawn();
      this._render();
      this._startDropTimer();
      this._startLevelTimer();
    });

    // 화면 크기 변경 시 재조정
    window.addEventListener('resize', () => this._resizeCanvas());
  }

  // ─── 캔버스 크기 조정 ────────────────────────────────────────────────────

  _resizeCanvas() {
    const canvas = document.getElementById('game-board-canvas');
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    // 부모 영역에 맞게 캔버스 크기 설정 (10:20 비율 유지)
    const maxW = parent.clientWidth;
    const maxH = parent.clientHeight;
    const size = Math.min(maxW, maxH / 2);

    canvas.width  = size;
    canvas.height = size * 2;

    this._render();
  }

  // ─── 렌더링 ──────────────────────────────────────────────────────────────

  _render() {
    if (!this._engine) return;

    // 메인 보드
    const canvas = document.getElementById('game-board-canvas');
    if (canvas) {
      renderBoard(canvas, this._engine.getBoardSnapshot(), {
        ghostCells: this._alive ? this._engine.getGhostCells() : [],
        isDead: !this._alive,
      });
    }

    // 다음 블록 미리보기
    if (this._showNextPiece) {
      const nextCanvas = document.getElementById('next-piece-canvas');
      if (nextCanvas) {
        renderNextPiece(nextCanvas, this._engine.getNextPieceCells());
      }
    }
  }

  // ─── 낙하 타이머 ────────────────────────────────────────────────────────

  _startDropTimer() {
    this._clearTimer('_dropTimer');
    this._dropTimer = setTimeout(() => this._dropTick(), dropInterval(this._level));
  }

  _restartDropTimer() {
    this._clearTimer('_dropTimer');
    if (this._softTimer) return; // 소프트 드롭 중에는 재시작 안 함
    this._dropTimer = setTimeout(() => this._dropTick(), dropInterval(this._level));
  }

  _dropTick() {
    if (!this._gameActive || !this._alive || !this._engine) return;

    const moved = this._engine.moveDown();
    if (!moved) {
      // 착지 → 고정
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

    if (cleared > 0) {
      this.sendToHost('linesCleared', { count: cleared });
    }

    // 다음 피스 스폰
    const canSpawn = this._engine.spawn();
    if (!canSpawn) {
      // 게임 오버
      this._onGameOver();
      return;
    }

    this._render();
    this._forceBoardSend(); // 고정 후 즉시 전송
    this._startDropTimer();

    // 1인 클리어: 레벨 100 도달 확인
    if (this._level >= 100) {
      this._onSoloClear();
    }
  }

  // ─── 자동 레벨 타이머 ────────────────────────────────────────────────────

  _startLevelTimer() {
    this._clearTimer('_levelTimer');
    this._levelTimer = setInterval(() => {
      if (!this._gameActive || !this._alive) return;
      if (this._level < 100) {
        this._level++;
        this._updateLevelUI();
        this._restartDropTimer();
        if (this._level >= 100) {
          // 1인 모드에서만 솔로 클리어 트리거
          this._checkSoloClear();
        }
      }
    }, LEVEL_TICK_MS);
  }

  _checkSoloClear() {
    // 플레이어가 혼자라면 솔로 클리어
    // 호스트가 결과를 처리하므로 메시지만 전송
    this._onSoloClear();
  }

  // ─── 소프트 드롭 ─────────────────────────────────────────────────────────

  _startSoftDrop() {
    if (this._softTimer) return;
    this._clearTimer('_dropTimer'); // 기존 낙하 타이머 중지
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
    if (this._softTimer) {
      clearInterval(this._softTimer);
      this._softTimer = null;
    }
    if (this._gameActive && this._alive) {
      this._startDropTimer();
    }
  }

  // ─── 이동 / 회전 / 하드드롭 ─────────────────────────────────────────────

  _doMove(dir) {
    if (!this._gameActive || !this._alive || !this._engine) return;
    if (dir === 'left')  this._engine.moveLeft();
    if (dir === 'right') this._engine.moveRight();
    this._render();
  }

  _doRotate() {
    if (!this._engine) return;
    this._engine.rotate();
    this._render();
  }

  _doHardDrop() {
    if (!this._gameActive || !this._alive || !this._engine) return;
    this._engine.hardDrop();
    this._render();
    this._clearTimer('_dropTimer');
    this._lockAndNext();
  }

  // ─── DAS 정리 ────────────────────────────────────────────────────────────

  _stopDAS() {
    this._dasDir = null;
    if (this._dasInitTimer) { clearTimeout(this._dasInitTimer);  this._dasInitTimer = null; }
    if (this._dasRepTimer)  { clearInterval(this._dasRepTimer);  this._dasRepTimer  = null; }
  }

  // ─── 게임 오버 / 솔로 클리어 ─────────────────────────────────────────────

  _onGameOver() {
    this._alive     = false;
    this._gameActive = false;
    this._stopAllTimers();

    this.sendToHost('gameOver', {});
    this._render(); // 탈락 오버레이 표시

    // 탈락 화면 전환
    this.showScreen('eliminated');
  }

  _onSoloClear() {
    this._alive     = false;
    this._gameActive = false;
    this._stopAllTimers();
    this.sendToHost('soloClear', {});
    this.showScreen('solo-clear');
  }

  // ─── boardUpdate 전송 ────────────────────────────────────────────────────

  _scheduleBoardSend() {
    const now = Date.now();
    if (now - this._lastBoardSend >= BOARD_SEND_MS) {
      this._forceBoardSend();
    }
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
    // 레벨업 공격 수신 시 시각적 피드백
    const barEl = document.getElementById('level-bar-fill');
    if (!barEl) return;
    barEl.classList.add('gyf-level-flash');
    setTimeout(() => barEl.classList.remove('gyf-level-flash'), 600);
    try { navigator.vibrate?.([80, 40, 80]); } catch (_) {}
  }

  _updateAliveCount() {
    // 다른 플레이어 탈락 시 안내 업데이트 (선택적)
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

  // ─── 타이머 정리 유틸리티 ────────────────────────────────────────────────

  _clearTimer(name) {
    if (this[name]) {
      if (name === '_levelTimer' || name === '_dasRepTimer' || name === '_softTimer') {
        clearInterval(this[name]);
      } else {
        clearTimeout(this[name]);
      }
      this[name] = null;
    }
  }

  _stopAllTimers() {
    this._clearTimer('_dropTimer');
    this._clearTimer('_levelTimer');
    this._clearTimer('_softTimer');
    this._stopDAS();
    this._stopSoftDrop();
  }
}
