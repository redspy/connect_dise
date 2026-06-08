import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';

export class RelayDrawingMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'rd-screen' });

    // 캔버스 상태
    this._ctx          = null;
    this._isDrawing    = false;
    this._currentColor = '#000000';
    this._lineWidth    = 5;
    this._isEraser     = false;
    this._lastX        = 0;
    this._lastY        = 0;

    // 프로필 캔버스 상태
    this._profileCtx   = null;
    this._profileLastX = 0;
    this._profileLastY = 0;

    this._timerInterval = null;
    this._hasSubmitted  = false;

    this._initUI();
    this._initCanvas();
    this._initHostMessages();
  }

  // ─── MobileBaseGame 훅 ────────────────────────────────────────────────────

  onJoin(player) {
    this.showScreen('setup');
  }

  onRejoin() {
    const nickname = localStorage.getItem('rd_nickname');
    if (nickname) {
      const avatar = document.getElementById('profileCanvas')?.toDataURL('image/jpeg', 0.5);
      this.sendToHost('setProfile', { nickname, avatar });
    }
    this.showScreen('waiting');
  }

  onReset() {
    this._clearTimer();
    this._hasSubmitted = false;
    document.getElementById('readyBtn')?.classList.remove('hidden');
    document.getElementById('readyStatus')?.classList.add('hidden');

    const nickname = localStorage.getItem('rd_nickname');
    if (nickname) {
      document.getElementById('myNameDisplay').textContent = nickname;
      const avatar = document.getElementById('profileCanvas')?.toDataURL('image/jpeg', 0.5);
      this.sendToHost('setProfile', { nickname, avatar });
    }
    this.showScreen('waiting');
  }

  // ─── UI 초기화 ────────────────────────────────────────────────────────────

  _initUI() {
    // 닉네임 입력 → setProfile + 대기 화면
    const savedNick = localStorage.getItem('rd_nickname') || '';
    const nicknameInput = document.getElementById('nickname');
    if (savedNick && nicknameInput) nicknameInput.value = savedNick;

    document.getElementById('joinBtn')?.addEventListener('click', () => {
      const nickname = document.getElementById('nickname')?.value.trim();
      if (!nickname) { alert('닉네임을 입력해주세요.'); return; }
      localStorage.setItem('rd_nickname', nickname);
      document.getElementById('myNameDisplay').textContent = nickname;

      // 프로필 이미지 캡처
      const avatar = document.getElementById('profileCanvas')?.toDataURL('image/jpeg', 0.5);

      this.sendToHost('setProfile', { nickname, avatar });
      this.showScreen('waiting');
    });

    // 준비 완료 버튼
    document.getElementById('readyBtn')?.addEventListener('click', () => {
      this.ready();
      this.sendToHost('playerReady', {});
      document.getElementById('readyBtn')?.classList.add('hidden');
      document.getElementById('readyStatus')?.classList.remove('hidden');
    });

    // 그림 그리기 도구
    document.querySelectorAll('.color-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this._currentColor = e.currentTarget.dataset.color;
        this._isEraser = false;
        document.getElementById('eraserBtn')?.classList.remove('active');
      });
    });

    document.getElementById('eraserBtn')?.addEventListener('click', () => {
      this._isEraser = true;
      document.getElementById('eraserBtn')?.classList.add('active');
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    });

    document.getElementById('clearBtn')?.addEventListener('click', () => {
      if (confirm('그림을 모두 지우시겠습니까?')) this._clearCanvas();
    });

    document.getElementById('submitDrawBtn')?.addEventListener('click', () => {
      this._submitDraw();
    });

    document.getElementById('submitWordBtn')?.addEventListener('click', () => {
      this._submitWord();
    });

    // 리액션 버튼
    document.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const emoji = e.currentTarget.dataset.emoji;
        this.sendToHost('sendReaction', { emoji });
      });
    });

    // canvas-container 크기 변화 감지 (화면 전환, 창 크기 변경, 방향 전환 모두 대응)
    const canvas = document.getElementById('drawingCanvas');
    const canvasContainer = document.querySelector('.canvas-container');
    if (canvas && canvasContainer) {
      const resizeObserver = new ResizeObserver(() => {
        // 그리기 화면이 활성화된 상태일 때만 리사이즈 실행
        if (document.querySelector('[data-screen="draw"].hidden')) return;

        const temp = canvas.toDataURL();
        this._resizeCanvas();
        const img = new Image();
        img.onload = () => this._ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        img.src = temp;
      });
      resizeObserver.observe(canvasContainer);
    }

    this._initProfileCanvas();

    // 하이브리드 이모지 입력기 바인딩 (아동 배제 극복)
    document.querySelectorAll('.picker-emoji').forEach(el => {
      el.addEventListener('click', e => {
        const emoji = e.currentTarget.textContent;
        const input = document.getElementById('wordGuess');
        if (input) {
          input.value += emoji;
          input.focus();
        }
      });
    });

    // 네이티브 SNS 공유 및 다운로드 연동
    document.getElementById('mobileShareBtn')?.addEventListener('click', () => {
      const img = document.getElementById('mobileShareImg');
      if (img && img.src) {
        this._shareResultToNative(img.src);
      }
    });
  }

  // ─── 캔버스 초기화 ────────────────────────────────────────────────────────

  _initProfileCanvas() {
    const canvas = document.getElementById('profileCanvas');
    if (!canvas) return;
    this._profileCtx = canvas.getContext('2d');

    // 래퍼 크기에 맞춰 캔버스 해상도 설정
    const size = Math.min(200, Math.round(window.innerWidth * 0.55));
    canvas.width = size;
    canvas.height = size;

    this._profileCtx.fillStyle = '#FFFFFF';
    this._profileCtx.fillRect(0, 0, size, size);

    const start = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      this._profileLastX = clientX - rect.left;
      this._profileLastY = clientY - rect.top;
      this._drawProfilePoint(this._profileLastX, this._profileLastY);
    };

    const move = (e) => {
      if (e.buttons !== 1 && !e.touches) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      this._profileCtx.beginPath();
      this._profileCtx.moveTo(this._profileLastX, this._profileLastY);
      this._profileCtx.lineTo(x, y);
      this._profileCtx.strokeStyle = '#000000';
      this._profileCtx.lineWidth = 4;
      this._profileCtx.lineCap = 'round';
      this._profileCtx.stroke();

      this._profileLastX = x;
      this._profileLastY = y;
    };

    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
  }

  _drawProfilePoint(x, y) {
    this._profileCtx.beginPath();
    this._profileCtx.arc(x, y, 2, 0, Math.PI * 2);
    this._profileCtx.fillStyle = '#000000';
    this._profileCtx.fill();
  }

  _initCanvas() {
    const canvas = document.getElementById('drawingCanvas');
    if (!canvas) return;
    this._ctx = canvas.getContext('2d');

    const container = document.querySelector('.canvas-container');
    container?.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    container?.addEventListener('touchmove',  e => e.preventDefault(), { passive: false });

    canvas.addEventListener('touchstart', this._startDrawing.bind(this), { passive: false });
    canvas.addEventListener('touchmove',  this._draw.bind(this),         { passive: false });
    canvas.addEventListener('touchend',   this._stopDrawing.bind(this));
    canvas.addEventListener('touchcancel',this._stopDrawing.bind(this));
    canvas.addEventListener('mousedown',  this._startDrawing.bind(this));
    canvas.addEventListener('mousemove',  this._draw.bind(this));
    canvas.addEventListener('mouseup',    this._stopDrawing.bind(this));
    canvas.addEventListener('mouseout',   this._stopDrawing.bind(this));
  }

  normalizeCoords(clientX, clientY, rect) {
    let nx = (clientX - rect.left) / rect.width;
    let ny = (clientY - rect.top) / rect.height;

    // 0~1 사이로 클램핑 (캔버스 외곽을 터치할 때의 보정)
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));

    return { nx, ny };
  }

  denormalizeCoords(nx, ny, width, height) {
    return {
      x: nx * width,
      y: ny * height
    };
  }

  _resizeCanvas() {
    const canvas = document.getElementById('drawingCanvas');
    if (!canvas) return;
    const parent = canvas.parentElement;
    const pWidth = parent.clientWidth;
    const pHeight = parent.clientHeight;

    let w = pWidth;
    let h = pWidth * (3 / 4);

    if (h > pHeight) {
      h = pHeight;
      w = pHeight * (4 / 3);
    }

    // CSS 스타일을 통한 4:3 강제 고정 및 레터박스 중앙 배치
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.left = `${(pWidth - w) / 2}px`;
    canvas.style.top = `${(pHeight - h) / 2}px`;
    canvas.style.position = 'absolute';

    // 논리 해상도는 800x600으로 영구 고정
    if (canvas.width !== 800 || canvas.height !== 600) {
      canvas.width = 800;
      canvas.height = 600;
      this._clearCanvas();
    }
  }

  _clearCanvas() {
    const canvas = document.getElementById('drawingCanvas');
    if (!this._ctx || !canvas) return;
    this._ctx.fillStyle = '#FFFFFF';
    this._ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  _getCoords(e) {
    const canvas = document.getElementById('drawingCanvas');
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return this.normalizeCoords(clientX, clientY, rect);
  }

  _startDrawing(e) {
    e.preventDefault();
    this._isDrawing = true;
    const { nx, ny } = this._getCoords(e);
    const { x, y } = this.denormalizeCoords(nx, ny, 800, 600);
    this._lastX = x;
    this._lastY = y;

    // 로컬 화면 드로잉
    this._ctx.beginPath();
    const r = (this._isEraser ? this._lineWidth * 3 : this._lineWidth) / 2;
    this._ctx.arc(x, y, r, 0, Math.PI * 2);
    this._ctx.fillStyle = this._isEraser ? '#FFFFFF' : this._currentColor;
    this._ctx.fill();

    // WebRTC 스트로크 스트리밍 패킷 설계 및 송출 시작
    this._strokeId = `${this.playerId}_${Date.now()}`;
    this._strokeSeq = 0;
    this._strokePoints = [];
    this._lastSendTime = Date.now();

    this.sendToHost('strokeStart', {
      strokeId: this._strokeId,
      color: this._isEraser ? '#FFFFFF' : this._currentColor,
      lineWidth: this._isEraser ? this._lineWidth * 3 : this._lineWidth,
      nx,
      ny
    });
  }

  _draw(e) {
    if (!this._isDrawing) return;
    e.preventDefault();
    const { nx, ny } = this._getCoords(e);
    const { x, y } = this.denormalizeCoords(nx, ny, 800, 600);

    // 로컬 화면 선 드로잉
    this._ctx.beginPath();
    this._ctx.moveTo(this._lastX, this._lastY);
    this._ctx.lineTo(x, y);
    this._ctx.strokeStyle = this._isEraser ? '#FFFFFF' : this._currentColor;
    this._ctx.lineWidth = this._isEraser ? this._lineWidth * 3 : this._lineWidth;
    this._ctx.lineCap = 'round';
    this._ctx.lineJoin = 'round';
    this._ctx.stroke();

    this._lastX = x;
    this._lastY = y;

    // 스트로크 포인트 수집
    this._strokePoints.push({ nx, ny });

    // 15ms(약 60fps) 주기로 패킷 송출
    const now = Date.now();
    if (now - this._lastSendTime >= 15 && this._strokePoints.length > 0) {
      this.sendToHost('strokeMove', {
        strokeId: this._strokeId,
        seq: this._strokeSeq++,
        points: this._strokePoints
      });
      this._strokePoints = [];
      this._lastSendTime = now;
    }
  }

  _stopDrawing(e) {
    if (e) e.preventDefault();
    if (!this._isDrawing) return;
    this._isDrawing = false;

    // 큐에 잔류한 드로잉 포인트 일괄 전송
    if (this._strokePoints && this._strokePoints.length > 0) {
      this.sendToHost('strokeMove', {
        strokeId: this._strokeId,
        seq: this._strokeSeq++,
        points: this._strokePoints
      });
      this._strokePoints = [];
    }

    // 스트로크 전송 종료 선언
    if (this._strokeId) {
      this.sendToHost('strokeEnd', { strokeId: this._strokeId });
      this._strokeId = null;
    }
  }

  // ─── 제출 로직 ────────────────────────────────────────────────────────────

  _submitDraw() {
    if (this._hasSubmitted) return;
    this._hasSubmitted = true;
    this._clearTimer();
    document.getElementById('submitDrawBtn').disabled = true;

    const canvas = document.getElementById('drawingCanvas');

    // 전송 크기 축소: 고정 해상도(480×360) 오프스크린 캔버스로 리샘플
    const offscreen = document.createElement('canvas');
    offscreen.width  = 480;
    offscreen.height = 360;
    offscreen.getContext('2d').drawImage(canvas, 0, 0, 480, 360);
    const dataUrl = offscreen.toDataURL('image/jpeg', 0.6);

    this.sendToHost('submitTurn', { type: 'draw', content: dataUrl });
    this.showScreen('standby');
  }

  _submitWord() {
    if (this._hasSubmitted) return;
    this._hasSubmitted = true;
    this._clearTimer();
    document.getElementById('submitWordBtn').disabled = true;

    const word = document.getElementById('wordGuess')?.value.trim() || '???';
    this.sendToHost('submitTurn', { type: 'word', content: word });
    this.showScreen('standby');
  }

  // ─── 타이머 ───────────────────────────────────────────────────────────────

  _startTimer(seconds, type) {
    this._clearTimer();
    const el = document.getElementById(type === 'draw' ? 'drawTimer' : 'wordTimer');

    if (seconds <= 0) {
      if (el) { el.textContent = '∞'; el.classList.remove('warning'); }
      return; // 무제한 — 직접 제출 버튼으로만 완료
    }

    let timeLeft = seconds;
    if (el) { el.textContent = timeLeft; el.classList.remove('warning'); }

    this._timerInterval = setInterval(() => {
      timeLeft--;
      if (el) el.textContent = timeLeft;
      if (timeLeft <= 10 && el) el.classList.add('warning');
      if (timeLeft <= 0) {
        this._clearTimer();
        if (type === 'draw') this._submitDraw();
        else this._submitWord();
      }
    }, 1000);
  }

  _clearTimer() {
    clearInterval(this._timerInterval);
    this._timerInterval = null;
  }

  // ─── 호스트 메시지 처리 ───────────────────────────────────────────────────

  _initHostMessages() {
    this.onMessage('playerListUpdated', ({ players }) => {
      this._updatePlayerList(players);
    });

    this.onMessage('gameStarting', () => {
      // 게임 시작 예고 (필요 시 UI 처리)
    });

    this.onMessage('roundAssignments', ({ assignments }) => {
      const myId = this.playerId;
      const myAssignment = assignments[myId];
      if (!myAssignment) return;

      this._hasSubmitted = false;

      if (myAssignment.turnType === 'draw') {
        this._setupDrawPhase(myAssignment.content, myAssignment.timeLimit);
      } else {
        this._setupWordPhase(myAssignment.content, myAssignment.timeLimit);
      }
    });

    this.onMessage('showResults', () => {
      this._clearTimer();
      this.showScreen('spectate');
    });

    this.onMessage('rejoinState', ({ phase, assignment }) => {
      if (phase === 'game' && assignment) {
        this._hasSubmitted = false;
        if (assignment.turnType === 'draw') {
          this._setupDrawPhase(assignment.content, assignment.timeLimit);
        } else {
          this._setupWordPhase(assignment.content, assignment.timeLimit);
        }
      }
    });

    this.onMessage('roundSubmitted', () => {
      this.showScreen('standby');
    });

    this.onMessage('forceSubmit', ({ type }) => {
      if (this._hasSubmitted) return;
      if (type === 'draw') this._submitDraw();
      else this._submitWord();
    });

    this.onMessage('submissionStatus', ({ players }) => {
      const listEl = document.getElementById('submission-list');
      if (!listEl) return;
      listEl.innerHTML = players.map(p => `
        <div class="submission-item ${p.submitted ? 'done' : ''}">
          <div class="sub-dot" style="background:${p.color}"></div>
          <span class="sub-name">${p.nickname}</span>
          <span class="sub-icon">${p.submitted ? '✅' : '⏳'}</span>
        </div>
      `).join('');
    });

    // P2P 역송신 최종 결과 이미지 수신 핸들러
    this.onMessage('showFinalShareCard', ({ webpDataUrl }) => {
      const shareCard = document.getElementById('mobileShareCard');
      const shareImg  = document.getElementById('mobileShareImg');
      if (shareCard && shareImg) {
        shareImg.src = webpDataUrl;
        shareCard.classList.remove('hidden');
      }
    });
  }

  _updatePlayerList(players) {
    const listEl  = document.getElementById('playerList');
    const countEl = document.getElementById('playerCount');
    if (countEl) countEl.textContent = players.length;
    if (!listEl) return;
    listEl.innerHTML = '';

    players.forEach(p => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="player-color-dot" style="background:${p.color};"></div>
        <span class="player-name">${p.nickname}</span>
        <span class="player-ready-badge ${p.ready ? 'ready' : ''}">${p.ready ? '✓ 준비' : '⏳'}</span>
      `;
      listEl.appendChild(li);
    });
  }

  _setupDrawPhase(topic, timeLimit) {
    document.getElementById('drawTopic').textContent = topic;
    document.getElementById('submitDrawBtn').disabled = false;
    // 첫 번째 색상 버튼 선택
    document.querySelectorAll('.color-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    this._currentColor = '#000000';
    this._isEraser = false;
    document.getElementById('eraserBtn')?.classList.remove('active');

    // 결과 공유 카드는 숨김
    document.getElementById('mobileShareCard')?.classList.add('hidden');

    this.showScreen('draw');
    setTimeout(() => this._resizeCanvas(), 50);
    this._clearCanvas();
    this._startTimer(timeLimit, 'draw');
  }

  _setupWordPhase(imageSrc, timeLimit) {
    document.getElementById('previousDrawing').src = imageSrc;
    document.getElementById('wordGuess').value = '';
    document.getElementById('submitWordBtn').disabled = false;

    this.showScreen('word');
    this._startTimer(timeLimit, 'word');
  }

  // ─── 모바일 네이티브 SNS 공유 및 폴백 ───────────────────────────────────────

  async _shareResultToNative(dataUrl) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], 'relay-story.webp', { type: 'image/webp' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: '그림 릴레이 2.0 결과 🎨',
          text: '친구들과 스마트폰으로 함께 그린 왁자지껄 릴레이 스토리 결과입니다!'
        });
      } else if (navigator.share) {
        await navigator.share({
          title: '그림 릴레이 2.0 결과 🎨',
          text: '친구들과 스마트폰으로 함께 그린 왁자지껄 릴레이 스토리 결과입니다!'
        });
      } else {
        this._fallbackDownload(dataUrl);
      }
    } catch (e) {
      console.error('네이티브 공유 실패:', e);
      this._fallbackDownload(dataUrl);
    }
  }

  _fallbackDownload(dataUrl) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'relay-result.webp';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    alert('기기가 네이티브 공유를 지원하지 않아 결과 카드를 이미지 파일로 다운로드합니다. ⬇');
  }
}
