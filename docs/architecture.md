# 플랫폼 아키텍처

## 설계 철학

**플랫폼(인프라)과 게임(콘텐츠)을 완전히 분리**하는 SDK 패턴을 사용합니다.

- **플랫폼**: 세션 생성, 플레이어 입장/퇴장, 준비 상태, 메시지 라우팅 담당
- **게임**: 플랫폼 SDK를 통해 통신하고, 게임 로직만 구현

서버는 게임 내용을 전혀 알지 못합니다. 메시지 타입과 페이로드를 투명하게 중계할 뿐입니다.

---

## 전체 구조

```
                ┌─────────────────────────────────────────┐
                │              Browser (PC Host)           │
                │  ┌──────────┐     ┌───────────────────┐ │
                │  │ HostSDK  │────▶│   Game Host Code  │ │
                │  └──────────┘     │  (SpinGame, etc.) │ │
                │       │           └───────────────────┘ │
                └───────┼─────────────────────────────────┘
                        │ Socket.IO
                ┌───────┼─────────────────────────────────┐
                │       ▼           Node.js Server        │
                │  ┌───────────────────────────────────┐  │
                │  │  Express + Socket.IO              │  │
                │  │  ┌─────────────────────────────┐  │  │
                │  │  │      SessionManager          │  │  │
                │  │  │  - 세션 생성/삭제            │  │  │
                │  │  │  - 플레이어 관리             │  │  │
                │  │  │  - 준비 상태 추적            │  │  │
                │  │  └─────────────────────────────┘  │  │
                │  └───────────────────────────────────┘  │
                └───────┬─────────────────────────────────┘
                        │ Socket.IO
                ┌───────┼─────────────────────────────────┐
                │       ▼        Browser (Mobile)          │
                │  ┌───────────┐    ┌────────────────────┐│
                │  │ MobileSDK │───▶│ Game Mobile Code   ││
                │  └───────────┘    └────────────────────┘│
                └─────────────────────────────────────────┘
```

---

## 디렉토리 구조

```
connect_dise/
├── index.html                    # 게임 선택 로비 (진입점)
├── src/
│   ├── lobby.js                  # 로비 — games/registry.js를 읽어 카드 렌더링
│   └── style.css                 # 공통 CSS
│
├── platform/                     # 플랫폼 레이어 (게임 무관)
│   ├── client/
│   │   ├── HostSDK.js            # 호스트용 클라이언트 SDK
│   │   ├── MobileSDK.js          # 모바일용 클라이언트 SDK
│   │   ├── HostBaseGame.js       # 호스트 게임 베이스 클래스
│   │   ├── MobileBaseGame.js     # 모바일 게임 베이스 클래스
│   │   └── shared/
│   │       ├── SensorManager.js  # iOS DeviceMotion 권한 요청 + 이벤트 래핑
│   │       ├── LevelIndicator.js # 기울기 버블 UI 컴포넌트
│   │       └── QRDisplay.js      # qrcode 라이브러리 래핑 유틸
│   └── server/
│       └── SessionManager.js     # 서버 측 세션·플레이어 상태 관리
│
├── games/
│   ├── registry.js               # 게임 목록 (로비에서 참조)
│   ├── spin-battle/              # 팽이 배틀 (Three.js 3D)
│   │   ├── host/
│   │   └── mobile/
│   ├── nunchi-ten/               # 눈치 10단 (보드게임)
│   │   ├── host/
│   │   └── mobile/
│   └── dice/                     # 주사위 (미완성)
│       ├── host/
│       └── mobile/
│
├── server/
│   └── index.js                  # Express + Socket.IO 서버
└── vite.config.js                # 멀티 엔트리 빌드 설정
```

---

## 세션 라이프사이클

```
1. 호스트 접속
   └─▶ platform:createSession { gameId }
       └─▶ server: SessionManager.createSession()
           └─▶ platform:sessionCreated { sessionId, localIp }
               └─▶ HostSDK: QR URL 생성, 'sessionReady' 이벤트 발생

2. 모바일 입장 (QR 스캔)
   └─▶ platform:joinSession { sessionId }
       └─▶ server: SessionManager.joinSession() → 색상 부여
           ├─▶ platform:joined { player }           → 모바일에 전달
           └─▶ platform:playerJoined { player }     → 호스트에 전달

3. 준비 완료
   └─▶ platform:playerReady { sessionId }
       └─▶ server: readyPlayers에 추가
           ├─▶ platform:readyUpdate { readyCount, totalCount }  → 호스트
           └─▶ (모두 준비 시) platform:allReady {}  → 전체 세션

4. 게임 중 메시지
   ├─▶ game:toHost { sessionId, type, payload }     (모바일 → 서버 → 호스트)
   ├─▶ game:toPlayer { to, type, payload }          (호스트 → 서버 → 특정 모바일)
   └─▶ game:broadcast { sessionId, type, payload }  (호스트 → 서버 → 전체 모바일)

5. 리셋
   └─▶ platform:reset { sessionId }
       └─▶ server: readyPlayers 초기화
           └─▶ platform:reset {} → 전체 세션

6. 연결 해제
   ├─▶ (호스트) sessionId에 속한 모든 소켓에 hostDisconnected
   └─▶ (모바일) 호스트에 platform:playerLeft, platform:readyUpdate
```

