import { HostSDK } from '../../../platform/client/HostSDK.js';
import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { DemoSimulator } from './DemoSimulator.js';

class PitTradeHost extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'phase-overlay', qrContainerId: 'qr-box' });

    this._gameActive = false;
    this._isDemo = false;
    this._playersList = [];

    // 거래소 상태 맵
    this._playerHands = new Map();         // playerId -> string[] (소유 카드 ID 리스트)
    this._activeTrades = new Map();        // playerId -> { cardCount: number, cardIds: string[] }
    this._scores = new Map();              // playerId -> number

    // 동적 시세 변동
    this._prices = {};
    this._priceTimer = null;

    // 동시성 거래 락 (Transaction Lock)
    this._isTradingLocked = false;

    // Web Audio 신시사이저 오디오 컨텍스트
    this._audioCtx = null;
    this._ambientSource = null;

    this._demoSimulator = new DemoSimulator(this);
    this._setupControls();
    this._wireMessages();
  }

  async onSetup({ sessionId }) {
    document.getElementById('room-code-val').textContent = sessionId;
    this.setPhase('lobby');
    this._renderLobbyGrid();
  }

  _setupControls() {
    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.onclick = () => {
        if (this._isDemo) return;
        this._isDemo = true;
        demoPlayBtn.textContent = '🤖 데모 진행 중...';
        this._demoSimulator.startDemo();
      };
    }

    const restartBtn = document.getElementById('btn-restart-result');
    if (restartBtn) {
      restartBtn.onclick = () => this.resetSession();
    }
  }

  onPlayerJoin(player) {
    this._resetIdleTimer();
    if (!this._playersList.includes(player.id) && !this._gameActive) {
      this._playersList.push(player.id);
      this._scores.set(player.id, this._scores.get(player.id) || 0);
    }
    this._renderLobbyGrid();
  }

  onPlayerLeave(playerId) {
    this._renderLobbyGrid();

    if (this._gameActive) {
      const idx = this._playersList.indexOf(playerId);
      if (idx !== -1) {
        this._playersList.splice(idx, 1);
        this._playerHands.delete(playerId);
        this._activeTrades.delete(playerId);

        if (this._playersList.length < 3 && !this._isDemo) {
          // 거래 가능 인원 부족 시 강제 종료
          this._endRound(null, true);
        } else {
          this._broadcastTradeState();
          this._renderHUDStandings();
        }
      }
    }
  }

  onPlayerRejoin(player) {
    this._resetIdleTimer();
    this._renderLobbyGrid();
    if (this._gameActive) {
      // 기존 카드 핸드 재전파 (재연결 시 poolCounts 전송 필수 누락 수정)
      const hand = this._playerHands.get(player.id) || [];
      this.sendToPlayer(player.id, 'tradeExecuted', { 
        hand, 
        poolCounts: Object.fromEntries(this._commodityPoolCounts) 
      });
      this._broadcastTradeState();
    }
  }

  onAllReady() {
    if (!this._gameActive) {
      this._startGame();
    }
  }

  onReset() {
    this._gameActive = false;
    this._isDemo = false;
    this._playersList = [];
    this._playerHands.clear();
    this._activeTrades.clear();
    this._scores.clear();
    this._isTradingLocked = false;

    // 데모 시뮬레이터 정지 및 가상 봇 해제
    this._demoSimulator.stopDemo();

    // 가격 변동 타이머 정리
    if (this._priceTimer) {
      clearInterval(this._priceTimer);
      this._priceTimer = null;
    }

    // 웅성거림 배경음 정지
    this._stopAmbientNoise();

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) demoPlayBtn.textContent = '🤖 데모 플레이 실행';

    const container = document.querySelector('.pp-host-container');
    container?.classList.remove('screen-shake');

    this.setPhase('lobby');
    this._renderLobbyGrid();
  }

  // ─── 게임 라이프사이클 엔진 ───

  _startGame() {
    this._gameActive = true;
    this._isTradingLocked = false;
    this._activeTrades.clear();
    this._playerHands.clear();

    const P = this._playersList.length;

    // 모든 플레이어의 초기 스코어를 0으로 바인딩
    this._playersList.forEach(pid => {
      if (!this._scores.has(pid)) {
        this._scores.set(pid, 0);
      }
    });

    // 1. 상품 분기 설정 (최대 8인 대응을 위해 설탕 및 향신료 추가)
    const allCommodities = ['diamond', 'gold', 'oil', 'wheat', 'coffee', 'wood', 'sugar', 'spices'];
    const activeCommodities = allCommodities.slice(0, P);

    // 초기 시세 설정
    const defaultPrices = { diamond: 100, gold: 80, oil: 70, wheat: 60, coffee: 50, wood: 40, sugar: 30, spices: 20 };
    this._prices = {};
    activeCommodities.forEach(c => {
      this._prices[c] = defaultPrices[c];
    });

    // 2. 카드 풀 생성 (각 상품별 9장씩)
    let cardPool = [];
    activeCommodities.forEach(c => {
      for (let i = 0; i < 9; i++) {
        cardPool.push(c);
      }
    });

    // 조커(황소) 및 감점(곰) 카드 주입
    // 풀의 임의의 카드 2장을 각각 'bull' 및 'bear'로 대체
    if (cardPool.length >= 2) {
      cardPool[0] = 'bull';
      cardPool[1] = 'bear';
    }

    // 실제 풀에 주입된 최종 상품별 수량 카운트 (일부 상품은 조커/감점 대체로 7~8장으로 줄어듦)
    this._commodityPoolCounts = new Map();
    cardPool.forEach(c => {
      if (c !== 'bull' && c !== 'bear') {
        this._commodityPoolCounts.set(c, (this._commodityPoolCounts.get(c) || 0) + 1);
      }
    });

    // 카드 풀 피셔-예이츠 셔플
    for (let i = cardPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cardPool[i], cardPool[j]] = [cardPool[j], cardPool[i]];
    }

    // 3. 카드 9장씩 배포
    this._playersList.forEach((pid, idx) => {
      const start = idx * 9;
      const hand = cardPool.slice(start, start + 9);
      this._playerHands.set(pid, hand);
      this.sendToPlayer(pid, 'tradeExecuted', { 
        hand, 
        poolCounts: Object.fromEntries(this._commodityPoolCounts) 
      });
    });

    // 4. 전광판 렌더링
    this._renderCommodityPrices();
    this._renderHUDStandings();
    this._broadcastTradeState();

    // 5. 배경 오디오 신디사이저 웅성거림 가동
    this._startAmbientNoise();

    // 6. 동적 시세 변동 타이머 작동
    this._startPriceFluctuations();

    this.setPhase('game');

    // 시뮬레이터 구동
    if (this._isDemo) {
      this._demoSimulator.startTradingLoop();
    }
  }

  // 동적 시세 변동 타이머
  _startPriceFluctuations() {
    this._priceTimer = setInterval(() => {
      const commodities = Object.keys(this._prices);
      if (commodities.length === 0) return;

      const randomComm = commodities[Math.floor(Math.random() * commodities.length)];
      const events = [
        { name: '🔥 골드러시 발효! 시세 급증', multiplier: 1.5, text: '의 시장 가치가 급등했습니다!' },
        { name: '📉 공급 과잉 발생! 가치 폭락', multiplier: 0.7, text: '의 유통량이 증가해 시세가 하락했습니다.' }
      ];
      const event = events[Math.floor(Math.random() * events.length)];
      
      const prevPrice = this._prices[randomComm];
      this._prices[randomComm] = Math.round(prevPrice * event.multiplier);

      const ticker = document.getElementById('news-ticker');
      if (ticker) {
        const commNames = { diamond: '💎 다이아몬드', gold: '🪙 골드', oil: '🛢️ 석유', wheat: '🌾 밀', coffee: '☕ 커피', wood: '🪵 목재', sugar: '🍬 설탕', spices: '🌶️ 향신료' };
        ticker.textContent = `📢 [속보] ${commNames[randomComm]}${event.text}`;
      }

      this._renderCommodityPrices();
    }, 15000);
  }

  _renderCommodityPrices() {
    const container = document.getElementById('commodity-prices');
    if (!container) return;
    container.innerHTML = '';

    const commNames = { diamond: '💎 다이아몬드', gold: '🪙 골드', oil: '🛢️ 석유', wheat: '🌾 밀', coffee: '☕ 커피', wood: '🪵 목재', sugar: '🍬 설탕', spices: '🌶️ 향신료' };

    Object.keys(this._prices).forEach(c => {
      const row = document.createElement('div');
      row.className = 'commodity-row';
      row.innerHTML = `
        <span class="commodity-name-tag">${commNames[c] || c}</span>
        <span class="commodity-price-tag">${this._prices[c]} Pt</span>
      `;
      container.appendChild(row);
    });
  }

  _renderLobbyGrid() {
    const countSpan = document.getElementById('player-count');
    if (countSpan) countSpan.textContent = this._playersList.length;

    const grid = document.getElementById('lobby-grid');
    if (!grid) return;
    grid.innerHTML = '';

    this._playersList.forEach(pid => {
      const nick = this._playerNicknames.get(pid) || 'Player';
      const isReady = this._isDemo || false;
      const card = document.createElement('div');
      card.className = `lobby-player-card ${isReady ? 'ready' : ''}`;
      card.textContent = nick;
      grid.appendChild(card);
    });
  }

  _renderHUDStandings() {
    const grid = document.getElementById('game-players-grid');
    if (!grid) return;
    grid.innerHTML = '';

    this._playersList.forEach(pid => {
      const nick = this._playerNicknames.get(pid) || 'Player';
      const hand = this._playerHands.get(pid) || [];
      
      // 몇 장 모았는지 확인 (조커 포함)
      let counts = {};
      let bullCount = 0;
      hand.forEach(c => {
        if (c === 'bull') bullCount++;
        else if (c !== 'bear') {
          counts[c] = (counts[c] || 0) + 1;
        }
      });
      
      let maxSame = 0;
      let maxComm = 'diamond';
      Object.keys(counts).forEach(c => {
        if (counts[c] > maxSame) {
          maxSame = counts[c];
          maxComm = c;
        }
      });
      const currentMax = maxSame + bullCount;
      const target = (this._commodityPoolCounts.get(maxComm) || 9) - 1;
      const isWarning = currentMax >= target - 1;

      const card = document.createElement('div');
      card.className = `player-hud-card ${isWarning ? 'warning-near' : ''}`;
      card.innerHTML = `
        <span></span>
        <span>최다 ${currentMax}장</span>
      `;
      card.firstElementChild.textContent = nick;
      grid.appendChild(card);
    });
  }

  _broadcastTradeState() {
    const state = [];
    this._activeTrades.forEach((trade, pid) => {
      state.push({
        playerId: pid,
        nickname: this._playerNicknames.get(pid) || 'Player',
        cardCount: trade.cardCount
      });
    });

    this.broadcast('tradeState', state);

    // 호스트 화면 갱신
    const container = document.getElementById('active-trades-container');
    if (!container) return;
    container.innerHTML = '';

    if (state.length === 0) {
      container.innerHTML = `<div style="color: #94a3b8; font-style: italic; font-size: 14px;">현재 시장에 등록된 교환 대기 카드가 없습니다.</div>`;
      return;
    }

    state.forEach(t => {
      const card = document.createElement('div');
      card.className = 'trade-item-card';
      card.innerHTML = `
        <span class="trade-user"></span>
        <span class="trade-card-count">${t.cardCount}장 교환 희망</span>
      `;
      card.querySelector('.trade-user').textContent = t.nickname;
      container.appendChild(card);
    });
  }

  _endRound(winnerId, isForced = false) {
    this._gameActive = false;
    this._stopAmbientNoise();

    if (this._priceTimer) {
      clearInterval(this._priceTimer);
      this._priceTimer = null;
    }

    // 황동 종 애니메이션 가동
    const bell = document.getElementById('brass-bell');
    bell?.classList.add('bell-ring');
    this._playBellSound();
    setTimeout(() => {
      bell?.classList.remove('bell-ring');
    }, 3000);

    // 곰 카드 보유자 판정
    let bearHolderId = '';
    this._playerHands.forEach((hand, pid) => {
      if (hand.includes('bear')) {
        bearHolderId = pid;
      }
    });

    const winnerNick = winnerId ? (this._playerNicknames.get(winnerId) || 'Unknown') : '없음';

    // 점수 정산
    if (winnerId && !isForced) {
      // 승리한 상품 알아내기 (조커 제외)
      const hand = this._playerHands.get(winnerId) || [];
      let counts = {};
      hand.forEach(c => {
        if (c !== 'bull' && c !== 'bear') {
          counts[c] = (counts[c] || 0) + 1;
        }
      });
      let wonComm = 'diamond';
      let maxCount = 0;
      Object.keys(counts).forEach(c => {
        if (counts[c] > maxCount) {
          maxCount = counts[c];
          wonComm = c;
        }
      });

      // 획득 시세 가치 점수 가산
      const scoreGained = this._prices[wonComm] || 100;
      this._scores.set(winnerId, (this._scores.get(winnerId) || 0) + scoreGained);
    }

    // 곰 카드 패널티 가산
    if (bearHolderId) {
      this._scores.set(bearHolderId, (this._scores.get(bearHolderId) || 0) - 50);
    }

    // 결과 뷰포트 바인딩
    const winnerNameSpan = document.getElementById('winner-name');
    if (winnerNameSpan) {
      winnerNameSpan.textContent = isForced ? '인원 부족으로 라운드 파행' : winnerNick;
    }

    const ranking = document.getElementById('ranking-list');
    if (ranking) {
      ranking.innerHTML = '';
      const sorted = Array.from(this._scores.entries()).sort((a, b) => b[1] - a[1]);
      sorted.forEach(([pid, score]) => {
        const row = document.createElement('div');
        row.className = 'ranking-row';
        row.innerHTML = `
          <span></span>
          <span>${score} 점</span>
        `;
        row.firstElementChild.textContent = this._playerNicknames.get(pid) || 'Player';
        ranking.appendChild(row);
      });
    }

    const bearLoser = document.getElementById('bear-loser-text');
    if (bearLoser) {
      bearLoser.textContent = bearHolderId
        ? `${this._playerNicknames.get(bearHolderId) || 'Player'} (-50점 감점)`
        : '없음';
    }

    // 전체 모바일에 종료 전송
    const scoresWithNicks = Array.from(this._scores.entries()).map(([pid, val]) => {
      return [this._playerNicknames.get(pid) || 'Player', val];
    });

    this.broadcast('gameFinished', {
      winnerId,
      winnerNick,
      bearHolderId,
      scores: scoresWithNicks
    });

    this.setPhase('result');
  }

  _hasMatchingCards(hand, cardIds) {
    const handCounts = {};
    hand.forEach(c => handCounts[c] = (handCounts[c] || 0) + 1);
    const tradeCounts = {};
    cardIds.forEach(c => tradeCounts[c] = (tradeCounts[c] || 0) + 1);
    return Object.keys(tradeCounts).every(c => (handCounts[c] || 0) >= tradeCounts[c]);
  }

  onReadyUpdate({ readyCount, total }) {
    const subtitle = document.querySelector('.subtitle');
    if (subtitle) {
      subtitle.textContent = `모든 상인이 준비를 완료하면 게임이 시작됩니다. (준비 완료: ${readyCount}/${total})`;
    }
  }

  // ─── 메시지 수신 핸들러 ───────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('setProfile', (player, { nickname }) => {
      const name = nickname.trim() || '익명';
      this.setPlayerName(player.id, name);
      this._renderLobbyGrid();
    });

    // 1. 거래 등록
    this.onMessage('registerTrade', (player, { cardCount, cardIds }) => {
      if (!this._gameActive) return;

      // 소유 카드 검증 (보유 개수 충족 검사로 복제/파괴 핵 가드)
      const hand = this._playerHands.get(player.id) || [];
      if (!this._hasMatchingCards(hand, cardIds) || cardIds.length !== cardCount) return;

      this._activeTrades.set(player.id, { cardCount, cardIds });
      this._broadcastTradeState();

      if (this._isDemo) {
        this._demoSimulator.onMarketChange();
      }
    });

    // 2. 거래 등록 취소
    this.onMessage('cancelTrade', (player) => {
      if (!this._gameActive) return;
      this._activeTrades.delete(player.id);
      this._broadcastTradeState();
    });

    // 3. 거래 매칭 수락
    this.onMessage('executeTrade', (player, { targetPlayerId, cardCount, cardIds }) => {
      if (!this._gameActive || this._isTradingLocked) return;

      // 자기 자신과의 거래 가드
      if (player.id === targetPlayerId) return;

      // 동시성 락(Lock) 획득
      this._isTradingLocked = true;

      const trade = this._activeTrades.get(targetPlayerId);
      if (!trade || trade.cardCount !== cardCount) {
        this._isTradingLocked = false;
        return;
      }

      // 두 거래 당사자의 핸드 검증
      const handA = this._playerHands.get(player.id) || [];
      const handB = this._playerHands.get(targetPlayerId) || [];

      if (!this._hasMatchingCards(handA, cardIds) || !this._hasMatchingCards(handB, trade.cardIds)) {
        this._isTradingLocked = false;
        return;
      }

      // 카드 교환 수행 (단일 트랜잭션 보장)
      cardIds.forEach(cid => {
        const idx = handA.indexOf(cid);
        handA.splice(idx, 1);
      });
      trade.cardIds.forEach(cid => {
        const idx = handB.indexOf(cid);
        handB.splice(idx, 1);
      });

      cardIds.forEach(cid => handB.push(cid));
      trade.cardIds.forEach(cid => handA.push(cid));

      // 거래 등록 소거
      this._activeTrades.delete(player.id);
      this._activeTrades.delete(targetPlayerId);

      // 교환받은 유저에게 조커/감점 카드 햅틱 노티 피드백용 전송
      const hasBearA = trade.cardIds.includes('bear');
      const hasBearB = cardIds.includes('bear');

      this.sendToPlayer(player.id, 'tradeExecuted', { 
        hand: handA, 
        gotBear: hasBearA, 
        poolCounts: Object.fromEntries(this._commodityPoolCounts) 
      });
      this.sendToPlayer(targetPlayerId, 'tradeExecuted', { 
        hand: handB, 
        gotBear: hasBearB, 
        poolCounts: Object.fromEntries(this._commodityPoolCounts) 
      });

      this._isTradingLocked = false;
      this._broadcastTradeState();
      this._renderHUDStandings();

      if (this._isDemo) {
        this._demoSimulator.onMarketChange();
      }
    });

    // 3. 종 울리기 요청
    this.onMessage('ringBell', (player) => {
      if (!this._gameActive) return;

      // 독점 여부 최종 재검증
      const hand = this._playerHands.get(player.id) || [];
      let counts = {};
      let bullCount = 0;
      hand.forEach(c => {
        if (c === 'bull') bullCount++;
        else if (c !== 'bear') {
          counts[c] = (counts[c] || 0) + 1;
        }
      });
      let isCornered = false;
      Object.keys(counts).forEach(c => {
        const target = (this._commodityPoolCounts.get(c) || 9) - 1;
        if (counts[c] + bullCount >= target) {
          isCornered = true;
        }
      });

      if (isCornered) {
        this._endRound(player.id);
      }
    });
  }

  // ─── Web Audio API 합성 오디오 ───

  _initAudio() {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  // 웅성웅성 노이즈 루프 가동
  _startAmbientNoise() {
    try {
      this._initAudio();
      const ctx = this._audioCtx;
      if (ctx.state === 'suspended') ctx.resume();

      const bufferSize = ctx.sampleRate * 2; // 2초 화이트 노이즈 버퍼
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noiseNode = ctx.createBufferSource();
      noiseNode.buffer = buffer;
      noiseNode.loop = true;

      // 대역통과 필터 (사람 웅성거림 대역 설정)
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(450, ctx.currentTime);
      filter.Q.setValueAtTime(1.2, ctx.currentTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.08, ctx.currentTime); // 잔잔한 볼륨

      noiseNode.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noiseNode.start();
      this._ambientSource = noiseNode;
    } catch (e) {
      console.warn('Audio synthesis fail:', e);
    }
  }

  _stopAmbientNoise() {
    if (this._ambientSource) {
      try {
        this._ambientSource.stop();
      } catch (e) {}
      this._ambientSource = null;
    }
  }

  // 맑고 울려퍼지는 황동 종소리
  _playBellSound() {
    try {
      this._initAudio();
      const ctx = this._audioCtx;
      const now = ctx.currentTime;

      // 다중 사인파 가산 합성 (종소리의 고주파 배음 성분)
      const frequencies = [440, 554, 659, 880, 1200];
      frequencies.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now);

        // 배음별 서서히 감쇠하는 엔벨로프
        gain.gain.setValueAtTime(0.15 / (idx + 1), now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 2.6);
      });
    } catch (e) {}
  }
}

// SDK 실행 및 게임 바인딩
const sdk = new HostSDK({ gameId: 'pit-trade' });
new PitTradeHost(sdk);
