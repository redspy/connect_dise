import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';

class RhythmJamMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'mobile-screen' });

    this._instrumentIndex = 0; // 0: Bass, 1: Snare, 2: Hihat
    this._score = 0;
    this._combo = 0;
    this._myId = '';

    this._setupUI();
    this._wireMessages();
  }

  _setupUI() {
    const btnJoin = document.getElementById('btn-join');
    const btnReady = document.getElementById('btn-ready');
    const inputNick = document.getElementById('nickname-input');

    const padBtn = document.getElementById('drum-pad-btn');

    // 1. 대기방 조인
    if (btnJoin) {
      btnJoin.addEventListener('click', () => {
        const nickname = inputNick?.value.trim() || 'Player';
        this.sdk.setNickname(nickname);
        this.sdk.joinSession();
        this.showScreen('waiting');
      });
    }

    // 2. 준비 완료
    if (btnReady) {
      btnReady.addEventListener('click', () => {
        btnReady.classList.toggle('ready-btn');
        btnReady.textContent = btnReady.classList.contains('ready-btn') ? '준비 완료' : '준비 완료!';
        this.sdk.ready();
      });
    }

    // 3. 🥁 타격 패드 터치 바인딩 (touchstart & mousedown 간섭 해결)
    if (padBtn) {
      const handleTap = (e) => {
        e.preventDefault(); // 더블 트리거 방지
        
        // 버튼 햅틱 진동 전파
        this.sdk.vibrate('light');

        // 송신
        this.sdk.sendToHost('tapNote', {});

        // 시각 액티브 클래스 온
        padBtn.classList.add('active');
      };

      const handleRelease = () => {
        padBtn.classList.remove('active');
      };

      padBtn.addEventListener('touchstart', handleTap, { passive: false });
      padBtn.addEventListener('touchend', handleRelease, { passive: true });

      padBtn.addEventListener('mousedown', handleTap);
      padBtn.addEventListener('mouseup', handleRelease);
      padBtn.addEventListener('mouseleave', handleRelease);
    }
  }

  _wireMessages() {
    // 1. 악기 역할 배정
    this.sdk.onMessage('assignInstrument', ({ instrumentIndex, score, combo }) => {
      this._instrumentIndex = instrumentIndex;
      
      const roleName = document.getElementById('role-name');
      const scoreVal = document.getElementById('game-score');
      const comboVal = document.getElementById('game-combo');

      // 기존 등급 테마 초기화
      document.body.classList.remove('bass-theme', 'snare-theme', 'hihat-theme');

      const instruments = [
        { name: '🎸 BASS DRUM', class: 'bass-theme' },
        { name: '🥁 SNARE DRUM', class: 'snare-theme' },
        { name: '✨ HI-HAT CYMBAL', class: 'hihat-theme' }
      ];

      const inst = instruments[instrumentIndex] || instruments[0];
      
      if (roleName) roleName.textContent = inst.name;
      document.body.className = `mobile-controller ${inst.class}`;

      // 리조인 시 상태 복구
      if (score !== undefined && scoreVal) scoreVal.textContent = score;
      if (combo !== undefined && comboVal) comboVal.textContent = combo;

      this.showScreen('game');
    });

    // 2. 실시간 점수/콤보 갱신 수신
    this.sdk.onMessage('scoreUpdate', ({ score, combo }) => {
      const scoreVal = document.getElementById('game-score');
      const comboVal = document.getElementById('game-combo');
      if (scoreVal) scoreVal.textContent = score;
      if (comboVal) comboVal.textContent = combo;
    });

    // 3. 미스 피격 경고 (지리릭 진동 + 적색 플래시)
    this.sdk.onMessage('missAlert', () => {
      // 3연속 미세 경고 진동
      this.sdk.vibrate('light');
      setTimeout(() => this.sdk.vibrate('light'), 80);
      setTimeout(() => this.sdk.vibrate('light'), 160);

      const flash = document.getElementById('miss-flash-alert');
      if (flash) {
        flash.classList.remove('hidden');
        void flash.offsetWidth; // trigger reflow
        setTimeout(() => flash.classList.add('hidden'), 200);
      }
    });

    // 4. 게임 최종 완료 결과
    this.sdk.onMessage('gameFinished', ({ score, maxCombo, grade }) => {
      const rScore = document.getElementById('result-score');
      const rCombo = document.getElementById('result-max-combo');
      const rGrade = document.getElementById('result-grade');

      if (rScore) rScore.textContent = score;
      if (rCombo) rCombo.textContent = maxCombo;
      if (rGrade) {
        rGrade.textContent = grade;
        const colors = { S: 'var(--neon-yellow)', A: 'var(--neon-cyan)', B: 'var(--neon-pink)', C: '#8b9bb4' };
        rGrade.style.color = colors[grade] || '#fff';
      }

      this.showScreen('result');
    });
  }
}

// SDK 초기화 및 모바일 기동
const sdk = new MobileSDK();
const controller = new RhythmJamMobile(sdk);
