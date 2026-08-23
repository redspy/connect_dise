/**
 * DemoSimulator.js — 루미큐브 데모(Attract Mode). §14 휴리스틱 v1.
 * 구현: 손패 내 세트 탐색(초기 착수) + 기존 세트에 1장 붙이기.
 * 미구현(명시적 스킵, plan.md §14): 보드 전면 해체·재조합, 조커 회수.
 */
import { parseTileId } from '../shared/RummikubEngine.js';

export class DemoSimulator {
  constructor(game) {
    this.game = game;
    this.state = 'idle';
    this.demoTimeouts = [];
    this.backupState = null;
    this.botIds = ['bot_amy', 'bot_bob'];
  }

  startDemo() {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.game._isDemo = true;

    this.backupState = { readyCount: this.game._readyCount, phase: this.game.phase };

    const bots = [
      { id: this.botIds[0], nickname: '🤖 에이미', color: '#e5484d' },
      { id: this.botIds[1], nickname: '🤖 밥', color: '#3b82f6' },
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

    document.getElementById('demoQROverlay')?.remove();
    const qrWrap = document.querySelector('.lobby-qr-box');
    if (qrWrap) { qrWrap.style.filter = ''; qrWrap.style.pointerEvents = ''; }

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.textContent = '🤖 데모 플레이 실행';
      demoPlayBtn.style.background = 'linear-gradient(135deg, var(--lobby-accent, #f59e0b), #d97706)';
      demoPlayBtn.style.color = '#000';
    }

    // 봇 id만 골라 제거 (AGENTS.md 필수 처리 사항 — 전체 스냅샷 복원 금지)
    this.botIds.forEach(id => {
      this.game._players.delete(id);
      this.game.sdk._players.delete(id);
      this.game._profiles.delete(id);
      this.game._hands.delete(id);
      this.game._playerMeta.delete(id);
    });

    if (this.backupState) {
      this.game._readyCount = this.backupState.readyCount;
      this.game._gameStarted = false;
      clearInterval(this.game._turnTimer);
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

  onTurnStart(playerId) {
    if (this.state !== 'running') return;
    if (!this.botIds.includes(playerId)) return;
    const t = setTimeout(() => this._playBotTurn(playerId), 1200 + Math.random() * 1800);
    this.demoTimeouts.push(t);
  }

  _playBotTurn(playerId) {
    if (this.state !== 'running') return;
    if (this.game._currentTurnPlayerId !== playerId) return;
    const meta = this.game._playerMeta.get(playerId);
    if (!meta) return;
    const acted = meta.initialMeldDone ? this._tryAttach(playerId) : this._tryInitialMeld(playerId);
    if (acted) this.game._commitTurn(playerId);
    else this.game._doPass(playerId);
  }

  _applyAndLog(playerId, op) {
    const res = this.game._applyOp(playerId, op);
    if (res.accepted) this.game._opLog.push(op);
    return res;
  }

  _findHandMeldCandidates(hand) {
    const candidates = [];
    const byNum = {};
    for (const t of hand) {
      if (t[0] === 'j') continue;
      const p = parseTileId(t);
      (byNum[p.num] = byNum[p.num] || []).push(t);
    }
    for (const n in byNum) {
      const seen = new Set(); const uniq = [];
      for (const t of byNum[n]) { const c = parseTileId(t).color; if (!seen.has(c)) { seen.add(c); uniq.push(t); } }
      if (uniq.length >= 3) {
        const tiles = uniq.slice(0, 4);
        candidates.push({ tiles, value: parseInt(n, 10) * tiles.length });
      }
    }
    const byColor = {};
    for (const t of hand) {
      if (t[0] === 'j') continue;
      const p = parseTileId(t);
      (byColor[p.color] = byColor[p.color] || []).push(t);
    }
    for (const c in byColor) {
      const tiles = [...byColor[c]].sort((a, b) => parseTileId(a).num - parseTileId(b).num);
      let run = [tiles[0]];
      for (let i = 1; i < tiles.length; i++) {
        const prevNum = parseTileId(run[run.length - 1]).num;
        const curNum = parseTileId(tiles[i]).num;
        if (curNum === prevNum + 1) run.push(tiles[i]);
        else if (curNum === prevNum) { /* 중복 숫자 동색 — 스킵 */ }
        else {
          if (run.length >= 3) candidates.push({ tiles: [...run], value: run.reduce((s, x) => s + parseTileId(x).num, 0) });
          run = [tiles[i]];
        }
      }
      if (run.length >= 3) candidates.push({ tiles: [...run], value: run.reduce((s, x) => s + parseTileId(x).num, 0) });
    }
    return candidates.sort((a, b) => b.value - a.value);
  }

  _tryInitialMeld(playerId) {
    const hand = [...(this.game._hands.get(playerId) || [])];
    const candidates = this._findHandMeldCandidates(hand);
    const used = new Set();
    const chosen = [];
    let total = 0;
    for (const cand of candidates) {
      if (cand.tiles.some(t => used.has(t))) continue;
      chosen.push(cand);
      cand.tiles.forEach(t => used.add(t));
      total += cand.value;
      if (total >= this.game._initialMeldThreshold) break;
    }
    if (total < this.game._initialMeldThreshold || chosen.length === 0) return false;
    for (const cand of chosen) {
      let meldId = null;
      cand.tiles.forEach((tileId, i) => {
        const to = i === 0 ? { zone: 'newMeld' } : { zone: 'meld', meldId, index: i };
        const res = this._applyAndLog(playerId, { tileId, from: { zone: 'hand' }, to });
        if (i === 0) meldId = res.newMeldId;
      });
    }
    return true;
  }

  _tryAttach(playerId) {
    const hand = [...(this.game._hands.get(playerId) || [])];
    for (const tileId of hand) {
      if (tileId[0] === 'j') continue;
      const t = parseTileId(tileId);
      for (const meld of this.game._board) {
        const tiles = meld.tiles;
        const first = parseTileId(tiles[0]);
        const last = parseTileId(tiles[tiles.length - 1]);
        if (!last.isJoker && t.color === last.color && t.num === last.num + 1) {
          this._applyAndLog(playerId, { tileId, from: { zone: 'hand' }, to: { zone: 'meld', meldId: meld.meldId, index: tiles.length } });
          return true;
        }
        if (!first.isJoker && t.color === first.color && t.num === first.num - 1) {
          this._applyAndLog(playerId, { tileId, from: { zone: 'hand' }, to: { zone: 'meld', meldId: meld.meldId, index: 0 } });
          return true;
        }
        const realNums = new Set(tiles.map(id => parseTileId(id)).filter(p => !p.isJoker).map(p => p.num));
        if (tiles.length === 3 && realNums.size === 1 && [...realNums][0] === t.num) {
          const colors = new Set(tiles.map(id => parseTileId(id)).filter(p => !p.isJoker).map(p => p.color));
          if (!colors.has(t.color)) {
            this._applyAndLog(playerId, { tileId, from: { zone: 'hand' }, to: { zone: 'meld', meldId: meld.meldId, index: tiles.length } });
            return true;
          }
        }
      }
    }
    return false;
  }
}
