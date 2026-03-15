# SDK API 레퍼런스

## HostSDK

`platform/client/HostSDK.js`

PC 호스트 화면에서 사용하는 SDK입니다. `EventTarget`을 상속하며, Socket.IO 연결과 세션 관리를 추상화합니다.

### 초기화

```js
import { HostSDK } from '../../../platform/client/HostSDK.js';

const host = new HostSDK({ gameId: 'my-game' });
```

생성자 호출 시 자동으로 서버에 연결하고 세션을 생성합니다.

---

### 플랫폼 이벤트 (`host.on`)

| 이벤트 | 콜백 인자 | 발생 시점 |
|--------|----------|----------|
| `sessionReady` | `{ sessionId, qrUrl }` | 세션이 생성되고 QR URL이 준비됐을 때 |
| `playerJoin` | `player` | 새 플레이어가 입장했을 때 |
| `playerLeave` | `playerId` | 플레이어가 완전 제거됐을 때 (유예 만료) |
| `playerRejoin` | `player` | 플레이어가 재연결했을 때 (유예 중 복귀) |
| `readyUpdate` | `{ readyCount, total }` | 준비 상태가 바뀔 때마다 |
| `allReady` | `{}` | 모든 플레이어가 준비 완료됐을 때 |
| `reset` | `{}` | 세션 리셋 후 |
| `hostDisconnect` | `{}` | (예비) 호스트 소켓 이벤트 |

```js
host.on('sessionReady', ({ sessionId, qrUrl }) => { ... });
host.on('playerJoin', (player) => { ... });
host.on('playerRejoin', (player) => { ... });
host.on('allReady', () => { ... });
```

`on()`은 `this`를 반환하므로 체이닝이 가능합니다.

---

### 게임 메시지 수신 (`host.onMessage`)

모바일이 `sendToHost(type, payload)`로 보낸 메시지를 받습니다.

```js
host.onMessage('launchSpin', (player, payload) => {
  // player: { id, color }
  // payload: 모바일이 보낸 데이터
  console.log(player.color, payload.rpm);
});
```

---

### 메시지 전송

```js
// 특정 플레이어에게 전송
host.sendToPlayer(playerId, 'eliminated', { rank: 2, reason: 'out-of-bounds' });

// 전체 플레이어에게 브로드캐스트
host.broadcast('battleStart', { players: [...] });
```

---

### 유틸

```js
host.getPlayers()    // Player[] — 현재 접속 중인 플레이어 배열
host.getSessionId()  // string — 현재 세션 ID
host.getQRUrl()      // string — QR 코드로 표시할 URL
host.resetSession()  // 세션 리셋 (readyPlayers 초기화 + 전체에 platform:reset 브로드캐스트)
host.getRawSocket()  // Socket.IO 소켓 직접 접근 (고급)
```

---

## MobileSDK

`platform/client/MobileSDK.js`

모바일 브라우저에서 사용하는 SDK입니다. URL 쿼리스트링의 `?session=` 값을 자동으로 읽어 세션에 입장합니다.

### 초기화

```js
import { MobileSDK } from '../../../platform/client/MobileSDK.js';

const mobile = new MobileSDK();
```

생성자 호출 시 자동으로 서버에 연결하고 세션에 입장을 시도합니다. sessionStorage에 저장된 reconnectId가 있으면 자동으로 재연결을 시도합니다.

---

### 플랫폼 이벤트 (`mobile.on`)

| 이벤트 | 콜백 인자 | 발생 시점 |
|--------|----------|----------|
| `join` | `player` | 세션 입장 완료 (`player.id`, `player.color` 포함) |
| `rejoin` | `player` | 재연결 성공 (기존 플레이어 정보 복원) |
| `allReady` | `{}` | 모든 플레이어가 준비 완료됐을 때 |
| `reset` | `{}` | 세션 리셋 후 |
| `hostDisconnect` | `{}` | 호스트 연결 종료 시 |
| `error` | `message` | 세션 없음 등 에러 |

```js
mobile.on('join', (player) => {
  console.log('내 색상:', player.color);
});

mobile.on('rejoin', (player) => {
  console.log('재연결 성공:', player.id);
});
```

---

### 게임 메시지 수신 (`mobile.onMessage`)

호스트가 `sendToPlayer` 또는 `broadcast`로 보낸 메시지를 받습니다.

```js
mobile.onMessage('battleStart', (payload) => {
  // payload: 호스트가 보낸 데이터
});

mobile.onMessage('eliminated', ({ rank, reason }) => { ... });
```

---

### 메시지 전송

```js
// 호스트에게 메시지 전송
mobile.sendToHost('launchSpin', { rpm: 1500 });
mobile.sendToHost('tiltInput', { tiltX: 0.3, tiltZ: -0.1 });
```

---

### 준비 상태

```js
// 플레이어가 준비됐음을 서버에 알림
// allReady 조건이 충족되면 platform:allReady가 전체 세션에 브로드캐스트됨
mobile.ready();
```

---

### 센서

iOS에서는 반드시 사용자 제스처(버튼 클릭 등) 내에서 `requestSensors()`를 호출해야 합니다.

```js
const granted = await mobile.requestSensors();

if (granted) {
  // 방향 센서 (기울기)
  mobile.onOrientation(({ alpha, beta, gamma }) => {
    // beta: 앞뒤 기울기 (-180 ~ 180)
    // gamma: 좌우 기울기 (-90 ~ 90)
  });

  // 모션 센서 (가속도 + 흔들기 강도)
  mobile.onMotion(({ acceleration, shakeMagnitude }) => {
    // shakeMagnitude: 흔들기 크기 (합산 가속도)
  });
}
```

