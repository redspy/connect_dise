import { io } from 'socket.io-client';

const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session');

const sessionDisplay = document.getElementById('session-display');
const connectionStatus = document.getElementById('connection-status');
const permissionModal = document.getElementById('permission-modal');
const btnGrant = document.getElementById('btn-grant-permission');
const diceArea = document.getElementById('dice-area');
const visualDice = document.getElementById('visual-dice');
const instructionMain = document.getElementById('instruction-main');
const instructionSub = document.getElementById('instruction-sub');
const btnRetry = document.getElementById('btn-retry');

let socket;
let myColor = '#FFFFFF'; // Default

if (!sessionId) {
    sessionDisplay.textContent = 'No Session ID provided';
} else {
    sessionDisplay.textContent = `Session: ${sessionId}`;

    // Connect to Socket.IO server utilizing Vite's proxy
    socket = io();

    socket.on('connect', () => {
        socket.emit('joinSession', sessionId);
    });

    socket.on('joined', ({ sessionId, color }) => {
        connectionStatus.classList.add('connected');
        myColor = color;
        // Make the mobile dice reflect the assigned color
        visualDice.style.color = myColor;
        // Use a more intense glow for the dice
        visualDice.style.textShadow = `0 10px 20px rgba(0,0,0,0.5), 0 0 30px ${myColor}, 0 0 60px ${myColor}`;
        // Update instruction color slightly to match theme
        instructionMain.style.color = myColor;
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

const levelBubble = document.getElementById('level-bubble');
const levelBeta  = document.getElementById('level-beta');
const levelGamma = document.getElementById('level-gamma');
const BOWL_RADIUS = 46; // px — usable radius inside the bowl (60 - bubble_radius/2)

function updateLevelIndicator(beta, gamma) {
    // beta: front-back tilt (-180~180), gamma: left-right tilt (-90~90)
    // Clamp to ±45° for the bowl range
    const clampedBeta  = Math.max(-45, Math.min(45, beta  ?? 0));
    const clampedGamma = Math.max(-45, Math.min(45, gamma ?? 0));

    // Map ±45° → ±BOWL_RADIUS px. Bubble moves opposite to tilt (like real bubble)
    const x = (-clampedGamma / 45) * BOWL_RADIUS;
    const y = (-clampedBeta  / 45) * BOWL_RADIUS;

    // Position: center is 50%/50%, offset in px
    levelBubble.style.left = `calc(50% + ${x.toFixed(1)}px)`;
    levelBubble.style.top  = `calc(50% + ${y.toFixed(1)}px)`;

    // Color: green when near center, red when tilted
    const dist = Math.sqrt(x * x + y * y);
    levelBubble.classList.toggle('tilted', dist > BOWL_RADIUS * 0.4);

    // Text values
    levelBeta.textContent  = `β: ${(beta  ?? 0).toFixed(1)}°`;
    levelGamma.textContent = `γ: ${(gamma ?? 0).toFixed(1)}°`;
}

function initSensors() {
    window.addEventListener('deviceorientation', (event) => {
        const now = Date.now();
        updateLevelIndicator(event.beta, event.gamma);

        if (now - lastUpdate > 100) { // Throttle network updates
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
            // Lowered threshold to 5 for higher sensitivity, make rotation extreme for shaking feel
            if (magnitude > 5 && !visualDice.classList.contains('throwing')) {
                visualDice.style.transition = 'transform 0.05s ease';
                visualDice.style.transform = `translate(${Math.random() * 40 - 20}px, ${Math.random() * 40 - 20}px) rotate(${Math.random() * 360}deg) scale(${1 + Math.random() * 0.2})`;
                setTimeout(() => {
                    if (!visualDice.classList.contains('throwing')) {
                        visualDice.style.transform = 'none';
                        visualDice.style.transition = 'transform 0.1s ease-out';
                    }
                }, 50);
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
    if (visualDice.classList.contains('throwing')) return; // Prevent multiple throws

    lastThrowTime = now;

    // Animate local dice (throws upwards)
    visualDice.classList.remove('throwing');
    void visualDice.offsetWidth; // trigger reflow
    visualDice.classList.add('throwing');

    // Hide instructions, show retry
    if (instructionMain) instructionMain.classList.add('hidden');
    if (instructionSub) instructionSub.classList.add('hidden');

    // Show Retry button after animation finishes
    setTimeout(() => {
        if (btnRetry) {
            btnRetry.classList.remove('hidden');
            // Slight delay to allow display block to apply before opacity transition
            setTimeout(() => btnRetry.classList.add('visible'), 50);
        }
    }, 500);

    // Vibrate if supported
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    // Emit throw event to server
    if (socket && sessionId) {
        socket.emit('throwDice', {
            sessionId,
            strength: 1.0, // Future: Calculate strength based on DeviceAcceleration
            color: myColor
        });
    }
}

// Attach Retry behavior
if (btnRetry) {
    btnRetry.addEventListener('click', () => {
        // Reset dice
        visualDice.classList.remove('throwing');

        // Hide retry button
        btnRetry.classList.remove('visible');
        setTimeout(() => btnRetry.classList.add('hidden'), 300);

        // Show instructions again
        if (instructionMain) instructionMain.classList.remove('hidden');
        if (instructionSub) instructionSub.classList.remove('hidden');
    });
}
