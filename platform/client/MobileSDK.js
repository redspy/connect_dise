import { io } from 'socket.io-client';
import { SensorManager } from './shared/SensorManager.js';
import { QRScanner } from './shared/QRScanner.js';
import { P2PManager } from './P2PManager.js';

const RECONNECT_KEY = (sessionId) => `_sdk_reconnect_${sessionId}`;

export class MobileSDK extends EventTarget {
  constructor() {
    super();
    const params = new URLSearchParams(window.location.search);
    this._sessionId = params.get('session');
    this._player = null;
    this._socket = io();
    this._messageHandlers = new Map();
    this._sensorManager = new SensorManager();
    this._p2p = null;
    this._setup();

    // 연결 전(빨간 상태)에는 항상 재연결 UI 표시
    this._showReconnectUI();
  }

  _setup() {
    const socket = this._socket;

    socket.on('connect', () => {
      if (this._sessionId) {
        // 이전 세션의 stable player ID가 있으면 재연결 시도
        const reconnectId = sessionStorage.getItem(RECONNECT_KEY(this._sessionId)) || null;
        socket.emit('platform:joinSession', { sessionId: this._sessionId, reconnectId });
      }
    });

    socket.on('platform:joined', ({ player, reconnected }) => {
      this._player = player;
      // stable player ID를 sessionStorage에 저장 (탭 생존 기간 동안 유지)
      sessionStorage.setItem(RECONNECT_KEY(this._sessionId), player.id);
      this._hideReconnectUI();

      if (reconnected) {
        // 화면 전환 없이 조용히 재연결 — 게임 계속
        this._emit('rejoin', player);
      } else {
        this._emit('join', player);
      }

      // P2P 초기화 (호스트의 offer를 대기)
      this._initP2P();
    });

    // P2P 시그널링 이벤트
    socket.on('p2p:offer', ({ sdp }) => {
      this._p2p?.acceptOffer('host', this._sessionId, sdp);
    });

    socket.on('p2p:ice', ({ candidate }) => {
      this._p2p?.addIceCandidate('host', candidate);
    });

    socket.on('platform:allReady', () => {
      this._emit('allReady', {});
    });

    socket.on('platform:reset', () => {
      this._emit('reset', {});
    });

    socket.on('platform:kicked', () => {
      sessionStorage.removeItem(RECONNECT_KEY(this._sessionId));
      this._p2p?.closeAll();
      this._emit('kicked', {});
      this._showReconnectUI();
    });

    socket.on('disconnect', () => {
      this._showReconnectUI();
    });

    socket.on('connect', () => {
      // 재연결 후 스캔 버튼 숨김은 platform:joined 처리 후
    });

    socket.on('hostDisconnected', () => {
      sessionStorage.removeItem(RECONNECT_KEY(this._sessionId));
      this._p2p?.closeAll();
      this._emit('hostDisconnect', {});
      this._showReconnectUI();
    });

    // Safari BFCache 복원 시 소켓이 stale 상태가 될 수 있으므로 강제 재연결
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) {
        socket.disconnect();
        socket.connect();
      }
    });

    // iOS 백그라운드 복귀 후 소켓이 끊긴 경우 재연결
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !socket.connected && this._sessionId) {
        socket.connect();
      }
    });

    socket.on('game:fromHost', ({ type, payload }) => {
      const handler = this._messageHandlers.get(type);
      if (handler) handler(payload);
    });

    socket.on('error', (msg) => {
      this._emit('error', msg);
    });
  }

  _emit(event, detail) {
    this.dispatchEvent(new CustomEvent(event, { detail }));
  }

  on(event, callback) {
    this.addEventListener(event, (e) => callback(e.detail));
    return this;
  }

  onMessage(type, callback) {
    this._messageHandlers.set(type, callback);
    return this;
  }

  sendToHost(type, payload) {
    if (!this._p2p?.send('host', type, payload)) {
      this._socket.emit('game:toHost', {
        sessionId: this._sessionId,
        type,
        payload,
      });
    }
  }

  _initP2P() {
    if (!P2PManager.isSupported()) return;
    this._p2p?.closeAll();
    this._p2p = new P2PManager(this._socket, {
      onMessage: (peerId, type, payload) => {
        const handler = this._messageHandlers.get(type);
        if (handler) handler(payload);
      },
      onChannelOpen: () => {
        console.log('[P2P] 호스트와 직접 연결됨');
      },
      onChannelClose: () => {
        console.log('[P2P] 호스트 연결 끊김 → Socket.io fallback');
      },
    });
  }

  ready() {
    this._socket.emit('platform:playerReady', { sessionId: this._sessionId });
  }

  async requestSensors() {
    return await this._sensorManager.requestPermission();
  }

  onOrientation(callback) {
    this._sensorManager.onOrientation(callback);
  }

  onMotion(callback) {
    this._sensorManager.onMotion(callback);
  }

  vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  getMyPlayer() {
    return this._player;
  }

  getSessionId() {
    return this._sessionId;
  }

  async showQRScanner() {
    const scanner = new QRScanner();
    const url = await scanner.scan();
    if (url) window.location.href = url;
  }

  _hideReconnectUI() {
    document.getElementById('_sdk-reconnect-ui')?.remove();
    if (this._passiveTimeout) {
      clearTimeout(this._passiveTimeout);
      this._passiveTimeout = null;
    }
  }

  _showReconnectUI() {
    if (document.getElementById('_sdk-reconnect-ui')) return;

    if (this._sessionId && this._player) {
      this._showPassiveReconnectUI();
    } else {
      this._showFullReconnectUI();
    }
  }

  _appendStyle() {
    if (document.getElementById('_sdk-reconnect-style')) return;
    const style = document.createElement('style');
    style.id = '_sdk-reconnect-style';
    style.textContent = `
      #_sdk-reconnect-ui {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        animation: _sdk-fade-in 0.3s ease;
      }
      @keyframes _sdk-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      ._sdk-reconnect-modal {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 2px solid rgba(0, 238, 255, 0.3);
        border-radius: 20px;
        padding: 40px;
        width: min(90vw, 400px);
        text-align: center;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
        animation: _sdk-slide-up 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes _sdk-slide-up {
        from { transform: translateY(40px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      ._sdk-reconnect-title {
        font-size: 1.8rem;
        font-weight: 700;
        color: #e2e8f0;
        margin-bottom: 32px;
        letter-spacing: -0.5px;
      }
      ._sdk-input-section {
        margin-bottom: 28px;
      }
      ._sdk-input-group {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
      }
      ._sdk-input-group input {
        flex: 1;
        padding: 14px 16px;
        border: 2px solid rgba(0, 238, 255, 0.4);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.05);
        color: #e2e8f0;
        font-size: 1rem;
        font-family: inherit;
        text-transform: uppercase;
        letter-spacing: 2px;
        transition: all 0.2s;
      }
      ._sdk-input-group input::placeholder {
        color: rgba(226, 232, 240, 0.5);
        text-transform: none;
        letter-spacing: normal;
      }
      ._sdk-input-group input:focus {
        outline: none;
        border-color: rgba(0, 238, 255, 0.8);
        background: rgba(255, 255, 255, 0.08);
        box-shadow: 0 0 12px rgba(0, 238, 255, 0.2);
      }
      ._sdk-input-group button {
        padding: 14px 24px;
        background: linear-gradient(135deg, #00eeff 0%, #0099ff 100%);
        border: none;
        border-radius: 12px;
        color: #000;
        font-weight: 700;
        font-size: 0.95rem;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
      }
      ._sdk-input-group button:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(0, 238, 255, 0.4);
      }
      ._sdk-input-group button:active {
        transform: translateY(0);
      }
      ._sdk-divider {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 28px;
        color: rgba(226, 232, 240, 0.5);
        font-size: 0.9rem;
        font-weight: 600;
      }
      ._sdk-divider::before,
      ._sdk-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: linear-gradient(to right, transparent, rgba(0, 238, 255, 0.3), transparent);
      }
      ._sdk-qr-btn {
        width: 100%;
        padding: 18px;
        background: linear-gradient(135deg, rgba(0, 238, 255, 0.15) 0%, rgba(0, 153, 255, 0.15) 100%);
        border: 2px solid rgba(0, 238, 255, 0.5);
        border-radius: 12px;
        color: #00eeff;
        font-size: 1.1rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        letter-spacing: 0.5px;
      }
      ._sdk-qr-btn:hover {
        border-color: rgba(0, 238, 255, 0.8);
        background: linear-gradient(135deg, rgba(0, 238, 255, 0.25) 0%, rgba(0, 153, 255, 0.25) 100%);
        box-shadow: 0 0 20px rgba(0, 238, 255, 0.3);
      }
      ._sdk-qr-btn:active {
        transform: scale(0.98);
      }
    `;
    document.head.appendChild(style);
  }

  _showPassiveReconnectUI() {
    this._appendStyle();

    // 스핀 애니메이션 스타일 추가
    if (!document.getElementById('_sdk-spin-style')) {
      const spinStyle = document.createElement('style');
      spinStyle.id = '_sdk-spin-style';
      spinStyle.textContent = `
        @keyframes _sdk-spin { to { transform: rotate(360deg); } }
      `;
      document.head.appendChild(spinStyle);
    }

    const ui = document.createElement('div');
    ui.id = '_sdk-reconnect-ui';

    const modal = document.createElement('div');
    modal.className = '_sdk-reconnect-modal';

    const title = document.createElement('div');
    title.className = '_sdk-reconnect-title';
    title.textContent = '연결 복구 중...';
    modal.appendChild(title);

    const spinner = document.createElement('div');
    spinner.style.cssText = [
      'width: 48px; height: 48px; border: 4px solid rgba(0, 238, 255, 0.1);',
      'border-top-color: #00eeff; border-radius: 50%;',
      'animation: _sdk-spin 1s linear infinite; margin: 0 auto 24px auto;'
    ].join(' ');
    modal.appendChild(spinner);

    const desc = document.createElement('div');
    desc.style.cssText = 'color: rgba(226, 232, 240, 0.65); font-size: 0.95rem; line-height: 1.5;';
    desc.textContent = '인터넷 연결이 원활하지 않아 복구를 시도하고 있습니다. 잠시만 기다려주세요.';
    modal.appendChild(desc);

    ui.appendChild(modal);
    document.body.appendChild(ui);

    // 30초 유예 만료 시 재연결 정보를 파괴하고 풀 재연결 창으로 유도
    this._passiveTimeout = setTimeout(() => {
      this._hideReconnectUI();
      sessionStorage.removeItem(RECONNECT_KEY(this._sessionId));
      this._player = null;
      this._showFullReconnectUI();
    }, 30000);
  }

  _showFullReconnectUI() {
    this._appendStyle();

    const ui = document.createElement('div');
    ui.id = '_sdk-reconnect-ui';

    const modal = document.createElement('div');
    modal.className = '_sdk-reconnect-modal';

    const title = document.createElement('div');
    title.className = '_sdk-reconnect-title';
    title.textContent = '방에 연결하기';
    modal.appendChild(title);

    const inputSection = document.createElement('div');
    inputSection.className = '_sdk-input-section';

    const inputGroup = document.createElement('div');
    inputGroup.className = '_sdk-input-group';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '방 코드 입력 (예: ABC123)';
    input.maxLength = 6;

    const submitBtn = document.createElement('button');
    submitBtn.textContent = '입장하기';
    submitBtn.addEventListener('click', () => {
      const code = input.value.trim().toUpperCase();
      if (code) {
        window.location.href = `${window.location.pathname}?session=${code}`;
      }
    });

    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') submitBtn.click();
    });

    inputGroup.appendChild(input);
    inputGroup.appendChild(submitBtn);
    inputSection.appendChild(inputGroup);
    modal.appendChild(inputSection);

    const divider = document.createElement('div');
    divider.className = '_sdk-divider';
    divider.textContent = '또는';
    modal.appendChild(divider);

    const qrBtn = document.createElement('button');
    qrBtn.className = '_sdk-qr-btn';
    qrBtn.innerHTML = '📷 <span>QR 코드 스캔</span>';
    qrBtn.addEventListener('click', () => this.showQRScanner());
    modal.appendChild(qrBtn);

    const homeBtn = document.createElement('button');
    homeBtn.className = '_sdk-home-btn';
    homeBtn.innerHTML = '⌂ 게임 선택으로 돌아가기';
    homeBtn.style.cssText = [
      'margin-top:16px;width:100%;padding:12px',
      'background:transparent;border:1px solid rgba(255,255,255,0.2)',
      'border-radius:10px;color:rgba(255,255,255,0.45);font-size:0.88rem',
      'cursor:pointer;transition:color .2s,border-color .2s',
    ].join(';');
    homeBtn.addEventListener('pointerenter', () => {
      homeBtn.style.color = 'rgba(255,255,255,0.75)';
      homeBtn.style.borderColor = 'rgba(255,255,255,0.45)';
    });
    homeBtn.addEventListener('pointerleave', () => {
      homeBtn.style.color = 'rgba(255,255,255,0.45)';
      homeBtn.style.borderColor = 'rgba(255,255,255,0.2)';
    });
    homeBtn.addEventListener('click', () => {
      if (window.confirm('게임을 나가시겠습니까?\n게임 선택 화면으로 이동합니다.')) {
        window.location.href = '/';
      }
    });
    modal.appendChild(homeBtn);

    ui.appendChild(modal);

    ui.addEventListener('click', (e) => {
      if (e.target === ui) {
        this._hideReconnectUI();
      }
    });

    document.body.appendChild(ui);
  }

  /**
   * 모바일 기기에 진동(Haptic) 피드백을 발생시킵니다.
   * @param {'light'|'medium'|'heavy'|'double'|number[]} [effect]
   */
  vibrate(effect = 'light') {
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    const patterns = {
      light: [30],
      medium: [70],
      heavy: [150],
      double: [30, 40, 30]
    };
    const pattern = patterns[effect] || effect;
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      console.warn('Vibrate failed:', e);
    }
  }
}
