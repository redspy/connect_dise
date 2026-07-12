import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';
import { MobileSDK } from '../../../platform/client/MobileSDK.js';

class PanicCockpitMobileGame extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'pc-screen' });

    // UI Elements
    this.connectionStatus = document.getElementById('connection-status');
    this.statusLabel = this.connectionStatus.querySelector('.status-label');

    // Lobby
    this.joinForm = document.getElementById('join-form');
    this.nicknameInput = document.getElementById('nickname-input');
    this.btnJoin = document.getElementById('btn-join');
    this.btnReady = document.getElementById('btn-ready');
    this.lobbyStatusText = document.getElementById('lobby-status');

    // Instruction Box
    this.instructionText = document.getElementById('instruction-text');
    this.instructionTimer = document.getElementById('instruction-timer');

    // Controls
    this.sliderLever = document.getElementById('slider-lever');
    this.switchA = document.getElementById('switch-a');
    this.switchB = document.getElementById('switch-b');
    this.btnAction = document.getElementById('btn-action');

    // HUD
    this.hudHealthFill = document.getElementById('hud-health-fill');
    this.hudDistanceFill = document.getElementById('hud-distance-fill');

    this.myNickname = '';
    this.activeInstruction = null; // { cmdId, timeLeft, duration, intervalId }

    this._setupUIEvents();
    this._wireGameMessages();
  }

  // ─── MobileBaseGame Lifecycle Hooks ────────────────────────────────────────

  onJoin(player) {
    this.connectionStatus.classList.add('connected');
    this.statusLabel.textContent = '서버 연결 완료';

    // 정식 입장 완료(onJoin) 시점에 로컬스토리지 닉네임 자동 복원
    const saved = localStorage.getItem('panic_nickname');
    if (saved) {
      this.myNickname = saved;
      this.joinForm.classList.add('hidden');
      this.btnReady.classList.remove('hidden');
      this.btnReady.disabled = false;
      this.btnReady.textContent = '준비하기';
      this.sendToHost('setProfile', { nickname: this.myNickname });
    } else {
      this.joinForm.classList.remove('hidden');
      this.btnReady.classList.add('hidden');
    }
    this.showScreen('waiting');
  }

  onRejoin(player) {
    this.connectionStatus.classList.add('connected');
    this.statusLabel.textContent = '서버 재연결 완료';
    
    // 재연결 시 호스트에게 상태 동기화 요청 가능
    // 호스트의 rejoin 핸들러가 자동으로 widgets, active commands, statusSync를 쏴주므로 대기함.
  }

  onReset() {
    if (this.btnReady) {
      this.btnReady.disabled = false;
      this.btnReady.textContent = '준비하기';
    }
    this._clearActiveInstruction();
    this.showScreen('waiting');
    this.lobbyStatusText.textContent = '세션이 리셋되었습니다. 대기 중...';
  }

  onHostDisconnect() {
    this.connectionStatus.classList.remove('connected');
    this.statusLabel.textContent = '호스트 연결 끊김';
  }

  onKicked() {
    this.connectionStatus.classList.remove('connected');
    this.statusLabel.textContent = '추방됨';
  }

  // ─── UI Event Binding ──────────────────────────────────────────────────────

  _setupUIEvents() {
    this.btnJoin.addEventListener('click', () => {
      const nickname = this.nicknameInput.value.trim();
      if (!nickname) {
        alert('닉네임을 입력해주세요.');
        return;
      }
      this.myNickname = nickname;
      localStorage.setItem('panic_nickname', this.myNickname);
      
      this.joinForm.classList.add('hidden');
      this.btnReady.classList.remove('hidden');

      this.sendToHost('setProfile', { nickname: this.myNickname });
    });

    this.btnReady.addEventListener('click', () => {
      this.btnReady.disabled = true;
      this.btnReady.textContent = '준비완료 ✓';
      this.ready();
    });

    this.sliderLever.addEventListener('input', () => {
      const val = Number(this.sliderLever.value);
      this.vibrate('light');
      this.sendToHost('controlAction', { key: 'lever', value: val });
    });

    this.switchA.addEventListener('change', () => {
      this.vibrate('light');
      this.sendToHost('controlAction', { key: 'switchA', value: this.switchA.checked });
    });

    this.switchB.addEventListener('change', () => {
      this.vibrate('light');
      this.sendToHost('controlAction', { key: 'switchB', value: this.switchB.checked });
    });

    this.btnAction.addEventListener('click', () => {
      this.vibrate('medium');
      this.sendToHost('controlAction', { key: 'btnAction', value: 'click' });
      
      // 버튼 액션 스케일 이펙트
      this.btnAction.style.transform = 'scale(0.95)';
      setTimeout(() => this.btnAction.style.transform = 'none', 100);
    });

    // 소켓 Disconnect 처리
    this.sdk.on('disconnect', () => {
      this.connectionStatus.classList.remove('connected');
      this.statusLabel.textContent = '연결 복구 중...';
    });
  }

  // ─── Game Message Listeners ────────────────────────────────────────────────

  _wireGameMessages() {
    this.onMessage('roleAssign', ({ widgets }) => {
      // 위젯 레이블 다이나믹 적용
      if (widgets) {
        if (widgets.lever) document.getElementById('label-lever').textContent = widgets.lever.name;
        if (widgets.switchA) document.getElementById('label-switch-a').textContent = widgets.switchA.name;
        if (widgets.switchB) document.getElementById('label-switch-b').textContent = widgets.switchB.name;
        if (widgets.btnAction) document.getElementById('label-btn-action').textContent = widgets.btnAction.name;
      }

      // 기본 계기판 값 리셋
      this.sliderLever.value = 0;
      this.switchA.checked = false;
      this.switchB.checked = false;

      this.showScreen('game');
    });

    this.onMessage('newInstruction', ({ cmdId, text, duration, elapsed = 0 }) => {
      this._clearActiveInstruction();

      this.instructionText.textContent = text;
      this.instructionTimer.style.width = '100%';

      const timeLeft = duration - elapsed;
      this.activeInstruction = {
        cmdId,
        duration,
        timeLeft,
        intervalId: setInterval(() => {
          this.activeInstruction.timeLeft -= 0.1;
          const pct = Math.max(0, (this.activeInstruction.timeLeft / this.activeInstruction.duration) * 100);
          this.instructionTimer.style.width = `${pct}%`;
          
          if (this.activeInstruction.timeLeft <= 0) {
            this._clearActiveInstruction();
          }
        }, 100)
      };
    });

    this.onMessage('resolveInstruction', ({ cmdId, success, failed }) => {
      if (this.activeInstruction && this.activeInstruction.cmdId === cmdId) {
        this._clearActiveInstruction();
      }

      if (success) {
        this.vibrate('light');
      } else if (failed) {
        this.vibrate('double');
      }
    });

    this.onMessage('actionFeedback', ({ key, success }) => {
      // 위젯 조작 양방향 피드백 연출 (글로우 효과)
      let widgetEl;
      if (key === 'lever') widgetEl = document.querySelector('.lever-widget');
      else if (key === 'switchA') widgetEl = document.getElementById('switch-a').closest('.switch-widget');
      else if (key === 'switchB') widgetEl = document.getElementById('switch-b').closest('.switch-widget');
      else if (key === 'btnAction') widgetEl = document.querySelector('.button-widget');

      if (widgetEl) {
        const cls = success ? 'action-success' : 'action-fail';
        widgetEl.classList.add(cls);
        setTimeout(() => widgetEl.classList.remove(cls), 300);
      }

      if (success) {
        this.vibrate('light');
      } else {
        this.vibrate('medium');
      }
    });

    this.onMessage('statusSync', ({ hullHealth, distance, goalDistance }) => {
      if (this.hudHealthFill) this.hudHealthFill.style.width = `${hullHealth}%`;
      
      if (this.hudDistanceFill) {
        const pct = Math.min(100, (distance / goalDistance) * 100);
        this.hudDistanceFill.style.width = `${pct}%`;
      }
    });

    this.onMessage('gameFinished', ({ success, message }) => {
      this._clearActiveInstruction();
      
      document.getElementById('result-icon').textContent = success ? '🏆' : '💀';
      document.getElementById('result-title').textContent = success ? '임무 성공!' : '선체 완파...';
      document.getElementById('result-desc').textContent = message;

      this.showScreen('result');
      
      if (success) {
        this.vibrate([100, 50, 100, 50, 300]);
      } else {
        this.vibrate([200, 100, 200, 100, 400]);
      }
    });

    // 로비 재연결 프리징 가드 패킷 수신 처리
    this.onMessage('lobbyState', ({ players }) => {
      if (this.btnReady) {
        this.btnReady.disabled = false;
        this.btnReady.textContent = '준비하기';
      }
      this._clearActiveInstruction();
      this.showScreen('waiting');
      
      // 이미 닉네임 입력했다면 닉네임 입력폼을 가림
      const saved = localStorage.getItem('panic_nickname');
      if (saved) {
        this.joinForm.classList.add('hidden');
        this.btnReady.classList.remove('hidden');
      }
      
      this.lobbyStatusText.textContent = `현재 대기자: ${players.length}명`;
    });

    this.onMessage('resultState', ({ success, message }) => {
      this._clearActiveInstruction();
      document.getElementById('result-icon').textContent = success ? '🏆' : '💀';
      document.getElementById('result-title').textContent = success ? '임무 성공!' : '선체 완파...';
      document.getElementById('result-desc').textContent = message;
      this.showScreen('result');
    });
  }

  _clearActiveInstruction() {
    if (this.activeInstruction) {
      clearInterval(this.activeInstruction.intervalId);
      this.activeInstruction = null;
    }
    this.instructionText.textContent = '대기 중...';
    this.instructionTimer.style.width = '0%';
  }
}

// SDK 엔트리 초기화
const sdk = new MobileSDK();
new PanicCockpitMobileGame(sdk);
