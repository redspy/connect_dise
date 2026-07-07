import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';
import { LevelIndicator } from '../../../platform/client/shared/LevelIndicator.js';

const MAX_RPM = 3000;
const MAX_SHAKE_ENERGY = 1500;

class SpinMobileGame extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'spin-screen' });

    // UI 요소 취득
    this.connectionStatus = document.getElementById('connection-status');
    this.sessionDisplay = document.getElementById('session-display');
    this.permissionModal = document.getElementById('permission-modal');
    this.btnGrant = document.getElementById('btn-grant-permission');
    this.btnReady = document.getElementById('btn-ready');
    this.readyStatus = document.getElementById('ready-status');

    this.launchRpmDisplay = document.getElementById('launch-rpm-display');
    this.launchGaugeBar = document.getElementById('launch-gauge-bar');
    this.launchTimer = document.getElementById('launch-timer');
    this.battleRpmDisplay = document.getElementById('battle-rpm-display');
    this.battleGaugeBar = document.getElementById('battle-gauge-bar');
    this.myColorDot = document.getElementById('my-color-dot');

    this.btnAgain = document.getElementById('btn-again');
    this.btnQuit = document.getElementById('btn-quit');

    // 상태 관리 변수들
    this._myRpm = 0;
    this._tiltInterval = null;
    this._latestBeta = 0;
    this._latestGamma = 0;
    this._latestShakeMag = 0;
    
    // 센서 캘리브레이션 기준점
    this._baseBeta = 0;
    this._baseGamma = 0;

    // 햅틱 경고 주기용
    this._lastWarningTime = 0;

    // 레벨 인디케이터 초기화
    this.levelIndicator = new LevelIndicator({
      bubble: document.getElementById('level-bubble'),
      betaEl: document.getElementById('level-beta'),
      gammaEl: document.getElementById('level-gamma'),
    });

    this._initSessionDisplay();
    this._bindEvents();
    this._setupMessageHandlers();
  }

  _initSessionDisplay() {
    if (!this.sdk.getSessionId()) {
      this.sessionDisplay.textContent = 'No Session ID';
    } else {
      this.sessionDisplay.textContent = `Session: ${this.sdk.getSessionId()}`;
    }
  }

  _bindEvents() {
    // 권한 승인 버튼
    this.btnGrant.addEventListener('click', async () => {
      const granted = await this.requestSensors();
      if (granted) {
        this.permissionModal.classList.add('hidden');
        this._initSensors();
      } else {
        alert('센서 권한이 필요합니다.');
      }
    });

    // 준비하기 버튼
    this.btnReady.addEventListener('click', () => {
      this.btnReady.disabled = true;
      this.btnReady.classList.add('hidden');
      this.readyStatus.classList.remove('hidden');
      this.ready();
    });

    // 다시하기 버튼
    if (this.btnAgain) {
      this.btnAgain.addEventListener('click', () => {
        this.sendToHost('requestReset', {});
      });
    }

    // 그만하기 버튼
    if (this.btnQuit) {
      this.btnQuit.addEventListener('click', () => {
        window.close();
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#fff;font-size:1.5rem;">탭을 닫아주세요</div>';
      });
    }
  }

  _initSensors() {
    this.onOrientation(({ beta, gamma }) => {
      this._latestBeta = beta;
      this._latestGamma = gamma;
      this.levelIndicator.update(beta, gamma);
    });

    this.onMotion(({ shakeMagnitude }) => {
      this._latestShakeMag = shakeMagnitude;
    });
  }

  // ─── SDK 라이프사이클 훅 오버라이드 ─────────────────────────────────────────

  onJoin(player) {
    this.connectionStatus.classList.add('connected');
    this.myColorDot.style.background = player.color;
    this.myColorDot.style.boxShadow = `0 0 12px ${player.color}`;
    this.myColorDot.classList.remove('hidden');
    this.btnReady.classList.remove('hidden');
    this.showScreen('lobby');
  }

  onRejoin(player) {
    this.connectionStatus.classList.add('connected');
    this.myColorDot.style.background = player.color;
    this.myColorDot.style.boxShadow = `0 0 12px ${player.color}`;
    this.myColorDot.classList.remove('hidden');
    
    // 재연결 시 즉시 rejoin 복구 중 화면으로 전환하여 프리징 가드 적용
    this.showScreen('rejoining');
  }

  onReset() {
    this._stopTiltSending();
    this.btnReady.classList.remove('hidden');
    this.btnReady.disabled = false;
    this.btnReady.textContent = '준비하기';
    this.readyStatus.classList.add('hidden');
    this.showScreen('lobby');
  }

  onHostDisconnect() {
    alert('호스트가 연결을 끊었습니다.');
  }

  // ─── 메시지 핸들러 셋업 ──────────────────────────────────────────────────

  _setupMessageHandlers() {
    // 로비 상태 복원
    this.onMessage('lobbyState', () => {
      this.showScreen('lobby');
    });

    // 런칭 시작 알림
    this.onMessage('launchStart', ({ durationMs }) => {
      this._myRpm = 0;
      this.showScreen('launching');
      this._startLaunchPhase(durationMs);
    });

    // 런칭 복원 알림 (재접속 시)
    this.onMessage('launchState', ({ remainingMs, rpm }) => {
      this._myRpm = rpm || 0;
      this.showScreen('launching');
      this._startLaunchPhase(remainingMs);
    });

    // 배틀 카운트다운 시작 알림 (3, 2, 1)
    this.onMessage('battleCountdown', ({ durationMs, players }) => {
      this.showScreen('battle');
      
      const me = players?.find(p => p.id === this.playerId);
      if (me) this._myRpm = me.rpm;
      this._updateBattleRpm(this._myRpm);
      
      // 카운트다운 진입 시 센서 중심점 자동 보정(Calibration) 수행
      this._baseBeta = this._latestBeta;
      this._baseGamma = this._latestGamma;
      
      this.vibrate('light');
    });

    // 배틀 조작 시작 알림 (GO!)
    this.onMessage('battleLive', () => {
      this.showScreen('battle');
      this._startTiltSending();
    });

    // 배틀 상태 동기화 패킷 (5Hz 수신)
    this.onMessage('battleState', ({ players, phase, isEliminated }) => {
      // rejoin 복구 가드
      if (this.screenClass !== 'battle' && (phase === 'countdown' || phase === 'battle')) {
        this.showScreen('battle');
        if (phase === 'battle') {
          this._startTiltSending();
        }
      }

      if (isEliminated) {
        this.showScreen('eliminated');
        this._stopTiltSending();
        return;
      }

      const me = players?.find(p => p.id === this.playerId);
      if (me) {
        this._myRpm = me.rpm;
        this._updateBattleRpm(this._myRpm);

        // RPM 위험 구간 경고 피드백
        if (this._myRpm > 0 && this._myRpm < 800) {
          const now = Date.now();
          if (now - this._lastWarningTime > 1000) {
            this.vibrate('medium'); // 1초 간격으로 위험 진동 경고
            this._lastWarningTime = now;
          }
          this.battleGaugeBar.style.background = 'linear-gradient(90deg, #ff1744, #ff5252)';
        } else {
          this.battleGaugeBar.style.background = ''; // 기본 그라디언트 복원
        }
      }
    });

    // 탈락 알림
    this.onMessage('eliminated', ({ rank, reason }) => {
      this._stopTiltSending();
      this.showScreen('eliminated');
      document.getElementById('eliminated-rank').textContent = `${rank}위 탈락`;
      this.vibrate([200, 100, 200, 100, 400]);
    });

    // 게임 종료 알림
    this.onMessage('gameOver', ({ rankings }) => {
      this._stopTiltSending();
      
      const myRank = rankings?.findIndex(entry => entry.id === this.playerId);
      const isWinner = myRank === 0;

      document.getElementById('result-icon').textContent = isWinner ? '🏆' : '💥';
      document.getElementById('result-title').textContent = isWinner
        ? '우승!'
        : `${myRank + 1}위 완료`;

      this.showScreen('result');
      this.vibrate(isWinner ? 'heavy' : 'medium');
    });

    // 충돌 진동 피드백
    this.onMessage('collisionFeedback', ({ intensity }) => {
      if (intensity === 'heavy') {
        this.vibrate('medium');
      } else {
        this.vibrate('light');
      }
    });

    // 벽 충돌 진동 피드백
    this.onMessage('wallFeedback', ({ speed }) => {
      const force = Math.min(150, Math.max(30, Math.round((speed || 0.1) * 800)));
      if (force > 100) {
        this.vibrate('medium');
      } else {
        this.vibrate('light');
      }
    });
  }

  // ─── 런칭 페이즈 로직 ─────────────────────────────────────────────────────

  _startLaunchPhase(durationMs) {
    let shakeEnergy = 0;
    let elapsed = 0;
    const DURATION = durationMs || 5000;

    const onMotion = () => {
      shakeEnergy += this._latestShakeMag;
      if (this._latestShakeMag > 15 && Math.random() < 0.25) {
        this.vibrate('light');
      }
    };
    window.addEventListener('devicemotion', onMotion);

    const iv = setInterval(() => {
      elapsed += 100;

      const rpm = Math.min(MAX_RPM, (shakeEnergy / MAX_SHAKE_ENERGY) * MAX_RPM);
      this._myRpm = rpm;
      this.launchRpmDisplay.textContent = `${Math.round(rpm)} RPM`;
      this.launchGaugeBar.style.width = `${(rpm / MAX_RPM) * 100}%`;

      const remaining = Math.ceil((DURATION - elapsed) / 1000);
      this.launchTimer.textContent = remaining > 0 ? remaining : '0';

      if (elapsed >= DURATION) {
        clearInterval(iv);
        window.removeEventListener('devicemotion', onMotion);
        const finalRpm = Math.max(200, Math.round(rpm));
        this.sendToHost('launchSpin', { rpm: finalRpm });
      }
    }, 100);
  }

  // ─── 배틀 틸트 송신 ────────────────────────────────────────────────────────

  _startTiltSending() {
    if (this._tiltInterval) return;
    this._tiltInterval = setInterval(() => {
      const betaDiff = this._latestBeta - this._baseBeta;
      const gammaDiff = this._latestGamma - this._baseGamma;

      const tiltX = Math.max(-1, Math.min(1, gammaDiff / 35));
      const tiltZ = Math.max(-1, Math.min(1, betaDiff / 35));
      
      this.sendToHost('tiltInput', { tiltX, tiltZ });
    }, 33);
  }

  _stopTiltSending() {
    if (this._tiltInterval) {
      clearInterval(this._tiltInterval);
      this._tiltInterval = null;
    }
  }

  _updateBattleRpm(rpm) {
    this.battleRpmDisplay.textContent = `${Math.round(rpm)} RPM`;
    this.battleGaugeBar.style.width = `${(rpm / MAX_RPM) * 100}%`;
  }
}

// 인스턴스 기동
const mobileSDK = new MobileSDK();
new SpinMobileGame(mobileSDK);
