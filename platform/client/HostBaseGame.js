import { renderQR } from './shared/QRDisplay.js';

/**
 * HostBaseGame – 호스트 화면 게임의 베이스 클래스.
 *
 * ── 제공하는 것 ──────────────────────────────────────────────────────────────
 *  - 플레이어 입/퇴장·준비 상태 자동 추적 (this.players Map)
 *  - setPhase(name)으로 오버레이 자동 전환
 *    → overlayClass를 가진 요소 중 data-phase="name"인 것만 표시
 *    → 매칭 없으면 전체 hidden (순수 게임 화면)
 *  - QR 자동 렌더링 (qrContainerId 옵션)
 *  - 라이프사이클 훅 (override하여 사용)
 *
 * ── 강요하지 않는 것 ──────────────────────────────────────────────────────────
 *  - 렌더링 방식 (Three.js, Canvas, DOM 자유)
 *  - HTML 구조 (overlayClass / qrContainerId만 맞으면 됨)
 *  - 게임 고유 페이즈 이름
 *
 * ── 기본 사용법 ───────────────────────────────────────────────────────────────
 *  class MyGame extends HostBaseGame {
 *    constructor(sdk) {
 *      super(sdk, { overlayClass: 'my-overlay', qrContainerId: 'qr-box' });
 *    }
 *    async onSetup({ sessionId, qrUrl }) { this.setPhase('lobby'); }
 *    onPlayerJoin(player) { ... }
 *    onAllReady() { this.setPhase('battle'); }
 *    onReset() { this.setPhase('lobby'); }
 *  }
 */
export class HostBaseGame {
  /**
   * @param {import('./HostSDK.js').HostSDK} hostSDK
   * @param {{ overlayClass?: string, qrContainerId?: string }} [options]
   */
  constructor(hostSDK, {
    overlayClass = 'game-overlay',
    qrContainerId = null,
  } = {}) {
    this.sdk = hostSDK;
    this._overlayClass = overlayClass;
    this._qrContainerId = qrContainerId;
    this._players = new Map(); // id → player object
    this._phase = 'loading';
    this._wireSDK();
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  _wireSDK() {
    this.sdk.on('sessionReady', async ({ qrUrl, sessionId }) => {
      if (this._qrContainerId) {
        const el = document.getElementById(this._qrContainerId);
        if (el) await renderQR(el, qrUrl, { width: 200 });
      }
      await this.onSetup({ qrUrl, sessionId });
    });

    this.sdk.on('playerJoin', (player) => {
      this._players.set(player.id, player);
      this.onPlayerJoin(player);
    });

    this.sdk.on('playerLeave', (playerId) => {
      this._players.delete(playerId);
      this.onPlayerLeave(playerId);
    });

    this.sdk.on('readyUpdate', ({ readyCount, total }) => {
      this.onReadyUpdate({ readyCount, total });
    });

    this.sdk.on('allReady', () => {
      this.onAllReady();
    });

    this.sdk.on('playerRejoin', (player) => {
      this._players.set(player.id, player);
      this.onPlayerRejoin(player);
    });

    this.sdk.on('reset', () => {
      // 플레이어 맵을 SDK 현재 상태로 복원
      this._players.clear();
      for (const p of this.sdk.getPlayers()) {
        this._players.set(p.id, p);
      }
      this._phase = 'lobby';
      this.onReset();
    });
  }

  // ─── Phase / overlay ─────────────────────────────────────────────────────

  /**
   * 현재 페이즈를 변경하고 오버레이를 자동 전환합니다.
   * overlayClass를 가진 요소 중 data-phase="name"인 것만 표시,
   * 나머지는 hidden. 매칭 없으면 전부 hidden.
   * @param {string} name
   */
  setPhase(name) {
    const prev = this._phase;
    this._phase = name;
    document.querySelectorAll(`.${this._overlayClass}`).forEach(el => {
      el.classList.toggle('hidden', el.dataset.phase !== name);
    });
    this.onPhaseChange(prev, name);
  }

  /** 현재 페이즈 이름 */
  get phase() { return this._phase; }

  // ─── Player access ───────────────────────────────────────────────────────

  /** 현재 참가 중인 플레이어 Map (id → player) */
  get players() { return this._players; }

  /** 현재 참가 인원 수 */
  get playerCount() { return this._players.size; }

  /** 특정 플레이어 조회 */
  getPlayer(id) { return this._players.get(id); }

  // ─── SDK shortcuts ───────────────────────────────────────────────────────

  /** 모든 플레이어에게 메시지 브로드캐스트 */
  broadcast(type, payload) { this.sdk.broadcast(type, payload); }

  /** 특정 플레이어에게 메시지 전송 */
  sendToPlayer(id, type, payload) { this.sdk.sendToPlayer(id, type, payload); }

  /** 모바일에서 오는 특정 타입 메시지 핸들러 등록. 체이닝 가능. */
  onMessage(type, callback) { this.sdk.onMessage(type, callback); return this; }

  /** 세션 리셋 (모든 플레이어에게 reset 이벤트 발송) */
  resetSession() { this.sdk.resetSession(); }

  /** 현재 QR URL 반환 */
  getQRUrl() { return this.sdk.getQRUrl(); }

  // ─── Lifecycle hooks ─────────────────────────────────────────────────────
  // 서브클래스에서 필요한 것만 override합니다.

  /**
   * 세션 준비 완료. QR 렌더링 후 호출됩니다.
   * 여기서 게임 초기화 및 첫 setPhase 호출을 권장합니다.
   * @param {{ qrUrl: string, sessionId: string }} _
   */
  async onSetup({ qrUrl, sessionId }) {} // eslint-disable-line no-unused-vars

  /**
   * 플레이어 입장. this.players에는 이미 추가된 상태입니다.
   * @param {{ id: string, color: string }} player
   */
  onPlayerJoin(player) {} // eslint-disable-line no-unused-vars

  /**
   * 플레이어 재연결 (grace period 이내 복귀).
   * @param {{ id: string, color: string }} player
   */
  onPlayerRejoin(player) {} // eslint-disable-line no-unused-vars

  /**
   * 플레이어 퇴장. this.players에서 이미 제거된 상태입니다.
   * @param {string} playerId
   */
  onPlayerLeave(playerId) {} // eslint-disable-line no-unused-vars

  /**
   * 준비 상태 업데이트.
   * @param {{ readyCount: number, total: number }} _
   */
  onReadyUpdate({ readyCount, total }) {} // eslint-disable-line no-unused-vars

  /** 모든 플레이어 준비 완료. */
  onAllReady() {}

  /**
   * 세션 리셋. this.players는 이미 복원된 상태입니다.
   * 게임 상태 초기화 후 setPhase('lobby')를 호출하세요.
   */
  onReset() {}

  /**
   * setPhase() 호출 시 페이즈가 변경된 후 호출됩니다.
   * @param {string} from
   * @param {string} to
   */
  onPhaseChange(from, to) {} // eslint-disable-line no-unused-vars
}
