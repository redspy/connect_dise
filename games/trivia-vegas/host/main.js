import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { HostSDK } from '../../../platform/client/HostSDK.js';
import { TriviaVegasDemoSimulator } from './DemoSimulator.js';

export class TriviaVegasGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'tv-overlay', qrContainerId: 'qr-box' });

    // 기본 데이터셋 (상식 숫자 퀴즈)
    this._triviaList = [
      { question: '자이언트 판다가 하루에 먹는 대나무의 평균 무게는 몇 kg일까요?', answer: 15 },
      { question: '에펠탑의 실제 정밀 높이는 몇 미터일까요? (안테나 포함)', answer: 330 },
      { question: '라이트 형제가 최초의 동력 비행을 성공한 연도는 몇 년도일까요?', answer: 1903 },
      { question: '달의 평균 표면 온도는 영하 몇 도(°C)일까요?', answer: 130 },
      { question: '모나리자 그림의 세로 정밀 길이는 몇 cm일까요?', answer: 77 },
      { question: '세계에서 가장 깊은 마리아나 해구의 깊이는 몇 미터일까요?', answer: 10984 },
      { question: '세계 최초의 상업용 여객기 보잉 707이 첫 비행을 한 연도는?', answer: 1957 }
    ];

    this._round = 1;
    this._maxRounds = 3;
    this._gameActive = false;
    this._roundPhase = 'estimates'; // 'estimates' | 'betting' | 'resolved'

    this._questions = [];
    this._playerEstimates = new Map(); // id -> number
    this._playerBalances = new Map(); // id -> money (default 1000)
    this._playerBets = new Map(); // id -> { slotIndex, amount }

    this._sortedSlots = [];
    this._winnerSlotIndex = -1;

    this._bettingTimer = null;
    this._bettingTimeLeft = 20;

    this._demoSimulator = new TriviaVegasDemoSimulator(this);
    this._isDemo = false;

    this._wireMessages();
  }

  async onSetup({ sessionId }) {
    this.setPhase('lobby');

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

    const sortBtn = document.getElementById('btn-sort-estimates');
    if (sortBtn) {
      sortBtn.onclick = () => this._sortEstimates();
    }

    const resolveBtn = document.getElementById('btn-resolve-bets');
    if (resolveBtn) {
      resolveBtn.onclick = () => this._resolveBets();
    }

    const nextBtn = document.getElementById('btn-next-round');
    if (nextBtn) {
      nextBtn.onclick = () => this._handleNextRound();
    }

    const restartBtn = document.getElementById('btn-restart-result');
    if (restartBtn) {
      restartBtn.onclick = () => this.resetSession();
    }
  }

  onPlayerJoin(player) {
    this._resetIdleTimer();
    this.renderLobbyPlayers(this._playerNicknames);
  }

  onPlayerLeave(playerId) {
    this._playerEstimates.delete(playerId);
    this._playerBalances.delete(playerId);
    this._playerBets.delete(playerId);
    this.renderLobbyPlayers(this._playerNicknames);

    if (this._gameActive && this._roundPhase === 'estimates') {
      this._checkAllEstimatesSubmitted();
    }
  }

  onPlayerRejoin(player) {
    this._resetIdleTimer();
    this.renderLobbyPlayers(this._playerNicknames);

    if (this._gameActive) {
      // 진행중인 상태 복원
      this.sendToPlayer(player.id, 'rejoinState', {
        phase: 'playing',
        roundPhase: this._roundPhase,
        round: this._round,
        question: this._questions[this._round - 1].question,
        balance: this._playerBalances.get(player.id) || 1000,
        hasSubmitted: this._playerEstimates.has(player.id),
        slots: this._sortedSlots,
        winnerSlotIndex: this._winnerSlotIndex,
        correctAnswer: this._questions[this._round - 1].answer
      });
    } else {
      this.sendToPlayer(player.id, 'lobbyState', { phase: 'lobby' });
    }
  }

  onAllReady() {
    this._startGame();
  }

  onReset() {
    this._demoSimulator.stopDemo();
    this._gameActive = false;
    this._round = 1;
    this._winnerSlotIndex = -1;
    this._playerEstimates.clear();
    this._playerBalances.clear();
    this._playerBets.clear();
    this._sortedSlots = [];
    if (this._bettingTimer) clearInterval(this._bettingTimer);

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) demoPlayBtn.textContent = '🤖 데모 플레이 실행';

    document.getElementById('submission-board').innerHTML = '';
    document.getElementById('betting-table').innerHTML = '';
    document.getElementById('timer-box').style.display = 'none';

    this.setPhase('lobby');
  }

  // ─── Game Cycle ───────────────────────────────────────────────────────────

  _startGame() {
    this._gameActive = true;
    this._round = 1;
    this._winnerSlotIndex = -1;
    this._playerEstimates.clear();
    this._playerBalances.clear();
    this._playerBets.clear();

    const plist = [...this.players.values()];
    plist.forEach(p => this._playerBalances.set(p.id, 1000)); // 초기금 $1,000

    // 랜덤 질문 선택
    const pool = [...this._triviaList];
    this._questions = [];
    for (let i = 0; i < this._maxRounds; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      this._questions.push(pool.splice(idx, 1)[0]);
    }

    this.setPhase('playing');
    this._startRound();
  }

  _startRound() {
    this._roundPhase = 'estimates';
    this._playerEstimates.clear();
    this._playerBets.clear();
    this._sortedSlots = [];
    this._winnerSlotIndex = -1;

    // HUD 및 타이머
    const roundEl = document.getElementById('hud-round');
    const phaseEl = document.getElementById('hud-phase-label');
    const qEl = document.getElementById('current-question');
    const timerBox = document.getElementById('timer-box');

    if (roundEl) roundEl.textContent = `${this._round} / ${this._maxRounds}`;
    if (phaseEl) phaseEl.textContent = '추정 답안 작성 중';
    if (qEl) qEl.textContent = this._questions[this._round - 1].question;
    if (timerBox) timerBox.style.display = 'none';

    // 버튼 초기화
    document.getElementById('btn-sort-estimates')?.classList.add('hidden');
    document.getElementById('btn-resolve-bets')?.classList.add('hidden');
    document.getElementById('btn-next-round')?.classList.add('hidden');

    document.getElementById('submission-board').classList.remove('hidden');
    document.getElementById('betting-table').classList.add('hidden');

    this._renderSubmissionGrid();

    // 모바일 지시 전송
    this.broadcast('newQuestion', {
      round: this._round,
      question: this._questions[this._round - 1].question
    });

    if (this._isDemo) {
      this._demoSimulator.queueBotEstimates(this._questions[this._round - 1].question);
    }
  }

  _checkAllEstimatesSubmitted() {
    const plist = [...this.players.values()];
    let submittedCount = 0;
    plist.forEach(p => {
      if (this._playerEstimates.has(p.id)) submittedCount++;
    });

    if (submittedCount >= plist.length && plist.length > 0) {
      document.getElementById('btn-sort-estimates')?.classList.remove('hidden');
    } else {
      document.getElementById('btn-sort-estimates')?.classList.add('hidden');
    }
  }

  // ─── 베팅 테이블 정렬 ──────────────────────────────────────────────────────

  _sortEstimates() {
    this._roundPhase = 'betting';
    document.getElementById('btn-sort-estimates')?.classList.add('hidden');

    const plist = [...this.players.values()];
    const uniqueEstimates = [];

    // 유니크한 숫자 답안 수집 및 매칭
    plist.forEach(p => {
      const val = this._playerEstimates.get(p.id) || 0;
      const nickname = this._playerNicknames.get(p.id) || p.nickname || '익명';
      
      const match = uniqueEstimates.find(e => e.value === val);
      if (match) {
        match.creatorNicknames.push(nickname);
      } else {
        uniqueEstimates.push({
          value: val,
          creatorNicknames: [nickname],
          creatorId: p.id
        });
      }
    });

    // 오름차순 정렬
    uniqueEstimates.sort((a, b) => a.value - b.value);

    // Banker 슬롯 추가 (정답 미만인 답안이 없는 경우 베팅 슬롯, 기본 5배)
    const slots = [{
      value: '정답 이하 없음',
      creatorNicknames: ['Banker'],
      isBanker: true,
      multiplier: 5
    }];

    // 각 정렬된 슬롯에 중앙값 비례 배당율 할당 (2배 ~ 5배)
    const midIdx = Math.floor(uniqueEstimates.length / 2);
    uniqueEstimates.forEach((item, idx) => {
      const dist = Math.abs(idx - midIdx);
      const mult = Math.min(5, 2 + dist); // 중앙값은 2배, 멀어질수록 3배, 4배, 5배 배당
      slots.push({
        value: item.value,
        creatorNicknames: item.creatorNicknames,
        creatorId: item.creatorId,
        isBanker: false,
        multiplier: mult
      });
    });

    this._sortedSlots = slots;

    // 테이블 렌더링 전환
    document.getElementById('submission-board').classList.add('hidden');
    const tableEl = document.getElementById('betting-table');
    tableEl.classList.remove('hidden');
    this._renderBettingTable();

    // 모바일에 베팅 보드 전송
    plist.forEach(p => {
      const bal = this._playerBalances.get(p.id) || 1000;
      this.sendToPlayer(p.id, 'bettingStart', {
        slots: this._sortedSlots,
        balance: bal
      });
    });

    // 20초 베팅 카운트다운 타이머 시작
    this._startBettingTimer();
  }

  _startBettingTimer() {
    this._bettingTimeLeft = this._isDemo ? 3 : 20;
    const timerBox = document.getElementById('timer-box');
    const timerEl = document.getElementById('hud-timer');
    const phaseEl = document.getElementById('hud-phase-label');

    if (timerBox) timerBox.style.display = 'block';
    if (timerEl) timerEl.textContent = `${this._bettingTimeLeft}초`;
    if (phaseEl) phaseEl.textContent = '베팅 진행 단계';

    if (this._bettingTimer) clearInterval(this._bettingTimer);
    this._bettingTimer = setInterval(() => {
      this._bettingTimeLeft--;
      if (timerEl) timerEl.textContent = `${this._bettingTimeLeft}초`;

      if (this._bettingTimeLeft <= 0) {
        clearInterval(this._bettingTimer);
        document.getElementById('btn-resolve-bets')?.classList.remove('hidden');
        if (phaseEl) phaseEl.textContent = '베팅 마감 (정산 대기)';
        
        // 모바일에 베팅 종료 신호
        this.broadcast('bettingTimeOut', {});

        if (this._isDemo) {
          // 데모 진행시 강제 배당금 정산
          setTimeout(() => this._resolveBets(), 1000);
        }
      }
    }, 1000);

    if (this._isDemo) {
      this._demoSimulator.queueBotBets();
    }
  }

  // ─── 베팅 정산 ──────────────────────────────────────────────────────────

  _resolveBets() {
    if (this._roundPhase !== 'betting') return;
    this._roundPhase = 'resolved';
    document.getElementById('btn-resolve-bets')?.classList.add('hidden');
    document.getElementById('timer-box').style.display = 'none';

    const questionObj = this._questions[this._round - 1];
    const answer = questionObj.answer;

    // 우승 슬롯 판정
    // 조건: 정답 이하(<=)인 값 중 가장 큰 값.
    // 만약 모든 값들이 정답을 초과하면 Banker 슬롯(0번)이 우승.
    let winIdx = 0; // default Banker
    let maxVal = -Infinity;

    for (let i = 1; i < this._sortedSlots.length; i++) {
      const slotVal = this._sortedSlots[i].value;
      if (slotVal <= answer && slotVal > maxVal) {
        maxVal = slotVal;
        winIdx = i;
      }
    }

    this._winnerSlotIndex = winIdx;
    const winSlot = this._sortedSlots[winIdx];

    // 정산 분배금 계산 및 가산
    const payoutMap = new Map(); // playerId -> payoutAmount
    const plist = [...this.players.values()];

    // 1. 배당금 지급
    plist.forEach(p => {
      const bet = this._playerBets.get(p.id);
      let payout = 0;
      if (bet && bet.slotIndex === winIdx) {
        payout = bet.amount * winSlot.multiplier;
        const curBal = this._playerBalances.get(p.id) || 0;
        this._playerBalances.set(p.id, curBal + payout);
      }
      payoutMap.set(p.id, payout);
    });

    // 2. Wits & Wagers 스페셜 정답 보너스: 정확한 우승 추정치를 적어 올린 제작자에게 +$200 지급
    if (!winSlot.isBanker && winSlot.creatorId) {
      plist.forEach(p => {
        if (p.id === winSlot.creatorId) {
          const curBal = this._playerBalances.get(p.id) || 0;
          this._playerBalances.set(p.id, curBal + 200);
          payoutMap.set(p.id, (payoutMap.get(p.id) || 0) + 200);
        }
      });
    }

    // 결과 렌더링 갱신
    this._renderBettingTable();

    // 모바일에 결과 패킷 브로드캐스트
    const balObj = {};
    plist.forEach(p => {
      balObj[p.id] = this._playerBalances.get(p.id) || 0;
    });

    plist.forEach(p => {
      this.sendToPlayer(p.id, 'roundResolved', {
        correctAnswer: answer,
        winnerSlotIndex: winIdx,
        payout: payoutMap.get(p.id) || 0,
        balance: this._playerBalances.get(p.id) || 0
      });
    });

    // 다음/종료 제어 버튼 노출
    const nextBtn = document.getElementById('btn-next-round');
    if (nextBtn) {
      nextBtn.classList.remove('hidden');
      nextBtn.textContent = this._round < this._maxRounds ? '다음 라운드 ➔' : '최종 성적 발표 🏆';
    }
  }

  _handleNextRound() {
    if (this._round < this._maxRounds) {
      this._round++;
      this._startRound();
    } else {
      this._endGame();
    }
  }

  _endGame() {
    this._gameActive = false;

    const plist = [...this.players.values()];
    const ranking = plist.map(p => ({
      id: p.id,
      nickname: this._playerNicknames.get(p.id) || p.nickname || '익명',
      score: this._playerBalances.get(p.id) || 0,
      color: p.color
    }));

    // 보유 자산 내림차순 정렬
    ranking.sort((a, b) => b.score - a.score);

    const winnerName = ranking[0] ? ranking[0].nickname : '없음';

    this.broadcast('gameFinished', {
      ranking,
      winner: winnerName
    });

    const rankingList = document.getElementById('ranking-list');
    if (rankingList) {
      rankingList.innerHTML = ranking.map((item, idx) => `
        <div class="rank-row">
          <div class="rank-num">#${idx + 1}</div>
          <div class="rank-name-box">
            <span class="visual-chip" style="background-color: ${item.color}">${item.nickname[0]}</span>
            <span style="font-weight: bold; font-size: 1.1rem; color: #fff;">${item.nickname}</span>
          </div>
          <div class="rank-score">$${item.score.toLocaleString()}</div>
        </div>
      `).join('');
    }

    this.setPhase('result');
  }

  // ─── 렌더링 헬퍼 ─────────────────────────────────────────────────────────

  _renderSubmissionGrid() {
    const grid = document.getElementById('submission-board');
    if (!grid) return;

    const plist = [...this.players.values()];
    grid.innerHTML = plist.map(p => {
      const hasSubmitted = this._playerEstimates.has(p.id);
      const nickname = this._playerNicknames.get(p.id) || p.nickname || '익명';
      const firstChar = nickname[0] || 'P';

      return `
        <div class="submission-card ${hasSubmitted ? 'submitted' : ''}">
          <div class="user-avatar" style="background-color: ${p.color}">${firstChar}</div>
          <div class="user-name">${nickname}</div>
          <div class="user-status">${hasSubmitted ? '제출 완료! 🔐' : '추정 입력 중... 💬'}</div>
        </div>
      `;
    }).join('');
  }

  _renderBettingTable() {
    const table = document.getElementById('betting-table');
    if (!table) return;

    table.innerHTML = this._sortedSlots.map((slot, idx) => {
      const isWinner = this._winnerSlotIndex === idx;
      let slotClass = 'betting-slot';
      if (isWinner) slotClass += ' winner-slot';

      // 해당 슬롯에 도달한 배팅 칩 렌더링
      const chipsHtml = [];
      this._playerBets.forEach((bet, playerId) => {
        if (bet.slotIndex === idx) {
          const player = this.getPlayer(playerId) || { color: '#888' };
          chipsHtml.push(`
            <div class="visual-chip" style="background-color: ${player.color}" title="$${bet.amount}">
              $${bet.amount}
            </div>
          `);
        }
      });

      return `
        <div class="${slotClass}">
          <div class="payout-puck">${slot.multiplier}:1 Payout</div>
          <div class="slot-value">${slot.value.toLocaleString()}</div>
          <div class="slot-creator">${slot.creatorNicknames.join(', ')}</div>
          
          <div class="slot-chips-zone">
            ${chipsHtml.join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── 메시지 맵 ───────────────────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('setProfile', (player, { nickname }) => {
      player.nickname = nickname;
      this.setPlayerName(player.id, nickname);
      this.renderLobbyPlayers(this._playerNicknames);
    });

    this.onMessage('submitEstimate', (player, { value }) => {
      if (!this._gameActive || this._roundPhase !== 'estimates') return;

      const num = parseFloat(value);
      if (isNaN(num)) return;

      this._playerEstimates.set(player.id, num);
      this._renderSubmissionGrid();
      this._checkAllEstimatesSubmitted();
    });

    this.onMessage('placeBet', (player, { slotIndex, amount }) => {
      if (!this._gameActive || this._roundPhase !== 'betting') return;

      const idx = parseInt(slotIndex);
      const amt = parseInt(amount);

      if (idx < 0 || idx >= this._sortedSlots.length) return;
      if (amt <= 0) return;

      const curBal = this._playerBalances.get(player.id) || 0;
      if (curBal < amt) return;

      // 이전 배팅이 있다면 자금 환급 후 덮어쓰기
      const prevBet = this._playerBets.get(player.id);
      if (prevBet) {
        this._playerBalances.set(player.id, curBal + prevBet.amount);
      }

      // 배팅 금액 차감 및 등록
      const nextBal = this._playerBalances.get(player.id) || 0;
      this._playerBalances.set(player.id, nextBal - amt);
      this._playerBets.set(player.id, { slotIndex: idx, amount: amt });

      this._renderBettingTable();

      // 바뀐 보유머니 전송
      this.sendToPlayer(player.id, 'betUpdate', {
        balance: this._playerBalances.get(player.id),
        slotIndex: idx,
        amount: amt
      });
    });
  }
}

// SDK 엔트리 초기화
const sdk = new HostSDK({ gameId: 'trivia-vegas' });
new TriviaVegasGame(sdk);
