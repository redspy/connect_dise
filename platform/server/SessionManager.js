import os from 'os';

function generateId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    if (name.toLowerCase().includes('wsl') || name.toLowerCase().includes('hyper-v')) continue;
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const playerColors = ['#FF4444', '#33B5E5', '#99CC00', '#FFBB33', '#AA66CC', '#FF00A2'];

export class SessionManager {
  constructor() {
    this.sessions = new Map();        // sessionId → Session
    this.socketToSession = new Map(); // socketId  → { sessionId, role, playerId? }
  }

  createSession(hostSocketId, gameId) {
    const sessionId = generateId().slice(0, 6);
    const localIp = getLocalIp();
    this.sessions.set(sessionId, {
      sessionId,
      gameId,
      hostSocketId,
      players: [],            // { id (stable), socketId (current), color }
      readyPlayers: new Set(), // stable player IDs
    });
    this.socketToSession.set(hostSocketId, { sessionId, role: 'host' });
    return { sessionId, localIp };
  }

  /**
   * @param {string}      sessionId
   * @param {string}      socketId    새 소켓 ID
   * @param {string|null} reconnectId 재연결 시 기존 stable player ID
   * @returns {{ player: {id, socketId, color}, reconnected: boolean } | null}
   */
  joinSession(sessionId, socketId, reconnectId = null) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // ── 재연결 시도 ───────────────────────────────────────────────
    if (reconnectId) {
      const player = session.players.find(p => p.id === reconnectId);
      if (player) {
        this.socketToSession.delete(player.socketId); // 구 소켓 매핑 제거
        player.socketId = socketId;
        this.socketToSession.set(socketId, { sessionId, role: 'player', playerId: player.id });
        return { player: { id: player.id, socketId, color: player.color }, reconnected: true };
      }
    }

    // ── 신규 참가 ─────────────────────────────────────────────────
    const colorIndex = session.players.length % playerColors.length;
    const player = {
      id: generateId(),   // stable ID — 게임 데이터 키
      socketId,           // 현재 전송용 소켓 ID
      color: playerColors[colorIndex],
    };
    session.players.push(player);
    this.socketToSession.set(socketId, { sessionId, role: 'player', playerId: player.id });
    return { player: { id: player.id, socketId, color: player.color }, reconnected: false };
  }

  /**
   * 소켓 제거. 플레이어는 즉시 제거하지 않고 호출자가 유예 타이머를 관리.
   * @returns 처리할 이벤트 배열
   */
  removeSocket(socketId) {
    const info = this.socketToSession.get(socketId);
    if (!info) return [];
    this.socketToSession.delete(socketId);

    const { sessionId, role, playerId } = info;
    const session = this.sessions.get(sessionId);
    if (!session) return [{ sessionId, role, data: null }];

    if (role === 'host') {
      // 호스트 연결 끊김 → 세션 즉시 종료
      this.sessions.delete(sessionId);
      for (const p of session.players) this.socketToSession.delete(p.socketId);
      return [{ sessionId, role: 'host', data: { players: session.players } }];
    } else {
      // 플레이어 연결 끊김 → 유예 기간 동안 세션 유지
      const player = session.players.find(p => p.id === playerId);
      return [{
        sessionId,
        role: 'player',
        data: { player, hostSocketId: session.hostSocketId },
      }];
    }
  }

  /**
   * 유예 기간 만료 후 플레이어 실제 제거.
   * 재연결로 socketId가 바뀌어 있으면 제거하지 않음.
   */
  finalizePlayerRemoval(sessionId, playerId, oldSocketId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const player = session.players.find(p => p.id === playerId);
    if (!player) return null;
    if (player.socketId !== oldSocketId) return null; // 이미 재연결됨

    const idx = session.players.indexOf(player);
    session.players.splice(idx, 1);
    session.readyPlayers.delete(playerId);

    return {
      player,
      readyCount: session.readyPlayers.size,
      totalCount: session.players.length,
      hostSocketId: session.hostSocketId,
    };
  }

  setReady(sessionId, socketId) {
    const info = this.socketToSession.get(socketId);
    const session = this.sessions.get(sessionId);
    if (!info || !session) return null;

    session.readyPlayers.add(info.playerId); // stable ID로 저장
    const readyCount = session.readyPlayers.size;
    const totalCount = session.players.length;
    const allReady = readyCount >= totalCount && totalCount > 0;
    return { readyCount, totalCount, allReady };
  }

  resetSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.readyPlayers = new Set();
  }

  /** stable playerId → 현재 socketId 조회 (직접 메시지 전송용) */
  getSocketId(sessionId, playerId) {
    const session = this.sessions.get(sessionId);
    return session?.players.find(p => p.id === playerId)?.socketId ?? null;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }
}
