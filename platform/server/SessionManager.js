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
    // 이 소켓이 이미 다른(혹은 같은) 세션에 host/player로 묶여 있으면 거부 —
    // 안 그러면 매핑이 새 세션으로 덮어써지면서 기존 세션이 정리되지 않는
    // 유령 세션으로 영구히 남는다(그 세션의 플레이어들은 호스트가 사라진 줄 모름).
    if (this.socketToSession.has(hostSocketId)) return null;

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

    // 이 소켓이 이미 어떤 세션에든 host/player로 묶여 있으면 거부(위 createSession과 동일 이유).
    // 진짜 재연결은 항상 새 Socket.IO 연결(=새 socketId)로 들어오므로 이 체크에 걸리지 않는다.
    if (this.socketToSession.has(socketId)) return null;

    // ── 재연결 시도 ───────────────────────────────────────────────
    // stable player ID를 안다고 해서 무조건 그 자리를 가로챌 수 있으면 안 됨 —
    // 실제로 연결이 끊겨 유예 상태(connected===false)인 플레이어만 재연결을 허용.
    // (연결이 살아있는 플레이어의 세션을 다른 소켓이 탈취하는 것을 방지)
    if (reconnectId) {
      const player = session.players.find(p => p.id === reconnectId);
      if (player) {
        if (player.connected) return null; // 아직 연결 중인 플레이어 — 탈취 시도로 간주해 거부
        this.socketToSession.delete(player.socketId); // 구 소켓 매핑 제거
        player.socketId = socketId;
        player.connected = true;
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
      connected: true,
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
      // 플레이어 연결 끊김 → 유예 기간 동안 세션 유지 (재연결 가능 상태로 표시)
      const player = session.players.find(p => p.id === playerId);
      if (player) player.connected = false;
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

    const { readyCount, totalCount } = this.getReadyStatus(session);
    return {
      player,
      readyCount,
      totalCount,
      hostSocketId: session.hostSocketId,
    };
  }

  setReady(sessionId, socketId) {
    const info = this.socketToSession.get(socketId);
    const session = this.sessions.get(sessionId);
    if (!info || !session) return null;

    session.readyPlayers.add(info.playerId); // stable ID로 저장(재연결 시에도 준비 상태 유지)
    const { readyCount, totalCount } = this.getReadyStatus(session);
    const allReady = readyCount >= totalCount && totalCount > 0;
    return { readyCount, totalCount, allReady };
  }

  /**
   * 연결이 끊긴(grace period 중인) 플레이어는 분모·분자 양쪽에서 제외하고
   * ready 집계를 계산한다 — disconnect 중에도 readyPlayers Set 자체는 보존하므로
   * (재연결 시 다시 준비 눌러야 하는 불편 방지) 집계 시점에만 필터링한다.
   * @param {{players: Array<{id:string, connected?:boolean}>, readyPlayers: Set<string>}} session
   */
  getReadyStatus(session) {
    const connectedPlayers = session.players.filter(p => p.connected !== false);
    const totalCount = connectedPlayers.length;
    const readyCount = connectedPlayers.filter(p => session.readyPlayers.has(p.id)).length;
    return { readyCount, totalCount };
  }

  resetSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.readyPlayers = new Set();
  }

  /**
   * 외부(서버)가 소켓 생존 프로브 등으로 "이 플레이어의 기존 연결은 이미 죽었다"고
   * 판정했을 때, 재연결(joinSession의 reconnectId 분기)이 허용되도록 강제 전환한다.
   */
  markDisconnected(sessionId, playerId) {
    const session = this.sessions.get(sessionId);
    const player = session?.players.find(p => p.id === playerId);
    if (player) player.connected = false;
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
