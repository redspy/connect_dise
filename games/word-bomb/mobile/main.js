import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';

class WordBombMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'mobile-screen' });

    this._myId = '';
    this._isActive = false;
    this._passedCount = 0;

    this._setupUI();
    this._wireMessages();
  }

  onReset() {
    const btnReady = document.getElementById('btn-ready');
    if (btnReady) {
      btnReady.disabled = false;
      btnReady.classList.remove('ready-btn');
      btnReady.textContent = '준비 완료';
    }
    this.showScreen('setup');
  }

  onRejoin(player) {
    // 연결 복구 중... 대기 상태 화면 띄우고 호스트에 상태 동기화 요청
    this.showScreen('waiting');
    this.sdk.sendToHost('requestSyncState', {});
  }

  _setupUI() {
    const btnJoin = document.getElementById('btn-join');
    const btnReady = document.getElementById('btn-ready');
    const inputNick = document.getElementById('nickname-input');

    const btnCorrect = document.getElementById('btn-correct');

    // 1. 대기실 로그인 조인
    if (btnJoin) {
      btnJoin.onclick = () => {
        const nickname = inputNick?.value.trim() || 'Player';
        this.sdk.sendToHost('setProfile', { nickname });
        this.showScreen('waiting');
      };
    }

    // 2. 준비 완료
    if (btnReady) {
      btnReady.onclick = () => {
        btnReady.classList.add('ready-btn');
        btnReady.textContent = '준비 완료!';
        btnReady.disabled = true;
        this.sdk.ready();
        this.sdk.sendToHost('playerReady', {});
      };
    }

    // 3. 정답 제출 및 패스 터치 이벤트 바인딩
    if (btnCorrect) {
      const handleCorrect = (e) => {
        e.preventDefault();
        if (!this._isActive) return;

        // 터치 피드백 햅틱
        this.sdk.vibrate('light');

        // 120ms 컬러 플래시 피드백
        const flashEl = document.getElementById('correct-flash-alert');
        if (flashEl) {
          flashEl.classList.remove('hidden');
          void flashEl.offsetWidth; // reflow
          setTimeout(() => flashEl.classList.add('hidden'), 120);
        }

        // 호스트로 정답 통보 -> 턴 패스 유도
        this.sdk.sendToHost('submitCorrect', {});
      };

      btnCorrect.addEventListener('touchstart', handleCorrect, { passive: false });
      btnCorrect.addEventListener('mousedown', handleCorrect);
    }
  }

  _wireMessages() {
    // 1. 차례 및 제시어 배정 수신
    this.sdk.onMessage('assignDescriber', ({ isActive, keyword, activeNick, passedCount }) => {
      this._isActive = isActive;
      this._passedCount = passedCount;

      const activePanel = document.getElementById('describer-active-panel');
      const waitPanel = document.getElementById('describer-wait-panel');

      const keywordText = document.getElementById('secret-keyword-text');
      const waitNickText = document.getElementById('wait-active-name');
      const passedVal = document.getElementById('wait-passed-count');

      // 패스 스코어 업데이트
      if (passedVal) passedVal.textContent = passedCount;

      if (isActive) {
        // 자기 차례 시작 노티 진동
        this.sdk.vibrate('medium');

        if (activePanel) activePanel.classList.remove('hidden');
        if (waitPanel) waitPanel.classList.add('hidden');
        if (keywordText) keywordText.textContent = keyword;

        // 제시어 카드 뒤집힘 (플립) 연출 트리거
        const cardFlip = document.getElementById('keyword-card-flip');
        if (cardFlip) {
          cardFlip.classList.remove('flip');
          void cardFlip.offsetWidth; // reflow
          cardFlip.classList.add('flip');
        }
      } else {
        if (activePanel) activePanel.classList.add('hidden');
        if (waitPanel) waitPanel.classList.remove('hidden');
        if (waitNickText) waitNickText.textContent = activeNick || '설명자';
      }

      this.showScreen('game');
    });

    // 1.5. 5초 이하 임박 상황 더블 진동 경고 수신
    this.sdk.onMessage('tickWarning', ({ remainingSec }) => {
      if (this._isActive) {
        // 5초 이하 매 초마다 짧게 징-징 두 번 진동
        this.sdk.vibrate([100, 80, 100]);
      }
    });

    // 1.8. 로비 상태 동기화 처리 (로비 재연결 프리징 가드)
    this.sdk.onMessage('lobbyState', ({ isReady, category }) => {
      this.showScreen('waiting');
      const btnReady = document.getElementById('btn-ready');
      if (btnReady) {
        if (isReady) {
          btnReady.classList.add('ready-btn');
          btnReady.textContent = '준비 완료!';
          btnReady.disabled = true;
        } else {
          btnReady.classList.remove('ready-btn');
          btnReady.textContent = '준비 완료';
          btnReady.disabled = false;
        }
      }
    });

    // 1.9. 결과 상태 동기화 처리
    this.sdk.onMessage('resultState', ({ loserId, loserNick, passedCount }) => {
      const statusText = document.getElementById('result-status-text');
      const passedVal = document.getElementById('result-passed');
      if (passedVal) passedVal.textContent = passedCount;

      const isMeLoser = loserId === this.sdk.playerId;
      if (statusText) {
        statusText.className = 'result-status ' + (isMeLoser ? 'loser' : 'winner');
        if (isMeLoser) {
          statusText.innerHTML = '💥 당신의 폰에서 폭탄이 터졌습니다! (패배)';
        } else {
          statusText.innerHTML = `🎉 생존 완료! <br>(${loserNick} 플레이어 폭사)`;
        }
      }
      this.showScreen('result');
    });

    // 2. 폭발 게임 종료 수신
    this.sdk.onMessage('gameFinished', ({ loserId, loserNick, passedCount }) => {
      const statusText = document.getElementById('result-status-text');
      const passedVal = document.getElementById('result-passed');

      const isMeLoser = loserId === this.sdk.playerId;

      if (passedVal) passedVal.textContent = passedCount;

      // 사이렌 적색 플래시 경보 레이어 깜빡임
      const flash = document.getElementById('explosion-flash-alert');
      if (flash) {
        flash.classList.remove('hidden');
        void flash.offsetWidth; // reflow
        setTimeout(() => flash.classList.add('hidden'), 250);
      }

      if (statusText) {
        statusText.className = 'result-status ' + (isMeLoser ? 'loser' : 'winner');
        if (isMeLoser) {
          // 패배자 묵직한 진동
          this.sdk.vibrate('heavy');
          statusText.innerHTML = '💥 당신의 폰에서 폭탄이 터졌습니다! (패배)';
        } else {
          // 승리팀 라이트 진동
          this.sdk.vibrate('light');
          statusText.innerHTML = `🎉 생존 완료! <br>(${loserNick} 플레이어 폭사)`;
        }
      }

      this.showScreen('result');
    });
  }
}

// SDK 기동 및 인스턴스 생성
const sdk = new MobileSDK();
new WordBombMobile(sdk);
