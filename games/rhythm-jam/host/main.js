import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { HostSDK } from '../../../platform/client/HostSDK.js';
import { RhythmJamDemoSimulator } from './DemoSimulator.js';

export class RhythmJamHost extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'dw-overlay', qrContainerId: 'qr-box' });

    this._score = 0;
    this._combo = 0;
    this._maxCombo = 0;
    this._perfectCount = 0;
    this._goodCount = 0;
    this._missCount = 0;

    this._gameActive = false;
    this._isPausedForRejoin = false;
    
    // 곡 정보
    this._track = 'disco'; // 'disco' | 'lounge' | 'rave'
    this._bpm = 110;
    this._trackLength = 20; // seconds
    this._startTime = 0;
    this._elapsedTime = 0;
    
    this._notes = []; // 현재 화면상의 액티브 노드들 { id, targetTime, lane, x, hit, missed }
    this._noteIdCounter = 0;
    
    this._playerInstruments = new Map(); // playerId -> instrumentIndex (0: Bass, 1: Snare, 2: Hihat)
    this._particles = []; // PERFECT 타격 시 뿜어져나오는 네온 리플 입자

    this._audioCtx = null;
    this._noiseBuffer = null; // 스네어/하이햇용 노이즈 버퍼 캐시
    
    this._demoSimulator = new RhythmJamDemoSimulator(this);
    this._isDemo = false;

    this._canvas = null;
    this._ctx = null;
    this._animationFrameId = null;

    this._wireMessages();
  }

  async onSetup({ sessionId }) {
    this.setPhase('lobby');

    this._canvas = document.getElementById('stage-canvas');
    if (this._canvas) {
      this._ctx = this._canvas.getContext('2d');
    }

    // 곡 설정 드롭다운 핸들러
    const trackSelect = document.getElementById('track-select-box');
    if (trackSelect) {
      trackSelect.onchange = (e) => {
        this._track = e.target.value;
      };
    }

    // 데모 버튼 핸들러
    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.onclick = () => {
        if (!this._isDemo) {
          this._demoSimulator.startDemo();
          demoPlayBtn.textContent = '⏹️ 데모 중지';
        } else {
          this._demoSimulator.stopDemo();
          this.resetSession();
        }
      };
    }

    const restartBtn = document.getElementById('btn-restart-result');
    if (restartBtn) {
      restartBtn.onclick = () => this.resetSession();
    }
  }

  onPlayerJoin(player) {
    this._resetIdleTimer();
    this.renderLobbyPlayers(this._playerNicknames);
  }

  onPlayerLeave(playerId) {
    this._playerInstruments.delete(playerId);
    this.renderLobbyPlayers(this._playerNicknames);

    if (this._gameActive) {
      this._pauseGameForRejoin();
    }
  }

  onPlayerRejoin(player) {
    this._resetIdleTimer();
    this.renderLobbyPlayers(this._playerNicknames);

    if (this._gameActive) {
      // 기존 역할 할당 상태 복원
      const savedInst = this._playerInstruments.get(player.id) !== undefined
        ? this._playerInstruments.get(player.id)
        : 0;
      this._playerInstruments.set(player.id, savedInst);

      this.sendToPlayer(player.id, 'assignInstrument', {
        instrumentIndex: savedInst,
        score: this._score,
        combo: this._combo
      });

      this._resumeGameAfterRejoin();
    } else {
      this.sendToPlayer(player.id, 'lobbyState', { phase: 'lobby' });
    }
  }

  onAllReady() {
    this._startGame();
  }

  onReset() {
    this._demoSimulator.stopDemo();
    this._gameActive = false;
    this._isPausedForRejoin = false;
    if (this._animationFrameId) cancelAnimationFrame(this._animationFrameId);

    this._score = 0;
    this._combo = 0;
    this._maxCombo = 0;
    this._perfectCount = 0;
    this._goodCount = 0;
    this._missCount = 0;
    this._notes = [];
    this._particles = [];

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) demoPlayBtn.textContent = '🤖 데모 플레이 실행';

    document.getElementById('track-select-box').disabled = false;
    document.getElementById('stabilization-banner')?.classList.add('hidden');
    document.getElementById('roles-board').innerHTML = '';

    this.setPhase('lobby');
  }

  // ─── Web Audio API 합성 엔진 ─────────────────────────────────────────────

  _initAudio() {
    if (this._audioCtx) return;
    
    // 브라우저 AudioContext 생성 및 기상청 활성화 가드
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this._audioCtx = new AudioContextClass();
    
    // 1초 분량의 화이트 노이즈 버퍼 생성 (스네어/하이햇에 사용)
    const bufferSize = this._audioCtx.sampleRate;
    const buffer = this._audioCtx.createBuffer(1, bufferSize, this._audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this._noiseBuffer = buffer;
  }

  _playBassSound() {
    if (!this._audioCtx) return;
    const ctx = this._audioCtx;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    // 베이스드럼: 피치 하강 사인파 (130Hz -> 30Hz)
    osc.frequency.setValueAtTime(130, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(1.0, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.16);
  }

  _playSnareSound() {
    if (!this._audioCtx || !this._noiseBuffer) return;
    const ctx = this._audioCtx;
    if (ctx.state === 'suspended') ctx.resume();

    // 1. 피치용 주파수 사인파
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);

    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.1);
    oscGain.gain.setValueAtTime(0.7, ctx.currentTime);
    oscGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);

    // 2. 노이즈 소스 + 밴드패스 필터
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;

    const noiseGain = ctx.createGain();

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    noiseGain.gain.setValueAtTime(1.0, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

    noise.start(ctx.currentTime);
    noise.stop(ctx.currentTime + 0.16);
  }

  _playHihatSound() {
    if (!this._audioCtx || !this._noiseBuffer) return;
    const ctx = this._audioCtx;
    if (ctx.state === 'suspended') ctx.resume();

    const source = ctx.createBufferSource();
    source.buffer = this._noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;

    const gain = ctx.createGain();

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);

    source.start(ctx.currentTime);
    source.stop(ctx.currentTime + 0.06);
  }

  _playInstrumentSound(instIndex) {
    if (instIndex === 0) this._playBassSound();
    else if (instIndex === 1) this._playSnareSound();
    else if (instIndex === 2) this._playHihatSound();
  }

  // ─── Game Management ──────────────────────────────────────────────────────

  _startGame() {
    this._initAudio();

    this._gameActive = true;
    this._isPausedForRejoin = false;
    this._score = 0;
    this._combo = 0;
    this._maxCombo = 0;
    this._perfectCount = 0;
    this._goodCount = 0;
    this._missCount = 0;
    this._notes = [];
    this._particles = [];

    // 수록곡 비트 맵 로드
    const trackName = this._track;
    const trackInfo = this._getTrackNotes(trackName);
    this._bpm = trackInfo.bpm;
    this._trackLength = this._isDemo ? 8 : trackInfo.length;
    this._preloadedNotes = trackInfo.notes;

    document.getElementById('track-select-box').disabled = true;

    // 참가 플레이어 악기 배정 (0: Bass, 1: Snare, 2: Hihat 분산 부여)
    this._assignInstruments();

    const trackTitleEl = document.getElementById('hud-track-title');
    if (trackTitleEl) {
      const titles = {
        disco: '🕺 Neon Disco (110 BPM)',
        lounge: '🌌 Space Lounge (90 BPM)',
        rave: '⚡ Cyber Rave (130 BPM)',
        retro: '👾 Retro 8-Bit (100 BPM)',
        funk: '🎸 Future Funk (115 BPM)',
        synth: '🌆 Synthwave Dream (120 BPM)',
        techno: '🏭 Acid Techno (140 BPM)',
        lofi: '☕ Hip-Hop Lo-Fi (80 BPM)',
        waltz: '🎡 Galaxy Waltz (120 BPM)',
        chaos: '🔥 Chaos Drummer (150 BPM)'
      };
      trackTitleEl.textContent = titles[trackName] || trackName;
    }

    this.setPhase('playing');

    this._startTime = performance.now();
    this._lastSpawnTime = 0;

    // 60fps 렌더 루프 가동
    this._startRenderLoop();

    if (this._isDemo) {
      this._demoSimulator.onStart();
    }
  }

  _getTrackNotes(trackName) {
    const notes = [];
    let bpm = 110;
    let length = 20; // 20초 단축 플레이
    
    // BPM 매핑
    const bpms = {
      disco: 110, lounge: 90, rave: 130, retro: 100,
      funk: 115, synth: 120, techno: 140, lofi: 80,
      waltz: 120, chaos: 150
    };
    bpm = bpms[trackName] || 110;
    const bLen = 60 / bpm;
    const totalBeats = Math.floor(length / bLen);

    if (trackName === 'disco') {
      for (let b = 2; b < totalBeats; b++) {
        const time = b * bLen;
        notes.push({ time, lane: 2 });
        if (b % 2 === 0) notes.push({ time, lane: 0 });
        if (b % 2 === 1) notes.push({ time, lane: 1 });
      }
    } else if (trackName === 'lounge') {
      for (let b = 2; b < totalBeats; b++) {
        const time = b * bLen;
        notes.push({ time, lane: 2 });
        if (b % 4 === 0 || b % 4 === 2) notes.push({ time, lane: 0 });
        if (b % 4 === 1) notes.push({ time: time + bLen * 0.5, lane: 1 });
      }
    } else if (trackName === 'rave') {
      for (let b = 2; b < totalBeats; b++) {
        const time = b * bLen;
        notes.push({ time, lane: 2 });
        notes.push({ time: time + bLen * 0.5, lane: 2 });
        if (b % 2 === 0) notes.push({ time, lane: 0 });
        else notes.push({ time, lane: 1 });
      }
    } else if (trackName === 'retro') {
      // 8비트 레트로
      for (let b = 2; b < totalBeats; b++) {
        const time = b * bLen;
        notes.push({ time, lane: 2 });
        if (b % 4 === 0) notes.push({ time, lane: 0 });
        if (b % 4 === 2) notes.push({ time: time + bLen * 0.5, lane: 0 });
        if (b % 2 === 1) notes.push({ time, lane: 1 });
      }
    } else if (trackName === 'funk') {
      // 퓨처 펑크
      for (let b = 2; b < totalBeats; b++) {
        const time = b * bLen;
        notes.push({ time, lane: 2 });
        if (b % 4 === 0 || b % 4 === 3) notes.push({ time: time + bLen * 0.25, lane: 0 });
        if (b % 2 === 1) notes.push({ time, lane: 1 });
      }
    } else if (trackName === 'synth') {
      // 신스웨이브
      for (let b = 2; b < totalBeats; b++) {
        const time = b * bLen;
        notes.push({ time, lane: 0 });
        notes.push({ time: time + bLen * 0.5, lane: 0 });
        if (b % 2 === 1) notes.push({ time, lane: 1 });
        if (b % 4 === 0) notes.push({ time, lane: 2 });
      }
    } else if (trackName === 'techno') {
      // 애시드 테크노
      for (let b = 2; b < totalBeats; b++) {
        const time = b * bLen;
        notes.push({ time, lane: 0 });
        notes.push({ time, lane: 2 });
        if (b % 4 === 2 || b % 4 === 3.5) {
          notes.push({ time: time + bLen * 0.25, lane: 1 });
        }
      }
    } else if (trackName === 'lofi') {
      // 힙합 로파이
      for (let b = 2; b < totalBeats; b++) {
        const time = b * bLen;
        if (b % 2 === 0) notes.push({ time, lane: 2 });
        if (b % 4 === 0) notes.push({ time, lane: 0 });
        if (b % 4 === 2) notes.push({ time, lane: 1 });
      }
    } else if (trackName === 'waltz') {
      // 3/4 왈츠
      for (let b = 2; b < totalBeats; b++) {
        const time = b * bLen;
        if (b % 3 === 0) notes.push({ time, lane: 0 });
        if (b % 3 === 1) notes.push({ time, lane: 1 });
        if (b % 3 === 2) notes.push({ time, lane: 2 });
      }
    } else if (trackName === 'chaos') {
      // 카오스 드러머
      for (let b = 2; b < totalBeats; b++) {
        const time = b * bLen;
        if (Math.random() < 0.8) notes.push({ time, lane: 2 });
        if (Math.random() < 0.6) notes.push({ time: time + bLen * 0.5, lane: 1 });
        if (b % 2 === 0) notes.push({ time, lane: 0 });
      }
    }
    return { bpm, notes, length };
  }

  _assignInstruments() {
    this._playerInstruments.clear();
    const players = Array.from(this._playerNicknames.keys());
    if (players.length === 0) return;

    players.forEach((pid, idx) => {
      const instIndex = idx % 3; // 3개 악기로 순환 할당
      this._playerInstruments.set(pid, instIndex);
      this.sendToPlayer(pid, 'assignInstrument', { instrumentIndex: instIndex });
    });

    // 디스플레이 영역에 역할 보드 렌더링
    this._renderRolesBoard();
  }

  _startRenderLoop() {
    const frame = (timestamp) => {
      if (!this._gameActive) return;

      if (!this._isPausedForRejoin) {
        this._updateGame(timestamp);
      }
      this._drawCanvas();

      this._animationFrameId = requestAnimationFrame(frame);
    };
    this._animationFrameId = requestAnimationFrame(frame);
  }

  _updateGame(timestamp) {
    this._elapsedTime = (performance.now() - this._startTime) / 1000;

    // 진행률 바 업데이트
    const pct = Math.min(100, (this._elapsedTime / this._trackLength) * 100);
    const progressFill = document.getElementById('hud-progress-bar');
    if (progressFill) {
      progressFill.style.width = `${pct}%`;
    }

    // 1. 프리로드된 악보로부터 노드 스폰
    this._preloadedNotes.forEach(note => {
      if (!note.spawned && note.time <= this._elapsedTime) {
        note.spawned = true;
        this._notes.push({
          id: this._noteIdCounter++,
          targetTime: note.time,
          lane: note.lane,
          x: this._canvas.width,
          hit: false,
          missed: false
        });
      }
    });

    // 2. 스크롤 위치 이동 및 화면 이탈 MISS 판정
    const w = this._canvas.width;
    const speed = 260; // 픽셀/초
    const targetX = 130; // 판정선 X선 (x = 130)

    this._notes.forEach(note => {
      // 시간차 비례 x 픽셀 연산
      const delta = this._elapsedTime - note.targetTime;
      note.x = targetX + (delta * -speed);

      // 판정선을 지나쳐 멀리 사라지면 MISS
      if (!note.hit && !note.missed && note.x < 50) {
        note.missed = true;
        this._triggerJudge('miss');
      }
    });

    // 만료된 노드 정리
    this._notes = this._notes.filter(note => note.x > 10);

    // 3. 파티클 물리 업데이트
    this._particles = this._particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= 0.03;
      p.radius += 0.5;
      return p.alpha > 0;
    });

    // 4. 데모 봇 피드백 온비트 스캔
    if (this._isDemo) {
      this._demoSimulator.onTick(this._elapsedTime, this._notes);
    }

    // 5. 완곡 도출 시 게임 종료
    if (this._elapsedTime >= this._trackLength) {
      this._endGame();
    }
  }

  _triggerJudge(judge) {
    const stamp = document.getElementById('judge-stamp');
    const comboWrap = document.getElementById('combo-display');
    const comboCnt = document.getElementById('combo-count');

    if (!stamp || !comboWrap || !comboCnt) return;

    stamp.classList.remove('hidden', 'perfect', 'good', 'miss');
    void stamp.offsetWidth; // reflow

    if (judge === 'perfect') {
      this._score += (this._combo >= 10) ? 200 : 100; // 피버 모드 더블 배점
      this._combo++;
      this._perfectCount++;
      stamp.textContent = '대박!';
      stamp.classList.add('perfect');
    } else if (judge === 'good') {
      this._score += (this._combo >= 10) ? 100 : 50;
      this._combo++;
      this._goodCount++;
      stamp.textContent = '나이스!';
      stamp.classList.add('good');
    } else if (judge === 'miss') {
      this._combo = 0;
      this._missCount++;
      stamp.textContent = '앗!';
      stamp.classList.add('miss');

      // 미스 시 전체 모바일에 경고 오버헤드 햅틱 진동 지시
      this.broadcast('missAlert', {});
    }

    this._maxCombo = Math.max(this._maxCombo, this._combo);

    // 콤보 HUD 노출
    if (this._combo > 0) {
      comboWrap.classList.remove('hidden');
      comboCnt.textContent = this._combo;
      
      // 피버 모드 여부에 따른 캔버스 보더 클래스 제어
      const canvasWrap = document.querySelector('.canvas-wrapper');
      if (this._combo >= 10) {
        canvasWrap?.classList.add('fever-flash');
      } else {
        canvasWrap?.classList.remove('fever-flash');
      }
    } else {
      comboWrap.classList.add('hidden');
      document.querySelector('.canvas-wrapper')?.classList.remove('fever-flash');
    }

    // HUD 업데이트
    const scoreVal = document.getElementById('hud-score');
    const maxComboVal = document.getElementById('hud-max-combo');
    if (scoreVal) scoreVal.textContent = this._score;
    if (maxComboVal) maxComboVal.textContent = this._maxCombo;

    // 실시간 모바일 동기화 통보
    this.broadcast('scoreUpdate', { score: this._score, combo: this._combo });
  }

  // ─── 캔버스 2D 드로잉 ───

  _drawCanvas() {
    if (!this._ctx || !this._canvas) return;
    const ctx = this._ctx;
    const w = this._canvas.width;
    const h = this._canvas.height;

    // 배경 지우기
    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, w, h);

    // 1. 컨베이어 벨트 트랙 그리기 (3줄 레일)
    const laneH = h / 3;
    const colors = ['#ff007f', '#ffd700', '#00f3ff']; // Red: Bass, Yellow: Snare, Blue: Hihat
    
    // 피버 무지개 트랙 그라데이션 여부
    const isFever = this._combo >= 10;

    for (let i = 0; i < 3; i++) {
      const centerY = i * laneH + laneH / 2;

      // 트랙 라인
      if (isFever) {
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, '#ff007f');
        grad.addColorStop(0.3, '#ffd700');
        grad.addColorStop(0.6, '#00f3ff');
        grad.addColorStop(1, '#39ff14');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 4;
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 2;
      }
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(w, centerY);
      ctx.stroke();

      // 판정선 가이드 원형 서클 (x = 130)
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(130, centerY, 32, 0, Math.PI * 2);
      ctx.stroke();

      // 판정선 후광 효과
      ctx.fillStyle = isFever ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)';
      ctx.beginPath();
      ctx.arc(130, centerY, 30, 0, Math.PI * 2);
      ctx.fill();

      // 라벨 표기 (BASS, SNARE, HIHAT)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = 'bold 12px Outfit';
      const labels = ['BASS DRUM', 'SNARE DRUM', 'HI-HAT CYMBAL'];
      ctx.fillText(labels[i], 20, centerY - 45);
    }

    // 2. 리듬 노드 렌더링
    this._notes.forEach(note => {
      if (note.hit) return; // 이미 친 노드는 안 그림

      const centerY = note.lane * laneH + laneH / 2;
      ctx.fillStyle = colors[note.lane];
      ctx.shadowBlur = 10;
      ctx.shadowColor = colors[note.lane];

      ctx.beginPath();
      ctx.arc(note.x, centerY, 24, 0, Math.PI * 2);
      ctx.fill();

      // 내부 광택 효과
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 0; // 그림자 제거
      ctx.beginPath();
      ctx.arc(note.x - 6, centerY - 6, 6, 0, Math.PI * 2);
      ctx.fill();
    });

    // 3. 퍼펙트 링 리플 파티클 렌더링
    this._particles.forEach(p => {
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.lineWidth = p.lineWidth;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.globalAlpha = 1.0; // 투명도 복구
  }

  // ─── 모바일 탭 수신 핸들러 ───────────────────────────────────────────────

  _wireMessages() {
    // 플레이어 탭 노트 입력 처리
    this.onMessage('tapNote', (payload, playerId) => {
      if (!this._gameActive || this._isPausedForRejoin) return;

      const instIndex = this._playerInstruments.get(playerId);
      if (instIndex === undefined) return;

      // 악기 소리 dynamic synthesis 재생
      this._playInstrumentSound(instIndex);

      // 판정 계산 (가장 가까운 액티브 노드를 탐색)
      const targetX = 130;
      let closestNote = null;
      let minDiff = 9999;

      this._notes.forEach(note => {
        if (note.lane === instIndex && !note.hit && !note.missed) {
          const diff = Math.abs(note.x - targetX);
          if (diff < minDiff) {
            minDiff = diff;
            closestNote = note;
          }
        }
      });

      // 판정 가이드 기준:
      // PERFECT: 오차 25 픽셀 이하 (~100ms 이내)
      // GOOD: 오차 55 픽셀 이하 (~200ms 이내)
      if (closestNote) {
        if (minDiff <= 25) {
          closestNote.hit = true;
          this._triggerJudge('perfect');
          this._spawnRipple(targetX, instIndex);
        } else if (minDiff <= 55) {
          closestNote.hit = true;
          this._triggerJudge('good');
          this._spawnRipple(targetX, instIndex);
        }
      }
    });
  }

  _spawnRipple(x, laneIndex) {
    const laneH = this._canvas.height / 3;
    const centerY = laneIndex * laneH + laneH / 2;
    const colors = ['#ff007f', '#ffd700', '#00f3ff'];

    // 2개의 퍼져나가는 고리 생성
    this._particles.push({
      x,
      y: centerY,
      vx: 0,
      vy: 0,
      radius: 30,
      alpha: 1.0,
      lineWidth: 4,
      color: colors[laneIndex]
    });
    this._particles.push({
      x,
      y: centerY,
      vx: 0,
      vy: 0,
      radius: 15,
      alpha: 0.8,
      lineWidth: 2,
      color: '#ffffff'
    });
  }

  _pauseGameForRejoin() {
    this._isPausedForRejoin = true;
    document.getElementById('stabilization-banner')?.classList.remove('hidden');
    if (this._isDemo) this._demoSimulator.stopDemo();
  }

  _resumeGameAfterRejoin() {
    this._isPausedForRejoin = false;
    document.getElementById('stabilization-banner')?.classList.add('hidden');
    if (this._isDemo) this._demoSimulator.startDemo();
  }

  _endGame() {
    this._gameActive = false;
    if (this._animationFrameId) cancelAnimationFrame(this._animationFrameId);

    // 등급 산출
    const totalHits = this._perfectCount + this._goodCount + this._missCount;
    const accuracy = totalHits > 0 ? ((this._perfectCount + this._goodCount) / totalHits) * 100 : 0;
    
    let grade = 'C';
    if (accuracy >= 92) grade = 'S';
    else if (accuracy >= 80) grade = 'A';
    else if (accuracy >= 65) grade = 'B';

    document.getElementById('result-score').textContent = this._score;
    document.getElementById('result-max-combo').textContent = this._maxCombo;
    document.getElementById('result-accuracy').textContent = `${Math.round(accuracy)}%`;
    
    const gradeEl = document.getElementById('result-grade');
    if (gradeEl) {
      gradeEl.textContent = grade;
      const gradeColors = { S: '#ffd700', A: '#00f3ff', B: '#ff007f', C: '#8b9bb4' };
      gradeEl.style.color = gradeColors[grade] || '#fff';
      document.querySelector('.rank-container').style.borderColor = gradeColors[grade] || '#fff';
    }

    this.broadcast('gameFinished', {
      score: this._score,
      maxCombo: this._maxCombo,
      grade
    });

    this.setPhase('result');
  }

  _renderRolesBoard() {
    const board = document.getElementById('roles-board');
    if (!board) return;

    board.innerHTML = '';
    const instNames = ['🎸 베이스 드럼', '🥁 스네어 드럼', '✨ 하이햇 심벌'];

    this._playerInstruments.forEach((instIdx, pid) => {
      const nickname = this._playerNicknames.get(pid) || 'Player';
      const card = document.createElement('div');
      card.className = 'player-card ready';
      card.innerHTML = `
        <div class="player-dot"></div>
        <div class="player-name">${nickname} (${instNames[instIdx]})</div>
      `;
      board.appendChild(card);
    });
  }
}

// SDK 엔트리 초기화
const sdk = new HostSDK({ gameId: 'rhythm-jam' });
new RhythmJamHost(sdk);
