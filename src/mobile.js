import { io } from 'socket.io-client';

const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session');

const sessionDisplay = document.getElementById('session-display');
const connectionStatus = document.getElementById('connection-status');
const permissionModal = document.getElementById('permission-modal');
const btnGrant = document.getElementById('btn-grant-permission');
const diceArea = document.getElementById('dice-area');
const visualDice = document.getElementById('visual-dice');

let socket;

if (!sessionId) {
    sessionDisplay.textContent = 'No Session ID provided';
} else {
    sessionDisplay.textContent = `Session: ${sessionId}`;

    // Connect to Socket.IO server utilizing Vite's proxy
    socket = io();

    socket.on('connect', () => {
        socket.emit('joinSession', sessionId);
    });

    socket.on('joined', (id) => {
        connectionStatus.classList.add('connected');
    });

    socket.on('hostDisconnected', () => {
        alert("Host has disconnected. The game is over.");
        connectionStatus.classList.remove('connected');
    });

    socket.on('error', (msg) => {
        console.error('Socket error:', msg);
        alert('Error: ' + msg);
    });
}

// Request Permission Flow for Accelerometer/Gyroscope
btnGrant.addEventListener('click', async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const permissionState = await DeviceOrientationEvent.requestPermission();
            if (permissionState === 'granted') {
                permissionModal.classList.add('hidden');
                initSensors();
            } else {
                alert("Permission denied. You cannot play without motion sensors.");
            }
        } catch (error) {
            console.error(error);
            permissionModal.classList.add('hidden');
            initSensors(); // Fallback
        }
    } else {
        // Non-iOS or older devices that don't require user interaction to bind sensors
        permissionModal.classList.add('hidden');
        initSensors();
    }
});

let lastUpdate = 0;
let lastThrowTime = 0;

function initSensors() {
    window.addEventListener('deviceorientation', (event) => {
        const now = Date.now();
        if (now - lastUpdate > 100) { // Throttle updates
            lastUpdate = now;
            if (socket && sessionId && connectionStatus.classList.contains('connected')) {
                // Send gyro data to server (for future 3D tilt effects if needed)
                socket.emit('gyroData', {
                    sessionId,
                    data: {
                        alpha: event.alpha,
                        beta: event.beta,
                        gamma: event.gamma
                    }
                });
            }
        }
    });

    // Provide visual feedback by shaking the dice on screen!
    window.addEventListener('devicemotion', (event) => {
        const acc = event.accelerationIncludingGravity || event.acceleration;
        if (acc) {
            const magnitude = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
            if (magnitude > 15 && !visualDice.classList.contains('throwing')) {
                visualDice.style.transform = `translate(${Math.random() * 10 - 5}px, ${Math.random() * 10 - 5}px) rotate(${Math.random() * 20 - 10}deg)`;
                setTimeout(() => {
                    if (!visualDice.classList.contains('throwing')) {
                        visualDice.style.transform = 'none';
                    }
                }, 100);
            }
        }
    });
}

// Emulate throw with double tap
let lastTap = 0;
diceArea.addEventListener('touchstart', (e) => {
    const now = Date.now();
    const timesince = now - lastTap;
    if (timesince < 300 && timesince > 0) {
        // double tap detected
        triggerThrow();
    }
    lastTap = now;
});

// Also support Double Click for testing on PC emulator
diceArea.addEventListener('dblclick', () => {
    triggerThrow();
});

function triggerThrow() {
    const now = Date.now();
    if (now - lastThrowTime < 500) return; // Debounce 0.5s
    lastThrowTime = now;

    // Animate local dice (throws upwards)
    visualDice.classList.remove('throwing');
    void visualDice.offsetWidth; // trigger reflow
    visualDice.classList.add('throwing');

    // Vibrate if supported
    if (navigator.vibrate) navigator.vibrate(200);

    // Emit throw event to server
    if (socket && sessionId) {
        socket.emit('throwDice', {
            sessionId,
            strength: 1.0 // Future: Calculate strength based on DeviceAcceleration
        });
    }
}
