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
    this._pauseStartTime = 0;
    
    // 곡 정보
    this._track = 'disco'; // 'disco' | 'lounge' | 'rave'
    this._bpm = 110;
    this._trackLength = 20; // seconds
    this._startTime = 0;
    this._elapsedTime = 0;
    
    this._notes = []; // 현재 화면상의 액티브 노드들 { id, targetTime, lane, x, hit, missed }
    this._noteIdCounter = 0;
    
    this._playerInstruments = new Map(); // playerId -> instrumentIndex (0: Bass, 1: Snare, 2: Hihat, 3: Clap)
    this.activeLanes = 3; // 기본 레인 수
    this._particles = []; // PERFECT 타격 시 뿜어져나오는 네온 리플 입자

    this._audioCtx = null;
    this._noiseBuffer = null; // 스네어/하이햇/클랩용 노이즈 버퍼 캐시
    
    this._demoSimulator = new RhythmJamDemoSimulator(this);
    this._isDemo = false;
    this._savedPlayersSnapshot = null; // 데모 시작 전 실제 사용자 스냅샷

    this._lastPlayerTapTimes = new Map(); // playerId -> lastTapTimeMs (과타 억제용)
    this._playerStats = new Map(); // playerId -> { perfect, good, overhit, total } (기여도 분석용)

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
          if (this.playerCount > 0) return;
          this._demoSimulator.startDemo();
          demoPlayBtn.textContent = '⏹️ 데모 중지';
        } else {
          this._demoSimulator.stopDemo();
        }
      };
    }

    const bannerStopBtn = document.getElementById('btn-stop-demo-banner');
    if (bannerStopBtn) {
      bannerStopBtn.onclick = () => {
        this.exitDemoMode();
      };
    }

    const restartBtn = document.getElementById('btn-restart-result');
    if (restartBtn) {
      restartBtn.onclick = () => this.resetSession();
    }
  }

  onPlayerJoin(player) {
    this._resetIdleTimer();

    // 데모 모드 도중 실제 사용자가 들어오면 즉시 데모 종료 후 실게임 로비 복원
    if (this._isDemo) {
      console.log('[Host] Human player joined during demo. Exiting demo mode.');
      this.exitDemoMode();
      
      // 새로 입장한 플레이어를 복원된 상태에 명시적으로 추가
      this.players.set(player.id, player);
      this.sdk._players.set(player.id, player);
      this._playerNicknames.set(player.id, player.nickname || 'Player');
      this.renderLobbyPlayers(this._playerNicknames);
      return;
    }

    this.renderLobbyPlayers(this._playerNicknames);
  }

  onPlayerDisconnect(playerId) {
    // 가상 봇의 이탈은 무시
    if (playerId.startsWith('bot_')) return;

    if (this._gameActive) {
      this._pauseGameForRejoin();
    }
  }

  onPlayerLeave(playerId) {
    this._playerInstruments.delete(playerId);
    this._lastPlayerTapTimes.delete(playerId);
    this._playerStats.delete(playerId);
    this.renderLobbyPlayers(this._playerNicknames);

    if (this._gameActive) {
      // 남아있는 사람이 없으면 HostBaseGame 규칙에 따라 resetSession() 등이 수행되지만
      // 인원 적응형 레인 시스템이므로, 진행 중인 경우 레인 갯수를 조정하거나 일시정지를 유지합니다.
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

      // 모든 플레이어가 재접속을 마쳤을 때만 게임을 재개함 (재연결 프리징 가드)
      if (this._disconnectedPlayers.size === 0) {
        this._resumeGameAfterRejoin();
      }
    } else {
      // 로비 재연결 프리징 가드: 모바일 클라이언트에 확실하게 lobbyState 전송
      this.sendToPlayer(player.id, 'lobbyState', { phase: 'lobby' });
    }
  }

  onAllReady() {
    this._startGame();
  }

  onReset() {
    // 데모 강제 정지
    this._isDemo = false;
    this._demoSimulator.stopDemo();
    this._savedPlayersSnapshot = null;

    this._gameActive = false;
    this._isPausedForRejoin = false;
    this._pauseStartTime = 0;
    if (this._animationFrameId) cancelAnimationFrame(this._animationFrameId);

    this._score = 0;
    this._combo = 0;
    this._maxCombo = 0;
    this._perfectCount = 0;
    this._goodCount = 0;
    this._missCount = 0;
    this._notes = [];
    this._particles = [];
    this._lastPlayerTapTimes.clear();
    this._playerStats.clear();

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) demoPlayBtn.textContent = '🤖 데모 플레이 실행';

    const trackSelect = document.getElementById('track-select-box');
    if (trackSelect) trackSelect.disabled = false;
    
    document.getElementById('demo-active-banner')?.classList.add('hidden');
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

  _playClapSound() {
    if (!this._audioCtx || !this._noiseBuffer) return;
    const ctx = this._audioCtx;
    if (ctx.state === 'suspended') ctx.resume();

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 3.0;

    const source = ctx.createBufferSource();
    source.buffer = this._noiseBuffer;
    const gain = ctx.createGain();
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.8, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
    
    const source2 = ctx.createBufferSource();
    source2.buffer = this._noiseBuffer;
    const gain2 = ctx.createGain();
    source2.connect(filter);
    filter.connect(gain2);
    gain2.connect(ctx.destination);
    gain2.gain.setValueAtTime(0.6, ctx.currentTime + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);

    source.start(ctx.currentTime);
    source.stop(ctx.currentTime + 0.06);
    source2.start(ctx.currentTime + 0.02);
    source2.stop(ctx.currentTime + 0.09);
  }

  _playInstrumentSound(instIndex) {
    if (instIndex === 0) this._playBassSound();
    else if (instIndex === 1) this._playSnareSound();
    else if (instIndex === 2) this._playHihatSound();
    else if (instIndex === 3) this._playClapSound();
  }

  // ─── Game Management ──────────────────────────────────────────────────────

  _startGame() {
    this._initAudio();

    this._gameActive = true;
    this._isPausedForRejoin = false;
    this._pauseStartTime = 0;
    this._score = 0;
    this._combo = 0;
    this._maxCombo = 0;
    this._perfectCount = 0;
    this._goodCount = 0;
    this._missCount = 0;
    this._notes = [];
    this._particles = [];
    this._lastPlayerTapTimes.clear();
    this._playerStats.clear();

    // 동적 activeLanes 설정 (데모인 경우 3개 레인 강제)
    this.activeLanes = this._isDemo ? 3 : Math.min(4, Math.max(1, this.playerCount));

    // 기여도 스탯 초기화
    if (!this._isDemo) {
      for (const pid of this.players.keys()) {
        this._playerStats.set(pid, { perfect: 0, good: 0, overhit: 0, total: 0 });
      }
    }

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
        if (b % 4 === 2 || b % 4 === 3) {
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
      const instIndex = idx % this.activeLanes; // activeLanes 개수로 순환 할당
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
          lane: note.lane % this.activeLanes, // activeLanes 에 맞춰 lane 매핑
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

  _triggerJudge(judge, playerId = null) {
    const stamp = document.getElementById('judge-stamp');
    const comboWrap = document.getElementById('combo-display');
    const comboCnt = document.getElementById('combo-count');

    if (!stamp || !comboWrap || !comboCnt) return;

    stamp.classList.remove('hidden', 'perfect', 'good', 'miss');
    void stamp.offsetWidth; // reflow

    // 기여도 데이터 기록
    if (playerId && !playerId.startsWith('bot_') && this._playerStats.has(playerId)) {
      const stats = this._playerStats.get(playerId);
      stats.total++;
      if (judge === 'perfect') stats.perfect++;
      else if (judge === 'good') stats.good++;
      else if (judge === 'overhit') stats.overhit++;
    }

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
    } else if (judge === 'overhit') {
      this._combo = 0;
      this._missCount++;
      this._score = Math.max(0, this._score - 30); // 과타 감점
      stamp.textContent = '과타!';
      stamp.classList.add('miss');

      // 과타 친 당사자에게만 missAlert(햅틱 진동) 송출
      if (playerId) {
        this.sendToPlayer(playerId, 'missAlert', {});
      }
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

    // 1. 컨베이어 벨트 트랙 그리기 (동적 레일)
    const laneH = h / this.activeLanes;
    const colors = ['#ff007f', '#ffd700', '#00f3ff', '#39ff14']; // Red, Yellow, Blue, Green
    const labels = ['BASS DRUM', 'SNARE DRUM', 'HI-HAT CYMBAL', 'HAND CLAP'];
    
    // 피버 무지개 트랙 그라데이션 여부
    const isFever = this._combo >= 10;

    for (let i = 0; i < this.activeLanes; i++) {
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
      ctx.strokeStyle = colors[i] || '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(130, centerY, 32, 0, Math.PI * 2);
      ctx.stroke();

      // 판정선 후광 효과
      ctx.fillStyle = isFever ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)';
      ctx.beginPath();
      ctx.arc(130, centerY, 30, 0, Math.PI * 2);
      ctx.fill();

      // 라벨 표기
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = 'bold 12px Outfit';
      ctx.fillText(labels[i] || 'SUB PERCUSSION', 20, centerY - (laneH * 0.35));
    }

    // 2. 리듬 노드 렌더링
    this._notes.forEach(note => {
      if (note.hit) return; // 이미 친 노드는 안 그림

      const centerY = note.lane * laneH + laneH / 2;
      const color = colors[note.lane] || '#fff';
      ctx.fillStyle = color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = color;

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
    this.onMessage('setProfile', (player, { nickname }) => {
      const name = nickname.trim() || '익명';
      this.setPlayerName(player.id, name);
      this.renderLobbyPlayers(this._playerNicknames);
    });

    // 플레이어 탭 노트 입력 처리
    this.onMessage('tapNote', (player, payload) => {
      if (!this._gameActive || this._isPausedForRejoin) return;

      const playerId = player.id;
      const instIndex = this._playerInstruments.get(playerId);
      if (instIndex === undefined) return;

      const now = performance.now();
      const lastTap = this._lastPlayerTapTimes.get(playerId) || 0;

      // 과타 방지 쿨다운 가드 (150ms)
      if (now - lastTap < 150) {
        return;
      }
      this._lastPlayerTapTimes.set(playerId, now);

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
      // PERFECT: 오차 25 픽셀 이하
      // GOOD: 오차 55 픽셀 이하
      // 그 이상 혹은 대상 노트 없으면 OVERHIT(과타)
      if (closestNote && minDiff <= 55) {
        closestNote.hit = true;
        const judge = minDiff <= 25 ? 'perfect' : 'good';
        this._triggerJudge(judge, playerId);
        this._spawnRipple(targetX, instIndex);
        this.sendToPlayer(playerId, 'tapResult', { judge });
      } else {
        // 과타(오버히트) 판정
        this._triggerJudge('overhit', playerId);
        this.sendToPlayer(playerId, 'tapResult', { judge: 'overhit' });
      }
    });
  }

  _spawnRipple(x, laneIndex) {
    const laneH = this._canvas.height / this.activeLanes;
    const centerY = laneIndex * laneH + laneH / 2;
    const colors = ['#ff007f', '#ffd700', '#00f3ff', '#39ff14'];

    this._particles.push({
      x,
      y: centerY,
      vx: 0,
      vy: 0,
      radius: 30,
      alpha: 1.0,
      lineWidth: 4,
      color: colors[laneIndex] || '#ffffff'
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
    this._pauseStartTime = performance.now();
    document.getElementById('stabilization-banner')?.classList.remove('hidden');
    if (this._isDemo) this._demoSimulator.stopDemo();
  }

  _resumeGameAfterRejoin() {
    this._isPausedForRejoin = false;
    if (this._pauseStartTime) {
      const pauseDuration = performance.now() - this._pauseStartTime;
      this._startTime += pauseDuration;
      this._pauseStartTime = 0;
    }
    document.getElementById('stabilization-banner')?.classList.add('hidden');
    if (this._isDemo) this._demoSimulator.startDemo();
  }

  // ─── 데모 시뮬레이션 공개 API ───

  enterDemoMode() {
    this._isDemo = true;

    // 1. 실제 사용자 목록 스냅샷 저장
    this._savedPlayersSnapshot = {
      players: new Map(this.players),
      sdkPlayers: new Map(this.sdk._players),
      nicknames: new Map(this._playerNicknames),
      instruments: new Map(this._playerInstruments)
    };

    // 2. 가상 봇 생성
    const bots = [
      { id: 'bot_bass', nickname: '🤖 리듬 천재 (Bass)', color: '#ff007f' },
      { id: 'bot_snare', nickname: '🤖 비트 매니아 (Snare)', color: '#ffd700' },
      { id: 'bot_hihat', nickname: '🤖 드럼 마스터 (Hi-hat)', color: '#00f3ff' }
    ];

    this.players.clear();
    this.sdk._players.clear();
    this._playerNicknames.clear();
    this._playerInstruments.clear();

    bots.forEach((b, idx) => {
      this._playerNicknames.set(b.id, b.nickname);
      this.players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
      this.sdk._players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
      this._playerInstruments.set(b.id, idx);
    });

    const banner = document.getElementById('demo-active-banner');
    if (banner) banner.classList.remove('hidden');

    this._startGame();
  }

  exitDemoMode() {
    this._isDemo = false;
    this._demoSimulator.stopDemo();

    // 1. 봇 정리
    this.players.clear();
    this.sdk._players.clear();
    this._playerNicknames.clear();
    this._playerInstruments.clear();

    // 2. 실제 사용자 스냅샷 복구
    if (this._savedPlayersSnapshot) {
      this._savedPlayersSnapshot.players.forEach((p, id) => this.players.set(id, p));
      this._savedPlayersSnapshot.sdkPlayers.forEach((p, id) => this.sdk._players.set(id, p));
      this._savedPlayersSnapshot.nicknames.forEach((n, id) => this._playerNicknames.set(id, n));
      this._savedPlayersSnapshot.instruments.forEach((inst, id) => this._playerInstruments.set(id, inst));
      this._savedPlayersSnapshot = null;
    }

    const banner = document.getElementById('demo-active-banner');
    if (banner) banner.classList.add('hidden');

    this.onReset();
  }

  simulateTapNote(botId) {
    if (!this._gameActive || this._isPausedForRejoin) return;

    const instIndex = this._playerInstruments.get(botId);
    if (instIndex === undefined) return;

    this._playInstrumentSound(instIndex);

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

    // 플레이어별 기여도 순위 산정 및 렌더링
    const contribsContainer = document.getElementById('result-contributions');
    if (contribsContainer) {
      contribsContainer.innerHTML = '';
      
      const statsList = Array.from(this._playerStats.entries()).map(([pid, stat]) => {
        const total = stat.total;
        const hitAcc = total > 0 ? ((stat.perfect + stat.good) / total) * 100 : 0;
        
        // 기여도 배지 산정
        let badge = '협동 연주원';
        if (stat.perfect > 0 && stat.perfect >= stat.good * 2) badge = '🔥 피버 메이커';
        else if (stat.overhit > 5) badge = '🥁 과타 대왕';
        else if (hitAcc >= 90) badge = '🎯 정밀의 신';

        return {
          id: pid,
          nickname: this._playerNicknames.get(pid) || 'Player',
          badge,
          accuracy: Math.round(hitAcc),
          perfect: stat.perfect,
          good: stat.good,
          overhit: stat.overhit
        };
      });

      // 정확도 기준 정렬
      statsList.sort((a, b) => b.accuracy - a.accuracy);

      statsList.forEach(item => {
        const card = document.createElement('div');
        card.className = 'contrib-card';
        card.innerHTML = `
          <div class="contrib-info">
            <span class="contrib-name">${item.nickname}</span>
            <span class="contrib-badge">${item.badge}</span>
          </div>
          <div class="contrib-stats">
            정확도: <span class="contrib-accuracy">${item.accuracy}%</span><br>
            <small>대박:${item.perfect} 나이스:${item.good} 과타:${item.overhit}</small>
          </div>
        `;
        contribsContainer.appendChild(card);
      });
    }

    this.broadcast('gameFinished', {
      score: this._score,
      maxCombo: this._maxCombo,
      grade,
      playerStats: Array.from(this._playerStats.entries()).map(([pid, stat]) => {
        const total = stat.total;
        const hitAcc = total > 0 ? ((stat.perfect + stat.good) / total) * 100 : 0;
        return {
          id: pid,
          nickname: this._playerNicknames.get(pid) || 'Player',
          accuracy: Math.round(hitAcc)
        };
      })
    });

    this.setPhase('result');
  }

  _renderRolesBoard() {
    const board = document.getElementById('roles-board');
    if (!board) return;

    board.innerHTML = '';
    const instNames = ['🎸 베이스 드럼', '🥁 스네어 드럼', '✨ 하이햇 심벌', '👏 박수/클랩'];

    this._playerInstruments.forEach((instIdx, pid) => {
      const nickname = this._playerNicknames.get(pid) || 'Player';
      const card = document.createElement('div');
      card.className = 'player-card ready';
      card.innerHTML = `
        <div class="player-dot"></div>
        <div class="player-name">${nickname} (${instNames[instIdx] || '👏 박수/클랩'})</div>
      `;
      board.appendChild(card);
    });
  }
}

// SDK 엔트리 초기화
const sdk = new HostSDK({ gameId: 'rhythm-jam' });
new RhythmJamHost(sdk);
