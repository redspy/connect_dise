import { io } from 'socket.io-client';
import { SensorManager } from './shared/SensorManager.js';
import { QRScanner } from './shared/QRScanner.js';

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
        socket.emit('platform:joinSession', { sessionId: this._sessionId });
      }
    });

    socket.on('platform:joined', ({ player }) => {
      this._player = player;
      this._hideScanBtn();
      this._emit('join', player);
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

    socket.on('hostDisconnected', () => {
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

  /**
   * QR 스캔 오버레이를 열어 읽힌 URL로 이동합니다.
   * 게임 페이지에서 직접 호출하거나, SDK가 자동으로 호출(hostDisconnect 시)합니다.
   */
  async showQRScanner() {
    const scanner = new QRScanner();
    const url = await scanner.scan();
    if (url) window.location.href = url;
  }

  _hideScanBtn() {
    document.getElementById('_sdk-scan-btn')?.remove();
  }

  /** 빨간 상태(미연결)일 때 화면에 스캔 버튼을 주입합니다. */
  _showScanBtn() {
    if (document.getElementById('_sdk-scan-btn')) return;

    const btn = document.createElement('button');
    btn.id = '_sdk-scan-btn';
    btn.title = 'QR 코드 스캔';
    btn.innerHTML = '&#x1F4F7;'; // 📷
    btn.style.cssText = [
      'position:fixed;top:12px;right:12px;z-index:8000',
      'width:44px;height:44px;border-radius:50%',
      'background:rgba(0,238,255,0.18);border:2px solid rgba(0,238,255,0.7)',
      'color:#00eeff;font-size:1.3rem',
      'cursor:pointer;display:flex;align-items:center;justify-content:center',
      'box-shadow:0 0 12px rgba(0,238,255,0.4)',
      'animation:_sdk-pulse 1.8s ease infinite',
    ].join(';');

    // 펄스 애니메이션 스타일 (한 번만 삽입)
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
