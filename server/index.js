import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { SessionManager } from '../platform/server/SessionManager.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const sm = new SessionManager();

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // ─── Platform events ────────────────────────────────────────────────────────

  socket.on('platform:createSession', ({ gameId }) => {
    const { sessionId, localIp } = sm.createSession(socket.id, gameId);
    socket.join(sessionId);
    socket.emit('platform:sessionCreated', { sessionId, localIp });
    console.log(`[${gameId}] Session ${sessionId} created by ${socket.id} (IP: ${localIp})`);
  });

  socket.on('platform:joinSession', ({ sessionId }) => {
    const player = sm.joinSession(sessionId, socket.id);
    if (!player) {
      socket.emit('error', 'Session not found or invalid');
      return;
    }
    socket.join(sessionId);
    const session = sm.getSession(sessionId);
    socket.emit('platform:joined', { player });
    io.to(session.hostSocketId).emit('platform:playerJoined', { player });
    console.log(`Player ${socket.id} joined session ${sessionId} with color ${player.color}`);
  });

  socket.on('platform:playerReady', ({ sessionId }) => {
    const result = sm.setReady(sessionId, socket.id);
    if (!result) return;
    const session = sm.getSession(sessionId);
    if (!session) return;
    const { readyCount, totalCount, allReady } = result;
    io.to(session.hostSocketId).emit('platform:readyUpdate', { readyCount, totalCount });
    console.log(`[${sessionId}] ${socket.id} ready (${readyCount}/${totalCount})`);
    if (allReady) {
      io.to(sessionId).emit('platform:allReady', {});
      console.log(`[${sessionId}] All players ready — allReady broadcast`);
    }
  });

  socket.on('platform:reset', ({ sessionId }) => {
    sm.resetSession(sessionId);
    io.to(sessionId).emit('platform:reset', {});
    console.log(`[${sessionId}] Session reset`);
  });

  // ─── Game message routing (server is content-agnostic) ──────────────────────

  socket.on('game:toHost', ({ sessionId, type, payload }) => {
    const session = sm.getSession(sessionId);
    if (!session) return;
    io.to(session.hostSocketId).emit('game:fromPlayer', { from: socket.id, type, payload });
  });

  socket.on('game:toPlayer', ({ to, type, payload }) => {
    io.to(to).emit('game:fromHost', { type, payload });
  });

  socket.on('game:broadcast', ({ sessionId, type, payload }) => {
    const session = sm.getSession(sessionId);
    if (!session) return;
    for (const p of session.players) {
      io.to(p.id).emit('game:fromHost', { type, payload });
    }
  });

  // ─── Disconnect ─────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    const events = sm.removeSocket(socket.id);
    for (const { sessionId, role, data } of events) {
      if (role === 'host') {
        io.to(sessionId).emit('hostDisconnected');
        console.log(`Session ${sessionId} closed — host disconnected`);
      } else if (data?.player) {
        const { player, readyCount, totalCount, hostSocketId } = data;
        io.to(hostSocketId).emit('platform:playerLeft', { playerId: player.id });
        io.to(hostSocketId).emit('platform:readyUpdate', { readyCount, totalCount });
        console.log(`Player ${player.id} removed from session ${sessionId}`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket.IO Server running on http://0.0.0.0:${PORT}`);
});