---

### 기타

```js
mobile.vibrate([200, 100, 200]);  // 진동 패턴 (ms 단위)
mobile.getMyPlayer()              // { id, color } — 나 자신의 플레이어 정보
mobile.getSessionId()             // string — 현재 세션 ID
```

---

## HostBaseGame

`platform/client/HostBaseGame.js`

호스트 게임의 베이스 클래스입니다. HostSDK를 래핑하여 플레이어 추적, 페이즈 관리, QR 자동 렌더링 등 공통 기능을 제공합니다.

### 초기화

```js
import { HostSDK } from '../../../platform/client/HostSDK.js';
import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';

class MyGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, {
      overlayClass: 'game-overlay',    // 페이즈 오버레이 CSS 클래스
      qrContainerId: 'qr-container',   // QR 자동 렌더링 요소 ID
    });
  }
}

const sdk = new HostSDK({ gameId: 'my-game' });
const game = new MyGame(sdk);
```

### 라이프사이클 훅

서브클래스에서 필요한 메서드만 override합니다.

| 훅 | 인자 | 호출 시점 |
|----|------|----------|
| `onSetup({ qrUrl, sessionId })` | 세션 정보 | 세션 생성 + QR 렌더링 완료 후 |
| `onPlayerJoin(player)` | `{ id, color }` | 새 플레이어 입장 (players에 이미 추가됨) |
| `onPlayerRejoin(player)` | `{ id, color }` | 플레이어 재연결 |
| `onPlayerLeave(playerId)` | `string` | 플레이어 퇴장 (players에서 이미 제거됨) |
| `onReadyUpdate({ readyCount, total })` | 준비 현황 | 준비 상태 변경 |
| `onAllReady()` | - | 전원 준비 완료 |
| `onReset()` | - | 세션 리셋 (players 자동 복원됨) |
| `onPhaseChange(from, to)` | 이전/현재 | `setPhase()` 호출 후 |

### 페이즈 관리

```js
this.setPhase('lobby');   // overlayClass를 가진 요소 중 data-phase="lobby"만 표시
this.setPhase('battle');  // data-phase="battle"만 표시
this.phase;               // 현재 페이즈 이름
```

### SDK 바로가기

```js
this.broadcast(type, payload)          // 전체 브로드캐스트
this.sendToPlayer(id, type, payload)   // 특정 플레이어에게 전송
this.onMessage(type, callback)         // 게임 메시지 핸들러 등록
this.resetSession()                    // 세션 리셋
this.players                           // Map<id, player> — 현재 플레이어
this.playerCount                       // 현재 인원 수
this.getPlayer(id)                     // 특정 플레이어 조회
```

---

## MobileBaseGame

`platform/client/MobileBaseGame.js`

모바일 게임의 베이스 클래스입니다. MobileSDK를 래핑하여 화면 전환, 플레이어 정보 관리 등 공통 기능을 제공합니다.

### 초기화

```js
import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';

class MyMobileGame extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, {
      screenClass: 'game-screen',  // 화면 전환 CSS 클래스
    });
  }
}

const sdk = new MobileSDK();
const game = new MyMobileGame(sdk);
```

### 라이프사이클 훅

| 훅 | 인자 | 호출 시점 |
|----|------|----------|
| `onJoin(player)` | `{ id, color }` | 세션 입장 완료 |
| `onRejoin(player)` | `{ id, color }` | 재연결 성공 (화면 유지) |
| `onAllReady()` | - | 전원 준비 완료 |
| `onReset()` | - | 세션 리셋 |
| `onHostDisconnect()` | - | 호스트 연결 끊김 |

### 화면 관리

```js
this.showScreen('waiting');  // screenClass를 가진 요소 중 data-screen="waiting"만 표시
this.showScreen('game');     // data-screen="game"만 표시
```

### SDK 바로가기

```js
this.sendToHost(type, payload)    // 호스트에게 전송
this.ready()                      // 준비 완료
this.onMessage(type, callback)    // 게임 메시지 핸들러 등록
this.vibrate(pattern)             // 진동
this.requestSensors()             // 센서 권한 요청
this.onOrientation(callback)      // 기울기 센서
this.onMotion(callback)           // 모션 센서
this.player                       // { id, color }
this.playerId                     // string
this.playerColor                  // string
```

---

## 공유 컴포넌트

### QRDisplay (`platform/client/shared/QRDisplay.js`)

```js
import { renderQR } from '../../../platform/client/shared/QRDisplay.js';

await renderQR(containerElement, url, { width: 240 });
// containerElement 안에 QR 코드 이미지가 렌더링됩니다
```

### LevelIndicator (`platform/client/shared/LevelIndicator.js`)

기울기를 시각적으로 보여주는 버블 UI 컴포넌트입니다.

```js
import { LevelIndicator } from '../../../platform/client/shared/LevelIndicator.js';

const level = new LevelIndicator({
  bubble: document.getElementById('level-bubble'),
  betaEl: document.getElementById('level-beta'),   // 선택적
  gammaEl: document.getElementById('level-gamma'), // 선택적
});

// onOrientation 콜백 안에서 호출
mobile.onOrientation(({ beta, gamma }) => {
  level.update(beta, gamma);
});
```

`BOWL_RADIUS`는 46px로 고정되어 있으며, 기울기가 커질수록 버블이 그릇 테두리 쪽으로 이동합니다.

### SensorManager (`platform/client/shared/SensorManager.js`)

iOS DeviceMotion/Orientation 권한 요청과 센서 이벤트를 래핑합니다. MobileSDK 내부에서 사용되므로 직접 import할 필요는 거의 없습니다.
