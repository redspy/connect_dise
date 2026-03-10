# 새 게임 추가 가이드

이 문서는 Connect Dise 플랫폼에 새 게임을 추가하는 전체 과정을 설명합니다.

---

## 개요

게임 하나는 두 개의 독립적인 페이지로 구성됩니다.

- **호스트 페이지** (`games/{game-id}/host/`) — PC 화면에 표시되는 게임 화면
- **모바일 페이지** (`games/{game-id}/mobile/`) — 플레이어의 스마트폰 컨트롤러 화면

두 페이지는 `HostSDK` / `MobileSDK`를 통해 서버를 경유하여 실시간으로 통신합니다.
`HostBaseGame` / `MobileBaseGame` 베이스 클래스를 상속하면 플레이어 추적, 페이즈/화면 전환, 재연결 등 공통 기능을 자동으로 사용할 수 있습니다.

---

## 1단계: 디렉토리 생성

`games/` 아래에 게임 ID로 폴더를 만들고, `host`와 `mobile` 서브폴더를 구성합니다.

```
games/
└── my-game/
    ├── assets/              # 이미지, 사운드 등 (선택, 자동 서빙됨)
    ├── host/
    │   ├── index.html
    │   ├── main.js
    │   ├── MyGame.js        # HostBaseGame 상속
    │   └── style.css
    └── mobile/
        ├── index.html
        ├── main.js
        ├── MyMobile.js      # MobileBaseGame 상속
        └── style.css
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
    thumbnailImg: '/games/my-game/assets/thumbnail.png',  // 선택: 이미지 썸네일
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

## 4단계: 호스트 페이지 구현 (BaseGame 패턴)

### `games/my-game/host/MyGame.js`

`HostBaseGame`을 상속하여 게임 로직만 구현합니다.

```js
import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';

export class MyGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, {
      overlayClass: 'game-overlay',    // 페이즈별 오버레이 CSS 클래스
      qrContainerId: 'qr-container',   // QR 자동 렌더링 (null이면 비활성)
    });
  }

  // ─── 라이프사이클 훅 (필요한 것만 override) ─────────────────────

  async onSetup({ sessionId, qrUrl }) {
    // 세션 생성 + QR 렌더링 완료 후 호출
    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    // this.players에 이미 추가된 상태
    console.log(`${player.color} 입장, 현재 ${this.playerCount}명`);
  }

  onPlayerLeave(playerId) {
    // this.players에서 이미 제거된 상태
  }

  onAllReady() {
    this.setPhase('game');
    this.broadcast('gameStart', { players: [...this.players.values()] });
  }

  onReset() {
    // this.players는 자동 복원됨
    this.setPhase('lobby');
  }
}
```

### `games/my-game/host/main.js`

```js
import { HostSDK } from '../../../platform/client/HostSDK.js';
import { MyGame } from './MyGame.js';

const sdk = new HostSDK({ gameId: 'my-game' });
const game = new MyGame(sdk);

// 게임 메시지 핸들러
game.onMessage('playerAction', (player, payload) => {
  // player: { id, color }
});

game.onMessage('requestReset', () => {
  game.resetSession();
});
```

### `games/my-game/host/index.html`

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
  <!-- 페이즈별 오버레이 (data-phase 값으로 전환) -->
  <div class="game-overlay" data-phase="lobby">
    <div id="qr-container"></div>
    <p id="ready-status"></p>
  </div>

  <div class="game-overlay hidden" data-phase="game">
    <div id="game-area"></div>
  </div>

  <div class="game-overlay hidden" data-phase="result">
    <p id="result-text"></p>
    <button id="btn-restart">다시 하기</button>
  </div>

  <script type="module" src="./main.js"></script>
</body>
</html>
```

---

## 5단계: 모바일 페이지 구현 (BaseGame 패턴)

### `games/my-game/mobile/MyMobile.js`

```js
import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';

export class MyMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, {
      screenClass: 'game-screen',  // 화면 전환 CSS 클래스
    });
  }

  onJoin(player) {
    this.showScreen('waiting');
  }

  onRejoin(player) {
    // 재연결: 현재 화면 유지 (기본 동작)
  }

  onAllReady() {
    this.showScreen('game');
  }

  onReset() {
    this.showScreen('waiting');
  }
}
```

### `games/my-game/mobile/main.js`

