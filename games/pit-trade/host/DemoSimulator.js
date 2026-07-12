class SeededRandom {
  constructor(seed = 12345) {
    this.seed = seed;
  }
  next() {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  choice(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  range(min, max) {
    return min + this.next() * (max - min);
  }
}

export class DemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.timer = null;
    this.scenario = 'monopoly';
    this.tickCount = 0;
    this.random = new SeededRandom();
  }

  startDemo(scenario = 'monopoly') {
    this.isDemo = true;
    this.game._isDemo = true;
    this.scenario = scenario;
    this.tickCount = 0;
    this.random = new SeededRandom(Math.floor(Math.random() * 100000));

    const bots = [
      { id: 'bot_1', nickname: '🤖 워렌 버핏', color: '#ff3333' },
      { id: 'bot_2', nickname: '🤖 조지 소로스', color: '#ffcc00' },
      { id: 'bot_3', nickname: '🤖 피터 린치', color: '#00f3ff' }
    ];

    this.game.players.clear();
    this.game.sdk._players.clear();
    this.game._playerNicknames.clear();

    // SDK 표준 이벤트를 활용하여 가상 봇 입장 진행 (공개 핸들러 API 경유)
    bots.forEach(b => {
      this.game.handleSetProfile({ id: b.id }, b.nickname);

      this.game.sdk.dispatchEvent(new CustomEvent('playerJoin', { 
        detail: { id: b.id, color: b.color } 
      }));
    });

    // SDK 준비완료 이벤트 디스패치를 통해 allReady 및 startGame 표준 트리거 구동
    this.game.sdk.dispatchEvent(new CustomEvent('allReady', { detail: {} }));
  }

  startTradingLoop() {
    if (!this.isDemo) return;

    console.log(`[DemoSimulator] Trading loop started. Scenario: ${this.scenario}`);

    this.timer = setInterval(() => {
      if (!this.game._gameActive) {
        this.stopTradingLoop();
        return;
      }

      this.tickCount++;

      // ─── 시나리오별 예외 분기 처리 ───
      
      // A. 인원 부족 강제 종료 시나리오
      if (this.scenario === 'forced_leave' && this.tickCount === 12) {
        console.log('[DemoSimulator] Scenario: forced_leave triggered. bot_3 leaving.');
        // SDK 이벤트를 활용해 이탈 디스패치
        this.game.sdk.dispatchEvent(new CustomEvent('playerLeave', { detail: 'bot_3' }));
        this.stopTradingLoop();
        return;
      }

      // B. 재접속 복구 시나리오
      if (this.scenario === 'reconnect') {
        if (this.tickCount === 8) {
          console.log('[DemoSimulator] Scenario: reconnect. bot_3 disconnects.');
          this.game.sdk.dispatchEvent(new CustomEvent('playerDisconnect', { detail: { playerId: 'bot_3' } }));
          this.game.sdk.dispatchEvent(new CustomEvent('playerLeave', { detail: 'bot_3' }));
          return;
        }
        if (this.tickCount === 14) {
          console.log('[DemoSimulator] Scenario: reconnect. bot_3 rejoins.');
          const bot_3_info = { id: 'bot_3', nickname: '🤖 피터 린치', color: '#00f3ff' };
          
          this.game.handleSetProfile({ id: 'bot_3' }, bot_3_info.nickname);

          this.game.sdk.dispatchEvent(new CustomEvent('playerRejoin', { 
            detail: { id: 'bot_3', color: bot_3_info.color } 
          }));
        }
      }

      // 데모 진행 중인 봇 목록 (이탈 상태인 봇은 행동에서 제외)
      const activeBots = ['bot_1', 'bot_2', 'bot_3'].filter(id => this.game._playersList.includes(id));
      if (activeBots.length === 0) return;

      const botId = this.random.choice(activeBots);
      const hand = this.game._playerHands.get(botId) || [];
      if (hand.length === 0) return;

      // 1. 독점 여부 검증 (황소 조커 포함 9장 달성 시 즉시 종치기)
      let counts = {};
      let bullCount = 0;
      hand.forEach(c => {
        if (c === 'bull') bullCount++;
        else if (c !== 'bear') {
          counts[c] = (counts[c] || 0) + 1;
        }
      });

      let isCornered = false;
      let targetCommodity = '';
      Object.keys(counts).forEach(c => {
        const target = (this.game._commodityPoolCounts.get(c) || 9) - 1;
        if (counts[c] + bullCount >= target) {
          isCornered = true;
          targetCommodity = c;
        }
      });

      if (isCornered) {
        console.log(`[DemoSimulator] ${botId} CORNERED the market with ${targetCommodity}! Ringing bell.`);
        this.game.handleRingBell({ id: botId });
        this.stopTradingLoop();
        return;
      }

      // 2. 교환할 카드 정보 선정
      let targetCardIds = [];
      if (hand.includes('bear')) {
        // 곰 카드 최우선 방출 (1장 교환)
        const idx = hand.indexOf('bear');
        targetCardIds = [hand[idx]];
      } else {
        // 보유 상품 수량 카운팅
        let cardGroups = {};
        hand.forEach(c => {
          if (c !== 'bull') {
            cardGroups[c] = (cardGroups[c] || 0) + 1;
          }
        });

        // 곰 대난동 시나리오에서는 곰 카드가 아닌 일반 카드 교환을 더 활발하게 매칭하도록 설정
        // 가장 개수가 적은 상품 선택하여 1~3장 방출
        const sortedGroups = Object.entries(cardGroups).sort((a, b) => a[1] - b[1]);
        if (sortedGroups.length > 0) {
          const trashComm = sortedGroups[0][0];
          const maxTrash = Math.min(sortedGroups[0][1], 3);
          const trashCount = Math.floor(this.random.range(0, maxTrash)) + 1; // 1~3장 교환

          hand.forEach(c => {
            if (c === trashComm && targetCardIds.length < trashCount) {
              targetCardIds.push(c);
            }
          });
        }
      }

      if (targetCardIds.length === 0) return;

      const count = targetCardIds.length;

      // 3. 이미 등록한 교환 매물이 있는 경우
      if (this.game._activeTrades.has(botId)) {
        // 동일한 교환 장수가 등록되어 있으면 매칭 대기
        const myTrade = this.game._activeTrades.get(botId);
        
        // 시장에 동일 장수의 다른 매물 탐색
        let matchedTarget = null;
        this.game._activeTrades.forEach((otherTrade, otherId) => {
          if (otherId !== botId && otherTrade.cardCount === myTrade.cardCount) {
            matchedTarget = otherId;
          }
        });

        if (matchedTarget) {
          // 내 매물을 내리고 즉시 교환 수락 실행
          console.log(`[DemoSimulator] ${botId} cancels trade to match with ${matchedTarget}`);
          this.game._activeTrades.delete(botId);

          this.game.handleExecuteTrade({ id: botId }, matchedTarget, myTrade.cardCount, myTrade.cardIds);
        } else {
          // 일정 확률로 취소 처리
          if (this.random.next() < 0.3) {
            console.log(`[DemoSimulator] ${botId} cancels unmatching trade.`);
            this.game._activeTrades.delete(botId);
            this.game._broadcastTradeState();
          }
        }
        return;
      }

      // 4. 시장의 기존 매물 탐색 및 거래 매칭
      let matchedTargetPlayer = null;
      this.game._activeTrades.forEach((trade, otherId) => {
        if (otherId !== botId && trade.cardCount === count) {
          matchedTargetPlayer = otherId;
        }
      });

      if (matchedTargetPlayer) {
        console.log(`[DemoSimulator] ${botId} matches trade with ${matchedTargetPlayer} for ${count} cards.`);
        this.game.handleExecuteTrade({ id: botId }, matchedTargetPlayer, count, targetCardIds);
      } else {
        // 시장에 매칭 매물이 없으므로 내 교환 상자 등록
        console.log(`[DemoSimulator] ${botId} registers trade for ${count} cards (${targetCardIds.join(', ')}).`);
        this.game.handleRegisterTrade({ id: botId }, count, targetCardIds);
      }
    }, 600);
  }

  onMarketChange() {
    this.game._renderHUDStandings();
  }

  stopTradingLoop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  stopDemo() {
    if (!this.isDemo) return;
    this.isDemo = false;
    this.game._isDemo = false;
    this.stopTradingLoop();
    this.game.players.clear();
    this.game.sdk._players.clear();
    this.game._playerNicknames.clear();
  }
}
