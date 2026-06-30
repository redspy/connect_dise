import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { HostSDK } from '../../../platform/client/HostSDK.js';
import { PanicCockpitDemoSimulator } from './DemoSimulator.js';

export class PanicCockpitGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'pc-overlay', qrContainerId: null });

    this._hullHealth = 100;
    this._distance = 0;
    this._goalDistance = 2000;

    this._commands = [];
    this._commandIdCounter = 0;
    this._maxCommands = 3;

    this._playerWidgets = new Map();
    this._gameActive = false;

    this._gameTimer = null;
    this._flightTimer = null;

    this._demoSimulator = new PanicCockpitDemoSimulator(this);
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

    const restartBtn = document.getElementById('btn-restart-result');
    if (restartBtn) {
      restartBtn.onclick = () => this.resetSession();
    }

    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    this._resetIdleTimer();
    this.renderLobbyPlayers(this._playerNicknames);
  }

  onPlayerLeave(playerId) {
    if (this._gameActive) {
      console.log('[Panic Cockpit] Player left, resetting game.');
      this.resetSession();
    }
  }

  onPlayerRejoin(player) {
    console.log(`[Panic Cockpit] Player ${player.id} rejoined.`);
    if (!this._gameActive) return;

    // 모바일 위젯 상태 재발송
    const widgets = this._playerWidgets.get(player.id);
    if (widgets) {
      this.sendToPlayer(player.id, 'roleAssign', { widgets });
    }

    // 이 플레이어에게 할당된 현재 진행 중인 명령어 재전송
    this._commands.forEach(cmd => {
      if (cmd.shownToPlayerId === player.id) {
        this.sendToPlayer(player.id, 'newInstruction', {
          cmdId: cmd.id,
          text: cmd.text,
          duration: cmd.duration,
          elapsed: cmd.duration - cmd.timeLeft
        });
      }
    });

    // 전체 상태 동기화 패킷 발송
    this.sendToPlayer(player.id, 'statusSync', {
      hullHealth: this._hullHealth,
      distance: this._distance,
      goalDistance: this._goalDistance
    });
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

    if (this._gameTimer) clearInterval(this._gameTimer);
    if (this._flightTimer) clearInterval(this._flightTimer);

    this._hullHealth = 100;
    this._distance = 0;
    this._commands = [];
    this._commandIdCounter = 0;
    this._playerWidgets.clear();

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) demoPlayBtn.textContent = '🤖 데모 플레이 실행';

    // HUD 초기화
    const healthFill = document.getElementById('health-bar-fill');
    if (healthFill) {
      healthFill.style.width = '100%';
      healthFill.className = 'health-bar-fill';
    }
    const healthText = document.getElementById('health-text');
    if (healthText) healthText.textContent = '100%';

    const distEl = document.getElementById('stat-distance');
    if (distEl) distEl.textContent = '0m';

    const cmdList = document.getElementById('active-commands-list');
    if (cmdList) cmdList.innerHTML = '';

    this.setPhase('lobby');
  }

  // ─── Game Flow ───────────────────────────────────────────────────────────

  _startGame() {
    this._gameActive = true;
    this._hullHealth = 100;
    this._distance = 0;
    this._commands = [];
    this._commandIdCounter = 0;

    const plist = [...this.players.values()];

    // 각 플레이어별 조작 판넬 레이아웃 설계
    plist.forEach(p => {
      this._playerWidgets.set(p.id, {
        lever: { name: `${p.nickname}의 메인 레버`, type: 'slider', value: 0 },
        switchA: { name: `${p.nickname}의 파란 스위치`, type: 'switch', value: false },
        switchB: { name: `${p.nickname}의 빨간 스위치`, type: 'switch', value: false },
        btnAction: { name: `${p.nickname}의 가속 버튼`, type: 'button', value: false }
      });
    });

    // 모바일에 역할/위젯 전달
    if (!this._isDemo) {
      plist.forEach(p => {
        this.sendToPlayer(p.id, 'roleAssign', {
          widgets: this._playerWidgets.get(p.id)
        });
      });
    }

    this.setPhase('playing');

    // 첫 명령어 생성
    this._maxCommands = Math.min(plist.length + 1, 4);
    for (let i = 0; i < this._maxCommands; i++) {
      this._generateCommand();
    }

    // 메인 게임 루프 타이머 (명령어 제한 시간 만료 등 관리, 100ms 단위)
    this._gameTimer = setInterval(() => this._tickGame(), 100);

    // 비행 거리 업데이트 타이머 (1초 단위)
    this._flightTimer = setInterval(() => this._tickFlight(), 1000);
  }

  _tickFlight() {
    if (!this._gameActive) return;

    this._distance += 50;
    const distEl = document.getElementById('stat-distance');
    if (distEl) distEl.textContent = `${this._distance}m`;

    // 전체 상태 동기화 발송
    if (!this._isDemo) {
      this.broadcast('statusSync', {
        hullHealth: this._hullHealth,
        distance: this._distance,
        goalDistance: this._goalDistance
      });
    }

    if (this._distance >= this._goalDistance) {
      this._endGame(true, '임무 성공! 소행성대를 완전히 벗어났습니다.');
    }
  }

  _tickGame() {
    if (!this._gameActive) return;

    let hasExpired = false;

    // 타이머 감소
    this._commands.forEach(cmd => {
      cmd.timeLeft -= 0.1;
      if (cmd.timeLeft <= 0) {
        hasExpired = true;
      }
    });

    // 만료된 것 처리
    const expired = this._commands.filter(cmd => cmd.timeLeft <= 0);
    expired.forEach(cmd => {
      // 내구도 차감
      this._hullHealth = Math.max(0, this._hullHealth - 15);
      
      // 모바일 실패 알림
      if (!this._isDemo) {
        this.sendToPlayer(cmd.shownToPlayerId, 'resolveInstruction', { cmdId: cmd.id, failed: true });
      }

      this._playDamageEffect();
    });

    // 만료 제외
    this._commands = this._commands.filter(cmd => cmd.timeLeft > 0);

    // UI 동기화
    this._renderCommands();
    this._updateHealthHUD();

    // 터진 내구도 확인
    if (this._hullHealth <= 0) {
      this._endGame(false, '선체가 완전히 파괴되었습니다. 구조 신호를 보낼 수 없습니다...');
      return;
    }

    // 신규 명령어 채우기
    if (hasExpired || this._commands.length < this._maxCommands) {
      while (this._commands.length < this._maxCommands) {
        this._generateCommand();
      }
    }
  }

  _generateCommand() {
    const plist = [...this.players.values()];
    if (plist.length < 2) return;

    // 조작 타겟 기기 선정
    const targetPlayer = plist[Math.floor(Math.random() * plist.length)];
    const widgetKeys = ['lever', 'switchA', 'switchB', 'btnAction'];
    const widgetKey = widgetKeys[Math.floor(Math.random() * widgetKeys.length)];
    
    const widgets = this._playerWidgets.get(targetPlayer.id);
    const widget = widgets[widgetKey];

    let targetValue;
    let actionText = '';

    if (widgetKey === 'lever') {
      const current = widget.value;
      targetValue = current === 100 ? 0 : (current === 0 ? 100 : 0);
      actionText = `레버를 ${targetValue}%로 조절`;
    } else if (widgetKey === 'switchA' || widgetKey === 'switchB') {
      targetValue = !widget.value;
      actionText = `${targetValue ? '켜기' : '끄기'}`;
    } else {
      targetValue = 'click';
      actionText = `누르기`;
    }

    // 제시어 노출할 플레이어 선정 (협동을 위해 타겟과 가급적 다른 사람)
    const otherPlayers = plist.filter(p => p.id !== targetPlayer.id);
    const shownToPlayer = otherPlayers.length > 0
      ? otherPlayers[Math.floor(Math.random() * otherPlayers.length)]
      : targetPlayer;

    const command = {
      id: ++this._commandIdCounter,
      text: `[${widget.name}] ${actionText}!`,
      targetPlayerId: targetPlayer.id,
      widgetKey,
      targetValue,
      shownToPlayerId: shownToPlayer.id,
      timeLeft: 12,
      duration: 12
    };

    this._commands.push(command);

    if (!this._isDemo) {
      this.sendToPlayer(shownToPlayer.id, 'newInstruction', {
        cmdId: command.id,
        text: command.text,
        duration: command.duration
      });
    } else {
      // 데모 모드 전용 딜레이 트리거
      this._demoSimulator.queueBotOperation(command);
    }
  }

  _renderCommands() {
    const grid = document.getElementById('active-commands-list');
    if (!grid) return;

    // 갱신
    grid.innerHTML = '';
    this._commands.forEach(cmd => {
      const card = document.createElement('div');
      card.className = `command-card ${cmd.timeLeft < 4 ? 'danger' : ''}`;
      
      const pct = Math.max(0, (cmd.timeLeft / cmd.duration) * 100);

      const targetNickname = this.players.get(cmd.targetPlayerId)?.nickname || '승무원';
      const shownNickname = this.players.get(cmd.shownToPlayerId)?.nickname || '승무원';

      card.innerHTML = `
        <div class="cmd-info">
          <span class="cmd-target-player">${shownNickname}의 화면에 노출됨 ➔ 조종자: ${targetNickname}</span>
          <span class="cmd-text">${cmd.text}</span>
        </div>
        <div class="cmd-timer-wrap">
          <div class="cmd-timer-fill" style="width: ${pct}%; background: ${cmd.timeLeft < 4 ? 'var(--neon-red)' : 'var(--neon-cyan)'};"></div>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  _updateHealthHUD() {
    const healthFill = document.getElementById('health-bar-fill');
    const healthText = document.getElementById('health-text');
    if (!healthFill || !healthText) return;

    healthFill.style.width = `${this._hullHealth}%`;
    healthText.textContent = `${this._hullHealth}%`;

    // 게이지 색상 분기
    if (this._hullHealth > 50) {
      healthFill.className = 'health-bar-fill';
    } else if (this._hullHealth > 25) {
      healthFill.className = 'health-bar-fill warning';
    } else {
      healthFill.className = 'health-bar-fill danger';
    }

    // 비상 플래시 노출
    const flash = document.querySelector('.warning-flash');
    if (flash) {
      flash.style.display = this._hullHealth < 30 ? 'block' : 'none';
    }
  }

  _playDamageEffect() {
    const container = document.getElementById('cockpit-container');
    if (container) {
      container.style.animation = 'none';
      container.offsetHeight; // Reflow
      container.style.animation = 'cockpitShake 0.4s ease-in-out';
    }
  }

  _endGame(success, message) {
    this._gameActive = false;

    if (this._gameTimer) clearInterval(this._gameTimer);
    if (this._flightTimer) clearInterval(this._flightTimer);

    const titleEl = document.getElementById('result-title');
    const msgEl = document.getElementById('result-message');

    if (titleEl) {
      titleEl.textContent = success ? '🏆 미션 성공!' : '💀 우주선 파괴';
      titleEl.style.textShadow = success ? '0 0 15px var(--neon-green)' : '0 0 15px var(--neon-red)';
    }
    if (msgEl) {
      msgEl.textContent = message;
    }

    if (!this._isDemo) {
      this.broadcast('gameFinished', { success, message });
    }

    this.setPhase('result');
  }

  // ─── 메시지 처리 및 조작 피드백 ──────────────────────────────────────────

  _wireGameMessages() {
    this.onMessage('setProfile', (player, { nickname }) => {
      player.nickname = nickname;
      this.setPlayerName(player.id, nickname);
      this.renderLobbyPlayers(this._playerNicknames);
    });

    this.onMessage('controlAction', (playerId, { key, value }) => {
      if (!this._gameActive) return;

      const widgets = this._playerWidgets.get(playerId);
      if (!widgets || !widgets[key]) return;

      // 로컬 위젯 상태 업데이트
      widgets[key].value = value;

      // 매칭 명령어 감지
      let matchedIndex = -1;
      for (let i = 0; i < this._commands.length; i++) {
        const cmd = this._commands[i];
        if (cmd.targetPlayerId === playerId && cmd.widgetKey === key) {
          if (cmd.targetValue === 'click' && key === 'btnAction') {
            matchedIndex = i;
            break;
          } else if (cmd.targetValue === value) {
            matchedIndex = i;
            break;
          }
        }
      }

      if (matchedIndex !== -1) {
        const cmd = this._commands[matchedIndex];
        
        // 명령어 풀에서 소거
        this._commands.splice(matchedIndex, 1);

        // 모바일에 성공 신호 발송 (햅틱 트리거용)
        this.sendToPlayer(cmd.shownToPlayerId, 'resolveInstruction', { cmdId: cmd.id, success: true });
        
        // 보너스 비행 거리
        this._distance += 25;
        const distEl = document.getElementById('stat-distance');
        if (distEl) distEl.textContent = `${this._distance}m`;

        this._renderCommands();

        // 새 명령 채워 넣기
        while (this._commands.length < this._maxCommands) {
          this._generateCommand();
        }
      }
    });
  }
}

// 칵핏 흔들림 키프레임 주입
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes cockpitShake {
      0%, 100% { transform: translate(0, 0) rotate(0deg); }
      10% { transform: translate(-8px, 5px) rotate(-1deg); }
      30% { transform: translate(6px, -6px) rotate(1deg); }
      50% { transform: translate(-5px, 8px) rotate(-0.5deg); }
      70% { transform: translate(7px, 4px) rotate(0.8deg); }
      90% { transform: translate(-3px, -3px) rotate(-0.3deg); }
    }
  `;
  document.head.appendChild(style);
}

// SDK 엔트리 초기화
const sdk = new HostSDK({ gameId: 'panic-cockpit' });
new PanicCockpitGame(sdk);
