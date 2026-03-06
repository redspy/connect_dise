import os from 'os';

function generateSessionId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    if (name.toLowerCase().includes('wsl') || name.toLowerCase().includes('hyper-v')) continue;
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const playerColors = ['#FF4444', '#33B5E5', '#99CC00', '#FFBB33', '#AA66CC', '#FF00A2'];

export class SessionManager {
  constructor() {
    this.sessions = new Map();       // sessionId → Session
    this.socketToSession = new Map(); // socketId → { sessionId, role }
  }

  createSession(hostSocketId, gameId) {
    const sessionId = generateSessionId();
    const localIp = getLocalIp();
    this.sessions.set(sessionId, {
      sessionId,
      gameId,
      hostSocketId,
      players: [],
      readyPlayers: new Set(),
    });
    this.socketToSession.set(hostSocketId, { sessionId, role: 'host' });
    return { sessionId, localIp };
  }

  joinSession(sessionId, socketId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const colorIndex = session.players.length % playerColors.length;
    const player = { id: socketId, color: playerColors[colorIndex] };
    session.players.push(player);
    this.socketToSession.set(socketId, { sessionId, role: 'player' });
    return player;
  }

  setReady(sessionId, socketId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.readyPlayers.add(socketId);
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

  // Returns array of change events to handle in server
  removeSocket(socketId) {
    const info = this.socketToSession.get(socketId);
    if (!info) return [];
    this.socketToSession.delete(socketId);

    const { sessionId, role } = info;
    const session = this.sessions.get(sessionId);
    if (!session) return [{ sessionId, role, data: null }];

    if (role === 'host') {
      this.sessions.delete(sessionId);
      for (const p of session.players) {
        this.socketToSession.delete(p.id);
      }
      return [{ sessionId, role: 'host', data: { players: session.players } }];
    } else {
      const idx = session.players.findIndex(p => p.id === socketId);
      let removed = null;
      if (idx !== -1) {
        [removed] = session.players.splice(idx, 1);
        session.readyPlayers.delete(socketId);
      }
      return [{
        sessionId,
        role: 'player',
        data: {
          player: removed,
          readyCount: session.readyPlayers.size,
          totalCount: session.players.length,
          hostSocketId: session.hostSocketId,
        },
      }];
    }
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }
}