---

## 플레이어 색상

서버가 입장 순서에 따라 자동으로 색상을 배정합니다 (게임 코드에서 직접 지정 불필요).

```
순서: #FF4444 → #33B5E5 → #99CC00 → #FFBB33 → #AA66CC → #FF00A2 (6색 순환)
```

`player.color` 속성으로 접근합니다.

---

## Vite 멀티 엔트리 빌드

각 게임의 host/mobile 페이지가 독립적인 HTML 엔트리로 빌드됩니다. 새 게임 추가 시 `vite.config.js`에 엔트리를 추가해야 합니다.

```js
// vite.config.js
input: {
  lobby:            'index.html',
  spinBattleHost:   'games/spin-battle/host/index.html',
  spinBattleMobile: 'games/spin-battle/mobile/index.html',
  nunchiTenHost:    'games/nunchi-ten/host/index.html',
  nunchiTenMobile:  'games/nunchi-ten/mobile/index.html',
}
```

---

## Socket.IO 이벤트 프로토콜

`platform:*` 이벤트는 서버가 직접 처리하고, `game:*` 이벤트는 투명하게 중계합니다.

### platform:* (서버 직접 처리)

| 이벤트 | 방향 | 페이로드 |
|--------|------|---------|
| `platform:createSession` | 호스트 → 서버 | `{ gameId }` |
| `platform:sessionCreated` | 서버 → 호스트 | `{ sessionId, localIp }` |
| `platform:joinSession` | 모바일 → 서버 | `{ sessionId }` |
| `platform:joined` | 서버 → 모바일 | `{ player: { id, color } }` |
| `platform:playerJoined` | 서버 → 호스트 | `{ player: { id, color } }` |
| `platform:playerReady` | 모바일 → 서버 | `{ sessionId }` |
| `platform:readyUpdate` | 서버 → 호스트 | `{ readyCount, totalCount }` |
| `platform:allReady` | 서버 → 전체 세션 | `{}` |
| `platform:reset` | 호스트 → 서버 / 서버 → 전체 | `{ sessionId }` / `{}` |
| `platform:playerLeft` | 서버 → 호스트 | `{ playerId }` |
| `hostDisconnected` | 서버 → 전체 소켓 | `{}` |

### game:* (서버 투명 중계)

| 이벤트 | 방향 | 페이로드 |
|--------|------|---------|
| `game:toHost` | 모바일 → 서버 | `{ sessionId, type, payload }` |
| `game:fromPlayer` | 서버 → 호스트 | `{ from: socketId, type, payload }` |
| `game:toPlayer` | 호스트 → 서버 | `{ to: socketId, type, payload }` |
| `game:broadcast` | 호스트 → 서버 | `{ sessionId, type, payload }` |
| `game:fromHost` | 서버 → 모바일 | `{ type, payload }` |

---

## SDK API 레퍼런스

### HostSDK (`platform/client/HostSDK.js`)

PC 호스트 화면에서 사용. `EventTarget` 상속, 생성자 호출 시 자동 연결 및 세션 생성.

```js
const host = new HostSDK({ gameId: 'my-game' });
```

**플랫폼 이벤트**

| 이벤트 | 콜백 인자 | 발생 시점 |
|--------|----------|----------|
| `sessionReady` | `{ sessionId, qrUrl }` | 세션 생성 + QR 준비 |
| `playerJoin` | `player` | 플레이어 입장 |
| `playerLeave` | `playerId` | 플레이어 연결 해제 |
| `readyUpdate` | `{ readyCount, total }` | 준비 상태 변경 |
| `allReady` | `{}` | 모든 플레이어 준비 완료 |
| `reset` | `{}` | 세션 리셋 후 |

`on()`은 `this`를 반환하므로 체이닝 가능.

**게임 메시지 수신**

```js
host.onMessage('launchSpin', (player, payload) => { ... });
```

**메시지 전송**

```js
host.sendToPlayer(playerId, 'eliminated', { rank: 2 });
host.broadcast('battleStart', { players: [...] });
```

**유틸**

```js
host.getPlayers()    // Player[] — 현재 접속 중인 플레이어 배열
host.getSessionId()  // string
host.getQRUrl()      // string
host.resetSession()  // readyPlayers 초기화 + platform:reset 브로드캐스트
host.getRawSocket()  // Socket.IO 소켓 직접 접근 (고급)
```

---

### MobileSDK (`platform/client/MobileSDK.js`)

모바일 브라우저에서 사용. URL 쿼리스트링의 `?session=` 값을 자동으로 읽어 세션 입장.

```js
const mobile = new MobileSDK();
```

**플랫폼 이벤트**

