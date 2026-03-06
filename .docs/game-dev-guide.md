# 새 게임 추가 가이드

이 문서는 Connect Dise 플랫폼에 새 게임을 추가하는 전체 과정을 설명합니다.

---

## 개요

게임 하나는 두 개의 독립적인 페이지로 구성됩니다.

- **호스트 페이지** (`games/{game-id}/host/`) — PC 화면에 표시되는 게임 화면
- **모바일 페이지** (`games/{game-id}/mobile/`) — 플레이어의 스마트폰 컨트롤러 화면

두 페이지는 `HostSDK` / `MobileSDK`를 통해 서버를 경유하여 실시간으로 통신합니다.

---

## 1단계: 디렉토리 생성

`games/` 아래에 게임 ID로 폴더를 만들고, `host`와 `mobile` 서브폴더를 구성합니다.

```
games/
└── my-game/
    ├── host/
    │   ├── index.html
    │   ├── main.js
    │   └── (MyGame.js, style.css 등 필요한 파일)
    └── mobile/
        ├── index.html
        └── main.js
```

---

## 2단계: 게임 등록

[`games/registry.js`](../games/registry.js)에 항목을 추가합니다.

```js
export const GAMES = [
  // ... 기존 게임들
  {
    id: 'my-game',           // URL 경로에 사용될 ID (소문자, 하이픈)
    name: '내 게임',
    description: '게임 설명을 한 줄로 작성합니다.',
    hostPath: '/games/my-game/host/',
    mobilePath: '/games/my-game/mobile/',
    minPlayers: 2,
    maxPlayers: 4,
    thumbnail: '🎮',         // 로비에 표시되는 이모지
  },
];
```

---

## 3단계: Vite 빌드 엔트리 추가

[`vite.config.js`](../vite.config.js)의 `input` 객체에 두 엔트리를 추가합니다.

```js
input: {
  // ... 기존 엔트리들
  myGameHost:   resolve(__dirname, 'games/my-game/host/index.html'),
  myGameMobile: resolve(__dirname, 'games/my-game/mobile/index.html'),
},
```

---

## 4단계: 호스트 페이지 구현

### `games/my-game/host/index.html`

공통 스타일을 불러오고, 게임에 필요한 HTML 구조를 작성합니다.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>내 게임 - Host</title>
  <link rel="stylesheet" href="/src/style.css">
  <link rel="stylesheet" href="./style.css">
</head>
<body class="host-board">
  <!-- QR 코드가 렌더링될 컨테이너 (권장) -->
  <div id="qr-container"></div>

  <!-- 게임 캔버스나 UI -->
  <div id="game-area"></div>

  <!-- 세션 정보 표시 (선택) -->
  <p id="session-info"></p>

  <button id="btn-restart">다시 하기</button>

  <script type="module" src="./main.js"></script>
</body>
</html>
```

### `games/my-game/host/main.js`

```js
import { HostSDK } from '../../../platform/client/HostSDK.js';
import { renderQR } from '../../../platform/client/shared/QRDisplay.js';

const host = new HostSDK({ gameId: 'my-game' });

// 1. 세션 준비 — QR 코드 표시
host.on('sessionReady', async ({ sessionId, qrUrl }) => {
  document.getElementById('session-info').textContent = `Session: ${sessionId}`;
  await renderQR(document.getElementById('qr-container'), qrUrl, { width: 200 });

  // 게임 초기화
  initGame();
});

// 2. 플레이어 입장/퇴장 처리
host.on('playerJoin', (player) => {
  console.log('입장:', player.id, player.color);
  updatePlayerList();
});

host.on('playerLeave', (playerId) => {
  console.log('퇴장:', playerId);
  updatePlayerList();
});

// 3. 준비 완료 처리
host.on('allReady', () => {
  startGame();
});

// 4. 모바일에서 오는 게임 메시지
host.onMessage('playerAction', (player, payload) => {
  // player: { id, color }
  // payload: 모바일이 보낸 데이터
  handlePlayerAction(player, payload);
});

// 5. 리셋
host.on('reset', () => {
  resetGame();
});

// ─── 게임 로직 ─────────────────────────────────────────────────────────────────

function initGame() { /* ... */ }

function startGame() {
  // 게임 시작을 전체 모바일에 알림
  host.broadcast('gameStart', {
    players: host.getPlayers(),
  });
}

