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
    this._demoSetupInterval = null;
    this._isDemoRunning = false;
    this._scenario = 1; // 1: 시민 승리, 2: 스파이 승리, 3: 타임아웃
  }

  startDemo() {
    this.start();
  }

  start() {
    this.stop(); // 이전 실행 청소
    this._isDemoRunning = true;
    this.game._isDemoActive = true;

    // 3가지 시나리오 중 무작위 결정
    this._scenario = Math.floor(Math.random() * 3) + 1;
    console.log(`[Demo] Starting attract simulation (Scenario: ${this._scenario})...`);

    this._updateDemoBadge('LOBBY');

    // 1. 가상 봇 입장 디스패치 (메시지 통신 흐름 모방)
    this._bots.forEach((bot, idx) => {
      const t = setTimeout(() => {
        if (!this._isDemoRunning) return;

        // SDK 플레이어로 가상 등록
        this.game.sdk._players.set(bot.id, bot);
        // playerJoin 이벤트 디스패치
        this.game.sdk._emit('playerJoin', bot);

        // setProfile 메시지 가상 전송
        this._triggerGameMessage('setProfile', bot.id, { nickname: bot.nickname, avatar: null });

        console.log(`[Demo] Virtual join: ${bot.nickname}`);
      }, idx * 600);

      this._timerQueue.push(t);
    });

    // 2. 준비 완료 디스패치
    const tReady = setTimeout(() => {
      if (!this._isDemoRunning) return;
      this.game.sdk._emit('readyUpdate', { readyCount: 3, total: 3 });
      this.game.sdk._emit('allReady', {});
    }, 2000);
    this._timerQueue.push(tReady);

    // 3. 실제 게임 시작 함수 호출
    const tStart = setTimeout(() => {
      if (!this._isDemoRunning) return;
      this.game._startGame();
      
      // Setup 페이즈 가속
      this._accelerateSetup();
    }, 3500);
    this._timerQueue.push(tStart);
  }

  stop() {
    this._isDemoRunning = false;
    this._clearAllTimers();
    if (this._demoSetupInterval) {
      clearInterval(this._demoSetupInterval);
      this._demoSetupInterval = null;
    }

    // 봇 정보 소거
    this._bots.forEach(bot => {
      this.game.sdk._players.delete(bot.id);
    });

    this.game._isDemoActive = false;
    this._updateDemoBadge(null);

    // 게임 원복
    this.game.onReset();
    console.log('[Demo] Simulation stopped & reset completed.');
  }

  // ─── 내부 시뮬레이션 머신 ──────────────────────────────────────────────────

  _accelerateSetup() {
    this._updateDemoBadge('SETUP');
    
    // 게임 본체의 setupInterval 정지하고 데모용 가속 타이머 구동
    if (this.game._setupInterval) {
      clearInterval(this.game._setupInterval);
      this.game._setupInterval = null;
    }

    let setupCounter = 5;
    const countdownEl = document.getElementById('setup-countdown');
    if (countdownEl) countdownEl.textContent = setupCounter;

    this._demoSetupInterval = setInterval(() => {
      if (!this._isDemoRunning) {
        clearInterval(this._demoSetupInterval);
        return;
      }

      setupCounter--;
      if (countdownEl) countdownEl.textContent = setupCounter;

      if (setupCounter <= 0) {
        clearInterval(this._demoSetupInterval);
        this.game._stopTimer();
        this.game._startDiscussionPhase();
        this._simulateDiscussionPhase();
      }
    }, 500); // 0.5초 주기로 초고속 카운트다운
  }

  _simulateDiscussionPhase() {
    this._updateDemoBadge('DISCUSSION');
    console.log('[Demo] Simulating Discussion Phase...');

    const citizenWord = this.game._citizenWord;
    const spyWord = this.game._spyWord;

    const hints = [];
    this._bots.forEach(bot => {
      const isSpy = (bot.id === this.game._spyPlayerId);
      
      if (isSpy && this._scenario === 3) {
        // 시나리오 3: 힌트 미제출 타임아웃을 위해 스파이는 단어를 제출하지 않음
        return;
      }

      const hintWord = isSpy ? this._getSpyDemoHint(spyWord) : this._getCitizenDemoHint(citizenWord);
      hints.push({ id: bot.id, word: hintWord });
    });

    // 힌트 순차 제출
    hints.forEach((hintData, idx) => {
      const tSubmit = setTimeout(() => {
        if (!this._isDemoRunning) return;
        this._triggerGameMessage('submitHint', hintData.id, { hint: hintData.word });
      }, (idx + 1) * 800);

      this._timerQueue.push(tSubmit);
    });

    // 만약 타임아웃 시나리오면, 타이머 강제 만료 대기
    if (this._scenario === 3) {
      // 힌트 타임아웃 딜레이 후 강제 진행 (시간 단축)
      const tTimeout = setTimeout(() => {
        if (!this._isDemoRunning) return;
        
        // main.js의 타임아웃 콜백 로직 모방
        this.game.players.forEach(p => {
          if (!this.game._playerHints.has(p.id)) {
            this.game._playerHints.set(p.id, '...');
            this.game._spawnFloatingBubble(p.id, '...');
          }
        });
        
        const tNext = setTimeout(() => {
          if (!this._isDemoRunning) return;
          this.game._startVotingPhase();
          this._simulateVotingPhase();
        }, 1000);
        this._timerQueue.push(tNext);
      }, 4000); // 4초 뒤 만료

      this._timerQueue.push(tTimeout);
    }
  }

  _simulateVotingPhase() {
    this._updateDemoBadge('VOTING');
    console.log('[Demo] Simulating Voting Phase...');

    if (this._scenario === 3) {
      // 시나리오 3: 투표 타임아웃 대기
      const tTimeout = setTimeout(() => {
        if (!this._isDemoRunning) return;
        this.game._revealResult();
      }, 4000); // 4초 뒤 만료
      this._timerQueue.push(tTimeout);
      return;
    }

    const spyId = this.game._spyPlayerId;
    const citizenIds = this._bots.map(b => b.id).filter(id => id !== spyId);
    const votes = [];

    if (this._scenario === 1) {
      // 시민 승리: 시민들은 스파이 투표, 스파이는 첫 번째 시민 투표
      citizenIds.forEach(cid => {
        votes.push({ voter: cid, target: spyId });
      });
      votes.push({ voter: spyId, target: citizenIds[0] });
    } else {
      // 스파이 승리: 시민들은 무고한 다른 시민 투표, 스파이도 다른 시민 투표
      citizenIds.forEach((cid, idx) => {
        const target = citizenIds[(idx + 1) % citizenIds.length];
        votes.push({ voter: cid, target: target });
      });
      votes.push({ voter: spyId, target: citizenIds[0] });
    }

    votes.forEach((voteData, idx) => {
      const tVote = setTimeout(() => {
        if (!this._isDemoRunning) return;
        this._triggerGameMessage('submitVote', voteData.voter, { targetId: voteData.target });
      }, (idx + 1) * 800);

      this._timerQueue.push(tVote);
    });
  }

  // ─── 힌트 단어 사전 ────────────────────────────────────────────────────────

  _getCitizenDemoHint(word) {
    const dict = {
      '사과': ['빨갛다', '과일', '달콤함', '비타민'],
      '스마트폰': ['인터넷', '화면', '통화', '휴대용'],
      '비행기': ['하늘', '여행', '날개', '구름'],
      '바다': ['파도', '모래', '여름', '넓다'],
      '축구': ['골대', '잔디', '발', '손흥민'],
      '라떼': ['우유', '커피', '에스프레소', '고소함'],
      '고양이': ['야옹', '집사', '귀엽다', '꼬리'],
      '피자': ['치즈', '둥글다', '이탈리아', '도우'],
      '짜장면': ['춘장', '단무지', '중국집', '이사날'],
      '콜라': ['탄산', '검은색', '시원함', '얼음'],
      '라면': ['신라면', '꼬들꼬들', '양은냄비', '김치'],
      '안경': ['시력', '렌즈', '콧대', '라식'],
      '산': ['등산', '정상', '단풍', '호랑이'],
      '달리기': ['육상', '운동장', '트랙', '운동화'],
      '영화관': ['팝콘', '스크린', '극장', '조조'],
      '선생님': ['학교', '교탁', '수업', '칠판'],
      '도서관': ['정숙', '책장', '공부', '대출'],
      '자전거': ['체인', '페달', '따릉이', '안전모'],
      '지하철': ['승강장', '환승', '개찰구', '기관사'],
      '선풍기': ['회전', '강풍', '날개', '타이머'],
      '장갑': ['목도리', '방한', '털실', '스키장'],
      '안마기': ['안마의자', '효도', '두드림', '피로'],
      '시계': ['시침', '알람', '손목', '초침'],
      '우산': ['소나기', '우비', '양산', '살대'],
      '피아노': ['건반', '바이엘', '체르니', '조율'],
      '노트북': ['맥북', '키보드', '휴대용', '충전기'],
      '유튜브': ['구독', '크리에이터', '조회수', '쇼츠'],
      '소주': ['초록병', '삼겹살', '알코올', '잔'],
      '온천': ['유황', '일본', '노천탕', '힐링'],
      '기차': ['선로', '코레일', '플랫폼', '입석'],
      '노래방': ['마이크', '템버린', '에코', '100점'],
      '편의점': ['삼각김밥', '도시락', '24시간', '택배'],
      '치킨': ['맥주', '양념', '후라이드', '닭다리'],
      '독서': ['마음의양식', '베스트셀러', '책갈피', '종이'],
      '카메라': ['사진', '셔터', '렌즈', '찰칵'],
      '가을': ['낙엽', '독서', '단풍', '바바리'],
      '겨울': ['붕어빵', '첫눈', '패딩', '군고구마'],
      '주스': ['오렌지', '과일', '유리병', '델몬트'],
      '연필': ['지우개', '심', '샤프', '흑연']
    };
    const hints = dict[word] || ['설명', '단어', '특징', '힌트'];
    return hints[Math.floor(Math.random() * hints.length)];
  }

  _getSpyDemoHint(word) {
    const dict = {
      '배': ['과일', '시원함', '선박', '물컹함'],
      '컴퓨터': ['모니터', '책상', '키보드', '마우스'],
      '헬리콥터': ['프로펠러', '하늘', '구조', '소음'],
      '수영장': ['물안경', '실내', '락스', '레인'],
      '농구': ['링', '슛', '에어조던', '골대'],
      '아메리카노': ['얼죽아', '커피', '검은색', '쓴맛'],
      '강아지': ['멍멍', '개껌', '산책', '반려견'],
      '햄버거': ['패티', '맥도날드', '감자튀김', '번'],
      '짬뽕': ['해물', '얼큰함', '빨간국물', '탕수육'],
      '사이다': ['칠성', '탄산', '투명함', '스프라이트'],
      '우동': ['가쓰오부시', '휴게소', '어묵', '두꺼운면'],
      '선글라스': ['자외선', '해변', '검은렌즈', '패션'],
      '언덕': ['오르막', '달동네', '바람', '동산'],
      '걷기': ['산책', '유산소', '걸음마', '만보기'],
      '미술관': ['전시회', '그림', '화가', '액자'],
      '학생': ['교복', '급식', '독서실', '수능'],
      '서점': ['교보문고', '베스트셀러', '신간', '도서'],
      '오토바이': ['헬멧', '배달', '엔진', '폭주족'],
      '버스': ['정류장', '교통카드', '노선', '벨'],
      '에어컨': ['실외기', '냉방', '인버터', '무풍'],
      '양말': ['발가락', '신발', '뒤꿈치', '스니커즈'],
      '침대': ['에이스', '수면', '베개', '매트리스'],
      '달력': ['공휴일', '12개월', '달력', '탁상'],
      '비옷': ['장마', '방수', '후드', '우비'],
      '바이올린': ['활', '현악기', '피아노', '협주곡'],
      '태블릿': ['아이패드', '갤럭시탭', '펜슬', '인강'],
      '넷플릭스': ['오리지널', '스트리밍', '정주행', '계정'],
      '맥주': ['홉', '치킨', '거품', '피처'],
      '사우나': ['한증막', '식혜', '수건양머리', '목욕탕'],
      '고속버스': ['우등', '터미널', '휴게소', '안전벨트'],
      '클럽': ['디제이', '댄스', '조명', '입장권'],
      '마트': ['카트', '시식', '이마트', '할인'],
      '족발': ['콜라겐', '보쌈', '새우젓', '쟁반국수'],
      '공부': ['시험', '독서실', '성적', '문제집'],
      '거울': ['반사', '거울아', '거울샷', '메이크업'],
      '봄': ['벚꽃', '새싹', '춘곤증', '꽃가루'],
      '여름': ['폭염', '피서', '빙수', '모기'],
      '우유': ['칼슘', '서울우유', '흰우유', '시리얼'],
      '볼펜': ['모나미', '잉크', '삼색', '필기']
    };
    const hints = dict[word] || ['무언가', '대변', '유사함', '스파이'];
    return hints[Math.floor(Math.random() * hints.length)];
  }

  // ─── 데모 전용 헬퍼 ──────────────────────────────────────────────────────

  _triggerGameMessage(type, fromPlayerId, payload) {
    const handler = this.game.sdk._messageHandlers.get(type);
    if (handler) {
      const player = this.game.sdk._players.get(fromPlayerId) || { id: fromPlayerId };
      handler(player, payload);
    }
  }

  _updateDemoBadge(phase) {
    const badge = document.getElementById('demo-status-badge');
    const stageText = document.getElementById('demo-stage-text');
    const scenarioText = document.getElementById('demo-scenario-text');
    
    if (!badge) return;

    if (!phase || !this._isDemoRunning) {
      badge.classList.add('hidden');
      return;
    }

    badge.classList.remove('hidden');
    if (stageText) stageText.textContent = phase;
    if (scenarioText) {
      const scenarioNames = ['시민 승리 (스파이 검거)', '스파이 승리 (오검거)', '타임아웃 (스파이 탈출)'];
      scenarioText.textContent = scenarioNames[this._scenario - 1] ?? this._scenario;
    }
  }

  _clearAllTimers() {
    this._timerQueue.forEach(t => clearTimeout(t));
    this._timerQueue = [];
  }
}
