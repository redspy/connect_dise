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
| `playerLeave` | `playerId` | 플레이어가 연결을 끊었을 때 |
| `readyUpdate` | `{ readyCount, total }` | 준비 상태가 바뀔 때마다 |
| `allReady` | `{}` | 모든 플레이어가 준비 완료됐을 때 |
| `reset` | `{}` | 세션 리셋 후 |
| `hostDisconnect` | `{}` | (예비) 호스트 소켓 이벤트 |

```js
host.on('sessionReady', ({ sessionId, qrUrl }) => { ... });
host.on('playerJoin', (player) => { ... });
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

생성자 호출 시 자동으로 서버에 연결하고 세션에 입장을 시도합니다.

---

### 플랫폼 이벤트 (`mobile.on`)

| 이벤트 | 콜백 인자 | 발생 시점 |
|--------|----------|----------|
| `join` | `player` | 세션 입장 완료 (`player.id`, `player.color` 포함) |
| `allReady` | `{}` | 모든 플레이어가 준비 완료됐을 때 |
| `reset` | `{}` | 세션 리셋 후 |
| `hostDisconnect` | `{}` | 호스트 연결 종료 시 |
| `error` | `message` | 세션 없음 등 에러 |

```js
mobile.on('join', (player) => {
  console.log('내 색상:', player.color);
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
