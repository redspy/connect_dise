import { io } from 'socket.io-client';
import QRCode from 'qrcode';
import DiceBox from '@3d-dice/dice-box';

// Socket connects using current origin (proxied to node)
const socket = io();

// Initialize 3D Dice with local assets to prevent CORS/Module loading issues
const diceBox = new DiceBox("#dice-box", {
    assetPath: "/assets/dice-box/assets/",
    origin: "/assets/dice-box/",
    theme: "default",
    themeColor: "#FFD700",
    spinForce: 6,
    throwForce: 6,
    gravity: 1,
    scale: 6
});

let isDiceReady = false;
diceBox.init().then(() => {
    console.log("DiceBox ready");
    isDiceReady = true;
});

// Update UI elements
const sessionInfo = document.getElementById('session-info');
const playerStatus = document.getElementById('player-status');
const qrContainers = [
    document.getElementById('qr-top-left'),
    document.getElementById('qr-top-right'),
    document.getElementById('qr-bottom-left'),
    document.getElementById('qr-bottom-right')
];

let currentSession = null;
let playerCount = 0;

socket.on('connect', () => {
    console.log('Connected to server, requesting session...');
    socket.emit('createSession');
});

socket.on('sessionCreated', async ({ sessionId, localIp }) => {
    currentSession = sessionId;
    sessionInfo.innerHTML = `Session ID<br><strong>${sessionId}</strong>`;

    // Mobile Network URL utilizes the backend resolved IP to bypass localhost bindings
    const scheme = window.location.protocol;
    // Keep the port the same as where the Vite app is running (e.g. 5173)
    const port = window.location.port ? `:${window.location.port}` : '';
    const mobileUrl = `${scheme}//${localIp}${port}/mobile.html?session=${sessionId}`;

    // Generate QRs
    for (const container of qrContainers) {
        container.innerHTML = '';
        const canvas = document.createElement('canvas');
        container.appendChild(canvas);

        await QRCode.toCanvas(canvas, mobileUrl, {
            width: 120,
            margin: 1,
            color: { dark: '#1C5435', light: '#FFFFFF' }
        });

        const text = document.createElement('p');
        text.textContent = 'Scan to Join';
        container.appendChild(text);
    }
});

socket.on('playerJoined', (playerId) => {
    playerCount++;
    updatePlayerStatus();
});

socket.on('playerLeft', (playerId) => {
    playerCount = Math.max(0, playerCount - 1);
    updatePlayerStatus();
});

function updatePlayerStatus() {
    if (playerCount > 0) {
        playerStatus.textContent = `${playerCount} Player(s) connected and ready!`;
        playerStatus.style.color = "#00C851";
    } else {
        playerStatus.textContent = 'Waiting for players...';
        playerStatus.style.color = "#F0F0F0";
    }
}

// Listen for remote throw from the server (which forwards it from mobile)
socket.on('remoteThrow', ({ playerId, strength, color }) => {
    console.log(`Player ${playerId} threw the dice with color ${color}!`);

    // UI Feedback that event was received
    playerStatus.textContent = "Rolling dice!! 🎲";
    playerStatus.style.color = color || "#FFD700";
    // Increase glow of the status box temporarily
    document.querySelector('.center-status').style.boxShadow = `inset 0 0 20px rgba(0,0,0,0.5), 0 0 30px ${color || '#FFD700'}`;
    setTimeout(() => {
        updatePlayerStatus();
        document.querySelector('.center-status').style.boxShadow = '';
    }, 3000);

    if (!isDiceReady) {
        console.warn("3D Dice engine is not loaded yet!");
        return;
    }

    // Roll dice (will override previous automatically)
    // Using a more standard API for dice-box: roll(notation) with globally set themeColor
    // or passing options if supported. 
    // To ensure individual colors work better, we can also use 'add'
    diceBox.roll('2d6', { themeColor: color || "#FFD700" }).catch(err => {
        console.error("Dice roll failed:", err);
        // Fallback: try simple string notation if complex options fail
        diceBox.roll('2d6');
    });
});
