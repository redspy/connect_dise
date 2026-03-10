import { io } from 'socket.io-client';
import { SensorManager } from './shared/SensorManager.js';
import { QRScanner } from './shared/QRScanner.js';

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
    this._setup();

    // 연결 전(빨간 상태)에는 항상 스캔 버튼 표시
    this._showScanBtn();
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
      this._hideScanBtn();

      if (reconnected) {
        // 화면 전환 없이 조용히 재연결 — 게임 계속
        this._emit('rejoin', player);
      } else {
        this._emit('join', player);
      }
    });

    socket.on('platform:allReady', () => {
      this._emit('allReady', {});
    });

    socket.on('platform:reset', () => {
      this._emit('reset', {});
    });

    socket.on('disconnect', () => {
      this._showScanBtn();
    });

    socket.on('connect', () => {
      // 재연결 후 스캔 버튼 숨김은 platform:joined 처리 후
    });

    socket.on('hostDisconnected', () => {
      sessionStorage.removeItem(RECONNECT_KEY(this._sessionId));
      this._emit('hostDisconnect', {});
      this._showScanBtn();
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
    this._socket.emit('game:toHost', {
      sessionId: this._sessionId,
      type,
      payload,
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

  _hideScanBtn() {
    document.getElementById('_sdk-scan-btn')?.remove();
  }

  _showScanBtn() {
    if (document.getElementById('_sdk-scan-btn')) return;

    const btn = document.createElement('button');
    btn.id = '_sdk-scan-btn';
    btn.title = 'QR 코드 스캔';
    btn.innerHTML = '&#x1F4F7;';
    btn.style.cssText = [
      'position:fixed;top:12px;right:12px;z-index:8000',
      'width:44px;height:44px;border-radius:50%',
      'background:rgba(0,238,255,0.18);border:2px solid rgba(0,238,255,0.7)',
      'color:#00eeff;font-size:1.3rem',
      'cursor:pointer;display:flex;align-items:center;justify-content:center',
      'box-shadow:0 0 12px rgba(0,238,255,0.4)',
      'animation:_sdk-pulse 1.8s ease infinite',
    ].join(';');

    if (!document.getElementById('_sdk-scan-style')) {
      const style = document.createElement('style');
      style.id = '_sdk-scan-style';
      style.textContent = `
        @keyframes _sdk-pulse {
          0%,100% { box-shadow: 0 0 10px rgba(0,238,255,0.4); }
          50%      { box-shadow: 0 0 22px rgba(0,238,255,0.85); }
        }
      `;
      document.head.appendChild(style);
    }

    btn.addEventListener('click', () => this.showQRScanner());
    document.body.appendChild(btn);
  }
}