```js
import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { MyMobile } from './MyMobile.js';

const sdk = new MobileSDK();
const game = new MyMobile(sdk);

// 게임 메시지 핸들러
game.onMessage('gameStart', (payload) => {
  // 게임 시작 처리
});

game.onMessage('gameOver', ({ winnerId }) => {
  game.showScreen('result');
});

// UI 이벤트
document.getElementById('btn-ready').addEventListener('click', () => {
  game.ready();
});

document.getElementById('btn-action').addEventListener('click', () => {
  game.sendToHost('playerAction', { /* 데이터 */ });
  game.vibrate([100]);
});
```

### `games/my-game/mobile/index.html`

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>내 게임 - Controller</title>
  <link rel="stylesheet" href="/src/style.css">
  <link rel="stylesheet" href="./style.css">
</head>
<body class="mobile-controller">

  <!-- 화면별 (data-screen 값으로 전환) -->
  <div class="game-screen" data-screen="waiting">
    <button id="btn-ready">준비하기</button>
  </div>

  <div class="game-screen hidden" data-screen="game">
    <button id="btn-action">액션!</button>
  </div>

  <div class="game-screen hidden" data-screen="result">
    <p id="result-text"></p>
  </div>

  <script type="module" src="./main.js"></script>
</body>
</html>
```

---

## 에셋 (이미지/사운드)

`games/{game-id}/assets/` 폴더에 파일을 넣으면 자동으로 서빙됩니다.

- **개발 시**: Vite 미들웨어가 `/games/{game-id}/assets/` URL로 자동 서빙
- **빌드 시**: `dist/games/{game-id}/assets/`로 자동 복사

별도 설정 없이 HTML/JS에서 바로 참조 가능합니다:

```html
<img src="/games/my-game/assets/background.png">
```

```js
const audio = new Audio('/games/my-game/assets/sound.mp3');
```

---

## 센서 활용 패턴

### 흔들기로 액션 발동

```js
let shakeCooldown = false;

game.onMotion(({ shakeMagnitude }) => {
  if (shakeMagnitude > 20 && !shakeCooldown) {
    shakeCooldown = true;
    game.sendToHost('shake', { magnitude: shakeMagnitude });
    game.vibrate([50]);
    setTimeout(() => shakeCooldown = false, 1000);
  }
});
```

### 기울기로 방향 조종

```js
game.onOrientation(({ beta, gamma }) => {
  const x = Math.max(-1, Math.min(1, gamma / 45));
  const y = Math.max(-1, Math.min(1, beta / 45));
  game.sendToHost('tilt', { x, y });
});
```

---

## 체크리스트

새 게임 추가 시 확인할 항목입니다.

- [ ] `games/{game-id}/host/index.html` 생성
- [ ] `games/{game-id}/host/main.js` 생성 (HostBaseGame 상속 권장)
- [ ] `games/{game-id}/mobile/index.html` 생성
- [ ] `games/{game-id}/mobile/main.js` 생성 (MobileBaseGame 상속 권장)
- [ ] `games/registry.js`에 게임 항목 추가
- [ ] `vite.config.js`에 두 개의 엔트리 추가
- [ ] 개발 서버 재시작 (`npm run dev`)

---

## 참고 파일

- **눈치 10단** — BaseGame 패턴, 카드 UI, 라운드 상태 머신 예시
  - [`games/nunchi-ten/host/NunchiGame.js`](../games/nunchi-ten/host/NunchiGame.js)
  - [`games/nunchi-ten/mobile/NunchiMobile.js`](../games/nunchi-ten/mobile/NunchiMobile.js)
- **팽이 배틀** — 센서(흔들기 + 기울기), Three.js 3D 렌더링, 물리 엔진 예시
  - [`games/spin-battle/host/SpinGame.js`](../games/spin-battle/host/SpinGame.js)
  - [`games/spin-battle/host/SpinPhysics.js`](../games/spin-battle/host/SpinPhysics.js)
  - [`games/spin-battle/host/SpinRenderer.js`](../games/spin-battle/host/SpinRenderer.js)
  - [`games/spin-battle/mobile/main.js`](../games/spin-battle/mobile/main.js)
- **주사위** — 단순 흔들기 + 3D 라이브러리(`@3d-dice/dice-box`) 통합 예시
  - [`games/dice/host/main.js`](../games/dice/host/main.js)
  - [`games/dice/mobile/main.js`](../games/dice/mobile/main.js)
- **SDK API 레퍼런스**: [`.docs/architecture/sdk-api.md`](architecture/sdk-api.md)
- **이벤트 프로토콜**: [`.docs/architecture/protocol.md`](architecture/protocol.md)
