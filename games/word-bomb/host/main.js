import { HostSDK } from '../../../platform/client/HostSDK.js';
import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { DemoSimulator } from './DemoSimulator.js';

const KEYWORDS = {
  all: ['김밥', '스마트폰', '제주도', '에펠탑', '안경', '지갑', '강아지', '피자', '노래방', '선풍기', '우주선', '컴퓨터', '영화관', '자전거', '피아노', '도서관', '삼겹살', '기린', '소방서', '우산'],
  food: ['피자', '치킨', '짜장면', '떡볶이', '김밥', '삼겹살', '라면', '햄버거', '초밥', '비빔밥', '김치찌개', '빙수', '삼계탕', '샌드위치', '와플', '갈비', '돈까스', '족발', '탕수육'],
  animal: ['호랑이', '사자', '토끼', '코끼리', '원숭이', '판다', '고양이', '강아지', '펭귄', '돌고래', '기린', '여우', '늑대', '하마', '악어', '다람쥐', '코알라', '치타', '얼룩말'],
  place: ['에펠탑', '제주도', '서울역', '학교', '놀이공원', '수영장', '박물관', '공항', '지하철', '소방서', '경찰서', '백화점', '우체국', '은행', '병원', '약국', '도서관', '카페']
};

class WordBombHost extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'dw-overlay', qrContainerId: 'qr-box' });

    this._activePlayerIndex = 0;
    this._playersList = []; // 순서가 보장되는 플레이어 ID 배열
    this._currentKeyword = '';
    this._passedWords = 0;
    
    this._bombTime = 0; // 남은 시간 (ms)
    this._totalDuration = 0; // 게임 시작 시 설정된 총 시간 (ms)
    this._isExploded = false;
    this._gameActive = false;

    this._audioCtx = null;
    this._category = 'all';
    this._lastTickTime = 0;
    this._lastBeepSec = 0;

    // 데모 시뮬레이터 인젝션
    this._demoSimulator = new DemoSimulator(this);

    this._setupUI();
    this._wireMessages();
  }

  async onSetup({ sessionId }) {
    this.setPhase('lobby');

    // 캔버스 드로잉 준비
    this._canvas = document.getElementById('bomb-canvas');
    if (this._canvas) {
      this._ctx = this._canvas.getContext('2d');
    }
  }

  _setupUI() {
    // 카테고리 변경 감지
    const catSelect = document.getElementById('category-select-box');
    if (catSelect) {
      catSelect.addEventListener('change', (e) => {
        this._category = e.target.value;
      });
    }

    // 데모 플레이 버튼 핸들러
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

    // 결과 화면에서 대기실 복귀
    const restartBtn = document.getElementById('btn-restart-result');
    if (restartBtn) {
      restartBtn.onclick = () => {
        this.resetSession();
      };
    }
  }

  // ─── 오디오 합성 비프음 ───
  _initAudio() {
    if (this._audioCtx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this._audioCtx = new AudioContextClass();
  }

  _playBeepSound(frequency = 600, duration = 0.08) {
    if (!this._audioCtx) return;
    if (this._audioCtx.state === 'suspended') {
      this._audioCtx.resume();
    }
    const ctx = this._audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  _playExplosionSound() {
    if (!this._audioCtx) return;
    const ctx = this._audioCtx;
    const bufferSize = ctx.sampleRate * 0.8;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // 화이트 노이즈 필터링 합성
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 0.8);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.78);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(ctx.currentTime);
  }

  // ─── 로비 및 참가자 제어 ───
  onPlayerJoin(player) {
    this._renderLobbyGrid();
  }

  onPlayerLeave(playerId) {
    this._renderLobbyGrid();
    
    // 게임 진행 도중 이탈 시 턴 매니징 예외 가드
    if (this._gameActive) {
      const idx = this._playersList.indexOf(playerId);
      if (idx !== -1) {
        this._playersList.splice(idx, 1);
        
        if (this._playersList.length < 2 && !this._isDemo) {
          // 남은 플레이어가 2명 미만이면 즉시 에러 폭파
          this._explode(true);
          return;
        }

        // 턴 인덱스 보정
        if (idx < this._activePlayerIndex) {
          this._activePlayerIndex--;
        } else if (idx === this._activePlayerIndex) {
          if (this._activePlayerIndex >= this._playersList.length) {
            this._activePlayerIndex = 0;
          }
        }
        
        this._pickNextKeyword();
        this._syncTurnToMobiles();
        this._renderCarousel();
      }
    }
  }

  onPlayerRejoin(player) {
    // 튕겼다 재접속 시 이전 악기 파트 복구 및 타임스탬프 싱크 전파
    if (this._gameActive) {
      this._syncTurnToMobiles();
      this._renderCarousel();
    }
  }

  onAllReady() {
    this._startGame();
  }

  onReset() {
    this._gameActive = false;
    this._isDemo = false;
    this._playersList = [];
    
    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) demoPlayBtn.textContent = '🤖 데모 시뮬레이터 가동';

    const catSelect = document.getElementById('category-select-box');
    if (catSelect) catSelect.disabled = false;

    // 화면 뒤흔들림 클래스 리셋
    const container = document.querySelector('.pp-host-container');
    container?.classList.remove('screen-shake');

    this.setPhase('lobby');
    this._renderLobbyGrid();
  }

  // ─── 게임 라이프사이클 ───
  _startGame() {
    this._initAudio();

    this._gameActive = true;
    this._isExploded = false;
    this._passedWords = 0;
    
    // 카테고리 HUD 설정
    const catSelect = document.getElementById('category-select-box');
    if (catSelect) catSelect.disabled = true;

    const catTitles = {
      all: '🌐 종합 제시어',
      food: '🍕 맛있는 음식',
      animal: '🦁 동물 나라',
      place: '✈️ 세계 여행 & 사물'
    };
    const hudCat = document.getElementById('hud-category-title');
    if (hudCat) hudCat.textContent = catTitles[this._category] || '종합';

    // 생존 플레이어 턴 정렬
    this._playersList = Array.from(this._playerNicknames.keys());
    this._activePlayerIndex = 0;

    // 랜덤 폭탄 타이머 도화선 초 결정 (30초 ~ 45초)
    // 단, 봇 테스트 및 플레이라이트 최적화를 위한 데모 모드는 10초로 속도 제한
    const baseSeconds = this._isDemo ? 10 : (Math.floor(Math.random() * 16) + 30);
    this._totalDuration = baseSeconds * 1000;
    this._bombTime = this._totalDuration;

    this._pickNextKeyword();

    // HUD 업데이트
    const passedVal = document.getElementById('hud-passed-count');
    if (passedVal) passedVal.textContent = '0';

    this.setPhase('playing');
    this._syncTurnToMobiles();
    this._renderCarousel();

    this._lastTickTime = performance.now();
    this._lastBeepSec = Math.ceil(this._bombTime / 1000);

    // 60fps 드로잉 렌더 루프 및 비프음 틱 스위치 개시
    requestAnimationFrame((t) => this._gameLoop(t));

    if (this._isDemo) {
      this._demoSimulator.onStart();
    }
  }

  _gameLoop(timestamp) {
    if (!this._gameActive || this._isExploded) return;

    const delta = timestamp - this._lastTickTime;
    this._lastTickTime = timestamp;

    this._bombTime -= delta;
    if (this._bombTime < 0) this._bombTime = 0;

    // 폭탄 캔버스 드로잉 수행
    this._drawBombCanvas();

    // 째깍 째깍 비프음 사운드 주기 연산
    const remainingSecFloat = this._bombTime / 1000;
    const currentSec = Math.ceil(remainingSecFloat);
    
    // 남은 시간 10초 미만(데드라인 가속) 시에는 0.5초마다 째깍 비프
    const isDeadline = remainingSecFloat <= 10;
    const beepInterval = isDeadline ? 0.5 : 1.0;

    const currentIntervalStep = Math.floor(this._bombTime / (beepInterval * 1000));
    if (this._lastIntervalStep === undefined) {
      this._lastIntervalStep = currentIntervalStep;
    }

    if (currentIntervalStep !== this._lastIntervalStep) {
      this._lastIntervalStep = currentIntervalStep;
      // 데드라인 가속 시 더 높은 톤의 비프음 경고
      const tone = isDeadline ? 850 : 500;
      this._playBeepSound(tone, isDeadline ? 0.05 : 0.08);
      
      const countdownEl = document.getElementById('timer-text');
      if (countdownEl) {
        countdownEl.textContent = isDeadline ? '🚨 빨리 넘기세요! 🚨' : '째깍.. 째깍..';
        countdownEl.style.color = isDeadline ? 'var(--neon-red)' : 'var(--neon-gold)';
      }
    }

    if (this._bombTime <= 0) {
      this._explode(false);
      return;
    }

    requestAnimationFrame((t) => this._gameLoop(t));
  }

  _pickNextKeyword() {
    const list = KEYWORDS[this._category] || KEYWORDS.all;
    let nextWord = list[Math.floor(Math.random() * list.length)];
    // 직전 단어와 중복 방지
    while (nextWord === this._currentKeyword && list.length > 1) {
      nextWord = list[Math.floor(Math.random() * list.length)];
    }
    this._currentKeyword = nextWord;
  }

  _syncTurnToMobiles() {
    const activePlayerId = this._playersList[this._activePlayerIndex];
    const activeNick = this._playerNicknames.get(activePlayerId) || 'Player';

    // 호스트 화면에 설명자 전광판 갱신
    const spotlightName = document.getElementById('active-describer-name');
    if (spotlightName) {
      spotlightName.textContent = activeNick;
    }

    // 모바일 전체에 비대칭 정보 전파
    this._playersList.forEach((pid) => {
      if (pid === activePlayerId) {
        this.sendToPlayer(pid, 'assignDescriber', {
          isActive: true,
          keyword: this._currentKeyword,
          passedCount: this._passedWords
        });
      } else {
        this.sendToPlayer(pid, 'assignDescriber', {
          isActive: false,
          activeNick: activeNick,
          passedCount: this._passedWords
        });
      }
    });
  }

  _explode(isForced = false) {
    this._isExploded = true;
    this._gameActive = false;

    // 화면 뒤흔들림 효과 적용
    const container = document.querySelector('.pp-host-container');
    container?.classList.add('screen-shake');

    // 폭사 오디오 합성 구동
    this._playExplosionSound();

    // 턴 보유 패배자 특정
    const loserId = this._playersList[this._activePlayerIndex];
    const loserNick = this._playerNicknames.get(loserId) || 'Unknown Player';

    const loserVal = document.getElementById('loser-name');
    if (loserVal) loserVal.textContent = isForced ? '인원 부족으로 패배!' : loserNick;

    const resultPassed = document.getElementById('result-passed-words');
    if (resultPassed) resultPassed.textContent = this._passedWords;

    const resultCat = document.getElementById('result-category');
    if (resultCat) {
      const catNames = { all: '종합', food: '음식', animal: '동물', place: '여행/사물' };
      resultCat.textContent = catNames[this._category] || '종합';
    }

    // 전체 모바일에 종료 전송
    this.broadcast('gameFinished', {
      loserId,
      loserNick: isForced ? '인원 부족' : loserNick,
      passedCount: this._passedWords
    });

    this.setPhase('result');
  }

  // ─── 메시지 수신 핸들러 ───
  _wireMessages() {
    this.onMessage('setProfile', (player, { nickname }) => {
      const name = nickname.trim() || '익명';
      this.setPlayerName(player.id, name);
      this._renderLobbyGrid();
    });

    this.onMessage('submitCorrect', (player) => {
      if (!this._gameActive || this._isExploded) return;

      const activePlayerId = this._playersList[this._activePlayerIndex];
      // 턴 당사자만 패스 요청 가능 (부정 탭 방지)
      if (player.id !== activePlayerId) return;

      this._passedWords++;
      const passedVal = document.getElementById('hud-passed-count');
      if (passedVal) passedVal.textContent = this._passedWords;

      // 차례 다음으로 패스
      this._activePlayerIndex = (this._activePlayerIndex + 1) % this._playersList.length;

      this._pickNextKeyword();
      this._syncTurnToMobiles();
      this._renderCarousel();

      // 시뮬레이터 차례 통지
      if (this._isDemo) {
        this._demoSimulator.onTurnChange();
      }
    });
  }

  // ─── 캔버스 2D 폭탄 렌더링 ───
  _drawBombCanvas() {
    if (!this._ctx || !this._canvas) return;
    const ctx = this._ctx;
    const w = this._canvas.width;
    const h = this._canvas.height;

    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2 + 20;
    const radius = 100;

    // 1. 도화선 곡선 그리기
    ctx.beginPath();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#8c603e';
    ctx.lineCap = 'round';
    
    // 도화선 잔여 시간 비율에 따른 끝점 계산
    const ratio = this._bombTime / this._totalDuration;
    const fuseStartAngle = -Math.PI / 2;
    const fuseEndAngle = fuseStartAngle - (Math.PI * 1.0 * ratio); // 타면서 오목해짐

    ctx.arc(cx, cy - radius + 10, 80, 0, fuseEndAngle, true);
    ctx.stroke();

    // 2. 도화선의 활활 타는 불꽃 파티클 (Spark)
    // 삼각함수로 도화선 끄트머리 좌표 도출
    const fuseEndX = cx + 80 * Math.cos(fuseEndAngle);
    const fuseEndY = (cy - radius + 10) + 80 * Math.sin(fuseEndAngle);

    const isDeadline = ratio <= 0.25;
    const sparkColor = isDeadline ? '#ff3333' : '#ffcc00';

    ctx.beginPath();
    ctx.fillStyle = sparkColor;
    ctx.shadowBlur = 30;
    ctx.shadowColor = sparkColor;
    ctx.arc(fuseEndX, fuseEndY, isDeadline ? 20 : 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; // 그림자 복구

    // 불꽃 스파크 삐죽삐죽 연출
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI / 4) * i + (performance.now() / 100);
      const len = isDeadline ? 35 : 22;
      ctx.beginPath();
      ctx.moveTo(fuseEndX, fuseEndY);
      ctx.lineTo(fuseEndX + len * Math.cos(angle), fuseEndY + len * Math.sin(angle));
      ctx.stroke();
    }

    // 3. 폭탄 주물 몸체
    ctx.beginPath();
    ctx.fillStyle = '#1c1f26';
    ctx.strokeStyle = isDeadline ? 'var(--neon-red)' : '#333742';
    ctx.lineWidth = 8;
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 4. 폭탄 머리 밸브 단추
    ctx.fillStyle = '#2d3340';
    ctx.fillRect(cx - 20, cy - radius - 15, 40, 20);

    // 5. 폭탄 하이라이트/반사광
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.arc(cx - 30, cy - 30, 45, 0, Math.PI * 2);
    ctx.fill();

    // 6. 경고 상태일 때 적색 사이렌 경보 링 겹겹이 렌더
    if (isDeadline) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 51, 51, ' + (0.3 + 0.3 * Math.sin(performance.now() / 100)) + ')';
      ctx.lineWidth = 12;
      ctx.arc(cx, cy, radius + 25, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ─── 화면 업데이트 ───
  _renderLobbyGrid() {
    const board = document.getElementById('roles-board');
    if (!board) return;

    board.innerHTML = '';
    this._playerNicknames.forEach((nickname, pid) => {
      const card = document.createElement('div');
      card.className = 'player-card ready';
      card.innerHTML = `
        <div class="player-dot"></div>
        <div class="player-name">${nickname}</div>
      `;
      board.appendChild(card);
    });
  }

  _renderCarousel() {
    const row = document.getElementById('playing-players-row');
    if (!row) return;

    row.innerHTML = '';
    const activePlayerId = this._playersList[this._activePlayerIndex];

    this._playersList.forEach((pid) => {
      const nickname = this._playerNicknames.get(pid) || 'Player';
      const card = document.createElement('div');
      card.className = `playing-player-card ${pid === activePlayerId ? 'active-turn' : ''}`;
      card.textContent = nickname;
      row.appendChild(card);
    });
  }
}

// SDK 초기화 및 호스트 기동
const sdk = new HostSDK({ gameId: 'word-bomb' });
new WordBombHost(sdk);
