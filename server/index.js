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

    // Predefined distinct colors for players
    const playerColors = ['#FF4444', '#33B5E5', '#99CC00', '#FFBB33', '#AA66CC', '#FF00A2'];

    // Mobile connects to a session
    socket.on('joinSession', (sessionId) => {
        const session = sessions.get(sessionId);
        if (session) {
            socket.join(sessionId);

            // Assign a color based on the number of current players in the session
            const colorIndex = session.players.length % playerColors.length;
            const assignedColor = playerColors[colorIndex];

            // Store player socket and their assigned color
            const playerInfo = { id: socket.id, color: assignedColor };
            session.players.push(playerInfo);

            // Notify host that player joined along with their color
            io.to(session.hostSocket).emit('playerJoined', playerInfo);
            // Notify player of successful join and their color
            socket.emit('joined', { sessionId, color: assignedColor });
            console.log(`Mobile ${socket.id} joined session ${sessionId} with color ${assignedColor}`);
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
    socket.on('throwDice', ({ sessionId, strength, color }) => {
        const session = sessions.get(sessionId);
        if (session) {
            io.to(session.hostSocket).emit('remoteThrow', { playerId: socket.id, strength, color });
        }
    });

    // ─── Spin Battle Events ────────────────────────────────────────────────────

    // Host creates a spin battle session
    socket.on('createSpinSession', () => {
        const sessionId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const localIp = getLocalIp();
        sessions.set(sessionId, {
            hostSocket: socket.id,
            players: [],
            gameMode: 'spinner',
            gameState: 'lobby',
            launchRpms: new Map(),
        });
        socket.join(sessionId);
        socket.emit('spinSessionCreated', { sessionId, localIp });
        console.log(`[Spin] Session ${sessionId} created by ${socket.id}`);
    });

    // Mobile joins a spin session
    socket.on('spinJoinSession', (sessionId) => {
        const session = sessions.get(sessionId);
        if (session && session.gameMode === 'spinner' && session.gameState === 'lobby') {
            socket.join(sessionId);
            const colorIndex = session.players.length % playerColors.length;
            const color = playerColors[colorIndex];
            session.players.push({ id: socket.id, color });
            io.to(session.hostSocket).emit('spinPlayerJoined', { id: socket.id, color });
            socket.emit('spinJoined', { sessionId, color });
            console.log(`[Spin] ${socket.id} joined ${sessionId} as ${color}`);
        } else {
            socket.emit('error', 'Spin session not found or not in lobby');
        }
    });

    // Host starts the game → launch phase
    socket.on('spinStartGame', ({ sessionId }) => {
        const session = sessions.get(sessionId);
        if (session && session.hostSocket === socket.id) {
            session.gameState = 'launching';
            session.launchRpms = new Map();
            io.to(sessionId).emit('spinLaunchPhase');
            console.log(`[Spin] Launch phase started in ${sessionId}`);
        }
    });

    // Mobile submits launch RPM
    socket.on('spinLaunchSpin', ({ sessionId, rpm }) => {
        const session = sessions.get(sessionId);
        if (!session) return;
        session.launchRpms.set(socket.id, Math.min(3000, Math.max(300, rpm || 1000)));
        io.to(session.hostSocket).emit('spinLaunchSpinReceived', { playerId: socket.id, rpm });
        console.log(`[Spin] ${socket.id} launch rpm=${rpm} in ${sessionId}`);
    });

    // Host signals launch window ended → start battle
    socket.on('spinLaunchDone', ({ sessionId }) => {
        const session = sessions.get(sessionId);
        if (!session || session.hostSocket !== socket.id) return;
        session.gameState = 'battle';

        // Assign RPMs (default 1000 if player didn't spin)
        const players = session.players.map(p => ({
            id: p.id,
            color: p.color,
            rpm: session.launchRpms.get(p.id) || 1000,
        }));

        io.to(sessionId).emit('spinBattleStart', { players });
        console.log(`[Spin] Battle started in ${sessionId}`);
    });

    // Mobile sends tilt input → forward to host
    socket.on('spinTiltInput', ({ sessionId, tiltX, tiltZ }) => {
        const session = sessions.get(sessionId);
        if (session) {
            io.to(session.hostSocket).emit('spinTiltUpdate', { playerId: socket.id, tiltX, tiltZ });
        }
    });

    // Host resets game → back to lobby, players stay connected
    socket.on('spinResetGame', ({ sessionId }) => {
        const session = sessions.get(sessionId);
        if (!session || session.hostSocket !== socket.id) return;
        session.gameState = 'lobby';
        session.launchRpms = new Map();
        session.players.forEach(p => delete p.eliminated);
        io.to(sessionId).emit('spinGameReset', {
            players: session.players.map(p => ({ id: p.id, color: p.color }))
        });
        console.log(`[Spin] Game reset in ${sessionId}`);
    });

    // Host reports a player eliminated → notify that player
    socket.on('spinPlayerEliminated', ({ sessionId, playerId, reason }) => {
        const session = sessions.get(sessionId);
        if (!session) return;
        const playerEntry = session.players.find(p => p.id === playerId);
        if (playerEntry) playerEntry.eliminated = true;

        const remaining = session.players.filter(p => !p.eliminated);
        const rank = session.players.filter(p => p.eliminated).length;
        io.to(playerId).emit('spinEliminated', { rank, reason });

        // Check if only one left → game over
        if (remaining.length <= 1) {
            session.gameState = 'result';
            const winner = remaining[0];
            const eliminated = session.players.filter(p => p.eliminated && p.id !== winner?.id);
            const rankings = [];
            if (winner) rankings.push({ id: winner.id, color: winner.color });
            for (let i = eliminated.length - 1; i >= 0; i--) {
                rankings.push({ id: eliminated[i].id, color: eliminated[i].color });
            }
            io.to(sessionId).emit('spinGameOver', { rankings });
            console.log(`[Spin] Game over in ${sessionId}`);
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
                // Player disconnected — handle both dice (string) and spin (object) player formats
                const playerIndex = session.players.findIndex(
                    p => p === socket.id || p?.id === socket.id
                );
                if (playerIndex !== -1) {
                    const removed = session.players.splice(playerIndex, 1)[0];
                    const removedId = removed?.id ?? removed;
                    if (session.gameMode === 'spinner') {
                        io.to(session.hostSocket).emit('spinPlayerLeft', { id: removedId });
                    } else {
                        io.to(session.hostSocket).emit('playerLeft', removedId);
                    }
                    console.log(`Mobile ${removedId} removed from session ${sessionId}`);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Socket.IO Server running on http://0.0.0.0:${PORT}`);
});
