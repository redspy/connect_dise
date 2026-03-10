import { io } from 'socket.io-client';
import { P2PManager } from './P2PManager.js';

export class HostSDK extends EventTarget {
  constructor({ gameId }) {
    super();
    this.gameId = gameId;
    this._sessionId = null;
    this._players = new Map();
    this._qrUrl = null;
    this._socket = io();
    this._messageHandlers = new Map();
    this._p2p = null;
    this._setup();
  }

  _setup() {
    const socket = this._socket;

    socket.on('connect', () => {
      socket.emit('platform:createSession', { gameId: this.gameId });
    });

    socket.on('platform:sessionCreated', ({ sessionId, localIp }) => {
      this._sessionId = sessionId;
      const scheme = window.location.protocol;
      const port = window.location.port ? `:${window.location.port}` : '';
      this._qrUrl = `${scheme}//${localIp}${port}/games/${this.gameId}/mobile/?session=${sessionId}`;
      this._emit('sessionReady', { sessionId, qrUrl: this._qrUrl });
      this._initP2P();
    });

    socket.on('platform:playerJoined', ({ player }) => {
      this._players.set(player.id, player);
      this._emit('playerJoin', player);
      this._p2p?.initiateConnection(player.id, this._sessionId);
    });

    socket.on('platform:playerLeft', ({ playerId }) => {
      this._players.delete(playerId);
      this._p2p?.closeConnection(playerId);
      this._emit('playerLeave', playerId);
    });

    // 재연결: 플레이어 Map 갱신 후 게임에 알림
    socket.on('platform:playerRejoined', ({ player }) => {
      this._players.set(player.id, player);
      this._emit('playerRejoin', player);
      // P2P 재수립
      this._p2p?.closeConnection(player.id);
      this._p2p?.initiateConnection(player.id, this._sessionId);
    });

    // P2P 시그널링 이벤트
    socket.on('p2p:answer', ({ from, sdp }) => {
      this._p2p?.setRemoteAnswer(from, sdp);
    });

    socket.on('p2p:ice', ({ from, candidate }) => {
      this._p2p?.addIceCandidate(from, candidate);
    });

    socket.on('platform:readyUpdate', ({ readyCount, totalCount }) => {
      this._emit('readyUpdate', { readyCount, total: totalCount });
    });

    socket.on('platform:allReady', () => {
      this._emit('allReady', {});
    });

    socket.on('platform:reset', () => {
      this._emit('reset', {});
    });

    socket.on('game:fromPlayer', ({ from, type, payload }) => {
      const handler = this._messageHandlers.get(type);
      if (handler) {
        const player = this._players.get(from) || { id: from };
        handler(player, payload);
      }
    });

    socket.on('hostDisconnected', () => {
      this._emit('hostDisconnect', {});
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

  sendToPlayer(playerId, type, payload) {
    if (!this._p2p?.send(playerId, type, payload)) {
      this._socket.emit('game:toPlayer', {
        sessionId: this._sessionId,
        to: playerId,
        type,
        payload,
      });
    }
  }

  broadcast(type, payload) {
    for (const player of this._players.values()) {
      if (!this._p2p?.send(player.id, type, payload)) {
        this._socket.emit('game:toPlayer', {
          sessionId: this._sessionId,
          to: player.id,
          type,
          payload,
        });
      }
    }
  }

  _initP2P() {
    if (!P2PManager.isSupported()) return;
    this._p2p = new P2PManager(this._socket, {
      onMessage: (peerId, type, payload) => {
        const player = this._players.get(peerId) || { id: peerId };
        const handler = this._messageHandlers.get(type);
        if (handler) handler(player, payload);
      },
      onChannelOpen: (peerId) => {
        console.log(`[P2P] 플레이어 ${peerId} 직접 연결됨`);
      },
      onChannelClose: (peerId) => {
        console.log(`[P2P] 플레이어 ${peerId} 연결 끊김 → Socket.io fallback`);
      },
    });
  }

  resetSession() {
    this._socket.emit('platform:reset', { sessionId: this._sessionId });
  }

  getPlayers() {
    return [...this._players.values()];
  }

  getSessionId() {
    return this._sessionId;
  }

  getQRUrl() {
    return this._qrUrl;
  }

  getRawSocket() {
    return this._socket;
  }
}
