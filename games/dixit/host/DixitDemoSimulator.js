export class DixitDemoSimulator {
  constructor(game) {
    this.game = game;
    this.demoTimeouts = [];
    this._snapshot = null;
    this._isDemoRunning = false;
    this.currentScenarioIdx = 0;
    this.scenarios = [
      {
        name: "시나리오 A: 일부 정답 (가장 이상적인 Dixit 결과)",
        clue: "모험의 시작",
        cluesList: ["모험의 시작", "신비로운 숲", "끝없는 우주"],
        storyteller: "bot_amy",
        // 봇들의 카드 인덱스 선택 (손패 내에서의 인덱스)
        storytellerCardIdx: 0,
        otherSubmissions: {
          bot_bob: 1,
          bot_charles: 2
        },
        // 투표 대상 카드 결정
        // cardOwnerMap 이 빌드되면, 봇들은 다른 카드를 보며 투표함.
        // storyCardId 에 투표할 봇과 다른 미끼 카드에 투표할 봇을 고정
        votes: {
          bot_bob: "storyteller", // 이야기꾼의 카드 투표 (정답)
          bot_charles: "bot_bob"   // bob의 카드 투표 (미끼 낚임)
        }
      },
      {
        name: "시나리오 B: 전원 정답 (이야기꾼 득점 불가)",
        clue: "달콤한 꿈",
        cluesList: ["달콤한 꿈", "평화로운 오후", "하늘을 나는 배"],
        storyteller: "bot_bob",
        storytellerCardIdx: 1,
        otherSubmissions: {
          bot_amy: 0,
          bot_charles: 1
        },
        votes: {
          bot_amy: "storyteller", // 정답
          bot_charles: "storyteller" // 정답
        }
      },
      {
        name: "시나리오 C: 전원 오답 (이야기꾼 득점 불가)",
        clue: "숨겨진 진실",
        cluesList: ["숨겨진 진실", "심연의 목소리", "거울 속의 방"],
        storyteller: "bot_charles",
        storytellerCardIdx: 2,
        otherSubmissions: {
          bot_amy: 2,
          bot_bob: 0
        },
        votes: {
          bot_amy: "bot_bob", // bob 카드에 투표 (오답)
          bot_bob: "bot_amy"  // amy 카드에 투표 (오답)
        }
      }
    ];
  }

  startDemo() {
    this._isDemoRunning = true;
    this.game._isDemo = true;
    this.currentScenarioIdx = 0;

    // 1. 상태 스냅샷 저장
    this.captureSnapshot();
    this.logQA("데모 시뮬레이터를 시작합니다. 현재 세션 스냅샷을 백업했습니다.");

    // 2. 가상 봇 3명 등록
    const bots = [
      { id: 'bot_amy', nickname: '🤖 에이미 봇', color: '#EF4444' },
      { id: 'bot_bob', nickname: '🤖 밥 봇', color: '#10B981' },
      { id: 'bot_charles', nickname: '🤖 찰리 봇', color: '#3B82F6' }
    ];

    bots.forEach(b => {
      this.game._profiles.set(b.id, { nickname: b.nickname });
      this.game.players.set(b.id, { id: b.id, color: b.color });
      this.game._scores.set(b.id, 0);
    });

    this.game.renderLobbyPlayers(this.game._getLobbyProfiles());
    this.game.updateLobbyReady(3);

    // 3. UI 및 배너 표시
    const banner = document.getElementById('dx-demo-banner');
    if (banner) {
      banner.classList.remove('hidden');
      const stopBtn = document.getElementById('btn-stop-demo');
      if (stopBtn) {
        stopBtn.onclick = () => this.stopDemo();
      }
      const logs = document.getElementById('dx-demo-qa-logs');
      if (logs) logs.innerHTML = '';
    }

    // QR 블러 가드
    const qrWrap = document.querySelector('.qr-container');
    if (qrWrap) {
      qrWrap.style.filter = 'blur(8px)';
      qrWrap.style.pointerEvents = 'none';

      const overlayText = document.createElement('div');
      overlayText.id = 'demoQROverlay';
      overlayText.style.position = 'absolute';
      overlayText.style.inset = '0';
      overlayText.style.display = 'flex';
      overlayText.style.flexDirection = 'column';
      overlayText.style.alignItems = 'center';
      overlayText.style.justifyContent = 'center';
      overlayText.style.background = 'rgba(0,0,0,0.72)';
      overlayText.style.color = '#F59E0B';
      overlayText.style.fontWeight = 'bold';
      overlayText.style.fontSize = '1.1rem';
      overlayText.style.textAlign = 'center';
      overlayText.style.padding = '10px';
      overlayText.style.borderRadius = '8px';
      overlayText.style.boxSizing = 'border-box';
      overlayText.style.zIndex = '100';
      overlayText.innerHTML = '<span>🤖 데모 플레이 진행 중...</span><br><small style="font-size:0.78rem;color:#bbb;margin-top:4px;">데모 모드에서는 신규 접속이 불가합니다.</small>';
      qrWrap.parentNode.style.position = 'relative';
      qrWrap.parentNode.appendChild(overlayText);
    }

    // 게임 시작
    this.logQA("가상 봇 입장 완료. 게임을 시작합니다.");
    this.game._startGame();
    this.game._broadcastPlayerList();
  }

  stopDemo() {
    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];

    const overlay = document.getElementById('demoQROverlay');
    overlay?.parentNode?.removeChild(overlay);
    const qrWrap = document.querySelector('.qr-container');
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }

    const banner = document.getElementById('dx-demo-banner');
    if (banner) {
      banner.classList.add('hidden');
    }

    this._isDemoRunning = false;
    this.game._isDemo = false;
    
    // 상태 복원
    this.restoreSnapshot();
    this.logQA("데모 시뮬레이터를 정지하고 기존 세션 스냅샷을 복원했습니다.");
  }

  captureSnapshot() {
    this._snapshot = {
      profiles:      new Map(this.game._profiles),
      scores:        new Map(this.game._scores),
      hands:         new Map(this.game._hands),
      readyPlayers:  new Set(this.game._readyPlayers),
      players:       new Map(this.game.players),
      gameStarted:   this.game._gameStarted,
      readyCount:    this.game._readyCount,
      deck:          this.game._deck,
      round:         this.game._round,
      storytellerIdx: this.game._storytellerIdx,
      storytellerId: this.game._storytellerId,
      clue:          this.game._clue,
      submissions:   [...this.game._submissions],
      votes:         [...this.game._votes],
      boardCards:    [...this.game._boardCards],
      phase:         this.game.phase
    };
  }

  restoreSnapshot() {
    if (!this._snapshot) return;
    
    this.game._profiles      = new Map(this._snapshot.profiles);
    this.game._scores        = new Map(this._snapshot.scores);
    this.game._hands         = new Map(this._snapshot.hands);
    this.game._readyPlayers  = new Set(this._snapshot.readyPlayers);
    this.game.players        = new Map(this._snapshot.players);
    this.game._gameStarted    = this._snapshot.gameStarted;
    this.game._readyCount     = this._snapshot.readyCount;
    this.game._deck          = this._snapshot.deck;
    this.game._round          = this._snapshot.round;
    this.game._storytellerIdx = this._snapshot.storytellerIdx;
    this.game._storytellerId  = this._snapshot.storytellerId;
    this.game._clue           = this._snapshot.clue;
    this.game._submissions    = [...this._snapshot.submissions];
    this.game._votes          = [...this._snapshot.votes];
    this.game._boardCards     = [...this._snapshot.boardCards];
    
    // UI 복구
    this.game.setPhase(this._snapshot.phase);
    if (this._snapshot.phase === 'lobby') {
      this.game.renderLobbyPlayers(this.game._getLobbyProfiles());
      this.game.updateLobbyReady(this.game._readyCount);
    }
    
    this._snapshot = null;
  }

  logQA(message) {
    console.log(`[QA Demo] ${message}`);
    const logEl = document.getElementById('dx-demo-qa-logs');
    if (logEl) {
      const line = document.createElement('div');
      line.className = 'dx-demo-log-line';
      line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  onPhaseChange(phase) {
    if (!this.game._isDemo || !this._isDemoRunning) return;

    // 기존 예약 취소
    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];

    const scenario = this.scenarios[this.currentScenarioIdx % this.scenarios.length];
    const scenarioNameEl = document.getElementById('dx-demo-scenario-name');
    if (scenarioNameEl) {
      scenarioNameEl.textContent = `진행 중인 시나리오: ${scenario.name} (라운드 ${this.game._round})`;
    }

    if (phase === 'storytelling') {
      const storytellerId = this.game._storytellerId;
      this.logQA(`[Round ${this.game._round}] 페이즈: storytelling (이야기꾼: ${storytellerId})`);
      
      if (storytellerId) {
        const timeout = setTimeout(() => {
          const hand = this.game._hands.get(storytellerId) ?? [];
          if (hand.length === 0) return;
          const cardId = hand[scenario.storytellerCardIdx % hand.length] || hand[0];
          const clue = scenario.clue;
          
          this.logQA(`이야기꾼 ${storytellerId}가 카드를 고르고 힌트 "${clue}"를 제출합니다.`);
          this.game.handleDemoAction(storytellerId, 'submitClue', { cardId, clue });
        }, 3000);
        this.demoTimeouts.push(timeout);
      }
    } else if (phase === 'card-selection') {
      this.logQA(`[Round ${this.game._round}] 페이즈: card-selection (플레이어 카드 선택)`);
      const storytellerId = this.game._storytellerId;
      
      this.game.players.forEach(p => {
        if (p.id === storytellerId) return;
        
        const delay = 1500 + Math.random() * 2000;
        const timeout = setTimeout(() => {
          const hand = this.game._hands.get(p.id) ?? [];
          if (hand.length === 0) return;
          
          // 시나리오에서 정의된 카드 인덱스 선택
          const subIdx = scenario.otherSubmissions[p.id] ?? 0;
          const cardId = hand[subIdx % hand.length] || hand[0];
          
          this.logQA(`플레이어 ${p.id}가 카드를 제출합니다.`);
          this.game.handleDemoAction(p.id, 'submitCard', { cardId });
        }, delay);
        this.demoTimeouts.push(timeout);
      });
      
    } else if (phase === 'voting') {
      this.logQA(`[Round ${this.game._round}] 페이즈: voting (투표)`);
      const storytellerId = this.game._storytellerId;
      
      this.game.players.forEach(p => {
        if (p.id === storytellerId) return;
        
        const delay = 2000 + Math.random() * 2500;
        const timeout = setTimeout(() => {
          const myCard = this.game._submissions.find(s => s.playerId === p.id)?.cardId;
          const storyCard = this.game._submissions.find(s => s.playerId === storytellerId)?.cardId;
          
          // 시나리오 투표 판정
          const targetRole = scenario.votes[p.id];
          let cardId = null;
          
          if (targetRole === 'storyteller') {
            cardId = storyCard;
          } else {
            // 다른 봇 카드로 투표 설정
            const targetBotId = targetRole;
            cardId = this.game._submissions.find(s => s.playerId === targetBotId)?.cardId;
          }
          
          // Fallback 만약 투표할 카드가 없으면 자기 카드 제외하고 첫 카드로
          if (!cardId || cardId === myCard) {
            const votable = this.game._boardCards.filter(c => c !== myCard);
            cardId = votable[0];
          }
          
          this.logQA(`플레이어 ${p.id}가 투표를 진행합니다.`);
          this.game.handleDemoAction(p.id, 'submitVote', { cardId });
        }, delay);
        this.demoTimeouts.push(timeout);
      });
      
    } else if (phase === 'round-result') {
      this.logQA(`[Round ${this.game._round}] 페이즈: round-result (결과 공개)`);
      this.currentScenarioIdx++;
      
      // 결과 점수 로그 기록
      const scoresLog = [...this.game.players.keys()].map(id => {
        const nick = this.game._profiles.get(id)?.nickname ?? id;
        const score = this.game._scores.get(id) ?? 0;
        return `${nick}: ${score}점`;
      }).join(', ');
      this.logQA(`현재 점수 현황 -> ${scoresLog}`);

      // 다음 라운드 버튼 클릭 시뮬레이션
      const timeout = setTimeout(() => {
        const nextBtn = document.getElementById('next-round-btn');
        if (nextBtn) {
          this.logQA("다음 라운드로 넘어갑니다.");
          nextBtn.click();
        }
      }, 6000);
      this.demoTimeouts.push(timeout);
      
    } else if (phase === 'final') {
      this.logQA("게임 최종 종료! 결과를 발표하고 10초 후에 로비로 리셋합니다.");
      
      const timeout = setTimeout(() => {
        const restartBtn = document.getElementById('restart-btn');
        if (restartBtn) {
          restartBtn.click();
        }
      }, 10000);
      this.demoTimeouts.push(timeout);
    }
  }
}
