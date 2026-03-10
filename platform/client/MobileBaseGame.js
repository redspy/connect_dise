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
}
