/**
 * MobileBaseGame – 모바일 화면 게임의 베이스 클래스.
 *
 * ── 제공하는 것 ──────────────────────────────────────────────────────────────
 *  - 세션 입장·리셋·호스트 연결 끊김 자동 처리
 *  - showScreen(name)으로 화면 전환
 *    → screenClass를 가진 요소 중 data-screen="name"인 것만 표시
 *  - 플레이어 정보 (this.player)
 *  - 라이프사이클 훅 (override하여 사용)
 *
 * ── 강요하지 않는 것 ──────────────────────────────────────────────────────────
 *  - 화면 구조 (screenClass / data-screen만 맞으면 됨)
 *  - UI 방식
 *
 * ── 기본 사용법 ───────────────────────────────────────────────────────────────
 *  class MyMobileGame extends MobileBaseGame {
 *    constructor(sdk) {
 *      super(sdk, { screenClass: 'my-screen' });
 *    }
 *    onJoin(player) { this.showScreen('waiting'); }
 *    onAllReady() { this.showScreen('game'); }
 *    onReset() { this.showScreen('waiting'); }
 *  }
 */
export class MobileBaseGame {
  /**
   * @param {import('./MobileSDK.js').MobileSDK} mobileSDK
   * @param {{ screenClass?: string }} [options]
   */
  constructor(mobileSDK, {
    screenClass = 'game-screen',
  } = {}) {
    this.sdk = mobileSDK;
    this._screenClass = screenClass;
    this._player = null;
    this._wireSDK();
    this._injectHomeButton();
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  _wireSDK() {
    this.sdk.on('join', (player) => {
      this._player = player;
      this.onJoin(player);
    });

    // 재연결: 화면 전환 없이 플레이어 정보만 갱신
    this.sdk.on('rejoin', (player) => {
      this._player = player;
      this.onRejoin(player);
    });

    this.sdk.on('allReady', () => {
      this.onAllReady();
    });

    this.sdk.on('reset', () => {
      this.onReset();
    });

    this.sdk.on('hostDisconnect', () => {
      this.onHostDisconnect();
    });

    this.sdk.on('kicked', () => {
      this.onKicked();
    });
  }

  // ─── Home button (탈출 버튼) ─────────────────────────────────────────────

  /**
   * 모든 게임 화면에 공통으로 나타나는 작은 "홈으로" 버튼을 삽입합니다.
   * 준비 완료 대기 중이거나 게임 도중 나가고 싶을 때 언제든 사용 가능합니다.
   */
  _injectHomeButton() {
    if (document.getElementById('_mbg-home')) return;

    const btn = document.createElement('button');
    btn.id = '_mbg-home';
    btn.title = '게임 선택으로 돌아가기';
    btn.innerHTML = '&#x2302;'; // ⌂
    btn.style.cssText = [
      'position:fixed;bottom:max(env(safe-area-inset-bottom,0px) + 12px, 16px);left:12px',
      'z-index:7900',
      'width:34px;height:34px;border-radius:50%',
      'background:rgba(0,0,0,0.22);border:1px solid rgba(255,255,255,0.18)',
      'color:rgba(255,255,255,0.38);font-size:14px',
      'cursor:pointer;display:flex;align-items:center;justify-content:center',
      'transition:background .2s,color .2s',
      'box-shadow:0 2px 6px rgba(0,0,0,0.25)',
    ].join(';');

    btn.addEventListener('pointerenter', () => {
      btn.style.background = 'rgba(0,0,0,0.55)';
      btn.style.color = 'rgba(255,255,255,0.75)';
    });
    btn.addEventListener('pointerleave', () => {
      btn.style.background = 'rgba(0,0,0,0.22)';
      btn.style.color = 'rgba(255,255,255,0.38)';
    });
    btn.addEventListener('click', () => {
      if (window.confirm('게임을 나가시겠습니까?\n게임 선택 화면으로 이동합니다.')) {
        window.location.href = '/';
      }
    });

    document.body.appendChild(btn);
  }

  // ─── Screen management ───────────────────────────────────────────────────

  /**
   * screenClass를 가진 요소 중 data-screen="name"인 것만 표시,
   * 나머지는 hidden.
   * @param {string} name
   */
  showScreen(name) {
    document.querySelectorAll(`.${this._screenClass}`).forEach(el => {
      el.classList.toggle('hidden', el.dataset.screen !== name);
    });
  }

  // ─── Player access ───────────────────────────────────────────────────────

  /** 내 플레이어 객체 { id, color, ... } */
  get player() { return this._player; }

  /** 내 플레이어 ID */
  get playerId() { return this._player?.id ?? null; }

  /** 내 플레이어 색상 */
  get playerColor() { return this._player?.color ?? null; }

  // ─── SDK shortcuts ───────────────────────────────────────────────────────

  /** 호스트에게 메시지 전송 */
  sendToHost(type, payload) { this.sdk.sendToHost(type, payload); }

  /** 준비 완료 신호 전송 */
  ready() { this.sdk.ready(); }

  /** 호스트에서 오는 특정 타입 메시지 핸들러 등록. 체이닝 가능. */
  onMessage(type, callback) { this.sdk.onMessage(type, callback); return this; }

  /** 진동 */
  vibrate(pattern) { this.sdk.vibrate(pattern); }

  /** 센서 권한 요청 */
  requestSensors() { return this.sdk.requestSensors(); }

  /** 기울기 센서 등록 */
  onOrientation(callback) { this.sdk.onOrientation(callback); }

  /** 모션 센서 등록 */
  onMotion(callback) { this.sdk.onMotion(callback); }

  // ─── Lifecycle hooks ─────────────────────────────────────────────────────
  // 서브클래스에서 필요한 것만 override합니다.

  /**
   * 세션에 입장했을 때.
   * @param {{ id: string, color: string }} player
   */
  onJoin(player) {} // eslint-disable-line no-unused-vars

  /**
   * 백그라운드 복귀 등으로 재연결됐을 때.
   * 기본 동작: 아무것도 하지 않음 (현재 화면 유지).
   * @param {{ id: string, color: string }} player
   */
  onRejoin(player) {} // eslint-disable-line no-unused-vars

  /** 모든 플레이어 준비 완료 (호스트가 게임 시작). */
  onAllReady() {}

  /**
   * 세션 리셋. 대기 화면으로 돌아가는 처리를 여기서 합니다.
   */
  onReset() {}

  /**
   * 호스트 연결 끊김.
   * 기본 동작 없음 (MobileSDK가 QR 스캔 버튼을 자동으로 표시합니다).
   */
  onHostDisconnect() {}

  /**
   * 호스트에 의해 강퇴됨.
   * 기본 동작 없음 (MobileSDK가 QR 스캔 버튼을 자동으로 표시합니다).
   */
  onKicked() {}
}
