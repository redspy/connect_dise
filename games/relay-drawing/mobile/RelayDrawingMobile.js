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

  onReset() {
    this._clearTimer();
    this._hasSubmitted = false;
    document.getElementById('readyBtn')?.classList.remove('hidden');
    document.getElementById('readyStatus')?.classList.add('hidden');
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
      this.sendToHost('setProfile', { nickname });
      this.showScreen('waiting');
    });

    // 준비 완료 버튼
    document.getElementById('readyBtn')?.addEventListener('click', () => {
      this.ready();
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

    // 화면 회전 시 캔버스 리사이즈
    window.addEventListener('resize', () => {
      const canvas = document.getElementById('drawingCanvas');
      if (!canvas || !document.querySelector('[data-screen="draw"]:not(.hidden)')) return;
      const temp = canvas.toDataURL();
      this._resizeCanvas();
      const img = new Image();
      img.onload = () => this._ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = temp;
    });
  }

  // ─── 캔버스 초기화 ────────────────────────────────────────────────────────

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

  _resizeCanvas() {
    const canvas = document.getElementById('drawingCanvas');
    if (!canvas) return;
    const parent = canvas.parentElement;
    canvas.width  = parent.clientWidth;
    canvas.height = parent.clientHeight;
    this._clearCanvas();
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
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  _startDrawing(e) {
    e.preventDefault();
    this._isDrawing = true;
    const { x, y } = this._getCoords(e);
    this._lastX = x;
    this._lastY = y;
    this._ctx.beginPath();
    const r = (this._isEraser ? this._lineWidth * 3 : this._lineWidth) / 2;
    this._ctx.arc(x, y, r, 0, Math.PI * 2);
    this._ctx.fillStyle = this._isEraser ? '#FFFFFF' : this._currentColor;
    this._ctx.fill();
  }

  _draw(e) {
    if (!this._isDrawing) return;
    e.preventDefault();
    const { x, y } = this._getCoords(e);
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
  }

  _stopDrawing(e) {
    if (e) e.preventDefault();
    this._isDrawing = false;
  }

  // ─── 제출 로직 ────────────────────────────────────────────────────────────

  _submitDraw() {
    if (this._hasSubmitted) return;
    this._hasSubmitted = true;
    this._clearTimer();
    document.getElementById('submitDrawBtn').disabled = true;

    const canvas = document.getElementById('drawingCanvas');
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
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
    let timeLeft = seconds;
    const el = document.getElementById(type === 'draw' ? 'drawTimer' : 'wordTimer');
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
        <span>${p.nickname}</span>
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
}