function handlePlayerAction(player, payload) { /* ... */ }

function resetGame() {
  host.resetSession(); // 플랫폼 리셋 트리거
}

// 게임 종료 예시
function endGame(winnerId) {
  host.broadcast('gameOver', { winnerId });
}

// 특정 플레이어에게만 전송하는 예시
function notifyPlayer(playerId, message) {
  host.sendToPlayer(playerId, 'notification', { message });
}

document.getElementById('btn-restart').addEventListener('click', () => {
  host.resetSession();
});
```

---

## 5단계: 모바일 페이지 구현

### `games/my-game/mobile/index.html`

모바일 뷰포트에 맞게 설정하고, 게임 페이즈별 UI를 작성합니다.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>내 게임 - Controller</title>
  <link rel="stylesheet" href="/src/style.css">
</head>
<body class="mobile-controller">

  <!-- 센서 권한 모달 (센서를 사용하는 게임에 필요) -->
  <div id="permission-modal" class="modal">
    <div class="modal-content">
      <h2>내 게임</h2>
      <p>모션 센서 권한이 필요합니다.</p>
      <button id="btn-grant">게임 시작</button>
    </div>
  </div>

  <!-- 연결 상태 -->
  <div class="status-indicator">
    <span id="connection-status" class="status-dot"></span>
    <span id="session-display">Session: ---</span>
  </div>

  <!-- 로비 화면 -->
  <div id="phase-lobby">
    <button id="btn-ready" class="hidden">준비하기</button>
  </div>

  <!-- 게임 화면 -->
  <div id="phase-game" class="hidden">
    <button id="btn-action">액션!</button>
  </div>

  <!-- 결과 화면 -->
  <div id="phase-result" class="hidden">
    <p id="result-text"></p>
    <button id="btn-again">다시하기</button>
  </div>

  <script type="module" src="./main.js"></script>
</body>
</html>
```

### `games/my-game/mobile/main.js`

```js
import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { LevelIndicator } from '../../../platform/client/shared/LevelIndicator.js';

const mobile = new MobileSDK();

// ─── 연결 상태 표시 ─────────────────────────────────────────────────────────────

document.getElementById('session-display').textContent =
  `Session: ${mobile.getSessionId() ?? 'N/A'}`;

// 1. 세션 입장 완료
mobile.on('join', (player) => {
  document.getElementById('connection-status').classList.add('connected');
  document.getElementById('btn-ready').classList.remove('hidden');
});

// 2. 호스트 연결 종료
mobile.on('hostDisconnect', () => {
  alert('호스트가 연결을 끊었습니다.');
});

// 3. 리셋
mobile.on('reset', () => {
  showPhase('phase-lobby');
  document.getElementById('btn-ready').disabled = false;
  document.getElementById('btn-ready').classList.remove('hidden');
});

// ─── 게임 메시지 수신 ──────────────────────────────────────────────────────────

mobile.onMessage('gameStart', (payload) => {
  showPhase('phase-game');
});

mobile.onMessage('gameOver', ({ winnerId }) => {
  const isWinner = winnerId === mobile.getMyPlayer()?.id;
  document.getElementById('result-text').textContent = isWinner ? '우승!' : '패배...';
  showPhase('phase-result');
});

// ─── 센서 설정 (센서를 사용하는 경우) ─────────────────────────────────────────

document.getElementById('btn-grant').addEventListener('click', async () => {
  const granted = await mobile.requestSensors();
  if (granted) {
    document.getElementById('permission-modal').classList.add('hidden');
    setupSensors();
  } else {
    alert('센서 권한이 필요합니다.');
  }
});

function setupSensors() {
  mobile.onOrientation(({ beta, gamma }) => {
    // beta: 앞뒤 기울기, gamma: 좌우 기울기
    // 게임에 따라 활용
  });

  mobile.onMotion(({ shakeMagnitude }) => {
    // 흔들기 감지
  });
}

// ─── UI 조작 ───────────────────────────────────────────────────────────────────

document.getElementById('btn-ready').addEventListener('click', () => {
  document.getElementById('btn-ready').disabled = true;
  mobile.ready(); // 플랫폼에 준비 완료 알림
});

document.getElementById('btn-action').addEventListener('click', () => {
  mobile.sendToHost('playerAction', { /* 데이터 */ });
  mobile.vibrate([100]); // 진동 피드백
});

document.getElementById('btn-again').addEventListener('click', () => {
  mobile.sendToHost('requestReset', {});
});

// ─── 페이즈 전환 ───────────────────────────────────────────────────────────────

function showPhase(activeId) {
  ['phase-lobby', 'phase-game', 'phase-result'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', id !== activeId);
  });
}
```

