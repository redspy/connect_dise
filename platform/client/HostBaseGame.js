import { renderQR } from './shared/QRDisplay.js';
import './shared/AppBar.js';
import './shared/LobbyPanel.js';

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

    // 재연결 배너용 상태
    this._disconnectedPlayers = new Set();   // 현재 연결 끊긴 플레이어 id
    this._disconnectedColors  = new Map();   // id → color (leave 후에도 색상 유지)
    this._playerNicknames     = new Map();   // id → nickname (게임이 setPlayerName으로 등록)
    this._reconnectBannerQrDone = false;

    this._wireSDK();
    this._initReconnectBanner();
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  _wireSDK() {
    this.sdk.on('sessionReady', async ({ qrUrl, sessionId }) => {
      // <game-lobby> 자동 감지 — 있으면 QR/세션 자동 처리
      this._lobbyEl = document.querySelector('game-lobby');
      if (this._lobbyEl) {
        await renderQR(this._lobbyEl.qrContainer, qrUrl, { width: 200 });
        this._lobbyEl.setSession(sessionId, qrUrl);
      } else if (this._qrContainerId) {
        const el = document.getElementById(this._qrContainerId);
        if (el) await renderQR(el, qrUrl, { width: 200 });
      }
      await this.onSetup({ qrUrl, sessionId });
    });

    this.sdk.on('playerJoin', (player) => {
      this._players.set(player.id, player);
      this.onPlayerJoin(player);
    });

    this.sdk.on('playerDisconnect', ({ playerId }) => {
      const player = this._players.get(playerId);
      if (player) this._disconnectedColors.set(playerId, player.color);
      this._disconnectedPlayers.add(playerId);
      this._refreshReconnectBanner();
      this.onPlayerDisconnect(playerId);
    });

    this.sdk.on('playerLeave', (playerId) => {
      this._players.delete(playerId);
      this._disconnectedPlayers.delete(playerId);
      this._refreshReconnectBanner();
      this.onPlayerLeave(playerId);

      // 게임 진행 중 모든 플레이어가 퇴장하면 세션을 자동 리셋하여 로비로 복귀
      // (로비·로딩 단계에서는 동작하지 않음)
      if (this._players.size === 0
          && this._phase !== 'lobby'
          && this._phase !== 'loading') {
        this.resetSession();
      }
    });

    this.sdk.on('readyUpdate', ({ readyCount, total }) => {
      this.onReadyUpdate({ readyCount, total });
    });

    this.sdk.on('allReady', () => {
      this.onAllReady();
    });

    this.sdk.on('playerRejoin', (player) => {
      this._players.set(player.id, player);
      this._disconnectedPlayers.delete(player.id);
      this._refreshReconnectBanner();
      this.onPlayerRejoin(player);
    });

    this.sdk.on('reset', () => {
      // 플레이어 맵을 SDK 현재 상태로 복원
      this._players.clear();
      for (const p of this.sdk.getPlayers()) {
        this._players.set(p.id, p);
      }
      this._disconnectedPlayers.clear();
      this._refreshReconnectBanner();
      this._phase = 'lobby';
      this.onReset();
    });
  }

  // ─── Reconnect banner ────────────────────────────────────────────────────

  /** 플레이어 닉네임을 등록하면 배너에 이름이 표시됩니다. 게임에서 setProfile 수신 시 호출하세요. */
  setPlayerName(id, name) {
    this._playerNicknames.set(id, name);
  }

  _initReconnectBanner() {
    const style = document.createElement('style');
    style.textContent = `
      #_hbg-banner {
        position: fixed; bottom: 20px; right: 20px; z-index: 9999;
        background: rgba(10, 12, 18, 0.96);
        border: 2px solid rgba(251, 191, 36, 0.6);
        border-radius: 14px; padding: 12px 14px;
        display: flex; align-items: center; gap: 12px;
        max-width: 300px;
        box-shadow: 0 6px 28px rgba(0,0,0,0.65), 0 0 18px rgba(251,191,36,0.1);
        backdrop-filter: blur(16px);
        animation: _hbg-in 0.25s ease;
        font-family: -apple-system, 'Apple SD Gothic Neo', sans-serif;
        color: #f1f5f9;
      }
      #_hbg-banner.hidden { display: none !important; }
      @keyframes _hbg-in {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      ._hbg-qr-wrap { flex-shrink: 0; }
      ._hbg-qr-wrap canvas, ._hbg-qr-wrap img { border-radius: 6px; display: block; }
      ._hbg-info { flex: 1; min-width: 0; }
      ._hbg-label {
        font-size: 10px; font-weight: 700; letter-spacing: 1.2px;
        text-transform: uppercase; color: rgba(251,191,36,0.9); margin-bottom: 6px;
      }
      ._hbg-dots { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 5px; }
      ._hbg-pdot {
        width: 14px; height: 14px; border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.2); flex-shrink: 0;
        animation: _hbg-blink 1.4s ease-in-out infinite;
      }
      @keyframes _hbg-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      ._hbg-pname { font-size: 12px; color: rgba(255,255,255,0.75); margin-bottom: 4px; line-height: 1.35; word-break: keep-all; }
      ._hbg-hint  { font-size: 10px; color: rgba(255,255,255,0.38); }
    `;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = '_hbg-banner';
    el.className = 'hidden';
    el.innerHTML = `
      <div class="_hbg-qr-wrap" id="_hbg-qr"></div>
      <div class="_hbg-info">
        <div class="_hbg-label">연결 끊김</div>
        <div class="_hbg-dots" id="_hbg-dots"></div>
        <div class="_hbg-pname" id="_hbg-pname">재접속 대기 중...</div>
        <div class="_hbg-hint">QR 스캔으로 재접속</div>
      </div>
    `;
    document.body.appendChild(el);
  }

  async _refreshReconnectBanner() {
    const el = document.getElementById('_hbg-banner');
    if (!el) return;

    if (this._disconnectedPlayers.size === 0) {
      el.classList.add('hidden');
      return;
    }

    // QR을 처음 한 번만 렌더링
    if (!this._reconnectBannerQrDone) {
      this._reconnectBannerQrDone = true;
      const qrEl = document.getElementById('_hbg-qr');
      if (qrEl) {
        try { await renderQR(qrEl, this.getQRUrl(), { width: 76 }); } catch (_) {}
      }
    }

    // 연결 끊긴 플레이어 색상 점
    const dotsEl = document.getElementById('_hbg-dots');
    if (dotsEl) {
      dotsEl.innerHTML = [...this._disconnectedPlayers].map(id => {
        const color = this._disconnectedColors.get(id) ?? this._players.get(id)?.color ?? '#888';
        const name  = this._playerNicknames.get(id) ?? '';
        return `<div class="_hbg-pdot" style="background:${color};box-shadow:0 0 6px ${color}80" title="${name}"></div>`;
      }).join('');
    }

    // 이름 텍스트
    const nameEl = document.getElementById('_hbg-pname');
    if (nameEl) {
      const names = [...this._disconnectedPlayers]
        .map(id => this._playerNicknames.get(id))
        .filter(Boolean);
      nameEl.textContent = names.length
        ? `${names.join(', ')} 재접속 대기 중...`
        : '재접속 대기 중...';
    }

    el.classList.remove('hidden');
    // 재등장 애니메이션 재실행
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
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

  /** 특정 플레이어 강퇴 */
  kickPlayer(playerId) { this.sdk.kickPlayer(playerId); }

  /** 현재 QR URL 반환 */
  getQRUrl() { return this.sdk.getQRUrl(); }

  // ─── Lobby helpers (<game-lobby> 전용) ───────────────────────────────────

  /**
   * 로비 플레이어 카드를 렌더링합니다.
   * @param {Map<string, {nickname?:string, avatarUrl?:string}>|null} profilesMap
   */
  renderLobbyPlayers(profilesMap = null) {
    this._lobbyEl?.renderPlayers(this._players, profilesMap);
  }

  /**
   * 준비 상태 텍스트와 시작 버튼을 업데이트합니다.
   * @param {number} readyCount
   */
  updateLobbyReady(readyCount) {
    const total = this._players.size;
    this._lobbyEl?.setReady(readyCount, total);
    this._lobbyEl?.updateStartButton(readyCount, total);
  }

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
   * 플레이어 일시 연결 끊김 (grace period 시작, 아직 퇴장 아님).
   * @param {string} playerId
   */
  onPlayerDisconnect(playerId) {} // eslint-disable-line no-unused-vars

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
