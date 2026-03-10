import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { SessionManager } from '../platform/server/SessionManager.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const sm = new SessionManager();

// 플레이어 연결 끊김 후 실제 제거까지의 유예 시간
const RECONNECT_GRACE_MS = 30_000;
const disconnectTimers = new Map(); // playerId → timer

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // ─── Platform events ────────────────────────────────────────────────────────

  socket.on('platform:createSession', ({ gameId }) => {
    const { sessionId, localIp } = sm.createSession(socket.id, gameId);
    socket.join(sessionId);
    socket.emit('platform:sessionCreated', { sessionId, localIp });
    console.log(`[${gameId}] Session ${sessionId} created (IP: ${localIp})`);
  });

  socket.on('platform:joinSession', ({ sessionId, reconnectId = null }) => {
    const result = sm.joinSession(sessionId, socket.id, reconnectId);
    if (!result) {
      socket.emit('error', 'Session not found or invalid');
      return;
    }

    const { player, reconnected } = result;

    // 유예 타이머 취소 (재연결 성공)
    if (reconnected) {
      const timer = disconnectTimers.get(player.id);
      if (timer) { clearTimeout(timer); disconnectTimers.delete(player.id); }
      console.log(`Player ${player.id} reconnected to session ${sessionId}`);
    }

    socket.join(sessionId);
    socket.emit('platform:joined', { player, reconnected });

    const session = sm.getSession(sessionId);
    if (reconnected) {
      // 호스트에게 재연결 알림 (playerJoin 재호출 없이)
      io.to(session.hostSocketId).emit('platform:playerRejoined', { player });
    } else {
      io.to(session.hostSocketId).emit('platform:playerJoined', { player });
      console.log(`Player ${player.id} joined session ${sessionId} (color: ${player.color})`);
    }
  });

  socket.on('platform:playerReady', ({ sessionId }) => {
    const result = sm.setReady(sessionId, socket.id);
    if (!result) return;
    const session = sm.getSession(sessionId);
    if (!session) return;
    const { readyCount, totalCount, allReady } = result;
    io.to(session.hostSocketId).emit('platform:readyUpdate', { readyCount, totalCount });
    console.log(`[${sessionId}] ready ${readyCount}/${totalCount}`);
    if (allReady) {
      io.to(sessionId).emit('platform:allReady', {});
      console.log(`[${sessionId}] All players ready`);
    }
  });

  socket.on('platform:reset', ({ sessionId }) => {
    sm.resetSession(sessionId);
    io.to(sessionId).emit('platform:reset', {});
    console.log(`[${sessionId}] Session reset`);
  });

  // ─── Game message routing ─────────────────────────────────────────────────

  socket.on('game:toHost', ({ sessionId, type, payload }) => {
    const session = sm.getSession(sessionId);
    if (!session) return;
    const info = sm.socketToSession.get(socket.id);
    const stablePlayerId = info?.playerId ?? socket.id;
    io.to(session.hostSocketId).emit('game:fromPlayer', { from: stablePlayerId, type, payload });
  });

  socket.on('game:toPlayer', ({ sessionId, to, type, payload }) => {
    const socketId = sm.getSocketId(sessionId, to);
    if (socketId) io.to(socketId).emit('game:fromHost', { type, payload });
  });

  socket.on('game:broadcast', ({ sessionId, type, payload }) => {
    const session = sm.getSession(sessionId);
    if (!session) return;
    for (const p of session.players) {
      io.to(p.socketId).emit('game:fromHost', { type, payload });
    }
  });

  // ─── P2P Signaling relay ─────────────────────────────────────────────────

  // 호스트 → 플레이어: offer 전달
  socket.on('p2p:offer', ({ sessionId, to, sdp }) => {
    const socketId = sm.getSocketId(sessionId, to);
    if (socketId) io.to(socketId).emit('p2p:offer', { sdp });
  });

  // 플레이어 → 호스트: answer 전달
  socket.on('p2p:answer', ({ sessionId, sdp }) => {
    const session = sm.getSession(sessionId);
    const info = sm.socketToSession.get(socket.id);
    if (session && info) {
      io.to(session.hostSocketId).emit('p2p:answer', { from: info.playerId, sdp });
    }
  });

  // ICE 후보 양방향 relay
  // to 있음 → 호스트→플레이어, to 없음 → 플레이어→호스트
  socket.on('p2p:ice', ({ sessionId, to, candidate }) => {
    if (to) {
      const socketId = sm.getSocketId(sessionId, to);
      if (socketId) io.to(socketId).emit('p2p:ice', { candidate });
    } else {
      const session = sm.getSession(sessionId);
      const info = sm.socketToSession.get(socket.id);
      if (session && info) {
        io.to(session.hostSocketId).emit('p2p:ice', { from: info.playerId, candidate });
      }
    }
  });

  // ─── Disconnect ───────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    const events = sm.removeSocket(socket.id);

    for (const { sessionId, role, data } of events) {
      if (role === 'host') {
        io.to(sessionId).emit('hostDisconnected');
        console.log(`Session ${sessionId} closed — host disconnected`);

      } else if (data?.player) {
        const { player, hostSocketId } = data;
        const oldSocketId = socket.id;

        // 호스트에게 일시 연결 끊김 알림 (선택적 UI용)
        io.to(hostSocketId).emit('platform:playerDisconnected', { playerId: player.id });
        console.log(`[${sessionId}] Player ${player.id} disconnected — grace ${RECONNECT_GRACE_MS / 1000}s`);

        // 유예 기간 후 완전 제거
        const timer = setTimeout(() => {
          disconnectTimers.delete(player.id);
          const result = sm.finalizePlayerRemoval(sessionId, player.id, oldSocketId);
          if (result) {
            io.to(result.hostSocketId).emit('platform:playerLeft', { playerId: player.id });
            io.to(result.hostSocketId).emit('platform:readyUpdate', {
              readyCount: result.readyCount,
              totalCount: result.totalCount,
            });
            console.log(`[${sessionId}] Player ${player.id} removed after grace period`);
          }
        }, RECONNECT_GRACE_MS);

        disconnectTimers.set(player.id, timer);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket.IO Server running on http://0.0.0.0:${PORT}`);
});
