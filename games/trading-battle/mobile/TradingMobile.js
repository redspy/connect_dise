import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';

const INITIAL_BALANCE = 100000000;

const AVATARS = [
  { id: 0, image: '/games/nunchi-ten/assets/avatars/01_bear_explorer.png', label: '곰 탐험가' },
  { id: 1, image: '/games/nunchi-ten/assets/avatars/02_robot.png', label: '로봇' },
  { id: 2, image: '/games/nunchi-ten/assets/avatars/03_wizard_cat.png', label: '마법사 고양이' },
  { id: 3, image: '/games/nunchi-ten/assets/avatars/04_goblin.png', label: '고블린' },
  { id: 4, image: '/games/nunchi-ten/assets/avatars/05_ghost.png', label: '유령' },
  { id: 5, image: '/games/nunchi-ten/assets/avatars/06_knight.png', label: '기사' },
  { id: 6, image: '/games/nunchi-ten/assets/avatars/07_fox_pilot.png', label: '여우 조종사' },
  { id: 7, image: '/games/nunchi-ten/assets/avatars/08_penguin.png', label: '펭귄' },
];

export class TradingMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'tb-screen' });

    this._nickname = '';
    this._avatarId = 0;
    this._position = { type: 'cash', balance: INITIAL_BALANCE };
    this._equity = INITIAL_BALANCE;
    this._pendingOrder = null;
    this._leverageEnabled = true;
    this._candleInterval = 3000;
    this._candleTimerRaf = null;
    this._otherPlayers = [];
    this._timeLeft = 0;
    this._countdownTimer = null;
    this._gamePhase = 'lobby';

    this._prefillNickname();
    this._wireUI();
    this._wireMessages();
    this._renderAvatarGrid();
  }

  // ─── MobileBaseGame hooks ────────────────────────────────────────────────

  onJoin() {
    this.showScreen('setup');
  }

  onRejoin() {
    if (this._nickname) this._sendProfile();
  }

  onReset() {
    this._position = { type: 'cash', balance: INITIAL_BALANCE };
    this._equity = INITIAL_BALANCE;
    this._pendingOrder = null;
    this._gamePhase = 'lobby';
    this._clearCountdown();
    this._stopCandleTimer();

    if (this._nickname) {
      this._sendProfile();
    } else {
      this.showScreen('setup');
    }
  }

  // ─── Messages ────────────────────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('rejoinState', (payload) => this._applyRejoinState(payload));

    this.onMessage('playerListUpdated', ({ players }) => {
      this._otherPlayers = players.filter((p) => p.id !== this.playerId);
    });

    this.onMessage('gameStarted', ({ settings, players }) => {
      this._leverageEnabled = settings?.leverageEnabled ?? true;
      this._candleInterval = settings?.candleInterval ?? 3000;
      this._position = { type: 'cash', balance: INITIAL_BALANCE };
      this._equity = INITIAL_BALANCE;
      this._pendingOrder = null;
      this._otherPlayers = players.filter((p) => p.id !== this.playerId);

      // 차트 분석 페이즈로 이동 (10초)
      this.showScreen('chart_analysis');
      this._showAnalysisCountdown(10, () => {
        this._gamePhase = 'trading';
        this._renderTradingScreen();
        this.showScreen('trading');
        this._startCandleTimer();
      });
    });

    this.onMessage('countdown', ({ count }) => {
      this._showCountdownOverlay(count);
    });

    this.onMessage('candleRevealed', ({ candle, players }) => {
      this._otherPlayers = players.filter((p) => p.id !== this.playerId);
      const me = players.find((p) => p.id === this.playerId);
      if (me) {
        this._equity = me.equity;
        this._position.type = me.position;
        this._position.entryBalance = me.entryBalance;
      }
      this._pendingOrder = null;
      this._hideSettledOverlay();
      this._startCandleTimer();
      this._renderTradingScreen();
    });

    this.onMessage('timerUpdate', ({ timeLeft }) => {
      this._timeLeft = timeLeft;
      this._updateTimerDisplay();
    });

    this.onMessage('orderAccepted', ({ orderType, equity }) => {
      // 즉시 포지션 업데이트
      this._position.type = orderType;
      if (equity != null) {
        this._equity = equity;
        this._position.entryBalance = equity;
      }
      this._pendingOrder = orderType; // 다음 캔들까지 잠금
      this._renderTradingScreen();
      this._showSettledOverlay();
    });

    this.onMessage('playerOrderPending', ({ players }) => {
      this._otherPlayers = players.filter((p) => p.id !== this.playerId);
    });

    this.onMessage('gameFinished', ({ rankings }) => {
      this._showGameResult(rankings);
    });
  }

  // ─── UI wiring ───────────────────────────────────────────────────────────

  _wireUI() {
    // 설정 화면: 아바타 선택
    document.addEventListener('click', (e) => {
      if (e.target.closest('.avatar-btn')) {
        const btn = e.target.closest('.avatar-btn');
        const id = parseInt(btn.dataset.avatarId);
        this._selectAvatar(id);
      }
    });

    // 설정 화면: 참가하기
    document.getElementById('btn-join')?.addEventListener('click', () => {
      const nick = document.getElementById('nickname-input')?.value.trim();
      if (!nick) {
        alert('닉네임을 입력해주세요');
        return;
      }
      this._nickname = nick;
      localStorage.setItem('trading_nickname', nick);
      localStorage.setItem('trading_avatarId', this._avatarId);
      this._sendProfile();
    });

    // 대기 화면: 준비
    document.getElementById('btn-ready')?.addEventListener('click', (e) => {
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = '준비완료 ✓';
      this.ready();
    });

    // 거래 버튼
    const orders = [
      { id: 'btn-long2x', type: 'long2x' },
      { id: 'btn-long', type: 'long' },
      { id: 'btn-short', type: 'short' },
      { id: 'btn-short2x', type: 'short2x' },
      { id: 'btn-cash', type: 'cash' },
    ];
    for (const { id, type } of orders) {
      document
        .getElementById(id)
        ?.addEventListener('click', () => this._placeOrder(type));
    }

    // 결과 화면: 다시하기
    document.getElementById('btn-rematch')?.addEventListener('click', () => {
      this.sendToHost('requestRematch', {});
    });
  }

  // ─── Profile ─────────────────────────────────────────────────────────────

  _prefillNickname() {
    const saved = localStorage.getItem('trading_nickname');
    const savedAvatarId = localStorage.getItem('trading_avatarId');

    if (saved) {
      this._nickname = saved;
      const input = document.getElementById('nickname-input');
      if (input) input.value = saved;
    } else {
      const adjs = [
        '빠른',
        '느린',
        '용감한',
        '조용한',
        '탐욕스런',
        '냉철한',
        '대담한',
        '침착한',
      ];
      const nouns = [
        '워렌버핏',
        '일론머스크',
        '진도준',
        '피터린치',
        '존보글',
        '트럼프',
        '레이달리오',
        '조지소로스',
      ];
      const input = document.getElementById('nickname-input');
      if (input)
        input.value = `${adjs[Math.floor(Math.random() * adjs.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}`;
    }

    if (savedAvatarId != null) {
      this._avatarId = parseInt(savedAvatarId);
    }
  }

  _renderAvatarGrid() {
    const grid = document.getElementById('avatar-grid');
    if (!grid) return;

    grid.innerHTML = AVATARS.map(
      (avatar) => `
      <button class="avatar-btn ${avatar.id === this._avatarId ? 'selected' : ''}" data-avatar-id="${avatar.id}" title="${avatar.label}">
        <img src="${avatar.image}" alt="${avatar.label}" />
      </button>
    `,
    ).join('');
  }

  _selectAvatar(id) {
    this._avatarId = id;
    this._renderAvatarGrid();
  }

  _sendProfile() {
    this.sendToHost('setProfile', {
      nickname: this._nickname,
      avatarId: this._avatarId,
    });
    document.getElementById('waiting-nickname')?.textContent &&
      (document.getElementById('waiting-nickname').textContent =
        this._nickname);
    this.showScreen('waiting');
  }

  // ─── Trading ─────────────────────────────────────────────────────────────

  _placeOrder(orderType) {
    if (this._pendingOrder !== null) return; // 이미 주문 대기 중
    if (
      !this._leverageEnabled &&
      (orderType === 'long2x' || orderType === 'short2x')
    )
      return;
    if (this._position.type === orderType) return; // 이미 같은 포지션

    this.sendToHost('placeOrder', { orderType });
  }

  _renderTradingScreen() {
    // 상단 상태
    const pnlPct = ((this._equity - INITIAL_BALANCE) / INITIAL_BALANCE) * 100;
    const el = (id) => document.getElementById(id);

    if (el('my-equity'))
      el('my-equity').textContent =
        `₩${this._equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    if (el('my-pnl')) {
      el('my-pnl').textContent =
        `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`;
      el('my-pnl').className =
        `stat-value ${pnlPct >= 0 ? 'positive' : 'negative'}`;
    }
    if (el('my-position'))
      el('my-position').textContent = _positionLabel(this._position.type);

    // 포지션 수익률 표시
    this._renderPositionPnl();

    this._renderOrderButtons();
  }

  _renderPositionPnl() {
    const el = (id) => document.getElementById(id);
    const positionPnlBar = el('position-pnl-bar');
    if (!positionPnlBar) return;

    const isCash = this._position.type === 'cash';
    if (isCash) {
      positionPnlBar.classList.add('hidden');
      return;
    }

    // 포지션이 있을 때 수익률과 수익금액 계산 (진입 시점 기준)
    const entryBalance = this._position.entryBalance || INITIAL_BALANCE;
    const pnlAmount = this._equity - entryBalance;
    const pnlPct = (pnlAmount / entryBalance) * 100;

    positionPnlBar.classList.remove('hidden');

    if (el('position-pnl-pct')) {
      el('position-pnl-pct').textContent =
        `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`;
      el('position-pnl-pct').className =
        `position-pnl-pct ${pnlPct >= 0 ? 'positive' : 'negative'}`;
    }
    if (el('position-pnl-amount')) {
      el('position-pnl-amount').textContent =
        `${pnlAmount >= 0 ? '+' : ''}₩${Math.abs(pnlAmount).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
      el('position-pnl-amount').className =
        `position-pnl-amount ${pnlAmount >= 0 ? 'positive' : 'negative'}`;
    }
  }

  _renderOrderButtons() {
    const hasCash = this._position.type === 'cash';
    const orderGrid = document.getElementById('order-grid');
    const sellWrap = document.getElementById('sell-btn-wrap');

    if (orderGrid) orderGrid.classList.toggle('hidden', !hasCash);
    if (sellWrap) sellWrap.classList.toggle('hidden', hasCash);

    // 레버리지 비활성화 시 2배 버튼 숨김
    if (!this._leverageEnabled) {
      document
        .getElementById('btn-long2x')
        ?.style.setProperty('display', 'none');
      document
        .getElementById('btn-short2x')
        ?.style.setProperty('display', 'none');
    }
  }

  _updateTimerDisplay() {
    const el = document.getElementById('trading-timer');
    if (!el) return;
    const m = Math.floor(this._timeLeft / 60000);
    const s = Math.floor((this._timeLeft % 60000) / 1000);
    el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  _showCountdownOverlay(count) {
    const overlay = document.getElementById('countdown-overlay');
    const text = document.getElementById('countdown-text');
    if (!overlay || !text) return;
    if (count === 0) {
      overlay.classList.add('hidden');
    } else {
      text.textContent = count;
      overlay.classList.remove('hidden');
    }
  }

  _showSettledOverlay() {
    document.getElementById('settled-overlay')?.classList.remove('hidden');
  }

  _hideSettledOverlay() {
    document.getElementById('settled-overlay')?.classList.add('hidden');
  }

  _startCandleTimer() {
    this._stopCandleTimer();
    const bar = document.getElementById('candle-timer-bar-fill');
    if (!bar || !this._candleInterval) return;
    const start = performance.now();
    const interval = this._candleInterval;
    const animate = (now) => {
      const progress = Math.min((now - start) / interval, 1);
      bar.style.width = `${(1 - progress) * 100}%`;
      if (progress < 1) this._candleTimerRaf = requestAnimationFrame(animate);
    };
    this._candleTimerRaf = requestAnimationFrame(animate);
  }

  _stopCandleTimer() {
    if (this._candleTimerRaf) {
      cancelAnimationFrame(this._candleTimerRaf);
      this._candleTimerRaf = null;
    }
  }

  _showGameResult(rankings) {
    const me = rankings.find((p) => p.id === this.playerId);
    const myRank = me ? rankings.indexOf(me) + 1 : '-';
    const medals = ['🥇', '🥈', '🥉'];

    const el = (id) => document.getElementById(id);
    if (el('result-my-rank'))
      el('result-my-rank').textContent = medals[myRank - 1] ?? `${myRank}위`;
    if (el('result-my-equity'))
      el('result-my-equity').textContent = me
        ? `₩${me.equity.toLocaleString()}`
        : '--';
    if (el('result-my-pnl')) {
      const pnl = me?.pnlPct ?? 0;
      el('result-my-pnl').textContent =
        `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`;
      el('result-my-pnl').className =
        `result-pnl-big ${pnl >= 0 ? 'positive' : 'negative'}`;
    }

    const list = document.getElementById('result-list');
    if (list) {
      list.innerHTML = rankings
        .map(
          (p, i) => `
        <div class="result-row ${p.id === this.playerId ? 'me' : ''}">
          <span>${medals[i] ?? `${i + 1}위`}</span>
          <span class="result-row-name">${p.nickname}</span>
          <span class="result-row-equity">₩${p.equity.toLocaleString()}</span>
          <span class="${p.pnlPct >= 0 ? 'positive' : 'negative'}">${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(1)}%</span>
        </div>
      `,
        )
        .join('');
    }

    this.showScreen('game_result');
  }

  _applyRejoinState({
    phase,
    settings,
    players,
    myPosition,
    equity,
    timeLeft,
  }) {
    if (settings) this._leverageEnabled = settings.leverageEnabled ?? true;
    if (players)
      this._otherPlayers = players.filter((p) => p.id !== this.playerId);
    if (myPosition) this._position = myPosition;
    if (equity != null) this._equity = equity;
    if (timeLeft != null) this._timeLeft = timeLeft;

    if (phase === 'trading') {
      this._gamePhase = 'trading';
      this._renderTradingScreen();
      this.showScreen('trading');
      this._startCandleTimer();
    } else if (phase === 'game_result') {
      // 서버에서 rankings를 다시 보내줄 것이므로 대기
    } else {
      this.showScreen('waiting');
    }
  }

  _clearCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  }

  _showAnalysisCountdown(count, onComplete) {
    const el = document.getElementById('analysis-countdown');
    if (!el) {
      onComplete();
      return;
    }

    el.textContent = count;

    if (count > 0) {
      setTimeout(
        () => this._showAnalysisCountdown(count - 1, onComplete),
        1000,
      );
    } else {
      onComplete();
    }
  }
}

function _positionLabel(type) {
  switch (type) {
    case 'long':
      return '📈 롱';
    case 'short':
      return '📉 숏';
    case 'long2x':
      return '🚀 2배 롱';
    case 'short2x':
      return '💥 2배 숏';
    default:
      return '💰 현금';
  }
}
