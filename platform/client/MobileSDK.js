import { io } from 'socket.io-client';
import { SensorManager } from './shared/SensorManager.js';

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
      this._emit('join', player);
    });

    socket.on('platform:allReady', () => {
      this._emit('allReady', {});
    });

    socket.on('platform:reset', () => {
      this._emit('reset', {});
    });

    socket.on('hostDisconnected', () => {
      this._emit('hostDisconnect', {});
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
}
