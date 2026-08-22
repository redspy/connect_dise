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
import { renderQR } from '../../../platform/client/shared/QRDisplay.js';

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
    this._resultTimer = null;
    this._hintTimer  = null;

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
    this._playersList = [];

    this._wireUI();
    this._wireMessages();
    this._prefillNickname();

    // 재대결마다 _startGame()이 다시 호출되므로, 리스너를 그 안에 두면 매 대결마다
    // 중복 등록되어 누적된다 — 인스턴스 생성 시 단 한 번만 등록.
    window.addEventListener('resize', () => this._resizeCanvas());
  }

  // ─── MobileBaseGame 훅 ────────────────────────────────────────────────────

  onJoin()    { this.showScreen('setup'); }
  onRejoin()  { if (this._nickname) this._sendProfile(); }
  onAllReady() { /* 게임 시작은 호스트가 제어 */ }

  onReset() {
    // _gameActive를 먼저 false로 내린 뒤 타이머를 정지해야 함 — 순서가 바뀌면
    // 소프트드롭 도중 리셋이 온 경우 _stopAllTimers()→_stopSoftDrop() 내부의
    // `if (this._gameActive && this._alive) this._startDropTimer()`가 아직 true인
    // 이전 라운드 플래그를 보고 새 _dropTimer를 다시 만들어버린다(claude 헤드리스
    // 리뷰로 발견 — _dropTick()의 !this._engine 가드 덕에 크래시로는 안 이어지지만
    // "리셋 시 모든 타이머 정지" 불변식이 깨지는 순서 버그).
    this._engine     = null;
    this._level      = 1;
    this._totalLines = 0;
    this._gameActive = false;
    this._alive      = true;
    this._stopAllTimers();
    if (this._nickname) this._sendProfile();
    else this.showScreen('setup');
  }

  // ─── 메시지 핸들러 ────────────────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('playerListUpdated', ({ players }) => {
      this._playersList = players || [];
      this._renderWaitingPlayers(players);
    });

    this.onMessage('gameStarted', ({ showNextPiece, mode, startLevel, targetLevel }) => {
      this._showNextPiece = showNextPiece;
      this._gameMode = mode || 'classic';
      this._targetLevel = targetLevel || 100;
      this._startGame(startLevel || 1);
    });

    this.onMessage('levelUp', ({ newLevel }) => {
      if (!this._gameActive || !this._alive) return;
      const prev  = this._level;
      this._level = Math.min(this._targetLevel || 100, Math.max(this._level, newLevel));
      if (this._level > prev) {
        this._updateLevelUI();
        this._restartDropTimer();
        this._flashLevelUp();
      }
    });

    this.onMessage('playerEliminated', ({ playerId, rank }) => {
      if (!this._gameActive) return;
      // 다른 플레이어 닉네임 찾기
      const targetPlayer = (this._playersList || []).find(p => p.id === playerId);
      const nickname = targetPlayer ? (targetPlayer.nickname || '상대') : '상대';
      this._showToast(`💀 ${nickname} 탈락! (${rank}위)`);
    });

    // 상대방 미니보드 — 호스트 대시보드와 동일한 정보를 폰 화면 구석에도
    // 작게 표시(호스트 화면이 안 보이는 간단대결모드 전체화면 상태, 또는
    // PC/TV 자체가 없는 호스트리스 모드에서 상대 현황을 볼 유일한 수단).
    this.onMessage('opponentSnapshot', ({ players }) => {
      this._renderOpponentStrip((players || []).filter(p => p.id !== this.playerId));
    });

    this.onMessage('gameFinished', ({ rankings }) => {
      this._stopAllTimers();
      this._gameActive = false;
      // 결과 연출을 위해 2.5초 대기 후 결과 화면 전환.
      // 인스턴스 필드에 저장해 onReset()에서 clear — 안 그러면 이 2.5초 사이에
      // 재대결 등으로 onReset()이 호출돼 setup/waiting 화면으로 이미 전환된 뒤에도
      // 뒤늦게 발화해 result 화면으로 도로 튀는 버그가 생긴다(codex 정적 리뷰로 발견,
      // AGENTS.md의 "setTimeout 체인은 인스턴스 필드에 저장하고 clear" 규칙과 동일).
      this._showToast('🏆 경기 종료! 최종 결과를 정산합니다...');
      this._resultTimer = setTimeout(() => {
        this._resultTimer = null;
        this._showResult(rankings);
      }, 2500);
    });

    this.onMessage('rejoinState', ({ phase, showNextPiece, level, lines, engineState, mode }) => {
      this._gameMode = mode || 'classic';
      this._targetLevel = mode === 'quick' ? 40 : 100;

      if (phase === 'eliminated') {
        this._stopAllTimers();
        this._alive = false;
        this._gameActive = false;
        this.showScreen('eliminated');
        return;
      }

      if (phase !== 'playing') return;
      this._showNextPiece = showNextPiece;
      this._stopAllTimers();
      
      this._engine     = new TetrisEngine();
      if (engineState) {
        this._engine.setState(engineState);
      }
      this._level      = level;
      this._totalLines = lines;
      this._alive      = true;
      this._gameActive = true;

      const nextPanel = document.getElementById('next-panel');
      if (nextPanel) nextPanel.style.display = this._showNextPiece ? 'flex' : 'none';

      this.showScreen('game');
      requestAnimationFrame(() => {
        this._resizeCanvas();
        if (!engineState) {
          this._engine.spawn();
        }
        this._render();
        this._updateLevelUI();
        this._startDropTimer();
        this._startLevelTimer();
        this._bindGestureControls();
      });
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

    document.getElementById('btn-room-start')?.addEventListener('click', () => {
      this.sendToHost('requestStart', {});
    });

    // --- 게임 설정 모달 및 보조 조작 버튼 바인딩 ---
    const btnSettings = document.getElementById('btn-game-settings');
    const overlaySettings = document.getElementById('game-settings-overlay');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const chkAssist = document.getElementById('chk-assist-buttons');
    const assistArea = document.getElementById('assist-buttons-area');

    btnSettings?.addEventListener('click', () => {
      overlaySettings?.classList.remove('hidden');
    });

    btnCloseSettings?.addEventListener('click', () => {
      overlaySettings?.classList.add('hidden');
    });

    chkAssist?.addEventListener('change', () => {
      if (chkAssist.checked) {
        assistArea?.classList.remove('hidden');
        localStorage.setItem('gyf_assist_buttons', 'on');
      } else {
        assistArea?.classList.add('hidden');
        localStorage.setItem('gyf_assist_buttons', 'off');
      }
      this._resizeCanvas();
    });

    // 로컬 스토리지 값 복원
    if (localStorage.getItem('gyf_assist_buttons') === 'on') {
      if (chkAssist) chkAssist.checked = true;
      assistArea?.classList.remove('hidden');
    }

    // 보조 조작 버튼 클릭/터치 이벤트 바인딩
    document.getElementById('btn-assist-left')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!this._gameActive || !this._alive || !this._engine) return;
      this._engine.moveLeft();
      this._render();
      this._scheduleBoardSend();
    });

    document.getElementById('btn-assist-right')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!this._gameActive || !this._alive || !this._engine) return;
      this._engine.moveRight();
      this._render();
      this._scheduleBoardSend();
    });

    document.getElementById('btn-assist-rotate')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._doRotate();
    });

    document.getElementById('btn-assist-soft')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!this._gameActive || !this._alive || !this._engine) return;
      this._engine.moveDown();
      this._render();
      this._scheduleBoardSend();
      try { navigator.vibrate?.(15); } catch (_) {}
    });

    document.getElementById('btn-assist-hard')?.addEventListener('click', (e) => {
      e.preventDefault();
      this._doHardDrop();
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
        this._scheduleBoardSend();
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
    this._renderRoomQr();
  }

  /**
   * 호스트리스 모드(main.js의 createRoomAndJoin())로 이 폰이 방을 직접
   * 만든 경우에만 호출됨 — 대기 화면에 QR을 띄워 다른 폰들이 스캔해서
   * 참여할 수 있게 한다(PC/TV 대시보드가 아예 없는 상태이므로 이 QR이
   * 유일한 초대 수단).
   */
  setRoomCreatorQr(qrUrl) {
    this._roomQrUrl = qrUrl;
    this._renderRoomQr();
  }

  _renderRoomQr() {
    const box = document.getElementById('room-qr-box');
    const canvas = document.getElementById('room-qr-canvas');
    if (!box || !canvas || !this._roomQrUrl) return;
    box.classList.remove('hidden');
    renderQR(canvas, this._roomQrUrl, { width: 140 });

    // 방을 만든 사람만 시작 버튼을 볼 수 있음 — 다른 참가자는 계속
    // "호스트가 게임을 시작할 때까지 대기" 문구 그대로 유지.
    document.getElementById('btn-room-start')?.classList.remove('hidden');
    const hint = document.getElementById('waiting-hint');
    if (hint) hint.textContent = '모두 준비되면 아래 버튼으로 게임을 시작하세요';
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

  _startGame(startLevel = 1) {
    this._engine     = new TetrisEngine();
    this._level      = startLevel;
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
      this._updateLevelUI(); // 초기 레벨 UI 표시 동기화
      this._startDropTimer();
      this._startLevelTimer();
      this._bindGestureControls();
      this._showGestureHint();
    });
  }

  // ─── 제스처 힌트 (처음 게임 시작 시 3초간 표시) ─────────────────────────

  _showGestureHint() {
    const hint = document.getElementById('gesture-hint');
    if (!hint) return;
    hint.classList.remove('gyf-hint-hidden');

    // 첫 터치 또는 3초 후 사라짐. _hintTimer에 저장해 _stopAllTimers()/onReset()에서
    // clear — 안 그러면 3초 이내에 재대결이 일어났을 때 이전 라운드 타이머가 뒤늦게
    // 발화해 새 라운드에서 막 보여준 힌트를 조기에 감춰버린다(claude 헤드리스 리뷰로
    // 발견).
    const hide = () => {
      hint.classList.add('gyf-hint-hidden');
      hint.removeEventListener('touchstart', hide);
      this._hintTimer = null;
    };
    hint.addEventListener('touchstart', hide, { once: true, passive: true });
    this._hintTimer = setTimeout(hide, 3000);
  }

  // ─── 캔버스 크기 조정 ────────────────────────────────────────────────────

  _resizeCanvas() {
    const canvas = document.getElementById('game-board-canvas');
    if (!canvas) return;

    // 레벨 바 높이를 제외한 실제 사용 가능한 화면 크기를 직접 측정
    const levelBar = document.querySelector('.gyf-level-bar-wrap');
    const levelH   = levelBar ? levelBar.offsetHeight : 34;

    // 보조 조작 버튼 영역 높이 추가 공제
    const assistArea = document.getElementById('assist-buttons-area');
    const assistH = (assistArea && !assistArea.classList.contains('hidden')) ? assistArea.offsetHeight || 80 : 0;

    const screenW  = window.innerWidth;
    const screenH  = window.innerHeight - levelH - assistH;

    // 다음 블록 미리보기가 켜져 있으면 패널 너비(80px + 간격 8px) 만큼 보드 가로 제한
    const nextPanel = document.getElementById('next-panel');
    const nextW     = (nextPanel && nextPanel.style.display !== 'none') ? 88 : 0;
    const maxW      = screenW - nextW;
    const maxH      = screenH;

    // 보드 비율 1:2 (가로:세로) 유지 — 화면 방향에 따라 자동 최적화
    // 세로형: 가로를 먼저 꽉 채우고, 세로가 초과하면 세로 기준으로 역산
    // 가로형: 세로가 먼저 제한되므로 자연스럽게 세로 기준으로 계산됨
    let w = maxW;
    let h = w * 2;
    if (h > maxH) {
      h = maxH;
      w = h / 2;
    }

    canvas.width  = Math.round(w);
    canvas.height = Math.round(h);

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

  // ─── 상대방 미니보드 스트립 ─────────────────────────────────────────────

  _renderOpponentStrip(opponents) {
    const strip = document.getElementById('opponent-strip');
    if (!strip) return;
    if (!opponents.length) {
      strip.classList.add('hidden');
      return;
    }
    strip.classList.remove('hidden');

    // 기존 카드 재사용(캔버스 매 프레임 재생성 방지), 없는 카드만 새로 생성
    const nextIds = new Set(opponents.map(o => o.id));
    for (const el of [...strip.children]) {
      if (!nextIds.has(el.dataset.oppId)) el.remove();
    }
    for (const opp of opponents) {
      let card = strip.querySelector(`[data-opp-id="${opp.id}"]`);
      if (!card) {
        card = document.createElement('div');
        card.className = 'gyf-opp-card';
        card.dataset.oppId = opp.id;
        card.innerHTML = `
          <span class="gyf-opp-dot" style="background:${opp.color}"></span>
          <canvas class="gyf-opp-canvas" width="60" height="120"></canvas>
          <span class="gyf-opp-lvl"></span>
        `;
        strip.appendChild(card);
      }
      card.classList.toggle('gyf-opp-dead', !opp.alive);
      card.querySelector('.gyf-opp-lvl').textContent = `Lv.${opp.level}`;
      renderBoard(card.querySelector('canvas'), opp.board ?? null, { isDead: !opp.alive });
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
        this._scheduleBoardSend();
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
    this._scheduleBoardSend();
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
      engineState: this._engine.getState()
    });
  }

  // ─── UI 갱신 ─────────────────────────────────────────────────────────────

  _updateLevelUI() {
    const lvlEl = document.getElementById('game-level');
    if (lvlEl) lvlEl.textContent = `Lv.${this._level}`;
    const barEl = document.getElementById('level-bar-fill');
    if (barEl) {
      const maxLvl = this._targetLevel || 100;
      const pct = Math.min(100, (this._level / maxLvl) * 100);
      barEl.style.width = `${pct}%`;
    }
  }

  _flashLevelUp() {
    const barEl = document.getElementById('level-bar-fill');
    if (barEl) {
      barEl.classList.add('gyf-level-flash');
      setTimeout(() => barEl.classList.remove('gyf-level-flash'), 600);
    }
    // 피격 시 테두리에 불꽃 플래시 적용
    const gameScreen = document.querySelector('.gyf-screen[data-screen="game"]');
    if (gameScreen) {
      gameScreen.classList.add('gyf-screen-hit-flash');
      setTimeout(() => gameScreen.classList.remove('gyf-screen-hit-flash'), 500);
    }
    try { navigator.vibrate?.([150, 50, 150]); } catch (_) {}
  }

  _showToast(msg) {
    let container = document.getElementById('gyf-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'gyf-toast-container';
      container.className = 'gyf-toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'gyf-toast';
    toast.textContent = msg;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('gyf-toast-fadeout');
      setTimeout(() => toast.remove(), 400);
    }, 2000);
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
    this._clearTimer('_resultTimer');
    this._clearTimer('_hintTimer');
    this._stopSoftDrop();
  }
}