| 이벤트 | 콜백 인자 | 발생 시점 |
|--------|----------|----------|
| `join` | `player` | 세션 입장 완료 (`player.id`, `player.color` 포함) |
| `allReady` | `{}` | 모든 플레이어 준비 완료 |
| `reset` | `{}` | 세션 리셋 후 |
| `hostDisconnect` | `{}` | 호스트 연결 종료 |
| `error` | `message` | 세션 없음 등 에러 |

**게임 메시지 수신**

```js
mobile.onMessage('battleStart', (payload) => { ... });
```

**메시지 전송**

```js
mobile.sendToHost('launchSpin', { rpm: 1500 });
```

**준비 상태**

```js
mobile.ready();  // allReady 조건 충족 시 전체 세션에 브로드캐스트
```

**센서** (iOS는 반드시 사용자 제스처 내에서 호출)

```js
const granted = await mobile.requestSensors();
if (granted) {
  mobile.onOrientation(({ alpha, beta, gamma }) => { ... });
  // beta: 앞뒤 기울기, gamma: 좌우 기울기
  mobile.onMotion(({ acceleration, shakeMagnitude }) => { ... });
}
```

**기타**

```js
mobile.vibrate([200, 100, 200]);  // 진동 패턴 (ms)
mobile.getMyPlayer()              // { id, color }
mobile.getSessionId()             // string
```

---

## 공유 컴포넌트

### QRDisplay (`platform/client/shared/QRDisplay.js`)

```js
import { renderQR } from '../../../platform/client/shared/QRDisplay.js';
await renderQR(containerElement, url, { width: 240 });
```

### LevelIndicator (`platform/client/shared/LevelIndicator.js`)

기울기를 시각적으로 보여주는 버블 UI. `BOWL_RADIUS` 46px 고정.

```js
import { LevelIndicator } from '../../../platform/client/shared/LevelIndicator.js';

const level = new LevelIndicator({
  bubble: document.getElementById('level-bubble'),
  betaEl: document.getElementById('level-beta'),   // 선택적
  gammaEl: document.getElementById('level-gamma'), // 선택적
});

mobile.onOrientation(({ beta, gamma }) => {
  level.update(beta, gamma);
});
```

---

## BaseGame 패턴

직접 SDK를 사용하는 대신 BaseGame 클래스를 상속하면 반복 코드를 줄일 수 있습니다.

### HostBaseGame (`platform/client/HostBaseGame.js`)

- 플레이어 Map 자동 관리: `this.players`, `this.playerCount`, `this.getPlayer(id)`
- `setPhase(name)` → `.overlayClass` 요소 중 `data-phase="name"`만 표시
- QR 자동 렌더링 (`qrContainerId` 옵션)
- SDK 단축 메서드: `broadcast`, `sendToPlayer`, `onMessage`, `resetSession`

**라이프사이클 훅**

| 훅 | 호출 시점 |
|----|----------|
| `onSetup({ sessionId })` | 세션 준비 완료 |
| `onPlayerJoin(player)` | 플레이어 입장 |
| `onPlayerLeave(playerId)` | 플레이어 퇴장 |
| `onReadyUpdate({ readyCount, total })` | 준비 상태 변경 |
| `onAllReady()` | 전원 준비 완료 |
| `onReset()` | 세션 리셋 |
| `onPhaseChange(name)` | `setPhase` 호출 시 |

**오버레이 컨벤션**

```html
<div class="spin-overlay" data-phase="lobby">...</div>
<div class="spin-overlay hidden" data-phase="battle">...</div>
<!-- data-phase 없는 오버레이는 setPhase 영향 안 받음 -->
```

**예시**

```js
class MyGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'my-overlay', qrContainerId: 'qr-box' });
  }
  async onSetup({ sessionId }) { this.setPhase('lobby'); }
  onPlayerJoin(player) { /* 플레이어 UI 업데이트 */ }
  onAllReady() { this.setPhase('game'); }
  onReset() { this.setPhase('lobby'); }
}
```

### MobileBaseGame (`platform/client/MobileBaseGame.js`)

- `showScreen(name)` → `.screenClass` 요소 중 `data-screen="name"`만 표시
- `this.player`, `this.playerId`, `this.playerColor`

**라이프사이클 훅**: `onJoin`, `onAllReady`, `onReset`, `onHostDisconnect`

---

## 게임 메시지 예시 (팽이 배틀)

| 방향 | type | payload | 용도 |
|------|------|---------|------|
| 모바일 → 호스트 | `launchSpin` | `{ rpm: number }` | 발사 RPM 전달 |
| 모바일 → 호스트 | `tiltInput` | `{ tiltX: number, tiltZ: number }` | 기울기 조종 (-1~1) |
| 모바일 → 호스트 | `requestReset` | `{}` | 리셋 요청 |
| 호스트 → 전체 | `battleStart` | `{ players: Player[] }` | 배틀 시작 |
| 호스트 → 특정 | `eliminated` | `{ rank: number, reason: string }` | 탈락 통보 |
| 호스트 → 전체 | `gameOver` | `{ rankings: Player[] }` | 게임 종료 |