---

## 게임 상태 머신 패턴 (복잡한 게임)

게임 로직이 복잡하면 별도 클래스로 분리하는 것이 좋습니다. `SpinGame.js`를 참고하세요.

```js
// games/my-game/host/MyGame.js
export class MyGame {
  constructor(host, canvas) {
    this.host = host;
    this.state = 'waiting'; // waiting | playing | result

    this._setupMessages();
  }

  _setupMessages() {
    this.host.on('allReady', () => this._start());

    this.host.onMessage('playerAction', (player, payload) => {
      if (this.state !== 'playing') return;
      this._handleAction(player, payload);
    });

    this.host.onMessage('requestReset', () => {
      this.host.resetSession();
    });
  }

  _start() {
    this.state = 'playing';
    this.host.broadcast('gameStart', { players: this.host.getPlayers() });
  }

  _handleAction(player, payload) { /* 게임 로직 */ }

  reset() {
    this.state = 'waiting';
    // 상태 초기화
  }
}
```

```js
// games/my-game/host/main.js
import { MyGame } from './MyGame.js';

const host = new HostSDK({ gameId: 'my-game' });
let game;

host.on('sessionReady', async ({ qrUrl }) => {
  await renderQR(document.getElementById('qr-container'), qrUrl);
  game = new MyGame(host, document.getElementById('canvas'));
});

host.on('reset', () => game?.reset());
```

---

## 센서 활용 패턴

### 흔들기로 액션 발동

```js
let shakeCooldown = false;

mobile.onMotion(({ shakeMagnitude }) => {
  if (shakeMagnitude > 20 && !shakeCooldown) {
    shakeCooldown = true;
    mobile.sendToHost('shake', { magnitude: shakeMagnitude });
    mobile.vibrate([50]);
    setTimeout(() => shakeCooldown = false, 1000);
  }
});
```

### 기울기로 방향 조종

```js
let tiltInterval;

function startTilting() {
  tiltInterval = setInterval(() => {
    mobile.onOrientation(({ beta, gamma }) => {
      // -1 ~ 1 범위로 정규화
      const x = Math.max(-1, Math.min(1, gamma / 45));
      const y = Math.max(-1, Math.min(1, beta / 45));
      mobile.sendToHost('tilt', { x, y });
    });
  }, 33); // 30fps
}

function stopTilting() {
  clearInterval(tiltInterval);
  tiltInterval = null;
}
```

---

## 체크리스트

새 게임 추가 시 확인할 항목입니다.

- [ ] `games/{game-id}/host/index.html` 생성
- [ ] `games/{game-id}/host/main.js` 생성
- [ ] `games/{game-id}/mobile/index.html` 생성
- [ ] `games/{game-id}/mobile/main.js` 생성
- [ ] `games/registry.js`에 게임 항목 추가
- [ ] `vite.config.js`에 두 개의 엔트리 추가
- [ ] 개발 서버 재시작 (`npm run dev`)

---

## 참고 파일

- **팽이 배틀** — 센서(흔들기 + 기울기), 페이즈 전환, 물리 엔진 예시
  - [`games/spin-battle/host/main.js`](../games/spin-battle/host/main.js)
  - [`games/spin-battle/host/SpinGame.js`](../games/spin-battle/host/SpinGame.js)
  - [`games/spin-battle/mobile/main.js`](../games/spin-battle/mobile/main.js)
- **주사위** — 단순 흔들기 + 3D 라이브러리(`@3d-dice/dice-box`) 통합 예시
  - [`games/dice/host/main.js`](../games/dice/host/main.js)
  - [`games/dice/mobile/main.js`](../games/dice/mobile/main.js)
- **SDK API 레퍼런스**: [`.docs/architecture/sdk-api.md`](architecture/sdk-api.md)
- **이벤트 프로토콜**: [`.docs/architecture/protocol.md`](architecture/protocol.md)
