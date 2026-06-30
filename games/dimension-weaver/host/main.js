import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { HostSDK } from '../../../platform/client/HostSDK.js';
import { DimensionWeaverDemoSimulator } from './DemoSimulator.js';

export class DimensionWeaverHost extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'dw-overlay', qrContainerId: 'qr-box' });

    this._distance = 0;
    this._maxDistance = 100;
    this._hull = 100;
    this._runnerRow = 2; // 0 ~ 4 (5행 그리드)
    
    this._gameActive = false;
    this._isPausedForRejoin = false;
    this._gameInterval = null;

    this._map = []; // 100칸의 맵 그리드
    this._playerRoles = new Map(); // playerId -> string[] (배정받은 차원 역할)

    this._demoSimulator = new DimensionWeaverDemoSimulator(this);
    this._isDemo = false;

    this._canvas = null;
    this._ctx = null;
    
    this._particles = [];
    this._drawnDistance = 0;

    this._wireMessages();
  }

  async onSetup({ sessionId }) {
    this.setPhase('lobby');

    this._canvas = document.getElementById('stage-canvas');
    if (this._canvas) {
      this._ctx = this._canvas.getContext('2d');
    }

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
    this._playerRoles.delete(playerId);
    this.renderLobbyPlayers(this._playerNicknames);

    if (this._gameActive) {
      // 실시간 협동 게임 중 이탈 감지 -> 차원 균열 정지
      this._pauseGameForRejoin();
    }
  }

  onPlayerRejoin(player) {
    this._resetIdleTimer();
    this.renderLobbyPlayers(this._playerNicknames);

    if (this._gameActive) {
      // 복원 시 기존 역할 재배정 및 게임 재개
      const savedRoles = this._playerRoles.get(player.id) || ['alpha'];
      this._playerRoles.set(player.id, savedRoles);

      this.sendToPlayer(player.id, 'assignRole', {
        roles: savedRoles,
        distance: this._distance,
        hull: this._hull
      });

      this._resumeGameAfterRejoin();
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
    this._isPausedForRejoin = false;
    this._distance = 0;
    this._hull = 100;
    this._runnerRow = 2;
    this._playerRoles.clear();
    this._particles = [];
    this._drawnDistance = 0;
    if (this._gameInterval) clearInterval(this._gameInterval);

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) demoPlayBtn.textContent = '🤖 데모 플레이 실행';

    document.getElementById('stabilization-banner')?.classList.add('hidden');
    document.getElementById('roles-board').innerHTML = '';

    this.setPhase('lobby');
  }

  // ─── Map Generator ────────────────────────────────────────────────────────

  _generateMap() {
    this._map = [];
    for (let x = 0; x <= this._maxDistance + 10; x++) {
      // 기본적으로 5열 다 solid floor(1)
      const col = {
        floor: [1, 1, 1, 1, 1],
        challenge: null, // 'spike' | 'gate'
        challengeActive: true,
        gateColor: null // 'red' | 'blue' | 'green'
      };

      // 5칸 간격으로 랜덤 장애물 생성 (앞의 5칸은 안전 지대)
      if (x > 5 && x % 4 === 0) {
        const rand = Math.random();
        if (rand < 0.35) {
          // 1. 끊어진 다리 (길 개척사 대상)
          const holeRow = Math.floor(Math.random() * 5);
          col.floor[holeRow] = 0;
          // 가끔 2개의 구멍
          if (Math.random() < 0.4) {
            col.floor[(holeRow + 2) % 5] = 0;
          }
        } else if (rand < 0.7) {
          // 2. 가시 트랩 (장애물 소멸사 대상)
          col.challenge = 'spike';
          col.challengeRow = Math.floor(Math.random() * 5);
        } else {
          // 3. 삼색 레이저 게이트 (게이트 개방사 대상)
          col.challenge = 'gate';
          const colors = ['red', 'blue', 'green'];
          col.gateColor = colors[Math.floor(Math.random() * colors.length)];
        }
      }

      this._map.push(col);
    }
  }

  // ─── Game Management ──────────────────────────────────────────────────────

  _startGame() {
    this._gameActive = true;
    this._isPausedForRejoin = false;
    this._distance = 0;
    this._hull = 100;
    this._runnerRow = 2;
    this._playerRoles.clear();
    this._particles = [];
    this._drawnDistance = 0;

    this._maxDistance = this._isDemo ? 20 : 100;
    this._generateMap();
    this._assignPlayerRoles();

    this.setPhase('playing');
    document.getElementById('stabilization-banner')?.classList.add('hidden');

    this._startLoop();
  }

  _assignPlayerRoles() {
    const plist = [...this.players.values()];
    if (plist.length === 0) return;

    if (plist.length >= 3) {
      // 3인 이상: 각자 하나의 고유 차원 분담
      this._playerRoles.set(plist[0].id, ['alpha']);
      this._playerRoles.set(plist[1].id, ['beta']);
      this._playerRoles.set(plist[2].id, ['gamma']);
      for (let i = 3; i < plist.length; i++) {
        // 남은 플레이어는 서포터로 지정
        this._playerRoles.set(plist[i].id, [['alpha', 'beta', 'gamma'][i % 3]]);
      }
    } else if (plist.length === 2) {
      // 2인: 한 명은 길 개척, 한 명은 복합 조작
      this._playerRoles.set(plist[0].id, ['alpha']);
      this._playerRoles.set(plist[1].id, ['beta', 'gamma']);
    } else {
      // 솔로/테스트 1인: 전체 부여
      this._playerRoles.set(plist[0].id, ['alpha', 'beta', 'gamma']);
    }

    // 모바일에 차원 부여 패킷 전송 및 대시보드 갱신
    plist.forEach(p => {
      const roles = this._playerRoles.get(p.id);
      this.sendToPlayer(p.id, 'assignRole', { roles });
    });

    this._renderRolesBoard();
  }

  _startLoop() {
    if (this._gameInterval) clearInterval(this._gameInterval);

    // 초당 4틱 (250ms 당 1칸 이동)
    this._gameInterval = setInterval(() => {
      if (this._isPausedForRejoin) return;
      this._tick();
    }, 250);

    // 60fps 애니메이션 렌더 루프 (카메라 보간 및 파티클 전용)
    const render = () => {
      if (!this._gameActive) return;
      if (!this._isPausedForRejoin) {
        // 카메라 전진 거리 보간
        this._drawnDistance += (this._distance - this._drawnDistance) * 0.15;
        this._updateParticles();
      }
      this._renderCanvas();
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  _updateParticles() {
    this._particles = this._particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // 중력 가속도
      p.life--;
      return p.life > 0;
    });
  }

  _pauseGameForRejoin() {
    this._isPausedForRejoin = true;
    document.getElementById('stabilization-banner')?.classList.remove('hidden');
    document.getElementById('hud-phase-label').textContent = '차원 균열 (정지됨)';
    document.getElementById('hud-phase-label').style.color = '#ef4444';
  }

  _resumeGameAfterRejoin() {
    this._isPausedForRejoin = false;
    document.getElementById('stabilization-banner')?.classList.add('hidden');
    document.getElementById('hud-phase-label').textContent = '차원 동기화 정상';
    document.getElementById('hud-phase-label').style.color = 'var(--neon-cyan)';
  }

  // ─── Game Physics Tick ────────────────────────────────────────────────────

  _tick() {
    const col = this._map[this._distance];
    
    // 1. 게이트 장애물 체크 (통과 가능 여부 판단)
    if (col && col.challenge === 'gate' && col.challengeActive) {
      // 잠긴 게이트를 만나면 전진이 가로막힘 (체력은 안 달지만 멈춤)
      document.getElementById('hud-phase-label').textContent = `게이트 차단 (${col.gateColor.toUpperCase()})`;
      this._renderCanvas();
      return;
    } else {
      document.getElementById('hud-phase-label').textContent = '차원 동기화 정상';
    }

    // 2. 가시 장애물 피격 체크
    if (col && col.challenge === 'spike' && col.challengeActive) {
      if (col.challengeRow === this._runnerRow) {
        this._damageHull(20, '가시 충돌');
        col.challengeActive = false; // 일회성 피격 후 소거
      }
    }

    // 전진 거리 증가
    this._distance++;
    
    // HUD 갱신
    document.getElementById('hud-distance').textContent = `${this._distance} / ${this._maxDistance}m`;

    // 3. 디딤판 체크 및 자동 경로 조절
    const nextCol = this._map[this._distance];
    if (nextCol) {
      // 러너가 딛고 있는 칸이 구멍(0)인 경우 인접한 solid row로 자동 회피 시도
      if (nextCol.floor[this._runnerRow] === 0) {
        let saved = false;
        const neighbors = [this._runnerRow - 1, this._runnerRow + 1];
        for (let r of neighbors) {
          if (r >= 0 && r < 5 && nextCol.floor[r] === 1) {
            this._runnerRow = r;
            saved = true;
            break;
          }
        }

        // 회피하지 못했다면 우주로 낙하!
        if (!saved) {
          this._damageHull(20, '추락 피해');
          // 구멍 메워주기 전까지 가장 가까운 온전한 행으로 임시 구조 조치
          for (let r = 0; r < 5; r++) {
            if (nextCol.floor[r] === 1) {
              this._runnerRow = r;
              break;
            }
          }
        }
      }
    }

    // 모바일에 동기화 신호 브로드캐스트
    const upcoming = [];
    for (let i = 0; i < 5; i++) {
      const idx = this._distance + i;
      if (idx < this._map.length) {
        upcoming.push({
          x: idx,
          floor: this._map[idx].floor,
          challenge: this._map[idx].challenge,
          challengeActive: this._map[idx].challengeActive,
          challengeRow: this._map[idx].challengeRow,
          gateColor: this._map[idx].gateColor
        });
      }
    }
    this.broadcast('mapTick', {
      distance: this._distance,
      hull: this._hull,
      upcoming
    });

    this._renderCanvas();

    // 골인 검증
    if (this._distance >= this._maxDistance) {
      this._endGame(true);
    } else {
      if (this._isDemo) {
        this._demoSimulator.onTick();
      }
    }
  }

  _damageHull(amt, cause) {
    this._hull = Math.max(0, this._hull - amt);
    
    const hullEl = document.getElementById('hud-hull');
    if (hullEl) {
      hullEl.textContent = `${this._hull}%`;
      if (this._hull <= 30) {
        hullEl.style.color = '#ef4444';
      }
    }

    // 선체 피해 시 화면 흔들림 연출 추가
    const canvasWrap = document.querySelector('.canvas-wrapper');
    if (canvasWrap) {
      canvasWrap.classList.remove('shake-anim');
      void canvasWrap.offsetWidth; // trigger reflow
      canvasWrap.classList.add('shake-anim');
    }

    // 💥 파티클 폭발 연출 추가
    if (this._canvas) {
      const cellW = this._canvas.width / 10;
      const cellH = this._canvas.height / 5;
      const rx = 2 * cellW + cellW / 2;
      const ry = this._runnerRow * cellH + cellH / 2;
      const color = cause === '추락 피해' ? '#00f3ff' : '#ff007f';

      for (let i = 0; i < 20; i++) {
        this._particles.push({
          x: rx,
          y: ry,
          vx: (Math.random() - 0.5) * 8 - 3, // 뒤쪽으로 폭발하도록 바이어스
          vy: (Math.random() - 0.5) * 8 - 2,
          color: color,
          life: 25 + Math.random() * 15,
          size: 2 + Math.random() * 3
        });
      }
    }

    this.broadcast('damageAlert', { hull: this._hull, cause });

    if (this._hull <= 0) {
      this._endGame(false);
    }
  }

  _endGame(win) {
    this._gameActive = false;
    if (this._gameInterval) clearInterval(this._gameInterval);

    const headline = document.getElementById('result-headline');
    const summary = document.getElementById('result-summary');

    if (win) {
      headline.textContent = '🏆 시공간 돌파 성공!';
      headline.style.color = 'var(--neon-cyan)';
      summary.textContent = `축하합니다! 무사히 ${this._maxDistance}m 종착지에 골인했습니다.`;
    } else {
      headline.textContent = '💥 시공간 균열로 파괴됨';
      headline.style.color = '#ef4444';
      summary.textContent = `선체가 버티지 못하고 파괴되었습니다. (최종 이동 거리: ${this._distance}m)`;
    }

    this.broadcast('gameFinished', {
      win,
      distance: this._distance
    });

    this.setPhase('result');
  }

  // ─── 렌더링 ──────────────────────────────────────────────────────────────

  _renderCanvas() {
    if (!this._ctx || !this._canvas) return;

    const ctx = this._ctx;
    const w = this._canvas.width;
    const h = this._canvas.height;
    
    // 1. 우주 배경 채우기
    ctx.fillStyle = '#060a17';
    ctx.fillRect(0, 0, w, h);

    // 배경 스크롤 별들 그리기 (부드러운 스크롤)
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < 25; i++) {
      const starX = (Math.sin(i * 123) * 5000 - this._drawnDistance * 16) % w;
      const starY = (Math.cos(i * 456) * 5000) % h;
      ctx.fillRect(starX < 0 ? starX + w : starX, Math.abs(starY), 2, 2);
    }

    // 그리드 설정
    const rows = 5;
    const cols = 10;
    const cellW = w / cols;
    const cellH = h / rows;

    // 2. 가시 그리드 트랙 드로잉 (2칸 전방부터 부드럽게 스크롤)
    const baseCol = Math.floor(this._drawnDistance);
    const fraction = this._drawnDistance % 1;
    const viewOffset = baseCol - 2;

    for (let c = 0; c < cols + 2; c++) {
      const mapX = viewOffset + c;
      if (mapX < 0 || mapX >= this._map.length) continue;

      const colData = this._map[mapX];
      const screenX = (c - fraction) * cellW;

      for (let r = 0; r < rows; r++) {
        const hasFloor = colData.floor[r] === 1;

        if (hasFloor) {
          // 디딤판: 푸른빛 투명 그리드
          ctx.fillStyle = 'rgba(0, 243, 255, 0.12)';
          ctx.strokeStyle = 'rgba(0, 243, 255, 0.35)';
          ctx.lineWidth = 1;
          ctx.fillRect(screenX + 2, r * cellH + 2, cellW - 4, cellH - 4);
          ctx.strokeRect(screenX + 2, r * cellH + 2, cellW - 4, cellH - 4);
        } else {
          // 구멍: 붉은 점선 바운더리
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(screenX + 5, r * cellH + 5, cellW - 10, cellH - 10);
          ctx.setLineDash([]);
        }
      }

      // 3. 가시(Spike) 드로잉
      if (colData.challenge === 'spike' && colData.challengeActive) {
        const r = colData.challengeRow;
        const screenY = r * cellH;
        ctx.fillStyle = '#ff007f';
        ctx.beginPath();
        ctx.moveTo(screenX + cellW / 2, screenY + 12);
        ctx.lineTo(screenX + 10, screenY + cellH - 12);
        ctx.lineTo(screenX + cellW - 10, screenY + cellH - 12);
        ctx.closePath();
        ctx.fill();

        // 경고 네온 외곽선
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 4. 삼색 레이저 게이트 드로잉
      if (colData.challenge === 'gate' && colData.challengeActive) {
        ctx.strokeStyle = colData.gateColor === 'red' ? '#ef4444' : (colData.gateColor === 'blue' ? '#00f3ff' : '#22c55e');
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(screenX + cellW / 2, 0);
        ctx.lineTo(screenX + cellW / 2, h);
        ctx.stroke();
        
        // 레이저 에너지 입자
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 5; i++) {
          const pY = (Math.sin(this._distance + i) * 1000) % h;
          ctx.fillRect(screenX + cellW / 2 - 3, Math.abs(pY), 6, 6);
        }
      }
    }

    // 5. 러너(Runner) 그리기 (고정 2번째 열)
    const runnerX = 2 * cellW + cellW / 2;
    const runnerY = this._runnerRow * cellH + cellH / 2;

    // 우주인 헬멧 구체
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(runnerX, runnerY, 14, 0, Math.PI * 2);
    ctx.fill();

    // 헬멧 네온 바이저
    ctx.fillStyle = 'var(--neon-cyan)';
    ctx.beginPath();
    ctx.arc(runnerX + 4, runnerY - 2, 8, 0, Math.PI * 2);
    ctx.fill();

    // 제트팩 가스 불꽃 플리커
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.moveTo(runnerX - 16, runnerY);
    ctx.lineTo(runnerX - 26 - (Math.random() * 8), runnerY - 6);
    ctx.lineTo(runnerX - 26 - (Math.random() * 8), runnerY + 6);
    ctx.closePath();
    ctx.fill();

    // 6. 충돌 입자 파티클 그리기
    this._particles.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  _renderRolesBoard() {
    const board = document.getElementById('roles-board');
    if (!board) return;

    const plist = [...this.players.values()];
    board.innerHTML = plist.map(p => {
      const roles = this._playerRoles.get(p.id) || [];
      const nickname = this._playerNicknames.get(p.id) || p.nickname || '익명';
      
      const roleBadges = roles.map(r => {
        if (r === 'alpha') return '<span style="color:var(--neon-cyan);">🌀 길 개척사</span>';
        if (r === 'beta') return '<span style="color:var(--neon-pink);">⚡ 장애물 소멸사</span>';
        if (r === 'gamma') return '<span style="color:var(--neon-gold);">🔑 게이트 개방사</span>';
        return '';
      }).join(', ');

      return `
        <div class="role-chip">
          <span style="font-weight: bold;">${nickname}</span>
          <span>:</span>
          <span>${roleBadges}</span>
        </div>
      `;
    }).join('');
  }

  // ─── 메시지 수신 ─────────────────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('setProfile', (player, { nickname }) => {
      player.nickname = nickname;
      this.setPlayerName(player.id, nickname);
      this.renderLobbyPlayers(this._playerNicknames);
    });

    // 1. 차원 알파: 블록 설치
    this.onMessage('buildPath', (player, { x, row }) => {
      if (!this._gameActive) return;

      const roles = this._playerRoles.get(player.id) || [];
      if (!roles.includes('alpha')) return;

      const mapX = parseInt(x);
      const r = parseInt(row);

      if (mapX >= 0 && mapX < this._map.length && r >= 0 && r < 5) {
        this._map[mapX].floor[r] = 1;
        this._renderCanvas();
      }
    });

    // 2. 차원 베타: 장애물 소멸
    this.onMessage('disableTrap', (player, { x }) => {
      if (!this._gameActive) return;

      const roles = this._playerRoles.get(player.id) || [];
      if (!roles.includes('beta')) return;

      const mapX = parseInt(x);
      if (mapX >= 0 && mapX < this._map.length) {
        const col = this._map[mapX];
        if (col.challenge === 'spike') {
          col.challengeActive = false;
          this._renderCanvas();
        }
      }
    });

    // 3. 차원 감마: 레이저 게이트 컬러 오픈
    this.onMessage('unlockGate', (player, { color }) => {
      if (!this._gameActive) return;

      const roles = this._playerRoles.get(player.id) || [];
      if (!roles.includes('gamma')) return;

      // 러너 가시 시야에 들어온 게이트들 잠금 해제 (runner 거리 기준 앞 10칸 탐색)
      for (let x = this._distance; x < this._distance + 10; x++) {
        if (x >= this._map.length) break;
        const col = this._map[x];
        if (col.challenge === 'gate' && col.gateColor === color) {
          col.challengeActive = false;
        }
      }
      this._renderCanvas();
    });
  }
}

// SDK 엔트리 초기화
const sdk = new HostSDK({ gameId: 'dimension-weaver' });
new DimensionWeaverHost(sdk);
