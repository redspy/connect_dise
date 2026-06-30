import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { SpectrumDemoSimulator } from './DemoSimulator.js';

const BOARD_WIDTH = 600;
const BOARD_HEIGHT = 360;
const HUB_X = 300;
const HUB_Y = 320;
const DIAL_RADIUS = 260;

const CONCEPTS = [
  { left: '차가움 ❄️', right: '뜨거움 🔥' },
  { left: '부드러움 🧸', right: '딱딱함 🧱' },
  { left: '저렴함 🪙', right: '값비쌈 💎' },
  { left: '느림 🐌', right: '빠름 ⚡' },
  { left: '안전함 🛡️', right: '위험함 ☠️' },
  { left: '조용함 🤫', right: '시끄러움 📢' },
  { left: '가벼움 🎈', right: '무거움 🏋️' },
  { left: '악함 😈', right: '선함 😇' },
  { left: '불행 😢', right: '행복 😊' },
  { left: '비과학적 🔮', right: '과학적 🔬' },
];

export class SpectrumGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'sm-overlay', qrContainerId: null });

    this._scores = new Map();
    this._round = 1;
    this._maxRounds = 3;

    this._clue = '';
    this._targetAngle = 90;
    this._activeAngle = 90;
    this._currentConcept = null;

    this._giver = null;
    this._activeGuesser = null;
    this._gameActive = false;

    this._demoSimulator = new SpectrumDemoSimulator(this);
    this._wireGameMessages();
  }

  // ─── HostBaseGame Hooks ──────────────────────────────────────────────────

  async onSetup() {
    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.onclick = () => {
        if (!this._isDemo) {
          this._demoSimulator.startDemo();
          demoPlayBtn.textContent = '⏹️ 데모 중지';
        } else {
          this._demoSimulator.stopDemo();
          demoPlayBtn.textContent = '🤖 데모 플레이 실행';
        }
      };
    }

    const nextBtn = document.getElementById('btn-next-round');
    if (nextBtn) {
      nextBtn.onclick = () => this._handleNextRound();
    }

    const restartBtn = document.getElementById('btn-restart-result');
    if (restartBtn) {
      restartBtn.onclick = () => this.resetSession();
    }

    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    if (this._lobbyEl) {
      this._lobbyEl.onStart = () => {
        if (this.players.size >= 2) this._startGame();
      };
    }
  }

  onPlayerLeave(playerId) {
    if (this._gameActive) {
      // 진행 도중 플레이어 이탈 시 게임 리셋
      console.log('[Spectrum] Player left during active game, resetting.');
      this.resetSession();
    }
  }

  onPlayerRejoin(player) {
    console.log(`[Spectrum Mind] Player ${player.id} rejoined.`);
    if (!this._gameActive) return;

    const isGiver = this._giver?.id === player.id;

    if (isGiver) {
      this.sendToPlayer(player.id, 'roleAssign', {
        role: 'giver',
        targetAngle: this._targetAngle,
        concept: this._currentConcept,
        round: this._round
      });

      if (this.phase === 'guess') {
        this.sendToPlayer(player.id, 'clueSubmitted', { clue: this._clue });
      }
    } else {
      this.sendToPlayer(player.id, 'roleAssign', {
        role: 'guesser',
        activeGuesserId: this._activeGuesser.id,
        concept: this._currentConcept,
        giverNickname: this._giver?.nickname || '출제자',
        round: this._round
      });

      if (this.phase === 'guess') {
        this.sendToPlayer(player.id, 'clueSubmitted', { clue: this._clue });
      }
    }
  }

  onAllReady() {
    if (!this._gameActive && this.players.size >= 2) {
      this._startGame();
    }
  }

  onReadyUpdate({ readyCount, total }) {
    this.updateLobbyReady(readyCount);
  }

  onReset() {
    this._demoSimulator.stopDemo();
    this._gameActive = false;
    this._round = 1;
    this._scores.clear();

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) demoPlayBtn.textContent = '🤖 데모 플레이 실행';

    this.setPhase('lobby');
  }

  // ─── Game Flow ───────────────────────────────────────────────────────────

  _startGame() {
    this._gameActive = true;
    this._round = 1;
    this._scores.clear();

    for (const id of this.players.keys()) {
      this._scores.set(id, 0);
    }

    this._startRound();
  }

  _startRound() {
    this._clue = '';
    this._targetAngle = 20 + Math.floor(Math.random() * 140); // 20 ~ 160 deg
    this._activeAngle = 90;

    const plist = [...this.players.values()];
    this._giver = plist[(this._round - 1) % plist.length];
    this._activeGuesser = plist[plist.length > 1 ? this._round % plist.length : 0];

    this._currentConcept = CONCEPTS[Math.floor(Math.random() * CONCEPTS.length)];

    // UI 셋업
    document.getElementById('giver-name').textContent = this._giver.nickname;
    document.getElementById('giver-avatar').textContent = this._giver.nickname.charAt(0);
    document.getElementById('concept-left').textContent = this._currentConcept.left;
    document.getElementById('concept-right').textContent = this._currentConcept.right;
    document.getElementById('reveal-controls').classList.add('hidden');
    document.getElementById('guess-status-area').classList.remove('hidden');

    this.setPhase('clue');

    if (!this._isDemo) {
      // 모바일 기기 정보 배분
      this.sendToPlayer(this._giver.id, 'roleAssign', {
        role: 'giver',
        targetAngle: this._targetAngle,
        concept: this._currentConcept,
        round: this._round
      });

      for (const p of plist) {
        if (p.id !== this._giver.id) {
          this.sendToPlayer(p.id, 'roleAssign', {
            role: 'guesser',
            activeGuesserId: this._activeGuesser.id,
            concept: this._currentConcept,
            giverNickname: this._giver.nickname,
            round: this._round
          });
        }
      }
    } else {
      this._demoSimulator.triggerGiverClue();
    }
  }

  _handleNextRound() {
    this._round++;
    if (this._round > this._maxRounds) {
      this._endGame();
    } else {
      this._startRound();
    }
  }

  _endGame() {
    this._gameActive = false;

    // 순위 데이터 구성
    const rankings = [...this.players.values()].map(p => ({
      nickname: p.nickname,
      score: this._scores.get(p.id) || 0,
      color: p.color
    })).sort((a, b) => b.score - a.score);

    const rankList = document.getElementById('sm-rankings');
    if (rankList) {
      rankList.innerHTML = rankings.map((r, i) => `
        <div class="sm-rank-item">
          <div class="sm-rank-left">
            <span class="sm-rank-badge">${i + 1}위</span>
            <span class="sm-rank-name" style="color:${r.color}">${r.nickname}</span>
          </div>
          <span class="sm-rank-score">${r.score}점</span>
        </div>
      `).join('');
    }

    this.setPhase('result');
  }

  // ─── Drawing / Dial Rendering ─────────────────────────────────────────────

  _drawDial(revealMode = false) {
    const canvas = document.getElementById('sm-dial-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

    // 1. 다이얼 배경 반원
    ctx.beginPath();
    ctx.arc(HUB_X, HUB_Y, DIAL_RADIUS, Math.PI, 2 * Math.PI);
    ctx.lineTo(HUB_X, HUB_Y);
    ctx.closePath();
    ctx.fillStyle = '#111827';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#374151';
    ctx.stroke();

    // 2. 결과 공개 시 득점 영역 그리기
    if (revealMode) {
      this._drawWedges(ctx);
    }

    // 3. 눈금 그리기 (10도 간격)
    ctx.save();
    for (let angle = 0; angle <= 180; angle += 10) {
      const rad = (Math.PI * (180 - angle)) / 180;
      const startX = HUB_X + Math.cos(rad) * (DIAL_RADIUS - 15);
      const startY = HUB_Y - Math.sin(rad) * (DIAL_RADIUS - 15);
      const endX = HUB_X + Math.cos(rad) * DIAL_RADIUS;
      const endY = HUB_Y - Math.sin(rad) * DIAL_RADIUS;

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.lineWidth = angle % 30 === 0 ? 3 : 1;
      ctx.strokeStyle = angle % 30 === 0 ? '#9ca3af' : '#4b5563';
      ctx.stroke();
    }
    ctx.restore();

    // 4. 추측 지시 바늘 (빨간색 눈금)
    const activeRad = (Math.PI * (180 - this._activeAngle)) / 180;
    const needleX = HUB_X + Math.cos(activeRad) * (DIAL_RADIUS - 5);
    const needleY = HUB_Y - Math.sin(activeRad) * (DIAL_RADIUS - 5);

    ctx.beginPath();
    ctx.moveTo(HUB_X, HUB_Y);
    ctx.lineTo(needleX, needleY);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#e94560';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#e94560';
    ctx.stroke();
    ctx.shadowBlur = 0; // reset

    // 5. 다이얼 중심 허브 (메탈 질감)
    ctx.beginPath();
    ctx.arc(HUB_X, HUB_Y, 24, 0, 2 * Math.PI);
    const grad = ctx.createRadialGradient(HUB_X - 5, HUB_Y - 5, 2, HUB_X, HUB_Y, 24);
    grad.addColorStop(0, '#f3f4f6');
    grad.addColorStop(0.5, '#9ca3af');
    grad.addColorStop(1, '#374151');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#1f2937';
    ctx.stroke();
  }

  _drawWedges(ctx) {
    const centerDeg = this._targetAngle;

    // Wedges: 4점(센터 8도), 3점(양옆 24도), 2점(양옆 40도)
    const wedges = [
      { width: 40, color: 'rgba(52, 152, 219, 0.45)' }, // 2점
      { width: 24, color: 'rgba(46, 204, 113, 0.6)' },  // 3점
      { width: 8,  color: 'rgba(241, 196, 15, 0.85)' }   // 4점
    ];

    wedges.forEach(w => {
      const half = w.width / 2;
      const startRad = (Math.PI * (180 - (centerDeg + half))) / 180;
      const endRad = (Math.PI * (180 - (centerDeg - half))) / 180;

      ctx.beginPath();
      ctx.arc(HUB_X, HUB_Y, DIAL_RADIUS - 8, startRad, endRad);
      ctx.lineTo(HUB_X, HUB_Y);
      ctx.closePath();
      ctx.fillStyle = w.color;
      ctx.fill();
    });

    // 비밀 목표 라인 (골드 점선)
    const targetRad = (Math.PI * (180 - this._targetAngle)) / 180;
    ctx.beginPath();
    ctx.moveTo(HUB_X, HUB_Y);
    ctx.lineTo(HUB_X + Math.cos(targetRad) * DIAL_RADIUS, HUB_Y - Math.sin(targetRad) * DIAL_RADIUS);
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#f1c40f';
    ctx.stroke();
    ctx.setLineDash([]); // reset
  }

  // ─── Messaging ───────────────────────────────────────────────────────────

  _wireGameMessages() {
    // 1. 제시어 수신
    this.onMessage('submitClue', (player, { clue }) => {
      if (!this._gameActive || this.phase !== 'clue') return;
      if (player.id !== this._giver.id) return;

      this._clue = clue.trim() || '힌트 없음';
      document.getElementById('display-clue').textContent = `"${this._clue}"`;

      this.setPhase('guess');
      this._drawDial(false);

      if (!this._isDemo) {
        this.broadcast('clueSubmitted', { clue: this._clue });
      } else {
        this._demoSimulator.triggerGuesserRotation();
      }
    });

    // 2. 다이얼 회전 싱크
    this.onMessage('rotateDial', (player, { angle }) => {
      if (!this._gameActive || this.phase !== 'guess') return;
      if (player.id !== this._activeGuesser.id) return;

      this._activeAngle = Math.max(0, Math.min(180, angle));
      document.getElementById('active-angle-display').textContent = `${Math.round(this._activeAngle)}°`;
      this._drawDial(false);
    });

    // 3. 추측 제출 및 점수 정산
    this.onMessage('submitGuess', (player) => {
      if (!this._gameActive || this.phase !== 'guess') return;
      if (player.id !== this._activeGuesser.id) return;

      this._resolveScore();
    });
  }

  _resolveScore() {
    const diff = Math.abs(this._activeAngle - this._targetAngle);
    let points = 0;

    if (diff <= 4) points = 4;
    else if (diff <= 12) points = 3;
    else if (diff <= 20) points = 2;

    // 점수 합산 (출제자 제외 모든 플레이어 합산)
    for (const [id, score] of this._scores) {
      if (id !== this._giver.id) {
        this._scores.set(id, score + points);
      }
    }

    // 결과 노출
    document.getElementById('guess-status-area').classList.add('hidden');
    const badge = document.getElementById('points-earned');
    badge.textContent = points > 0 ? `+${points}점!` : '0점...';
    document.getElementById('reveal-controls').classList.remove('hidden');

    this._drawDial(true);

    if (!this._isDemo) {
      this.broadcast('guessResolved', {
        targetAngle: this._targetAngle,
        guessAngle: this._activeAngle,
        points
      });
    } else {
      this._demoSimulator.demoTimeouts.push(setTimeout(() => {
        if (this._isDemo) this._handleNextRound();
      }, 5000));
    }
  }
}

// ─── Main Instantiate ───────────────────────────────────────────────────────
import { HostSDK } from '../../../platform/client/HostSDK.js';
const sdk = new HostSDK({ gameId: 'spectrum-mind' });
new SpectrumGame(sdk);
