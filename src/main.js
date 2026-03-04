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

socket.on('sessionCreated', async (sessionId) => {
    currentSession = sessionId;
    sessionInfo.innerHTML = `Session ID<br><strong>${sessionId}</strong>`;

    // Mobile Network URL matches the current host with https
    const scheme = window.location.protocol;
    const mobileUrl = `${scheme}//${window.location.host}/mobile.html?session=${sessionId}`;

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
socket.on('remoteThrow', ({ playerId, strength }) => {
    console.log(`Player ${playerId} threw the dice!`);

    // UI Feedback that event was received
    playerStatus.textContent = "Rolling dice!! 🎲";
    playerStatus.style.color = "#FFD700";
    setTimeout(updatePlayerStatus, 3000);

    if (!isDiceReady) {
        console.warn("3D Dice engine is not loaded yet!");
        return;
    }

    // Roll dice (will override previous automatically)
    diceBox.roll('2d6').catch(err => console.error("Dice roll failed:", err));
});
