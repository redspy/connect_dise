/**
 * DemoSimulator.js — 다빈치 코드 데모(Attract Mode). §14 휴리스틱(D15, 제약 전파 라이트).
 * 봇은 game._tryXxx() 공개 API를 실제 플레이어 메시지와 동일한 경로로 호출한다
 * (호스트가 별도 "봇 전용 우회 경로"를 갖지 않도록 — 검증 로직이 봇에게도 그대로 적용됨).
 */
import { computeCandidates, poolCounts } from '../shared/DavinciEngine.js';

const THINK_MIN_MS = 900;
const THINK_MAX_MS = 1800;

export class DemoSimulator {
  constructor(game) {
    this.game = game;
    this.state = 'idle';
    this.demoTimeouts = [];
    this.backupState = null;
    this.botIds = ['bot_amy', 'bot_bob'];
  }

  _think(fn) {
    const t = setTimeout(() => { if (this.state === 'running') fn(); }, THINK_MIN_MS + Math.random() * (THINK_MAX_MS - THINK_MIN_MS));
    this.demoTimeouts.push(t);
  }

  startDemo() {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.game._isDemo = true;

    this.backupState = { readyCount: this.game._readyCount, phase: this.game.phase };

    const bots = [
      { id: this.botIds[0], nickname: '🤖 레오나르도', color: '#eab308' },
      { id: this.botIds[1], nickname: '🤖 모나리자', color: '#38bdf8' },
    ];
    bots.forEach(b => {
      const pObj = { id: b.id, color: b.color };
      this.game.players.set(b.id, pObj);
      this.game.sdk._players.set(b.id, pObj);
      this.game._profiles.set(b.id, { nickname: b.nickname });
    });

    this.game._renderLobby();
    this.game._updateReadyStatus();
    this.game.updateLobbyReady(2);

    const qrWrap = document.querySelector('.lobby-qr-box');
    if (qrWrap) {
      qrWrap.style.filter = 'blur(8px)';
      qrWrap.style.pointerEvents = 'none';
      const overlayText = document.createElement('div');
      overlayText.id = 'demoQROverlay';
      overlayText.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.78);color:#f59e0b;font-weight:bold;font-size:1.1rem;text-align:center;padding:10px;border-radius:8px;box-sizing:border-box;z-index:100;';
      overlayText.innerHTML = `
        <span>🤖 데모 플레이 진행 중...</span><br>
        <button id="btn-stop-demo-overlay" style="margin-top:8px;padding:4px 12px;background:#e5484d;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.8rem;font-weight:bold;">데모 중단</button>
      `;
      qrWrap.parentNode.style.position = 'relative';
      qrWrap.parentNode.appendChild(overlayText);
      document.getElementById('btn-stop-demo-overlay').onclick = (e) => { e.stopPropagation(); this.stopDemo(); };
    }

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.textContent = '⏹ 데모 플레이 중단';
      demoPlayBtn.style.background = 'linear-gradient(135deg, #e5484d, #b91c1c)';
      demoPlayBtn.style.color = '#fff';
    }

    this.game._startCountdown();
    this.game._broadcastPlayerList();
  }

  stopDemo() {
    if (this.state === 'idle') return;
    this.state = 'cleanup';
    this.game._isDemo = false;
    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];
    this.game._stopCountdown();

    document.getElementById('demoQROverlay')?.remove();
    const qrWrap = document.querySelector('.lobby-qr-box');
    if (qrWrap) { qrWrap.style.filter = ''; qrWrap.style.pointerEvents = ''; }

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.textContent = '🤖 데모 플레이 실행';
      demoPlayBtn.style.background = 'linear-gradient(135deg, var(--lobby-accent, #f59e0b), #d97706)';
      demoPlayBtn.style.color = '#000';
    }

    this.botIds.forEach(id => {
      this.game._players.delete(id);
      this.game.sdk._players.delete(id);
      this.game._profiles.delete(id);
      this.game._playerTiles.delete(id);
      this.game._playerMeta.delete(id);
    });

    if (this.backupState) {
      this.game._readyCount = this.backupState.readyCount;
      this.game._gameStarted = false;
      clearTimeout(this.game._turnTimer);
      this.game._renderLobby();
      this.game._updateReadyStatus();
      this.game._broadcastPlayerList();
      this.game.setPhase(this.backupState.phase);
    }
    this.state = 'idle';
  }

  onPhaseChange(phase) {
    if (this.state !== 'running') return;
    if (phase === 'result') {
      const t = setTimeout(() => this.stopDemo(), 6000);
      this.demoTimeouts.push(t);
    }
  }

  _isBot(playerId) { return this.botIds.includes(playerId); }

  // ─── 세팅: 색 구성 선택 ───────────────────────────────────────────────────

  onSetupPick(playerId) {
    if (this.state !== 'running' || !this._isBot(playerId)) return;
    this._think(() => {
      if (this.game._turnOrder[this.game._setupPickIdx] !== playerId) return;
      const n = this.game._startTileCount;
      const avail = poolCounts(this.game._pools);
      const maxBlack = Math.min(n, avail.black);
      const minBlack = Math.max(0, n - avail.white);
      const black = Math.floor(Math.random() * (maxBlack - minBlack + 1)) + minBlack;
      this.game._tryPickTiles(playerId, black);
    });
  }

  onJokerPlacePrompt(playerId, jokerSlots) {
    if (this.state !== 'running' || !this._isBot(playerId)) return;
    this._think(() => {
      const pos = Math.floor(Math.random() * jokerSlots);
      this.game._tryPlaceJoker(playerId, pos);
    });
  }

  // ─── 턴 ───────────────────────────────────────────────────────────────────

  onTurnStart(playerId) {
    if (this.state !== 'running' || !this._isBot(playerId)) return;
    this._think(() => {
      if (this.game._currentTurnPlayerId !== playerId) return;
      if (this.game._turn?.phase === 'draw') {
        const avail = poolCounts(this.game._pools);
        const color = avail.black === 0 ? 'W' : avail.white === 0 ? 'B' : (Math.random() < 0.5 ? 'B' : 'W');
        this.game._tryDrawTile(playerId, color);
      } else if (this.game._turn?.phase === 'guess') {
        this._doGuess(playerId);
      }
    });
  }

  onDrawResolved(playerId) {
    if (this.state !== 'running' || !this._isBot(playerId)) return;
    this._think(() => this._doGuess(playerId));
  }

  onChoosePrompt(playerId) {
    if (this.state !== 'running' || !this._isBot(playerId)) return;
    this._think(() => {
      if (this.game._turn?.phase !== 'choose') return;
      const hasCertain = this._hasCertainTarget(playerId);
      const cont = hasCertain || Math.random() < 0.3;
      this.game._tryTurnChoice(playerId, cont ? 'continue' : 'stop');
    });
  }

  onRevealOwnPrompt(playerId) {
    if (this.state !== 'running' || !this._isBot(playerId)) return;
    this._think(() => {
      if (this.game._turn?.phase !== 'revealOwn') return;
      const tiles = this.game._playerTiles.get(playerId) || [];
      const hidden = tiles.map((t, i) => [t, i]).filter(([t]) => !t.revealed).map(([, i]) => i);
      if (hidden.length === 0) return;
      const idx = hidden[Math.floor(Math.random() * hidden.length)];
      this.game._tryRevealOwnTile(playerId, idx);
    });
  }

  onTiebreakPrompt(playerId) {
    if (this.state !== 'running' || !this._isBot(playerId)) return;
    this._think(() => {
      if (this.game._turn?.phase !== 'tiebreak') return;
      this.game._tryPlaceTiebreak(playerId, Math.random() < 0.5 ? 'left' : 'right');
    });
  }

  // ─── 추측 결정 (D15 — 제약 전파 라이트) ──────────────────────────────────

  _myKnownColorInfo(playerId) {
    const numbers = { B: [], W: [] };
    const joker = { B: false, W: false };
    for (const t of this.game._playerTiles.get(playerId) || []) {
      if (t.joker) joker[t.color] = true; else numbers[t.color].push(t.number);
    }
    const drawn = this.game._turn?.drawnTile;
    if (drawn) { if (drawn.joker) joker[drawn.color] = true; else numbers[drawn.color].push(drawn.number); }
    return { numbers, joker };
  }

  _allTargets(playerId) {
    const publicBoardsView = this.game._publicBoardsView();
    const targets = [];
    for (const pid of this.game._turnOrder) {
      if (pid === playerId || this.game._isSkipped(pid)) continue;
      const tiles = publicBoardsView[pid] || [];
      tiles.forEach((t, idx) => { if (!t.revealed) targets.push({ targetPlayerId: pid, tileIndex: idx }); });
    }
    return targets;
  }

  _hasCertainTarget(playerId) {
    const publicBoardsView = this.game._publicBoardsView();
    const { numbers, joker } = this._myKnownColorInfo(playerId);
    return this._allTargets(playerId).some(({ targetPlayerId, tileIndex }) => computeCandidates({
      publicBoardsView, myColorKnownNumbers: numbers, myColorKnownJoker: joker,
      targetPlayerId, tileIndex, includeJokers: this.game._includeJokers,
    }).length === 1);
  }

  _doGuess(playerId) {
    if (this.game._currentTurnPlayerId !== playerId || this.game._turn?.phase !== 'guess') return;
    const publicBoardsView = this.game._publicBoardsView();
    const { numbers, joker } = this._myKnownColorInfo(playerId);
    const targets = this._allTargets(playerId);
    if (targets.length === 0) return;

    let best = null;
    for (const t of targets) {
      const cands = computeCandidates({
        publicBoardsView, myColorKnownNumbers: numbers, myColorKnownJoker: joker,
        targetPlayerId: t.targetPlayerId, tileIndex: t.tileIndex, includeJokers: this.game._includeJokers,
      });
      if (cands.length === 0) continue; // 이론상 없어야 하지만 방어적으로 스킵
      if (!best || cands.length < best.cands.length) best = { ...t, cands };
    }
    if (!best) { const t = targets[Math.floor(Math.random() * targets.length)]; best = { ...t, cands: [Math.floor(Math.random() * 12)] }; }
    const value = best.cands[Math.floor(Math.random() * best.cands.length)];
    this.game._tryGuess(playerId, best.targetPlayerId, best.tileIndex, value);
  }
}
