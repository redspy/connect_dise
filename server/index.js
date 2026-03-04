import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import os from 'os';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*', // Allow connections from Vite dev server
        methods: ['GET', 'POST']
    }
});

// Helper to get local IP
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1'; // Fallback
}

// Keep track of active sessions
const sessions = new Map();

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Host (PC) creates a new session
    socket.on('createSession', () => {
        const sessionId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const localIp = getLocalIp();

        sessions.set(sessionId, { hostSocket: socket.id, players: [] });
        socket.join(sessionId);

        // Emit session details including the forced local IP for QRs
        socket.emit('sessionCreated', { sessionId, localIp });
        console.log(`Session ${sessionId} created by ${socket.id} (IP: ${localIp})`);
    });

    // Mobile connects to a session
    socket.on('joinSession', (sessionId) => {
        const session = sessions.get(sessionId);
        if (session) {
            socket.join(sessionId);
            session.players.push(socket.id);

            // Notify host that player joined
            io.to(session.hostSocket).emit('playerJoined', socket.id);
            socket.emit('joined', sessionId);
            console.log(`Mobile ${socket.id} joined session ${sessionId}`);
        } else {
            socket.emit('error', 'Session not found or invalid');
        }
    });

    // Forward gyro data from mobile to host
    socket.on('gyroData', ({ sessionId, data }) => {
        const session = sessions.get(sessionId);
        if (session) {
            // Send only to the host
            io.to(session.hostSocket).emit('gyroDataUpdate', { playerId: socket.id, data });
        }
    });

    // Forward dice throw event from mobile to host
    socket.on('throwDice', ({ sessionId, strength }) => {
        const session = sessions.get(sessionId);
        if (session) {
            io.to(session.hostSocket).emit('remoteThrow', { playerId: socket.id, strength });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Cleanup sessions if needed
        for (const [sessionId, session] of sessions.entries()) {
            if (session.hostSocket === socket.id) {
                // Host disconnected
                sessions.delete(sessionId);
                io.to(sessionId).emit('hostDisconnected');
                console.log(`Session ${sessionId} deleted because host disconnected`);
            } else {
                // Player disconnected
                const playerIndex = session.players.indexOf(socket.id);
                if (playerIndex !== -1) {
                    session.players.splice(playerIndex, 1);
                    io.to(session.hostSocket).emit('playerLeft', socket.id);
                    console.log(`Mobile ${socket.id} removed from session ${sessionId}`);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Socket.IO Server running on http://0.0.0.0:${PORT}`);
});
