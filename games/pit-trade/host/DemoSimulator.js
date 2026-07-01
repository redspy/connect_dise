export class DemoSimulator {
  constructor(game) {
    this.game = game;
    this.isDemo = false;
    this.timer = null;
  }

  startDemo() {
    this.isDemo = true;
    this.game._isDemo = true;

    const bots = [
      { id: 'bot_1', nickname: '🤖 워렌 버핏', color: '#ff3333' },
      { id: 'bot_2', nickname: '🤖 조지 소로스', color: '#ffcc00' },
      { id: 'bot_3', nickname: '🤖 피터 린치', color: '#00f3ff' }
    ];

    this.game.players.clear();
    this.game._playerNicknames.clear();

    bots.forEach(b => {
      this.game._playerNicknames.set(b.id, b.nickname);
      this.game.players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
      this.game.sdk._players.set(b.id, { id: b.id, color: b.color, nickname: b.nickname });
    });

    this.game._playersList = bots.map(b => b.id);

    this.game._startGame();
  }

  startTradingLoop() {
    if (!this.isDemo) return;

    console.log('[DemoSimulator] Trading loop started.');

    this.timer = setInterval(() => {
      if (!this.game._gameActive) {
        this.stopTradingLoop();
        return;
      }

      const bots = ['bot_1', 'bot_2', 'bot_3'];

      // 매 틱마다 무작위 봇 하나를 선택해 행동을 유도하여 흐름 분산
      const botId = bots[Math.floor(Math.random() * bots.length)];
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
        if (counts[c] + bullCount >= 8) {
          isCornered = true;
          targetCommodity = c;
        }
      });

      if (isCornered) {
        console.log(`[DemoSimulator] ${botId} CORNERED the market with ${targetCommodity}! Ringing bell.`);
        const ringHandler = this.game.sdk._messageHandlers.get('ringBell');
        if (ringHandler) {
          ringHandler({ id: botId });
        }
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

        // 가장 개수가 적은 상품 선택하여 1~3장 방출
        const sortedGroups = Object.entries(cardGroups).sort((a, b) => a[1] - b[1]);
        if (sortedGroups.length > 0) {
          const trashComm = sortedGroups[0][0];
          const maxTrash = Math.min(sortedGroups[0][1], 3);
          const trashCount = Math.floor(Math.random() * maxTrash) + 1; // 1~3장 교환

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

          const executeHandler = this.game.sdk._messageHandlers.get('executeTrade');
          if (executeHandler) {
            executeHandler({ id: botId }, {
              targetPlayerId: matchedTarget,
              cardCount: myTrade.cardCount,
              cardIds: myTrade.cardIds
            });
          }
        } else {
          // 일정 확률로 취소 처리
          if (Math.random() < 0.25) {
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
        const executeHandler = this.game.sdk._messageHandlers.get('executeTrade');
        if (executeHandler) {
          executeHandler({ id: botId }, {
            targetPlayerId: matchedTargetPlayer,
            cardCount: count,
            cardIds: targetCardIds
          });
        }
      } else {
        // 시장에 매칭 매물이 없으므로 내 교환 상자 등록
        console.log(`[DemoSimulator] ${botId} registers trade for ${count} cards (${targetCardIds.join(', ')}).`);
        const registerHandler = this.game.sdk._messageHandlers.get('registerTrade');
        if (registerHandler) {
          registerHandler({ id: botId }, {
            cardCount: count,
            cardIds: targetCardIds
          });
        }
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
    this.isDemo = false;
    this.game._isDemo = false;
    this.stopTradingLoop();
    this.game.players.clear();
    this.game.sdk._players.clear();
    this.game._playerNicknames.clear();
  }
}
