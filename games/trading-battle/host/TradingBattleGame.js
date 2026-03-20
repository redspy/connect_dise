import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { generateStockData, randomStockName } from './stockData.js';

const INITIAL_BALANCE = 10000;

/**
 * 포지션 타입
 * cash / long / short / long2x / short2x
 */

export class TradingBattleGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'tb-overlay' });

    // 설정
    this._settings = {
      gameDuration: 5 * 60 * 1000, // 5분
      candleInterval: 3000,         // 3초
      leverageEnabled: true,
    };

    // 게임 데이터
    this._allCandles = [];      // 전체 캔들 (히스토리 + 게임)
    this._historyCount = 200;   // 초기 표시 캔들 수
    this._revealedCount = 0;    // 게임 중 공개된 캔들 수
    this._stockName = '';

    // 플레이어 데이터
    this._profiles = new Map();  // id → { nickname, avatarId }
    this._positions = new Map(); // id → { type, entryPrice, balance }
    this._pendingOrders = new Map(); // id → orderType (다음 캔들에 체결)

    // 타이머
    this._gameTimer = null;
    this._candleTimer = null;
    this._timeLeft = 0;
    this._gameStarted = false;

    this._chart = null;
    this._candleSeries = null;
    this._volumeSeries = null;
    this._maSeries = {};
    this._playerMarkers = [];

    this._wireMessages();
  }

  // ─── HostBaseGame hooks ──────────────────────────────────────────────────

  async onSetup({ sessionId }) {
    this._appbar = document.querySelector('game-appbar');
    if (this._appbar) this._appbar.onRestart = () => this.resetSession();

    const lobbyEl = document.querySelector('game-lobby');
    if (lobbyEl) lobbyEl.onStart = () => this._startGame();

    document.getElementById('btn-restart')?.addEventListener('click', () => this.resetSession());
    document.getElementById('btn-settings-start')?.addEventListener('click', () => this._applySettings());

    this._initSettingsUI();
    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    this._initPlayerPosition(player.id);
    this.renderLobbyPlayers(this._getLobbyProfiles());
  }

  onReadyUpdate({ readyCount }) {
    this.updateLobbyReady(readyCount);
  }

  onPlayerLeave(playerId) {
    this._profiles.delete(playerId);
    this._positions.delete(playerId);
    this._pendingOrders.delete(playerId);
    this.renderLobbyPlayers(this._getLobbyProfiles());
    this._renderPlayerPanels();
  }

  onPlayerRejoin(player) {
    this._sendRejoinState(player.id);
  }

  onPhaseChange(from, to) {
    const board = document.getElementById('game-board');
    if (board) board.classList.toggle('hidden', to !== 'trading');
  }

  onReset() {
    this._stopTimers();
    this._profiles.clear();
    this._positions.clear();
    this._pendingOrders.clear();
    this._gameStarted = false;
    this._revealedCount = 0;
    this._playerMarkers = [];

    for (const p of this.players.values()) this._initPlayerPosition(p.id);
    this.renderLobbyPlayers(this._getLobbyProfiles());
    this.setPhase('lobby');
  }

  // ─── Messages ───────────────────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('setProfile', (player, { nickname }) => {
      this._profiles.set(player.id, { nickname: nickname?.trim() || '익명' });
      this.renderLobbyPlayers(this._getLobbyProfiles());
      this._broadcastPlayerList();
      if (this._gameStarted) this._sendRejoinState(player.id);
    });

    this.onMessage('placeOrder', (player, { orderType }) => {
      this._handleOrder(player.id, orderType);
    });

    this.onMessage('requestRematch', () => {
      this.resetSession();
    });
  }

  // ─── Settings ───────────────────────────────────────────────────────────

  _initSettingsUI() {
    // 게임 시간 버튼
    document.querySelectorAll('[data-duration]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-duration]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._settings.gameDuration = parseInt(btn.dataset.duration) * 60 * 1000;
      });
    });
    // 캔들 간격 버튼
    document.querySelectorAll('[data-interval]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-interval]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._settings.candleInterval = parseInt(btn.dataset.interval) * 1000;
      });
    });
    // 레버리지 토글
    const leverageToggle = document.getElementById('leverage-toggle');
    if (leverageToggle) {
      leverageToggle.addEventListener('change', (e) => {
        this._settings.leverageEnabled = e.target.checked;
      });
    }
  }

  _applySettings() {
    // 설정 완료 → 로비로 이동 (QR 표시)
    this.setPhase('lobby');
  }

  // ─── Lobby ───────────────────────────────────────────────────────────────

  _initPlayerPosition(id) {
    this._positions.set(id, {
      type: 'cash',
      entryPrice: 0,
      balance: INITIAL_BALANCE,
    });
  }

  _getLobbyProfiles() {
    const map = new Map();
    for (const [id, profile] of this._profiles) {
      map.set(id, { nickname: profile.nickname });
    }
    return map;
  }

  _broadcastPlayerList() {
    this.broadcast('playerListUpdated', { players: this._buildPlayerList() });
  }

  _buildPlayerList() {
    return [...this.players.values()].map(p => {
      const pos = this._positions.get(p.id) || { type: 'cash', balance: INITIAL_BALANCE };
      const currentPrice = this._getCurrentPrice();
      const equity = this._calcEquity(pos, currentPrice);
      return {
        id: p.id,
        color: p.color,
        nickname: this._profiles.get(p.id)?.nickname ?? '익명',
        balance: pos.balance,
        equity,
        pnlPct: ((equity - INITIAL_BALANCE) / INITIAL_BALANCE) * 100,
        position: pos.type,
      };
    });
  }

  // ─── Game flow ───────────────────────────────────────────────────────────

  _startGame() {
    this._gameStarted = true;
    this._stockName = randomStockName();

    // 캔들 데이터 생성
    const totalNeeded = this._historyCount + Math.ceil(this._settings.gameDuration / this._settings.candleInterval) + 50;
    this._allCandles = generateStockData({ totalCandles: totalNeeded });
    this._revealedCount = 0;

    // 포지션 초기화
    for (const id of this.players.keys()) this._initPlayerPosition(id);

    this.broadcast('gameStarted', {
      stockName: this._stockName,
      settings: this._settings,
      players: this._buildPlayerList(),
    });

    // 게임 보드를 먼저 표시 (chart 컨테이너 크기 확보)
    this.setPhase('trading');

    // 차트 초기화 (DOM이 보여진 후)
    requestAnimationFrame(() => {
      this._initChart();

      // 히스토리 캔들 표시
      const historyCandles = this._allCandles.slice(0, this._historyCount);
      this._candleSeries.setData(historyCandles.map(c => ({
        time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
      })));
      this._volumeSeries.setData(historyCandles.map(c => ({
        time: c.time, value: c.volume, color: c.close >= c.open ? '#02c95388' : '#b4002b88',
      })));

      // 이동평균선 초기 데이터
      for (const period of [5, 10, 20, 50, 100]) {
        if (this._maSeries[period]) {
          this._maSeries[period].setData(this._calcMA(historyCandles, period));
        }
      }

      // 봉 두께 2배: fitContent 후 barSpacing 2배 적용
      this._chart.timeScale().fitContent();
      requestAnimationFrame(() => {
        const w = document.getElementById('chart-container')?.clientWidth ?? 1200;
        const barSpacing = Math.max(8, Math.round((w / this._historyCount) * 2));
        this._chart.timeScale().applyOptions({ barSpacing });
      });

      this._updatePriceDisplay(historyCandles[historyCandles.length - 1]?.close ?? 0);

      // 카운트다운 후 타이머 시작
      this._showCountdown(3, () => {
        this._startTimers();
      });
    });
  }

  _startTimers() {
    this._timeLeft = this._settings.gameDuration;

    // 타이머 카운트다운 (1초마다)
    this._gameTimer = setInterval(() => {
      this._timeLeft -= 1000;
      this._updateTimerDisplay();
      this.broadcast('timerUpdate', { timeLeft: this._timeLeft });
      if (this._timeLeft <= 0) this._endGame();
    }, 1000);

    // 캔들 공개
    this._candleTimer = setInterval(() => {
      this._revealNextCandle();
    }, this._settings.candleInterval);

    // 첫 캔들 즉시 공개
    this._revealNextCandle();
  }

  _revealNextCandle() {
    const idx = this._historyCount + this._revealedCount;
    if (idx >= this._allCandles.length) return;

    const candle = this._allCandles[idx];
    this._revealedCount++;

    // 미결 주문 체결
    this._settleOrders(candle);

    // 차트에 캔들 추가
    this._candleSeries.update({
      time: candle.time, open: candle.open, high: candle.high, low: candle.low, close: candle.close,
    });
    this._volumeSeries.update({
      time: candle.time, value: candle.volume,
      color: candle.close >= candle.open ? '#02c95388' : '#b4002b88',
    });

    // 이동평균선 업데이트
    const allSoFar = this._allCandles.slice(0, this._historyCount + this._revealedCount);
    for (const period of [5, 10, 20, 50, 100]) {
      if (!this._maSeries[period] || allSoFar.length < period) continue;
      const slice = allSoFar.slice(-period);
      const ma = slice.reduce((s, c) => s + c.close, 0) / period;
      this._maSeries[period].update({ time: candle.time, value: ma });
    }

    this._updatePriceDisplay(candle.close);
    this._renderPlayerPanels();
    this._updateRankingDisplay();

    this.broadcast('candleRevealed', {
      candle,
      players: this._buildPlayerList(),
    });
  }

  _settleOrders(candle) {
    // 즉시 체결 방식: 포지션은 이미 변경됨 — 다음 캔들 도달 시 잠금만 해제
    this._pendingOrders.clear();
  }

  _endGame() {
    this._stopTimers();

    // 모든 포지션 청산
    const finalPrice = this._getCurrentPrice();
    for (const [id, pos] of this._positions) {
      const equity = this._calcEquity(pos, finalPrice);
      pos.balance = equity;
      pos.type = 'cash';
    }

    const rankings = this._buildRankings();
    this.broadcast('gameFinished', { rankings });
    this._renderGameResult(rankings);
    this.setPhase('game_result');
  }

  _stopTimers() {
    if (this._gameTimer) { clearInterval(this._gameTimer); this._gameTimer = null; }
    if (this._candleTimer) { clearInterval(this._candleTimer); this._candleTimer = null; }
  }

  // ─── Order handling ──────────────────────────────────────────────────────

  _handleOrder(playerId, orderType) {
    if (this.phase !== 'trading') return;
    if (!['cash', 'long', 'short', 'long2x', 'short2x'].includes(orderType)) return;
    if (!this._settings.leverageEnabled && (orderType === 'long2x' || orderType === 'short2x')) return;

    const pos = this._positions.get(playerId);
    if (!pos) return;
    if (pos.type === orderType) return;
    if (this._pendingOrders.has(playerId)) return; // 이번 캔들 이미 주문

    // 즉시 체결 (현재 캔들 close 가격으로)
    const currentPrice = this._getCurrentPrice();
    const equity = this._calcEquity(pos, currentPrice);
    pos.balance = equity;
    pos.type = orderType;
    pos.entryPrice = orderType === 'cash' ? 0 : currentPrice;

    // 다음 캔들까지 재주문 잠금
    this._pendingOrders.set(playerId, orderType);

    const currentCandle = this._allCandles[this._historyCount + this._revealedCount - 1];
    if (currentCandle) {
      this._addMarker(playerId, currentCandle.time, orderType, currentPrice);
      this._updateMarkers();
    }

    this._renderPlayerPanels();
    this._updateRankingDisplay();

    this.sendToPlayer(playerId, 'orderAccepted', {
      orderType,
      equity: Math.round(equity),
    });
    this.broadcast('playerOrderPending', {
      playerId,
      orderType,
      players: this._buildPlayerList(),
    });
  }

  // ─── Equity calculation ──────────────────────────────────────────────────

  _calcEquity(pos, currentPrice) {
    if (pos.type === 'cash' || pos.entryPrice === 0) return pos.balance;
    const priceRatio = currentPrice / pos.entryPrice;
    let mult = 1;
    if (pos.type === 'long') mult = priceRatio;
    else if (pos.type === 'short') mult = 2 - priceRatio;
    else if (pos.type === 'long2x') mult = 1 + (priceRatio - 1) * 2;
    else if (pos.type === 'short2x') mult = 1 - (priceRatio - 1) * 2;
    return Math.max(0, pos.balance * mult);
  }

  _getCurrentPrice() {
    const idx = this._historyCount + this._revealedCount - 1;
    if (idx < 0 || idx >= this._allCandles.length) return 0;
    return this._allCandles[idx].close;
  }

  _buildRankings() {
    const finalPrice = this._getCurrentPrice();
    return [...this.players.values()]
      .map(p => {
        const pos = this._positions.get(p.id);
        const equity = pos ? this._calcEquity(pos, finalPrice) : INITIAL_BALANCE;
        return {
          id: p.id,
          color: p.color,
          nickname: this._profiles.get(p.id)?.nickname ?? '익명',
          equity: Math.round(equity),
          pnlPct: ((equity - INITIAL_BALANCE) / INITIAL_BALANCE) * 100,
        };
      })
      .sort((a, b) => b.equity - a.equity);
  }

  // ─── Chart ───────────────────────────────────────────────────────────────

  _initChart() {
    const { createChart } = window.LightweightCharts;
    const container = document.getElementById('chart-container');
    if (!container) return;
    container.innerHTML = '';

    const chart = createChart(container, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#bac9cc',
      },
      grid: {
        vertLines: { color: '#1c2026' },
        horzLines: { color: '#1c2026' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#3b494c' },
      timeScale: { borderColor: '#3b494c', timeVisible: true },
      width: container.clientWidth,
      height: container.clientHeight,
    });

    this._chart = chart;
    this._candleSeries = chart.addCandlestickSeries({
      upColor: '#02c953',
      downColor: '#b4002b',
      borderUpColor: '#02c953',
      borderDownColor: '#b4002b',
      wickUpColor: '#02c953',
      wickDownColor: '#b4002b',
    });

    // 볼륨 차트 (별도 패널)
    this._volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // 이동평균선 (5, 10, 20, 50, 100)
    const MA_CONFIGS = [
      { period: 5,   color: '#ff4040' },
      { period: 10,  color: '#ff8c00' },
      { period: 20,  color: '#ffd700' },
      { period: 50,  color: '#4a9eff' },
      { period: 100, color: '#9b59b6' },
    ];
    this._maSeries = {};
    for (const { period, color } of MA_CONFIGS) {
      this._maSeries[period] = chart.addLineSeries({
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    }

    // Resize observer
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    ro.observe(container);
  }

  _calcMA(candles, period) {
    const result = [];
    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
      result.push({ time: candles[i].time, value: sum / period });
    }
    return result;
  }

  _addMarker(playerId, time, type, price) {
    const profile = this._profiles.get(playerId);
    const name = profile?.nickname ?? '?';
    const player = this.players.get(playerId);
    const color = player?.color ?? '#00daf3';

    const isBuy = type.includes('long') || type.includes('pending_long');
    const isShort = type.includes('short') || type.includes('pending_short');
    const isCash = type === 'cash' || type === 'pending_cash';

    let text = name;
    if (type.includes('long2x')) text = `🚀${name}`;
    else if (type.includes('long')) text = `▲${name}`;
    else if (type.includes('short2x')) text = `💥${name}`;
    else if (type.includes('short')) text = `▼${name}`;
    else text = `💰${name}`;

    this._playerMarkers.push({
      time,
      position: (isBuy || type.includes('long')) ? 'belowBar' : 'aboveBar',
      color,
      shape: isCash ? 'circle' : (isShort ? 'arrowDown' : 'arrowUp'),
      text,
      size: 1,
    });
  }

  _updateMarkers() {
    if (!this._candleSeries) return;
    // 시간순 정렬
    const sorted = [...this._playerMarkers].sort((a, b) => a.time < b.time ? -1 : 1);
    this._candleSeries.setMarkers(sorted);
  }

  // ─── UI rendering ─────────────────────────────────────────────────────────

  _showCountdown(count, onComplete) {
    const el = document.getElementById('countdown-display');
    if (!el) { onComplete(); return; }
    el.textContent = count;
    el.classList.remove('hidden');

    this.broadcast('countdown', { count });

    if (count > 0) {
      setTimeout(() => this._showCountdown(count - 1, onComplete), 1000);
    } else {
      el.classList.add('hidden');
      onComplete();
    }
  }

  _updateTimerDisplay() {
    const el = document.getElementById('timer-display');
    if (!el) return;
    const m = Math.floor(this._timeLeft / 60000);
    const s = Math.floor((this._timeLeft % 60000) / 1000);
    el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  _updatePriceDisplay(price) {
    const el = document.getElementById('current-price');
    if (el) el.textContent = `₩${price.toLocaleString()}`;
    const nameEl = document.getElementById('stock-name');
    if (nameEl) nameEl.textContent = this._stockName;
  }

  _renderPlayerPanels() {
    const container = document.getElementById('player-panels');
    if (!container) return;
    const currentPrice = this._getCurrentPrice();
    const players = this._buildPlayerList();

    // 순위순 정렬
    const sorted = [...players].sort((a, b) => b.equity - a.equity);

    container.innerHTML = sorted.map((p, i) => {
      const posIcon = _positionIcon(p.position);
      const pnl = p.pnlPct;
      const pnlClass = pnl >= 0 ? 'positive' : 'negative';
      const isFirst = i === 0;
      return `
        <div class="player-panel ${isFirst ? 'first-place' : ''}" style="--player-color:${p.color}">
          <div class="player-rank">${i + 1}</div>
          <div class="player-name">${isFirst ? '👑 ' : ''}${p.nickname}</div>
          <div class="player-balance">$${p.equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div class="player-pnl ${pnlClass}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%</div>
          <div class="player-pos">${posIcon}</div>
        </div>
      `;
    }).join('');
  }

  _updateRankingDisplay() {
    const players = this._buildPlayerList();
    const sorted = [...players].sort((a, b) => b.equity - a.equity);
    if (sorted.length === 0) return;

    const first = sorted[0];
    const el = document.getElementById('top-player');
    if (el) {
      const pnl = first.pnlPct;
      el.textContent = `👑 ${first.nickname}  ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`;
    }
  }

  _renderGameResult(rankings) {
    const container = document.getElementById('result-rankings');
    if (!container) return;
    const medals = ['🥇', '🥈', '🥉'];
    container.innerHTML = rankings.map((p, i) => `
      <div class="result-row ${i === 0 ? 'winner' : ''}">
        <span class="result-medal">${medals[i] ?? `${i + 1}위`}</span>
        <span class="result-name" style="color:${p.color}">${p.nickname}</span>
        <span class="result-equity">$${p.equity.toLocaleString()}</span>
        <span class="result-pnl ${p.pnlPct >= 0 ? 'positive' : 'negative'}">${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(1)}%</span>
      </div>
    `).join('');
  }

  _sendRejoinState(playerId) {
    const pos = this._positions.get(playerId);
    const currentPrice = this._getCurrentPrice();
    const equity = pos ? this._calcEquity(pos, currentPrice) : INITIAL_BALANCE;
    this.sendToPlayer(playerId, 'rejoinState', {
      phase: this.phase,
      stockName: this._stockName,
      settings: this._settings,
      players: this._buildPlayerList(),
      myPosition: pos ?? { type: 'cash', balance: INITIAL_BALANCE },
      equity,
      timeLeft: this._timeLeft,
    });
  }
}

function _positionIcon(type) {
  switch (type) {
    case 'long': return '📈 롱';
    case 'short': return '📉 숏';
    case 'long2x': return '🚀 2x롱';
    case 'short2x': return '💥 2x숏';
    default: return '💰 현금';
  }
}
