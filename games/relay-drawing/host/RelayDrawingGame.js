import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { audioManager } from '../shared/AudioManager.js';

const STARTER_PROMPTS = [
  '로봇 청소기를 타는 고양이', '치킨을 훔쳐먹는 외계인', '번지점프를 하는 코끼리',
  '바나나 보트를 타는 펭귄', '선글라스를 낀 문어', '피자 도우를 돌리는 마법사',
  '스케이트보드를 타는 공룡', '라면을 먹는 좀비', '나이트클럽에 온 할머니',
  '우주복을 입은 강아지', '택배를 배달하는 호랑이', '요가하는 북극곰',
];

export class RelayDrawingGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'rd-overlay', qrContainerId: null });

    this._profiles        = new Map(); // id → { nickname, avatar }
    this._storyChains     = [];
    this._currentRound    = 0;
    this._totalRounds     = 0;
    this._timeLimitDraw   = 60;
    this._timeLimitText   = 30;
    this._timerInterval   = null;
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
    clearInterval(this._timerInterval);
    this._updateLobbyPlayers();
    this.updateLobbyReady(0);
    this.setPhase('lobby');
  }

  // ─── 메시지 핸들러 ────────────────────────────────────────────────────────

  _wireGameMessages() {
    this.onMessage('setProfile', (player, { nickname, avatar }) => {
      this._profiles.set(player.id, {
        nickname: nickname.trim() || '익명',
        avatar: avatar || null
      });
      this._updateLobbyPlayers();
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
      players.push({ id: p.id, color: p.color, nickname: this._profiles.get(p.id)?.nickname ?? '익명' });
    });
    this.broadcast('playerListUpdated', { players });
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
    this._timeLimitDraw = parseInt(document.getElementById('timeLimit')?.value || '60', 10);
    this._timeLimitText = Math.max(15, Math.floor(this._timeLimitDraw / 2));
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
    let timeLeft = seconds;
    const clockEl = document.getElementById('gameClock');
    const hurryEl = document.getElementById('hurryText');
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
      this._finishRound();
    }
  }

  _forceEndRound() {
    const isDrawTurn = (this._currentRound % 2 !== 0);
    this._storyChains.forEach(chain => {
      const p = this.players.get(chain.currentHolderId);
      if (p && !p._hasSubmitted) {
        chain.steps.push({
          type:        isDrawTurn ? 'draw' : 'word',
          content:     isDrawTurn ? this._createDummyCanvas() : '시간을 초과했습니다...',
          authorId:    p.id,
          roundNumber: this._currentRound,
        });
        p._hasSubmitted = true;
        this._updatePlayerStatusCard(p.id, true);
      }
    });
    this._finishRound();
  }

  _createDummyCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 300;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = '#cc3333';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('시간 초과 ㅠㅠ', 200, 155);
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
