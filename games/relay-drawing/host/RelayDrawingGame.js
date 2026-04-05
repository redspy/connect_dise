import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { audioManager } from '../shared/AudioManager.js';

const STARTER_PROMPTS = [
  // 원본
  '로봇 청소기를 타는 고양이', '치킨을 훔쳐먹는 외계인', '번지점프를 하는 코끼리',
  '바나나 보트를 타는 펭귄', '선글라스를 낀 문어', '피자 도우를 돌리는 마법사',
  '스케이트보드를 타는 공룡', '라면을 먹는 좀비', '나이트클럽에 온 할머니',
  '우주복을 입은 강아지', '택배를 배달하는 호랑이', '요가하는 북극곰',

  // 동물 + 엉뚱한 상황
  '자전거를 타는 기린', '면접을 보는 악어', '피아노를 치는 고릴라',
  '쇼핑카트를 미는 하마', '셀카를 찍는 원숭이', '수영장에서 튜브를 낀 상어',
  '등산하는 달팽이', '커피를 마시는 낙타', '낚시하는 독수리',
  '지하철을 타는 기린', '택시를 운전하는 코뿔소', '롤러코스터를 타는 거북이',
  '마라톤 대회에 나온 나무늘보', '줄넘기를 하는 하마', '드라이어로 머리를 하는 사자',
  '칫솔로 이를 닦는 악어', '도서관에서 책 읽는 판다', '노래방에서 부르는 앵무새',
  '요리하는 너구리', '설거지하는 두더지', '빨래를 너는 펠리컨',
  '스마트폰을 보는 침팬지', '웹서핑 중인 돌고래', '유튜브를 보는 코알라',
  '유모차를 미는 캥거루', '민트초코를 먹는 강아지', '아이스크림을 먹는 북극곰',

  // 사람 + 엉뚱한 상황
  '잠옷 차림으로 회의하는 직장인', '우주에서 치킨 먹는 우주인',
  '왕관을 쓰고 편의점 가는 왕', '드래곤을 산책시키는 아이',
  '용을 타고 출근하는 회사원', '마법 빗자루로 청소하는 마녀',
  '투명 인간이 셀카 찍기', '순간이동으로 지각하는 학생',
  '슈퍼히어로 옷 입고 장 보는 아저씨', '잠수함으로 출퇴근하는 직장인',
  '해적이 치킨 배달하는 장면', '기사가 자동문 앞에서 당황하는 장면',
  '닌자가 놀이동산에서 즐기는 장면', '인어가 엘리베이터 타는 장면',
  '공주가 버스 타는 장면', '외계인이 편의점 알바하는 장면',

  // 음식 + 유머
  '치킨을 구해달라는 현수막을 든 치킨', '피자가 피자를 주문하는 장면',
  '햄버거를 먹는 햄버거', '라면이 라면을 끓이는 장면',
  '아이스크림이 선풍기 앞에서 우는 장면', '떡볶이가 매운 거 먹고 물 마시는 장면',
  '짜장면이 배달 온 피자를 먹는 장면', '초밥이 회전초밥집에서 회전하는 장면',

  // 탈것 + 엉뚱한 상황
  'UFO로 드라이브 스루 하는 장면', '잠수함이 하늘을 나는 장면',
  '로켓을 타고 택시 부르는 장면', '공중에 뜬 배에서 낚시하는 장면',
  '스포츠카를 몰고 등산하는 장면', '말이 오토바이를 타는 장면',
  '드래곤이 KTX 옆을 달리는 장면', '타조가 택시로 쓰이는 장면',

  // 일상 + 판타지 믹스
  '드래곤이 빨래를 불로 말리는 장면', '유니콘이 편의점에서 알바하는 장면',
  '트롤이 미용실에서 머리 하는 장면', '요정이 빌딩 청소부로 일하는 장면',
  '해골이 웨딩 사진 찍는 장면', '좀비가 건강식 먹는 장면',
  '투명 인간이 보디빌더 대회 나가는 장면', '마법사가 전자레인지를 쓰는 장면',
  '소환사가 무적권을 소환하는 장면', '마녀가 스마트폰 지도 쓰는 장면',

  // 계절·날씨 상황
  '폭풍우 속에서 우산 쓰는 개미', '눈 위에서 서핑하는 순록',
  '태풍 속에서 바비큐 굽는 장면', '맑은 날 우비 입고 소풍 가는 장면',
  '사막에서 스키 타는 낙타', '북극에서 수박 먹는 북극곰',
  '폭염에서 담요 덮고 자는 장면', '눈보라 속 하와이 옷 입은 강아지',

  // 직업 + 동물
  '의사가 된 문어', '판사가 된 부엉이', '소방관이 된 코뿔소',
  '헤어디자이너 고양이', '경호원 치와와', '트레이너 도마뱀',
  '도서관 사서 부엉이', '건축가 비버', '패션 모델 기린',
  '탐정 너구리', '해녀 북극곰', '아이돌 오리',

  // 스포츠
  '복싱하는 캥거루', '펜싱하는 사마귀', '체조하는 문어',
  '농구하는 기린', '수영하는 낙타', '볼링하는 고슴도치',
  '태권도하는 팬더', '축구하는 펭귄', '야구하는 원숭이',

  // 기타 엉뚱한 조합
  '이케아 가구 조립하는 외계인', '택배 박스 안에서 자는 고양이',
  '엘리베이터 안에서 춤추다 들킨 장면', '화장실 슬리퍼로 수영하는 장면',
  '냉장고 문 열고 멍때리는 장면', '버블랩 다 터뜨린 사람 표정',
  '잠결에 허공에 답장 보내는 장면', '거울 앞에서 자기소개 연습하는 장면',
  '벽에 귀 대고 옆집 소리 듣는 장면', '비 오는데 커튼 바람에 날리는 장면',
];

