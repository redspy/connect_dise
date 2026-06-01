export class DemoSimulator {
  /**
   * @param {import('./main.js').HiddenAgentGame} gameInstance
   */
  constructor(gameInstance) {
    this.game = gameInstance;
    this._bots = [
      { id: 'demo_bot_1', nickname: '🤖 봇_Alice', color: '#06b6d4' },
      { id: 'demo_bot_2', nickname: '🤖 봇_Bob', color: '#a855f7' },
      { id: 'demo_bot_3', nickname: '🤖 봇_Charlie', color: '#10b981' }
    ];
    this._timerQueue = [];
    this._isDemoRunning = false;
  }

  start() {
    this.stop(); // 이전 실행 청소
    this._isDemoRunning = true;

    console.log('[Demo] Starting local attract simulation...');

    // 1. 봇 가상 입장 연계
    this._bots.forEach((bot, idx) => {
      const t = setTimeout(() => {
        if (!this._isDemoRunning) return;

        // SDK의 playerJoin을 거치지 않고 직접 내부 맵 주입
        const playerObj = { id: bot.id, color: bot.color };
        this.game.players.set(bot.id, playerObj);
        
        // 프로필 바인딩
        this.game._profiles.set(bot.id, { nickname: bot.nickname, avatar: null });
        this.game.setPlayerName(bot.id, bot.nickname);

        // 로비 갱신
        this.game._updateLobby();
        
        // 오디오 대역이 있으면 효과음 발생 가능 (로비 입장음)
        console.log(`[Demo] ${bot.nickname} joined lobby.`);
      }, idx * 600);

      this._timerQueue.push(t);
    });

    // 2. 준비 완료 상태 모킹
    const tReady = setTimeout(() => {
      if (!this._isDemoRunning) return;
      this.game.updateLobbyReady(3);
    }, 2000);
    this._timerQueue.push(tReady);

    // 3. 데모 게임 루프 개시
    const tStart = setTimeout(() => {
      if (!this._isDemoRunning) return;
      this._simulateGameStart();
    }, 3500);
    this._timerQueue.push(tStart);
  }

  stop() {
    this._isDemoRunning = false;
    this._clearAllTimers();

    // 봇 정보 소거
    this._bots.forEach(bot => {
      this.game.players.delete(bot.id);
      this.game._profiles.delete(bot.id);
      this.game._assignedRoles.delete(bot.id);
      this.game._assignedWords.delete(bot.id);
    });

    // 게임 원복
    this.game.onReset();
    console.log('[Demo] Local attract simulation stopped & lobby reset completed.');
  }

  // ─── 내부 시뮬레이션 머신 ──────────────────────────────────────────────────

  _simulateGameStart() {
    console.log('[Demo] Simulating Game Start...');

    // 역할 추첨 모킹 (봇 1번을 스파이로 무작위 고정 배정)
    this.game._spyPlayerId = 'demo_bot_1';
    this.game._citizenWord = '사과';
    this.game._spyWord = '배';

    this._bots.forEach(bot => {
      const isSpy = (bot.id === this.game._spyPlayerId);
      const role = isSpy ? 'spy' : 'citizen';
      const word = isSpy ? this.game._spyWord : this.game._citizenWord;

      this.game._assignedRoles.set(bot.id, role);
      this.game._assignedWords.set(bot.id, word);
    });

    // Setup 단계 (5초) 가속
    this.game.setPhase('setup');
    let setupCounter = 5;
    const countdownEl = document.getElementById('setup-countdown');
    if (countdownEl) countdownEl.textContent = setupCounter;

    const setupInterval = setInterval(() => {
      if (!this._isDemoRunning) {
        clearInterval(setupInterval);
        return;
      }

      setupCounter--;
      if (countdownEl) countdownEl.textContent = setupCounter;

      if (setupCounter <= 0) {
        clearInterval(setupInterval);
        this._simulateDiscussionPhase();
      }
    }, 600); // 0.6초 주기로 초고속 카운트다운
  }

  _simulateDiscussionPhase() {
    console.log('[Demo] Simulating Discussion (Hint Submissions)...');
    this.game.setPhase('discussion');
    this.game._playerHints.clear();
    this.game._updateSubmitStatus();

    // 40초 제한시간 바 렌더링 가속 가동
    this.game._startTimer(20, () => {
      // 강제 만료
    });

    // 봇들 힌트 단어 순차 제출 연출
    // 봇1(스파이, 제시어: 배) -> "오렌지"
    // 봇2(시민, 제시어: 사과) -> "달콤하다"
    // 봇3(시민, 제시어: 사과) -> "과수원"
    const hints = [
      { id: 'demo_bot_2', word: '달콤하다' },
      { id: 'demo_bot_3', word: '과수원' },
      { id: 'demo_bot_1', word: '오렌지' } // 스파이가 늦게 눈치를 보다 제출
    ];

    hints.forEach((hintData, idx) => {
      const tSubmit = setTimeout(() => {
        if (!this._isDemoRunning) return;

        this.game._playerHints.set(hintData.id, hintData.word);
        this.game._spawnFloatingBubble(hintData.id, hintData.word);
        this.game._updateSubmitStatus();

        // 전원 완료 체크
        if (this.game._playerHints.size === 3) {
          this.game._stopTimer();
          
          // 2.5초 후 투표로 이행
          const tNext = setTimeout(() => {
            if (!this._isDemoRunning) return;
            this._simulateVotingPhase();
          }, 2500);
          this._timerQueue.push(tNext);
        }
      }, (idx + 1) * 1500);

      this._timerQueue.push(tSubmit);
    });
  }

  _simulateVotingPhase() {
    console.log('[Demo] Simulating Voting Phase...');
    this.game.setPhase('voting');
    this.game._playerVotes.clear();
    this.game._buildVoteUI();
    this.game._updateVoteStatus();

    // 30초 타이머 가속
    this.game._startTimer(15, () => {});

    // 봇들이 의심자 지목 투표 (봇2와 봇3은 봇1(스파이)을 눈치채고 투표, 봇1은 봇2를 투표)
    const votes = [
      { voter: 'demo_bot_2', target: 'demo_bot_1' },
      { voter: 'demo_bot_3', target: 'demo_bot_1' },
      { voter: 'demo_bot_1', target: 'demo_bot_2' }
    ];

    votes.forEach((voteData, idx) => {
      const tVote = setTimeout(() => {
        if (!this._isDemoRunning) return;

        this.game._playerVotes.set(voteData.voter, voteData.target);
        this.game._updateVoteStatus();

        // 전원 투표 체크
        if (this.game._playerVotes.size === 3) {
          this.game._stopTimer();
          
          // 2.5초 후 결과 공개
          const tNext = setTimeout(() => {
            if (!this._isDemoRunning) return;
            this.game._revealResult();
          }, 2500);
          this._timerQueue.push(tNext);
        }
      }, (idx + 1) * 1200);

      this._timerQueue.push(tVote);
    });
  }

  // ─── 타이머 청소 ──────────────────────────────────────────────────────────

  _clearAllTimers() {
    this._timerQueue.forEach(t => clearTimeout(t));
    this._timerQueue = [];
  }
}
