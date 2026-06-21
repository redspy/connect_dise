import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import {
  generateDeck, getSymbolPath,
  hanjaSymbols, hangulSymbols, hanjaMeanings,
  hiraganaSymbols, katakanaSymbols, kanaHangulFeedback,
} from '../shared/DobbleEngine.js';
import { DobbleDemoSimulator } from './DobbleDemoSimulator.js';

const FREEZE_MS     = 3000;
const HIGHLIGHT_MS  = 2000;
const LOCK_MS       = 80;   // 동시 탭 방지 lock 시간

export class DobbleGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'db-overlay', qrContainerId: null });

    this._profiles   = new Map();   // id → { nickname }
    this._scores     = new Map();   // id → number
    this._frozen     = new Set();   // 현재 패널티 중인 id
    this._freezeTimers = new Map(); // id → timeoutId
    this._deck       = [];
    this._centerCard = [];
    this._playerCards = new Map();  // id → number[]
    this._mode       = 'image';
    this._winScore   = 10;
    this._roundLock  = false;
    this._gameStarted = false;
    this._readyCount = 0;
    this._flashTimer = null;
    this._demoSimulator = new DobbleDemoSimulator(this);
    this._isDemo = false;

    this._wireMessages();
  }

  // ─── HostBaseGame hooks ────────────────────────────────────────────────────

  onSetup() {
    document.getElementById('sel-mode')?.addEventListener('change', e => {
      this._mode = e.target.value;
    });
    document.getElementById('sel-winscore')?.addEventListener('change', e => {
      this._winScore = Number(e.target.value);
    });
    if (this._lobbyEl) {
      this._lobbyEl.onStart = () => { if (this._canStart()) this._startGame(); };
    }
    document.querySelector('game-appbar').onRestart = () => this.resetSession();

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.onclick = () => {
        if (!this._isDemo) {
          this._demoSimulator.startDemo();
        }
      };
    }

    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    this._scores.set(player.id, 0);
    this._renderLobby();
    this.updateLobbyReady(this._readyCount);
  }

  onPlayerLeave(playerId) {
    this._profiles.delete(playerId);
    this._scores.delete(playerId);
    this._frozen.delete(playerId);
    this._playerCards.delete(playerId);
    clearTimeout(this._freezeTimers.get(playerId));
    this._freezeTimers.delete(playerId);
    this._renderLobby();
    this.updateLobbyReady(this._readyCount);
    if (this._gameStarted) this._renderScoreCards();
  }

  onReadyUpdate({ readyCount }) {
    this._readyCount = readyCount;
    this.updateLobbyReady(readyCount);
  }

  onPlayerRejoin(player) {
    if (this._gameStarted) {
      const myCard = this._playerCards.get(player.id);
      this.sendToPlayer(player.id, 'rejoinState', {
        phase:         'playing',
        mode:          this._mode,
        winScore:      this._winScore,
        myCard:        myCard ?? [],
        centerCard:    this._centerCard,
        score:         this._scores.get(player.id) ?? 0,
        frozenPlayers: [...this._frozen],
        scores:        Object.fromEntries(this._scores),
        players:       this._buildPlayerList(),
      });
    } else if (this.phase === 'result') {
      const rankings = [...this.players.values()]
        .map(p => ({
          id:       p.id,
          color:    p.color,
          nickname: this._profiles.get(p.id)?.nickname ?? '익명',
          score:    this._scores.get(p.id) ?? 0,
        }))
        .sort((a, b) => b.score - a.score);
      this.sendToPlayer(player.id, 'gameFinished', { rankings });
    }
  }

  onAllReady() {
    if (!this._gameStarted) this._startGame();
  }

  onReset() {
    this._demoSimulator.stopDemo();
    clearTimeout(this._flashTimer);
    this._flashTimer = null;
    const flash = document.getElementById('round-flash');
    if (flash) flash.classList.add('hidden');
    for (const t of this._freezeTimers.values()) clearTimeout(t);
    this._profiles.clear();
    this._scores.clear();
    this._frozen.clear();
    this._freezeTimers.clear();
    this._playerCards.clear();
    this._deck        = [];
    this._centerCard  = [];
    this._gameStarted = false;
    this._roundLock   = false;
    this._readyCount  = 0;
    for (const p of this.players.values()) this._scores.set(p.id, 0);
    this._renderLobby();
    this.updateLobbyReady(0);
    this.setPhase('lobby');
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('setProfile', (player, { nickname }) => {
      const name = (nickname || '').trim() || '익명';
      this._profiles.set(player.id, { nickname: name });
      this.setPlayerName(player.id, name);
      this._renderLobby();
      this._broadcastPlayerList();
    });

    this.onMessage('tapSymbol', (player, { symbolIndex }) => {
      this._onTapSymbol(player.id, Number(symbolIndex));
    });

    this.onMessage('requestRematch', () => {
      this.resetSession();
    });
  }

  // ─── Lobby ────────────────────────────────────────────────────────────────

  _canStart() {
    return this.playerCount >= 2 && this._readyCount === this.playerCount && this.playerCount > 0;
  }

  _renderLobby() {
    this.renderLobbyPlayers(this._profiles);
  }

  _broadcastPlayerList() {
    this.broadcast('playerListUpdated', { players: this._buildPlayerList() });
  }

  _buildPlayerList() {
    return [...this.players.values()].map(p => ({
      id:       p.id,
      color:    p.color,
      nickname: this._profiles.get(p.id)?.nickname ?? '익명',
      score:    this._scores.get(p.id) ?? 0,
    }));
  }

  // ─── Game flow ────────────────────────────────────────────────────────────

  _startGame() {
    this._gameStarted = true;
    this._deck = generateDeck();
    for (const id of this.players.keys()) this._scores.set(id, 0);

    // 각 플레이어에게 카드 1장 분배
    for (const id of this.players.keys()) {
      this._playerCards.set(id, this._drawFromDeck());
    }
    this._centerCard = this._drawFromDeck();

    this.broadcast('gameStarted', { mode: this._mode, winScore: this._winScore });
    for (const id of this.players.keys()) {
      this.sendToPlayer(id, 'cardDealt', { card: this._playerCards.get(id) });
    }
    this.broadcast('centerCardUpdated', { card: this._centerCard });

    this.setPhase('playing');
    this._renderCenterCard();
    this._renderScoreCards();
  }

  _drawFromDeck() {
    if (this._deck.length === 0) this._deck = generateDeck();
    return this._deck.pop();
  }

  _onTapSymbol(id, symbolIndex) {
    if (this._roundLock)      return;
    if (this._frozen.has(id)) return;
    if (!this._gameStarted)   return;

    if (!this._centerCard.includes(symbolIndex)) {
      // 오답 — 패널티
      this._applyFreeze(id);
      return;
    }

    // 정답
    this._roundLock = true;
    const newScore = (this._scores.get(id) ?? 0) + 1;
    this._scores.set(id, newScore);

    // 카드 교환
    const newCenterCard  = this._playerCards.get(id).slice();
    const newPlayerCard  = this._drawFromDeck();
    this._playerCards.set(id, newPlayerCard);
    this._centerCard = newCenterCard;

    // 정답자에게 전송 (새 카드 포함)
    this.sendToPlayer(id, 'tapResult', {
      correct:     true,
      newCard:     newPlayerCard,
      symbolIndex: symbolIndex,
    });

    // 전체에 중앙 카드·점수 갱신 전송
    this.broadcast('centerCardUpdated', { card: this._centerCard });
    this.broadcast('stateUpdate', {
      scores:       Object.fromEntries(this._scores),
      frozenPlayers: [...this._frozen],
    });

    // 호스트 화면 갱신
    this._renderCenterCard();
    this._renderScoreCards();
    this._showRoundFlash(id, newScore);

    // 🤖 데모 모드일 때 다음 탭 예약 갱신
    if (this._isDemo && this._gameStarted) {
      this._demoSimulator.scheduleNextTaps();
    }

    // 승리 체크
    if (newScore >= this._winScore) {
      setTimeout(() => this._endGame(), HIGHLIGHT_MS);
    }

    setTimeout(() => { this._roundLock = false; }, LOCK_MS);
  }

  _applyFreeze(id) {
    this._frozen.add(id);
    this.sendToPlayer(id, 'tapResult', { correct: false, penaltyMs: FREEZE_MS });
    this.broadcast('stateUpdate', {
      scores:        Object.fromEntries(this._scores),
      frozenPlayers: [...this._frozen],
    });
    this._renderScoreCards();

    clearTimeout(this._freezeTimers.get(id));
    const t = setTimeout(() => {
      this._frozen.delete(id);
      this._freezeTimers.delete(id);
      this.broadcast('stateUpdate', {
        scores:        Object.fromEntries(this._scores),
        frozenPlayers: [...this._frozen],
      });
      this._renderScoreCards();
    }, FREEZE_MS);
    this._freezeTimers.set(id, t);
  }

  _endGame() {
    this._gameStarted = false;
    const rankings = [...this.players.values()]
      .map(p => ({
        id:       p.id,
        color:    p.color,
        nickname: this._profiles.get(p.id)?.nickname ?? '익명',
        score:    this._scores.get(p.id) ?? 0,
      }))
      .sort((a, b) => b.score - a.score);

    this.broadcast('gameFinished', { rankings });
    this._renderResult(rankings);
    this.setPhase('result');
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  _renderCenterCard() {
    const container = document.getElementById('center-card');
    if (!container) return;
    container.innerHTML = '';
    for (const symbolIdx of this._centerCard) {
      const wrap = document.createElement('div');
      wrap.className = 'db-symbol-wrap';
      const inner = document.createElement('div');
      inner.className = 'db-symbol-inner';
      inner.appendChild(this._makeSymbolContent(symbolIdx, false));
      wrap.appendChild(inner);
      container.appendChild(wrap);
    }
  }

  _renderScoreCards() {
    const container = document.getElementById('score-cards');
    if (!container) return;
    container.innerHTML = '';
    for (const [id, player] of this.players) {
      const score   = this._scores.get(id) ?? 0;
      const frozen  = this._frozen.has(id);
      const nickname = this._profiles.get(id)?.nickname ?? '...';
      const pct     = Math.min(100, Math.round(score / this._winScore * 100));

      const card = document.createElement('div');
      card.className = `db-score-card${frozen ? ' frozen' : ''}`;
      card.dataset.playerId = id;
      card.innerHTML = `
        <div class="db-sc-top">
          <div class="db-sc-dot" style="background:${player.color}"></div>
          <div class="db-sc-name">${nickname}</div>
          ${frozen ? '<div class="db-sc-freeze">❄️</div>' : ''}
        </div>
        <div class="db-sc-bar-bg">
          <div class="db-sc-bar" style="width:${pct}%;background:${player.color}"></div>
        </div>
        <div class="db-sc-score">${score} / ${this._winScore}</div>
      `;
      container.appendChild(card);
    }
  }

  _renderResult(rankings) {
    const container = document.getElementById('result-rankings');
    if (!container) return;
    const medals = ['🥇', '🥈', '🥉'];
    container.innerHTML = rankings.map((p, i) => `
      <div class="db-rank-row ${i === 0 ? 'winner' : ''}">
        <span class="db-rank-medal">${medals[i] ?? `${i + 1}위`}</span>
        <div class="db-rank-dot" style="background:${p.color}"></div>
        <span class="db-rank-name">${p.nickname}</span>
        <span class="db-rank-score">${p.score}점</span>
      </div>
    `).join('');
  }

  _showRoundFlash(id, newScore) {
    const player   = this.players.get(id);
    const nickname = this._profiles.get(id)?.nickname ?? '익명';
    const color    = player?.color ?? '#fff';

    const el = document.getElementById('round-flash');
    if (!el) return;

    el.querySelector('.db-flash-dot').style.background = color;
    el.querySelector('.db-flash-name').textContent     = nickname;
    el.querySelector('.db-flash-points').textContent   = `+1점 → ${newScore} / ${this._winScore}점`;

    el.classList.remove('hidden', 'flash-out');
    el.classList.add('flash-in');

    // 정답자 점수 카드 pulse
    const cards = document.querySelectorAll('.db-score-card');
    cards.forEach(c => {
      if (c.dataset.playerId === id) {
        c.classList.remove('just-scored');
        void c.offsetWidth;
        c.classList.add('just-scored');
        setTimeout(() => c.classList.remove('just-scored'), 600);
      }
    });

    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      el.classList.remove('flash-in');
      el.classList.add('flash-out');
      setTimeout(() => el.classList.add('hidden'), 400);
    }, 1600);
  }

  _makeSymbolContent(symbolIdx, withRotation = true) {
    const rotation = withRotation ? Math.random() * 360 : 0;
    const scale    = withRotation ? (0.85 + Math.random() * 0.3) : 1;

    if (this._mode === 'image') {
      const img = document.createElement('img');
      img.src = getSymbolPath(symbolIdx);
      img.className = 'db-symbol-img';
      img.style.transform = `rotate(${rotation}deg) scale(${scale})`;
      return img;
    }

    const div = document.createElement('div');
    div.className = 'db-symbol-text';
    if (this._mode === 'hanja') {
      div.textContent = hanjaSymbols[symbolIdx] ?? '?';
    } else if (this._mode === 'hiragana') {
      div.textContent = hiraganaSymbols[symbolIdx] ?? '?';
    } else {
      div.textContent = katakanaSymbols[symbolIdx] ?? '?';
    }
    return div;
  }
}
