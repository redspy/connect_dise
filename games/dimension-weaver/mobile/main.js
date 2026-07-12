import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';
import { MobileSDK } from '../../../platform/client/MobileSDK.js';

export class DimensionWeaverMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'dw-screen' });

    this.myNickname = '';
    this.myRoles = [];
    this.upcomingData = [];
    this.runnerRow = 2;

    // UI Elements
    this.connectionStatus = document.getElementById('connection-status');
    this.statusLabel = this.connectionStatus.querySelector('.status-label');

    this.joinForm = document.getElementById('join-form');
    this.nicknameInput = document.getElementById('nickname-input');
    this.btnJoin = document.getElementById('btn-join');
    this.btnReady = document.getElementById('btn-ready');
    this.lobbyStatusText = document.getElementById('lobby-status');

    this.hudDistText = document.getElementById('hud-dist-text');
    this.hudHullText = document.getElementById('hud-hull-text');

    this.alphaPanel = document.getElementById('alpha-panel');
    this.betaPanel = document.getElementById('beta-panel');
    this.gammaPanel = document.getElementById('gamma-panel');
    this.alphaGrid = document.querySelector('.alpha-grid-container');
    this.betaScans = document.getElementById('beta-scans');
    this.betaCountBadge = document.getElementById('beta-count-badge');
    this.destabilizedAlert = document.getElementById('destabilized-alert');

    // 2인용 우선 가이드
    this.priorityGuide = document.getElementById('priority-guide');
    this.priorityText = document.getElementById('priority-text');

    // Result UI
    this.resultHeadline = document.getElementById('result-headline');
    this.resultSummary = document.getElementById('result-summary');
    this.resultIcon = document.getElementById('result-icon');
    this.resultStats = document.getElementById('mobile-result-stats');

    this._bindEvents();
    this._wireMessages();
  }

  // ─── 라이프사이클 훅 ─────────────────────────────────────────────────────────

  onJoin(player) {
    this.connectionStatus.classList.add('connected');
    this.statusLabel.textContent = '연결 완료';

    const saved = localStorage.getItem('weaver_nickname');
    if (saved) {
      this.myNickname = saved;
      this.joinForm.classList.add('hidden');
      this.btnReady.classList.remove('hidden');
      this.sendToHost('setProfile', { nickname: this.myNickname });
    } else {
      this.joinForm.classList.remove('hidden');
      this.btnReady.classList.add('hidden');
    }

    this.showScreen('waiting');
  }

  onRejoin(player) {
    this.connectionStatus.classList.add('connected');
    this.statusLabel.textContent = '연결 복구됨';
  }

  onReset() {
    if (this.btnReady) {
      this.btnReady.disabled = false;
      this.btnReady.textContent = '준비하기';
    }
    this.myRoles = [];
    this.upcomingData = [];
    this.showScreen('waiting');
    this.lobbyStatusText.textContent = '세션이 리셋되었습니다. 대기 중...';

    // 역할 UI 리셋
    this.alphaPanel.classList.add('hidden');
    this.betaPanel.classList.add('hidden');
    this.gammaPanel.classList.add('hidden');
    this.destabilizedAlert.classList.add('hidden');
    this.priorityGuide.classList.add('hidden');
  }

  onHostDisconnect() {
    this.connectionStatus.classList.remove('connected');
    this.statusLabel.textContent = '호스트 연결 차단';
    this.showScreen('waiting');
    this.lobbyStatusText.textContent = '호스트와의 연결이 끊어졌습니다. 대기 중...';
  }

  // ─── 이벤트 바인딩 ──────────────────────────────────────────────────────────

  _bindEvents() {
    this.btnJoin.addEventListener('click', () => {
      const nickname = this.nicknameInput.value.trim();
      if (!nickname) {
        alert('닉네임을 입력하세요.');
        return;
      }
      this.myNickname = nickname;
      localStorage.setItem('weaver_nickname', this.myNickname);

      this.joinForm.classList.add('hidden');
      this.btnReady.classList.remove('hidden');

      this.sendToHost('setProfile', { nickname: this.myNickname });
    });

    this.btnReady.addEventListener('click', () => {
      this.btnReady.disabled = true;
      this.btnReady.textContent = '준비완료 ✓';
      this.ready();
    });

    // 🔑 차원 감마: 레이저 게이트 버튼 바인딩
    document.querySelectorAll('.gate-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        this.applyTactileBounce(btn);
        this.vibrate('medium');
        this.sendToHost('unlockGate', { color });
      });
    });
  }

  // ─── 햅틱/반응 연출 헬퍼 ──────────────────────────────────────────────────────

  applyTactileBounce(element) {
    element.classList.add('tactile-bounce');
    element.addEventListener('animationend', () => {
      element.classList.remove('tactile-bounce');
    }, { once: true });
  }

  // ─── 렌더링 헬퍼 ─────────────────────────────────────────────────────────────

  renderAlphaGrid() {
    if (!this.alphaGrid || this.upcomingData.length === 0) return;

    this.alphaGrid.innerHTML = '';
    // 5행(r) x 5열(c) 그리드 생성
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const colData = this.upcomingData[c];
        if (!colData) continue;

        const isSolid = colData.floor[r] === 1;
        const cell = document.createElement('div');
        
        // 현재 러너 위치와 동일한 행이면 가이드 클래스 부여
        const isRunnerRow = r === this.runnerRow;
        cell.className = `alpha-cell ${isSolid ? 'solid-cell' : 'hole-cell'} ${isRunnerRow ? 'runner-row-guide' : ''}`;
        cell.textContent = `${colData.x},${r + 1}`;

        if (!isSolid) {
          cell.addEventListener('click', () => {
            this.applyTactileBounce(cell);
            this.vibrate('light');
            // 호스트에 다리 놓기 전송
            this.sendToHost('buildPath', { x: colData.x, row: r });
            
            // 낙관적 UI 업데이트 (지터 방지용 즉각 반응)
            cell.className = `alpha-cell solid-cell ${isRunnerRow ? 'runner-row-guide' : ''}`;
          });
        }

        this.alphaGrid.appendChild(cell);
      }
    }
  }

  renderBetaScans() {
    if (!this.betaScans) return;

    this.betaScans.innerHTML = '';
    let foundSpikes = 0;

    this.upcomingData.forEach(colData => {
      if (colData.challenge === 'spike' && colData.challengeActive) {
        foundSpikes++;
        const btn = document.createElement('button');
        btn.className = 'trap-item-btn';
        btn.textContent = `⚠️ 가시 소멸 (위치: ${colData.x}m / 행: ${colData.challengeRow + 1})`;
        
        btn.addEventListener('click', () => {
          this.applyTactileBounce(btn);
          this.vibrate('medium');
          // 가시 장애물 제거 전송
          this.sendToHost('disableTrap', { x: colData.x });
          setTimeout(() => btn.remove(), 150); // 바운스 완료 후 돔에서 제거
        });

        this.betaScans.appendChild(btn);
      }
    });

    if (this.betaCountBadge) {
      this.betaCountBadge.textContent = `위험 감지: ${foundSpikes}`;
      this.betaCountBadge.style.display = foundSpikes > 0 ? 'inline-block' : 'none';
    }

    if (foundSpikes === 0) {
      this.betaScans.innerHTML = '<p style="color: #8b9bb4; font-size: 0.85rem;">안전 구역 (감지된 가시 없음)</p>';
    }
  }

  updateGammaLights(upcoming) {
    // 활성 게이트 중 가장 가까운 게이트 색 감지
    const nextGate = upcoming.find(col => col.challenge === 'gate' && col.challengeActive);

    // 신호등 초기화
    document.getElementById('light-red')?.classList.remove('active');
    document.getElementById('light-blue')?.classList.remove('active');
    document.getElementById('light-green')?.classList.remove('active');

    if (nextGate) {
      const color = nextGate.gateColor;
      const targetLight = document.getElementById(`light-${color}`);
      if (targetLight) {
        targetLight.classList.add('active');
      }
    }
  }

  updatePriorityGuide(upcoming) {
    if (!this.priorityGuide) return;
    this.priorityGuide.classList.remove('hidden');

    // 시야 내 활성화된 첫 장애물 스캔
    const firstThreat = upcoming.find(col => 
      (col.challenge === 'spike' && col.challengeActive) || 
      (col.challenge === 'gate' && col.challengeActive)
    );

    if (firstThreat) {
      if (firstThreat.challenge === 'spike') {
        this.priorityText.innerHTML = `<span style="color:var(--neon-pink); font-weight:bold;">⚡ 가시 제거</span> 시급! (위치: ${firstThreat.x}m)`;
      } else if (firstThreat.challenge === 'gate') {
        this.priorityText.innerHTML = `<span style="color:var(--neon-gold); font-weight:bold;">🔑 ${firstThreat.gateColor.toUpperCase()} 게이트</span> 해제 요망! (위치: ${firstThreat.x}m)`;
      }
    } else {
      this.priorityText.textContent = '안전 구역 비행 중 (위험 요인 없음)';
    }
  }

  // ─── 메시지 수신 ──────────────────────────────────────────────────────────

  _wireMessages() {
    // 연결 관련 및 재접속 프리징 방지
    this.onMessage('lobbyState', ({ phase }) => {
      if (phase === 'lobby') {
        this.btnReady.disabled = false;
        this.btnReady.textContent = '준비하기';
        this.showScreen('waiting');
      }
    });

    this.onMessage('assignRole', ({ roles, distance, hull, paused, upcoming }) => {
      this.myRoles = roles;
      
      // HUD 초기화
      if (distance !== undefined) this.hudDistText.textContent = `${distance} / 100m`;
      if (hull !== undefined) this.hudHullText.textContent = `HULL: ${hull}%`;

      // 역할 패널 전환
      this.alphaPanel.classList.toggle('hidden', !roles.includes('alpha'));
      this.betaPanel.classList.toggle('hidden', !roles.includes('beta'));
      this.gammaPanel.classList.toggle('hidden', !roles.includes('gamma'));

      if (paused !== undefined) {
        this.destabilizedAlert.classList.toggle('hidden', !paused);
      }

      if (upcoming) {
        this.upcomingData = upcoming;
        if (roles.includes('alpha')) this.renderAlphaGrid();
        if (roles.includes('beta')) this.renderBetaScans();
        if (roles.includes('gamma')) this.updateGammaLights(upcoming);
      }

      this.showScreen('game');
    });

    this.onMessage('mapTick', ({ distance, hull, runnerRow, upcoming }) => {
      this.hudDistText.textContent = `${distance} / 100m`;
      this.hudHullText.textContent = `HULL: ${hull}%`;
      this.runnerRow = runnerRow !== undefined ? runnerRow : 2;

      this.destabilizedAlert.classList.add('hidden'); // 정상 복구 완료

      // 선체 피해 경고 연출 (30% 이하 카드 적색 점멸)
      const isCritical = hull <= 30;
      document.querySelectorAll('.card-bg').forEach(card => {
        card.classList.toggle('critical-hull-alert', isCritical);
      });

      this.upcomingData = upcoming;

      if (this.myRoles.includes('alpha')) {
        this.renderAlphaGrid();
      }
      if (this.myRoles.includes('beta')) {
        this.renderBetaScans();
      }
      if (this.myRoles.includes('gamma')) {
        this.updateGammaLights(upcoming);
      }

      // 2인 복합 역할 전용 우선순위 큐 갱신
      if (this.myRoles.includes('beta') && this.myRoles.includes('gamma')) {
        this.updatePriorityGuide(upcoming);
      } else {
        this.priorityGuide?.classList.add('hidden');
      }
    });

    this.onMessage('damageAlert', ({ hull, cause }) => {
      this.hudHullText.textContent = `HULL: ${hull}%`;
      this.vibrate('heavy'); // 피격 시 강한 피격 햅틱
    });

    this.onMessage('actionSuccess', ({ type }) => {
      // 액션 성공에 따른 haptic 강화
      if (type === 'buildPath') {
        this.vibrate('light');
      } else if (type === 'disableTrap' || type === 'unlockGate') {
        this.vibrate('medium');
      }
    });

    this.onMessage('actionFailure', ({ type }) => {
      // 액션 실패에 따른 haptic 경고 (더블 진동) 및 낙관적 UI 롤백
      this.vibrate([80, 50, 80]);
      if (type === 'buildPath') {
        this.renderAlphaGrid();
        if (this.alphaGrid) {
          this.alphaGrid.classList.add('critical-hull-alert');
          setTimeout(() => this.alphaGrid.classList.remove('critical-hull-alert'), 300);
        }
      } else if (type === 'disableTrap') {
        this.renderBetaScans();
        if (this.betaScans) {
          this.betaScans.classList.add('critical-hull-alert');
          setTimeout(() => this.betaScans.classList.remove('critical-hull-alert'), 300);
        }
      } else if (type === 'unlockGate') {
        document.querySelectorAll('.gate-btn').forEach(btn => {
          btn.classList.add('critical-hull-alert');
          setTimeout(() => btn.classList.remove('critical-hull-alert'), 300);
        });
      }
    });

    this.onMessage('stageClear', ({ stage }) => {
      // 속도 가속 시 햅틱 알림
      this.vibrate([100, 50, 100]);
    });

    this.onMessage('pauseState', ({ paused }) => {
      if (paused) {
        this.destabilizedAlert.classList.remove('hidden');
      } else {
        this.destabilizedAlert.classList.add('hidden');
      }
    });

    this.onMessage('gameFinished', ({ win, distance, stats }) => {
      if (win) {
        this.resultHeadline.textContent = '🏆 시공간 돌파 성공!';
        this.resultHeadline.style.color = 'var(--neon-cyan)';
        this.resultSummary.textContent = '차원 궤도를 무사히 완주해 탈출했습니다!';
        this.resultIcon.textContent = '🏆';
        this.vibrate([100, 50, 100, 50, 300]);
      } else {
        this.resultHeadline.textContent = '💥 선체 파괴 패배';
        this.resultHeadline.style.color = '#ef4444';
        this.resultSummary.textContent = `선체가 파손되었습니다. (이동 거리: ${distance}m)`;
        this.resultIcon.textContent = '💥';
        this.vibrate([200, 100, 200]);
      }

      if (this.resultStats && stats) {
        this.resultStats.innerHTML = `
          <div style="display:flex; justify-content:space-between; margin-bottom:5px; border-bottom:1px dashed rgba(255,255,255,0.05);">
            <span>길 개척 횟수</span>
            <span style="font-weight:bold; color:var(--neon-cyan);">${stats.buildCount || 0}회</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:5px; border-bottom:1px dashed rgba(255,255,255,0.05);">
            <span>가시 제거 횟수</span>
            <span style="font-weight:bold; color:var(--neon-pink);">${stats.trapCount || 0}회</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:5px; border-bottom:1px dashed rgba(255,255,255,0.05);">
            <span>게이트 개방 횟수</span>
            <span style="font-weight:bold; color:var(--neon-gold);">${stats.gateCount || 0}회</span>
          </div>
        `;
      }

      this.showScreen('result');
    });
  }
}

// SDK 초기화 및 게임 기동
const sdk = new MobileSDK();
new DimensionWeaverMobile(sdk);
