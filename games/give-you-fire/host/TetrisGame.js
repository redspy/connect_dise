/**
 * TetrisGame.js — Give You Fire 호스트 게임 클래스
 * HostBaseGame을 상속하여 로비/대시보드/결과 화면을 관리합니다.
 *
 * 주요 역할:
 *  - 4코너 QR 렌더링, 미리보기 체크박스 관리
 *  - 플레이어 입장/프로필/준비 처리
 *  - 게임 중: 미니 보드 실시간 렌더링, 속도 레벨 표시
 *  - 라인 클리어 공격: 클리어한 플레이어 외 모두에게 levelUp 전송
 *  - 탈락 처리 및 최종 결과 집계
 */

import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { renderQR } from '../../../platform/client/shared/QRDisplay.js';
import { renderBoard } from '../shared/BoardRenderer.js';

/** 색상 표시에 사용할 플레이어 색상 목록 (플랫폼에서 자동 배정되지만 레이블용으로 보유) */

export class TetrisGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'gyf-overlay', qrContainerId: null });

    /** id → { nickname } */
    this._profiles = new Map();

    /** id → { level, lines, board: number[][], alive: boolean, rank: number|null } */
    this._playerData = new Map();

    this._gameStarted  = false;
    this._showNextPiece = false;  // 로비 체크박스 설정
    this._readyCount   = 0;
    this._aliveCount   = 0;
    this._rankings     = []; // 탈락/종료 순으로 쌓임
    this._gameStartTime = null;
    this._elapsed      = 0;
    this._elapsedTimer = null;

    this._wireGameMessages();
  }

  // ─── HostBaseGame 훅 ──────────────────────────────────────────────────────

  async onSetup({ sessionId, qrUrl }) {
    document.getElementById('session-code').textContent = sessionId;

    // 4코너 QR 렌더링 (동일 URL)
    const corners = ['qr-tl', 'qr-tr', 'qr-bl', 'qr-br'];
    for (const id of corners) {
      const el = document.getElementById(id);
      if (el) await renderQR(el, qrUrl, { width: 110 });
    }

    // 미리보기 체크박스
    const chk = document.getElementById('chk-next-piece');
    if (chk) {
      chk.addEventListener('change', () => {
        this._showNextPiece = chk.checked;
      });
    }

    // 버튼 이벤트
    document.getElementById('btn-start')?.addEventListener('click', () => {
      if (this._canStart()) this._startGame();
    });
    document.getElementById('btn-back')?.addEventListener('click', () => {
      location.href = '/';
    });
    document.getElementById('btn-restart-result')?.addEventListener('click', () => {
      this.resetSession();
    });
    document.getElementById('btn-restart-game')?.addEventListener('click', () => {
      this.resetSession();
    });

    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    if (this._gameStarted) return;
    this._playerData.set(player.id, { level: 1, lines: 0, board: null, alive: true, rank: null });
    this._renderLobby();
    this._updateReadyStatus();
    this._broadcastPlayerList();
  }

  onPlayerRejoin(player) {
    if (this._gameStarted) {
      // 재연결된 플레이어에게 게임 시작 메시지 재전송
      this.sendToPlayer(player.id, 'gameStarted', { showNextPiece: this._showNextPiece });
    }
  }

  onPlayerLeave(playerId) {
    this._profiles.delete(playerId);
    this._playerData.delete(playerId);
    if (!this._gameStarted) {
      this._renderLobby();
      this._updateReadyStatus();
      this._broadcastPlayerList();
    }
  }

  onReadyUpdate({ readyCount, total }) {
    this._readyCount = readyCount;
    this._updateReadyStatus();
    this._updateStartBtn();
  }

  onAllReady() {
    this._updateStartBtn();
  }

  onReset() {
    this._profiles.clear();
    this._playerData.clear();
    this._gameStarted   = false;
    this._readyCount    = 0;
    this._aliveCount    = 0;
    this._rankings      = [];
    this._gameStartTime = null;
    this._stopElapsedTimer();
    this.setPhase('lobby');
    this._renderLobby();
    this._updateReadyStatus();
    this._updateStartBtn();
  }

  // ─── 메시지 처리 ──────────────────────────────────────────────────────────

  _wireGameMessages() {
    // 닉네임 설정
    this.onMessage('setProfile', (player, { nickname }) => {
      this._profiles.set(player.id, { nickname });
      if (!this._gameStarted) {
        this._renderLobby();
        this._broadcastPlayerList();
      }
    });

    // 모바일에서 보드 상태 업데이트 수신 (100ms 스로틀로 도착)
    this.onMessage('boardUpdate', (player, { board, level, lines }) => {
      const data = this._playerData.get(player.id);
      if (!data || !data.alive) return;
      data.board = board;
      data.level = level;
      data.lines = lines;
      this._renderPlayerCard(player.id);
    });

    // 라인 클리어 공격 처리
    this.onMessage('linesCleared', (player, { count }) => {
      if (!this._gameStarted) return;
      // 클리어한 플레이어 외 모든 생존 플레이어에게 levelUp 전송
      for (const [id, data] of this._playerData) {
        if (id === player.id || !data.alive) continue;
        const newLevel = Math.min(100, data.level + count);
        data.level = newLevel;
        this.sendToPlayer(id, 'levelUp', { newLevel });
        // 레벨 UI 즉시 갱신
        this._renderPlayerCard(id);
      }
    });

    // 플레이어 탈락
    this.onMessage('gameOver', (player) => {
      const data = this._playerData.get(player.id);
      if (!data || !data.alive) return;
      data.alive = false;
      this._aliveCount--;
      const rank = this._aliveCount + 1;
      data.rank = rank;
      this._rankings.unshift({ id: player.id, rank });
      this._renderPlayerCard(player.id);

      const playersArr = [...this.players.values()];
      this.broadcast('playerEliminated', { playerId: player.id, rank });

      // 1인 플레이: 탈락 = 게임 종료
      if (playersArr.length === 1) {
        this._endGame();
        return;
      }
      // 멀티: 1명 이하 생존 시 종료
      if (this._aliveCount <= 1) {
        // 남은 생존자를 1위로 설정
        for (const [id, d] of this._playerData) {
          if (d.alive) {
            d.alive = false;
            d.rank = 1;
            this._rankings.unshift({ id, rank: 1 });
          }
        }
        this._endGame();
      }
    });

    // 1인 클리어 (레벨 100 도달)
    this.onMessage('soloClear', (player) => {
      const data = this._playerData.get(player.id);
      if (data) { data.alive = false; data.rank = 1; }
      this._rankings.unshift({ id: player.id, rank: 1 });
      this._endGame();
    });

    // 다시하기 요청
    this.onMessage('requestRematch', () => {
      this.resetSession();
    });
  }

  // ─── 게임 시작 ───────────────────────────────────────────────────────────

  _canStart() {
    return this.playerCount >= 1 && this._readyCount === this.playerCount;
  }

  _startGame() {
    this._gameStarted  = true;
    this._aliveCount   = this.playerCount;
    this._rankings     = [];
    this._gameStartTime = Date.now();

    // 모든 플레이어 데이터 초기화
    for (const [id] of this.players) {
      this._playerData.set(id, { level: 1, lines: 0, board: null, alive: true, rank: null });
    }

    // 대시보드 렌더링
    this._renderDashboard();
    this.setPhase('playing');

    // 경과 시간 타이머
    this._startElapsedTimer();

    // 게임 시작 메시지 브로드캐스트
    this.broadcast('gameStarted', { showNextPiece: this._showNextPiece });
  }

  // ─── 게임 종료 ───────────────────────────────────────────────────────────

  _endGame() {
    this._stopElapsedTimer();
    this._gameStarted = false;

    // 최종 순위 포함 종료 메시지
    const finalRankings = this._buildFinalRankings();
    this.broadcast('gameFinished', { rankings: finalRankings });

    // 결과 화면 렌더링
    this._renderResult(finalRankings);
    this.setPhase('result');
  }

  _buildFinalRankings() {
    return [...this.players.values()].map(player => {
      const profile = this._profiles.get(player.id) ?? {};
      const data    = this._playerData.get(player.id) ?? {};
      return {
        id:       player.id,
        nickname: profile.nickname ?? '???',
        color:    player.color,
        rank:     data.rank ?? 1,
        level:    data.level ?? 1,
        lines:    data.lines ?? 0,
      };
    }).sort((a, b) => a.rank - b.rank);
  }

  // ─── 경과 시간 타이머 ────────────────────────────────────────────────────

  _startElapsedTimer() {
    this._elapsed = 0;
    this._elapsedTimer = setInterval(() => {
      this._elapsed++;
      const el = document.getElementById('game-elapsed');
      if (el) el.textContent = this._formatTime(this._elapsed);
    }, 1000);
  }

  _stopElapsedTimer() {
    if (this._elapsedTimer) {
      clearInterval(this._elapsedTimer);
      this._elapsedTimer = null;
    }
  }

  _formatTime(s) {
    const m   = String(Math.floor(s / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${m}:${sec}`;
  }

  // ─── 로비 UI ─────────────────────────────────────────────────────────────

  _renderLobby() {
    const list = document.getElementById('lobby-players');
    if (!list) return;
    const players = [...this.players.values()];
    list.innerHTML = players.map(p => {
      const nick = this._profiles.get(p.id)?.nickname ?? '...';
      return `
        <div class="gyf-lobby-player">
          <span class="gyf-lobby-dot" style="background:${p.color}"></span>
          <span>${nick}</span>
        </div>`;
    }).join('');
  }

  _updateReadyStatus() {
    const el = document.getElementById('ready-status');
    if (el) el.textContent = `${this._readyCount} / ${this.playerCount} 준비 완료`;
  }

  _updateStartBtn() {
    const btn = document.getElementById('btn-start');
    if (!btn) return;
    btn.disabled = !this._canStart();
  }

  _broadcastPlayerList() {
    const players = [...this.players.values()].map(p => ({
      id:       p.id,
      color:    p.color,
      nickname: this._profiles.get(p.id)?.nickname ?? '...',
    }));
    this.broadcast('playerListUpdated', { players });
  }

  // ─── 대시보드 UI ─────────────────────────────────────────────────────────

  _renderDashboard() {
    const grid = document.getElementById('dashboard-grid');
    if (!grid) return;
    grid.innerHTML = '';

    for (const [id, player] of this.players) {
      const profile = this._profiles.get(id) ?? {};
      const card = document.createElement('div');
      card.className = 'gyf-player-card';
      card.id = `card-${id}`;
      card.innerHTML = `
        <div class="gyf-card-header">
          <span class="gyf-card-dot" style="background:${player.color}"></span>
          <span class="gyf-card-nick">${profile.nickname ?? '???'}</span>
          <span class="gyf-card-level" id="lvl-${id}">Lv.1</span>
        </div>
        <div class="gyf-card-bar-wrap">
          <div class="gyf-card-bar" id="bar-${id}" style="width:1%;background:${player.color}"></div>
        </div>
        <canvas class="gyf-mini-board" id="canvas-${id}" width="120" height="240"></canvas>
        <div class="gyf-card-status" id="status-${id}">PLAYING</div>
      `;
      grid.appendChild(card);

      // 빈 보드로 초기 렌더링
      const canvas = card.querySelector(`#canvas-${id}`);
      if (canvas) renderBoard(canvas, null);
    }
  }

  _renderPlayerCard(playerId) {
    const data   = this._playerData.get(playerId);
    const player = this.players.get(playerId);
    if (!data || !player) return;

    // 레벨 텍스트
    const lvlEl = document.getElementById(`lvl-${playerId}`);
    if (lvlEl) lvlEl.textContent = `Lv.${data.level}`;

    // 레벨 프로그래스 바
    const barEl = document.getElementById(`bar-${playerId}`);
    if (barEl) barEl.style.width = `${data.level}%`;

    // 미니 보드 캔버스 렌더링
    const canvas = document.getElementById(`canvas-${playerId}`);
    if (canvas) {
      renderBoard(canvas, data.board ?? null, { isDead: !data.alive });
    }

    // 상태 텍스트
    const statusEl = document.getElementById(`status-${playerId}`);
    if (statusEl) {
      if (!data.alive) {
        statusEl.textContent = `${data.rank}위 탈락`;
        statusEl.classList.add('gyf-eliminated');
        const cardEl = document.getElementById(`card-${playerId}`);
        if (cardEl) cardEl.classList.add('gyf-card-dead');
      }
    }
  }

  // ─── 결과 화면 ───────────────────────────────────────────────────────────

  _renderResult(rankings) {
    const list = document.getElementById('result-rankings');
    if (!list) return;
    const medals = ['🥇', '🥈', '🥉', ''];
    list.innerHTML = rankings.map((r, i) => `
      <div class="gyf-rank-row">
        <span class="gyf-rank-medal">${medals[Math.min(i, 3)]}</span>
        <span class="gyf-rank-dot" style="background:${r.color}"></span>
        <span class="gyf-rank-nick">${r.nickname}</span>
        <span class="gyf-rank-detail">Lv.${r.level} / ${r.lines}줄</span>
      </div>
    `).join('');
  }
}