export class RelayDrawingGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'rd-overlay', qrContainerId: null });

    this._profiles        = new Map(); // id → { nickname, avatar }
    this._storyChains     = [];
    this._currentRound    = 0;
    this._totalRounds     = 0;
    this._timeLimitDraw   = 0;
    this._timeLimitText   = 0;
    this._timerInterval   = null;
    this._forceEndTimeout = null;
    this._readyPlayers    = new Set(); // 준비 완료한 플레이어 ID
    this._currentStoryIndex = 0;
    this._presentationTimeouts = [];

    this._wireGameMessages();
  }

  // ─── HostBaseGame 훅 ─────────────────────────────────────────────────────

  async onSetup() {
    if (this._lobbyEl) {
      this._lobbyEl.onStart = () => { if (this.playerCount >= 2) this._startGame(); };
    }

    const nextStoryBtn = document.getElementById('nextStoryBtn');
    if (nextStoryBtn) {
      nextStoryBtn.onclick = () => this._presentNextStory();
    }

    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) {
      restartBtn.onclick = () => this.resetSession();
    }

    this.setPhase('lobby');
    audioManager.playBGM('https://actions.google.com/static/audio/test/Lobby-Time.mp3');
  }

  onPlayerJoin() {
    this._updateLobbyPlayers();
  }

  onPlayerRejoin(player) {
    if (this.phase === 'game') {
      const p = this.players.get(player.id);
      if (p?._hasSubmitted) {
        this.sendToPlayer(player.id, 'roundSubmitted', {});
        return;
      }
      const chain = this._storyChains.find(c => c.currentHolderId === player.id);
      if (!chain) return;
      const isDrawTurn = (this._currentRound % 2 !== 0);
      const lastStep   = chain.steps[chain.steps.length - 1];
      this.sendToPlayer(player.id, 'rejoinState', {
        phase: 'game',
        assignment: {
          turnType:  this._currentRound === 1 ? 'draw' : (isDrawTurn ? 'draw' : 'word'),
          timeLimit: isDrawTurn ? this._timeLimitDraw : this._timeLimitText,
          content:   this._currentRound === 1 ? chain.initialPrompt : lastStep?.content ?? '',
        },
      });
    } else if (this.phase === 'result' || this.phase === 'final') {
      this.sendToPlayer(player.id, 'showResults', {});
    }
  }

  onPlayerLeave(playerId) {
    this._profiles.delete(playerId);
    this._updateLobbyPlayers();
  }

  onReadyUpdate({ readyCount }) {
    this.updateLobbyReady(readyCount);
  }

  onAllReady() {
    this.updateLobbyReady(this.playerCount);
  }

  onReset() {
    this._profiles.clear();
    this._storyChains = [];
    this._currentRound = 0;
    this._readyPlayers.clear();
    clearInterval(this._timerInterval);
    clearTimeout(this._forceEndTimeout);
    this._forceEndTimeout = null;
    this._updateLobbyPlayers();
    this.updateLobbyReady(0);
    this.setPhase('lobby');
  }

  // ─── 메시지 핸들러 ────────────────────────────────────────────────────────

  _wireGameMessages() {
    this.onMessage('setProfile', (player, { nickname, avatar }) => {
      const name = nickname.trim() || '익명';
      this._profiles.set(player.id, { nickname: name, avatar: avatar || null });
      this.setPlayerName(player.id, name);
      this._updateLobbyPlayers();
      this._broadcastPlayerList();
    });

    this.onMessage('playerReady', (player) => {
      this._readyPlayers.add(player.id);
      this._broadcastPlayerList();
    });

    this.onMessage('submitTurn', (player, payload) => {
      if (this.phase !== 'game') return;
      this._handlePlayerSubmission(player.id, payload);
    });

    this.onMessage('sendReaction', (player, { emoji }) => {
      if (this.phase === 'result') {
        this._showReaction(emoji);
        audioManager.playSFX('https://actions.google.com/static/audio/test/Pop.mp3', 0.5);
      }
    });
  }

  // ─── 로비 UI ─────────────────────────────────────────────────────────────

  _updateLobbyPlayers() {
    this.renderLobbyPlayers(this._profiles);
  }

  _broadcastPlayerList() {
    const players = [];
    this.players.forEach(p => {
      players.push({
        id:       p.id,
        color:    p.color,
        nickname: this._profiles.get(p.id)?.nickname ?? '익명',
        ready:    this._readyPlayers.has(p.id),
      });
    });
    this.broadcast('playerListUpdated', { players });
  }

  _broadcastSubmissionStatus() {
    const players = [];
    this.players.forEach(p => {
      players.push({
        id:        p.id,
        color:     p.color,
        nickname:  this._profiles.get(p.id)?.nickname ?? '익명',
        submitted: p._hasSubmitted ?? false,
      });
    });
    this.broadcast('submissionStatus', { players });
  }

  // ─── 게임 흐름 ────────────────────────────────────────────────────────────

  _startGame() {
    this._setupRoundParameters();
    this._initializeStoryChains();
    this.broadcast('gameStarting', {});
    audioManager.playSFX('https://actions.google.com/static/audio/test/3-sec-countdown.mp3');

    this.setPhase('intro');
    let count = 3;
    const countEl = document.getElementById('introCountdown');
    if (countEl) countEl.textContent = count;

    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        if (countEl) countEl.textContent = count;
      } else {
        clearInterval(interval);
        this._startRound(1);
      }
    }, 1000);
  }

  _setupRoundParameters() {
    const rCountVal = document.getElementById('roundCount')?.value;
    if (rCountVal === 'auto') {
      this._totalRounds = this.playerCount;
    } else {
      this._totalRounds = Math.min(parseInt(rCountVal, 10), this.playerCount);
    }
    this._timeLimitDraw = parseInt(document.getElementById('timeLimit')?.value || '0', 10);
    this._timeLimitText = this._timeLimitDraw > 0 ? Math.max(15, Math.floor(this._timeLimitDraw / 2)) : 0;
  }

  _initializeStoryChains() {
    this._storyChains = [];
    const playerArray = Array.from(this.players.values());
    const prompts = [...STARTER_PROMPTS].sort(() => Math.random() - 0.5);

    playerArray.forEach((p, i) => {
      this._storyChains.push({
        originalAuthorId: p.id,
        currentHolderId:  p.id,
        initialPrompt:    prompts[i % prompts.length],
        steps:            [],
      });
    });
  }

  _startRound(roundNumber) {
    this._currentRound = roundNumber;
    const turnEl = document.getElementById('currentTurnDisplay');
    if (turnEl) turnEl.textContent = roundNumber;

    this.setPhase('game');

    const isDrawTurn = (roundNumber % 2 !== 0); // 홀수: 그림, 짝수: 단어
    const timeLimit  = isDrawTurn ? this._timeLimitDraw : this._timeLimitText;

    this._setupGameStatusGrid(isDrawTurn);

    // 플레이어별 개별 할당 생성
    const assignments = {};
    this._storyChains.forEach(chain => {
      const lastStep = chain.steps[chain.steps.length - 1];
      assignments[chain.currentHolderId] = {
        turnType: roundNumber === 1 ? 'draw' : (isDrawTurn ? 'draw' : 'word'),
        timeLimit,
        content: roundNumber === 1 ? chain.initialPrompt : lastStep.content,
      };
    });

    // 제출 상태 초기화
    this.players.forEach(p => { p._hasSubmitted = false; });

    this.broadcast('roundAssignments', { assignments, timeLimit });
    this._startRoundTimer(timeLimit);
    
    if (roundNumber === 1) {
      audioManager.playBGM('https://actions.google.com/static/audio/test/Game-Start.mp3');
    }
    audioManager.playSFX('https://actions.google.com/static/audio/test/Tones_2.mp3');
  }

  _setupGameStatusGrid(isDrawTurn) {
    const grid = document.getElementById('statusGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const icon       = isDrawTurn ? '🎨' : '✍️';
    const actionText = isDrawTurn ? '그림 그리는 중...' : '단어 작성 중...';

    this.players.forEach(p => {
      const card = document.createElement('div');
      card.className = 'status-card';
      card.id = `status-${p.id}`;
      card.innerHTML = `
        <span class="status-icon" id="icon-${p.id}">${icon}</span>
        <div class="name">${this._profiles.get(p.id)?.nickname ?? '?'}</div>
        <div class="action-text" id="action-${p.id}">${actionText}</div>
      `;
      grid.appendChild(card);
    });
  }

  _startRoundTimer(seconds) {
    clearInterval(this._timerInterval);
    const clockEl = document.getElementById('gameClock');
    const hurryEl = document.getElementById('hurryText');

    if (seconds <= 0) {
      if (clockEl) { clockEl.textContent = '∞'; clockEl.classList.remove('warning'); }
      if (hurryEl) hurryEl.classList.add('hidden');
      return; // 무제한 — 모든 플레이어 제출 시까지 대기
    }

    let timeLeft = seconds;
    if (clockEl) { clockEl.textContent = timeLeft; clockEl.classList.remove('warning'); }
    if (hurryEl) hurryEl.classList.add('hidden');

    this._timerInterval = setInterval(() => {
      timeLeft--;
      if (clockEl) clockEl.textContent = timeLeft;
      if (timeLeft === 10) {
        if (clockEl) clockEl.classList.add('warning');
        if (hurryEl) hurryEl.classList.remove('hidden');
        audioManager.playSFX('https://actions.google.com/static/audio/test/Clock-Ticking.mp3');
      }
      if (timeLeft <= 0) {
        clearInterval(this._timerInterval);
        this._forceEndRound();
      }
    }, 1000);
  }

  _handlePlayerSubmission(playerId, payload) {
    const p = this.players.get(playerId);
    if (!p || p._hasSubmitted) return; // Guard: Only one submission per round

    const chain = this._storyChains.find(c => c.currentHolderId === playerId);
    if (!chain) return;

    chain.steps.push({
      type:        payload.type,
      content:     payload.content,
      authorId:    playerId,
      roundNumber: this._currentRound,
    });

    p._hasSubmitted = true;
    this._updatePlayerStatusCard(playerId, true);
    this._broadcastSubmissionStatus();

    this._checkTurnCompletion();
  }

  _updatePlayerStatusCard(playerId, isDone) {
    const card     = document.getElementById(`status-${playerId}`);
    const iconEl   = document.getElementById(`icon-${playerId}`);
    const actionEl = document.getElementById(`action-${playerId}`);
    if (!card) return;
    if (isDone) {
      card.classList.add('done');
      if (iconEl)   iconEl.textContent   = '✅';
      if (actionEl) actionEl.textContent = '제출 완료!';
    }
  }

  _checkTurnCompletion() {
    let allDone = true;
    this.players.forEach(p => { if (!p._hasSubmitted) allDone = false; });
    if (allDone) {
      clearInterval(this._timerInterval);
      // forceEndRound의 fallback timeout이 남아있으면 취소
      if (this._forceEndTimeout) {
        clearTimeout(this._forceEndTimeout);
        this._forceEndTimeout = null;
      }
      this._finishRound();
    }
  }

  _forceEndRound() {
    const isDrawTurn = (this._currentRound % 2 !== 0);
    // 모바일에 지금까지 입력한 내용 즉시 제출 요청
    this.broadcast('forceSubmit', { type: isDrawTurn ? 'draw' : 'word' });
    // 1.5초 후 네트워크 지연 등으로 미제출된 플레이어에게만 빈 내용으로 fallback
    this._forceEndTimeout = setTimeout(() => {
      this._forceEndTimeout = null;
      this._storyChains.forEach(chain => {
        const p = this.players.get(chain.currentHolderId);
        if (p && !p._hasSubmitted) {
          chain.steps.push({
            type:        isDrawTurn ? 'draw' : 'word',
            content:     isDrawTurn ? this._createBlankCanvas() : '',
            authorId:    p.id,
            roundNumber: this._currentRound,
          });
          p._hasSubmitted = true;
          this._updatePlayerStatusCard(p.id, true);
        }
      });
      this._finishRound();
    }, 1500);
  }

  _createBlankCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 300;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, 400, 300);
    return canvas.toDataURL();
  }

  _finishRound() {
    if (this._currentRound >= this._totalRounds) {
      audioManager.playSFX('https://actions.google.com/static/audio/test/Celebration-Fanfare.mp3');
      setTimeout(() => this._startResultPresentation(), 1500);
    } else {
      this._rotateStoryChains();
      setTimeout(() => this._startRound(this._currentRound + 1), 2000);
    }
  }

  _rotateStoryChains() {
    const playerArray = Array.from(this.players.keys());
    const holdingMap  = {};
    for (let i = 0; i < this._storyChains.length; i++) {
      const pIndex = playerArray.indexOf(this._storyChains[i].currentHolderId);
      holdingMap[i] = playerArray[(pIndex + 1) % playerArray.length];
    }
    for (let i = 0; i < this._storyChains.length; i++) {
      this._storyChains[i].currentHolderId = holdingMap[i];
    }
  }

  // ─── 결과 발표 ────────────────────────────────────────────────────────────

  _startResultPresentation() {
    this._clearPresentationTimeouts();
    this.setPhase('result');
    audioManager.playBGM('https://actions.google.com/static/audio/test/Story-Presentation.mp3');
    this.broadcast('showResults', {});
    this._currentStoryIndex = 0;
    this._presentNextStory();
  }

  _presentNextStory() {
    if (this._currentStoryIndex >= this._storyChains.length) {
      this.setPhase('final');
      return;
    }

    const chain = this._storyChains[this._currentStoryIndex];

      `${this._profiles.get(chain.originalAuthorId)?.nickname ?? '?'}의 이야기`;

    this._clearPresentationTimeouts(); 
    const stepsEl = document.getElementById('storySteps');
    if (stepsEl) stepsEl.innerHTML = '';

    this._addStoryStep({ type: 'word', content: chain.initialPrompt, authorId: 'system' }, '시작 단어');

    const nextBtn = document.getElementById('nextStoryBtn');
    if (nextBtn) nextBtn.disabled = true;

    let delay = 1000;
    chain.steps.forEach(step => {
      const profile = this._profiles.get(step.authorId);
      const authorName = profile?.nickname ?? '?';
      const authorAvatar = profile?.avatar;
      const t = setTimeout(() => this._addStoryStep(step, authorName, authorAvatar), delay);
      this._presentationTimeouts.push(t);
      delay += 2500;
    });

    const finalT = setTimeout(() => {
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.textContent = this._currentStoryIndex === this._storyChains.length - 1
          ? '결과 마치기'
          : '다음 이야기 보기';
      }
      this._currentStoryIndex++;
    }, delay);
    this._presentationTimeouts.push(finalT);
  }

  _clearPresentationTimeouts() {
    this._presentationTimeouts.forEach(t => clearTimeout(t));
    this._presentationTimeouts = [];
  }

  _addStoryStep(step, authorName, authorAvatar) {
    const el = document.createElement('div');
    el.className = `story-item ${step.type}`;

    const authorEl = document.createElement('div');
    authorEl.className = 'author';
    
    let avatarHtml = '';
    if (authorAvatar) {
      avatarHtml = `<img src="${authorAvatar}" class="author-avatar">`;
    } else if (step.authorId !== 'system') {
      avatarHtml = `<div class="author-avatar-placeholder"></div>`;
    }

    authorEl.innerHTML = `
      ${avatarHtml}
      <span>${step.authorId === 'system' ? '시작 단어' : `${authorName}의 ${step.type === 'word' ? '단어' : '그림'}`}</span>
    `;
    el.appendChild(authorEl);

    if (step.type === 'word') {
      const h3 = document.createElement('h3');
      h3.textContent = step.content;
      el.appendChild(h3);
    } else {
      const img = document.createElement('img');
      img.src = step.content;
      el.appendChild(img);
    }

    const container = document.getElementById('storySteps');
    if (container) {
      container.appendChild(el);
      // 부드러운 스크롤 추적
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
    
    setTimeout(() => {
      el.classList.add('visible');
      audioManager.playSFX('https://actions.google.com/static/audio/test/Slide-In.mp3', 0.3);
    }, 50);
  }

  _showReaction(emoji) {
    const overlay = document.getElementById('reactionOverlay');
    if (!overlay) return;
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emoji;
    el.style.left = `${Math.random() * 80 + 10}%`;
    overlay.appendChild(el);
    setTimeout(() => el.parentNode?.removeChild(el), 3000);
  }
}
