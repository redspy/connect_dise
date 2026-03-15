/**
 * P2PManager — WebRTC DataChannel 연결 생명주기 관리
 *
 * 사용 패턴:
 *   Host: p2p.initiateConnection(playerId, sessionId)  → offer 전송
 *   Mobile: p2p.acceptOffer('host', sessionId, sdp)    → answer 전송
 *
 * 메시지 포맷 (DataChannel): JSON { type, payload }
 */
export class P2PManager {
  constructor(socket, { onMessage, onChannelOpen, onChannelClose } = {}) {
    this._socket = socket;
    this._connections = new Map(); // peerId → RTCPeerConnection
    this._channels = new Map();   // peerId → RTCDataChannel
    this._sessionIds = new Map(); // peerId → sessionId
    this._onMessage = onMessage || (() => {});
    this._onChannelOpen = onChannelOpen || (() => {});
    this._onChannelClose = onChannelClose || (() => {});
  }

  // ── 내부: RTCPeerConnection 생성 ─────────────────────────────────────────

  _createPeerConnection(peerId, sessionId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    this._sessionIds.set(peerId, sessionId);

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const payload = { sessionId, candidate: candidate.toJSON() };
      // peerId가 'host'가 아니면 호스트→플레이어 방향 → to 필드 포함
      if (peerId !== 'host') payload.to = peerId;
      this._socket.emit('p2p:ice', payload);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'failed' || state === 'closed') {
        this._channels.delete(peerId);
        this._onChannelClose(peerId);
      }
    };

    this._connections.set(peerId, pc);
    return pc;
  }

  // ── 내부: DataChannel 이벤트 바인딩 ─────────────────────────────────────

  _setupChannel(peerId, channel) {
    channel.onopen = () => {
      this._channels.set(peerId, channel);
      this._onChannelOpen(peerId);
    };

    channel.onclose = () => {
      this._channels.delete(peerId);
      this._onChannelClose(peerId);
    };

    channel.onerror = () => {
      this._channels.delete(peerId);
      this._onChannelClose(peerId);
    };

    channel.onmessage = ({ data }) => {
      try {
        const { type, payload } = JSON.parse(data);
        this._onMessage(peerId, type, payload);
      } catch (e) {
        console.warn('[P2P] 메시지 파싱 실패:', e);
      }
    };
  }

  // ── 공개 API ─────────────────────────────────────────────────────────────

  /**
   * [호스트 전용] 플레이어에게 연결 offer를 시작한다.
   */
  async initiateConnection(peerId, sessionId) {
    if (this._connections.has(peerId)) {
      this.closeConnection(peerId);
    }

    const pc = this._createPeerConnection(peerId, sessionId);
    const channel = pc.createDataChannel('game');
    this._setupChannel(peerId, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this._socket.emit('p2p:offer', {
      sessionId,
      to: peerId,
      sdp: pc.localDescription,
    });
  }

  /**
   * [모바일 전용] 호스트의 offer를 받아 answer를 생성한다.
   */
  async acceptOffer(peerId, sessionId, sdp) {
    if (this._connections.has(peerId)) {
      this.closeConnection(peerId);
    }

    const pc = this._createPeerConnection(peerId, sessionId);

    // 호스트가 DataChannel을 만들므로, 모바일은 ondatachannel로 수신
    pc.ondatachannel = ({ channel }) => {
      this._setupChannel(peerId, channel);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this._socket.emit('p2p:answer', {
      sessionId,
      sdp: pc.localDescription,
    });
  }

  /**
   * [호스트 전용] 플레이어의 answer를 설정한다.
   */
  async setRemoteAnswer(peerId, sdp) {
    const pc = this._connections.get(peerId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (e) {
      console.warn('[P2P] setRemoteAnswer 실패:', e);
    }
  }

  /**
   * ICE 후보를 추가한다 (양쪽 공통).
   */
  async addIceCandidate(peerId, candidate) {
    const pc = this._connections.get(peerId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('[P2P] ICE 후보 추가 실패:', e);
    }
  }

  /**
   * DataChannel로 메시지를 전송한다.
   * @returns {boolean} 전송 성공 여부 (false면 Socket.io fallback 필요)
   */
  send(peerId, type, payload) {
    const channel = this._channels.get(peerId);
    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }

  /**
   * 해당 peer의 DataChannel이 open 상태인지 확인한다.
   */
  isReady(peerId) {
    return this._channels.get(peerId)?.readyState === 'open';
  }

  /**
   * 특정 peer의 연결을 닫고 정리한다.
   */
  closeConnection(peerId) {
    this._channels.delete(peerId);
    this._sessionIds.delete(peerId);
    const pc = this._connections.get(peerId);
    if (pc) {
      pc.close();
      this._connections.delete(peerId);
    }
  }

  /**
   * 모든 연결을 닫고 정리한다.
   */
  closeAll() {
    for (const peerId of [...this._connections.keys()]) {
      this.closeConnection(peerId);
    }
  }

  /**
   * 현재 환경에서 WebRTC가 지원되는지 확인한다.
   */
  static isSupported() {
    return typeof RTCPeerConnection !== 'undefined';
  }
}
