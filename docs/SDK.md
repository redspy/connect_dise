# SDK 레퍼런스

게임을 구현할 때 사용하는 플랫폼 SDK 라이브러리 문서입니다.
모든 내용은 실제 소스코드를 기준으로 작성되었습니다.

---

## 목차

1. [HostSDK](#hostsdk)
2. [MobileSDK](#mobilesdk)
3. [HostBaseGame](#hostbasegame)
4. [MobileBaseGame](#mobilebasegame)
5. [P2PManager](#p2pmanager)
6. [공유 컴포넌트](#공유-컴포넌트)
   - [LobbyPanel](#lobbypanel)
   - [AppBar](#appbar)
   - [QRDisplay](#qrdisplay)
   - [QRScanner](#qrscanner)
   - [SensorManager](#sensormanager)
   - [LevelIndicator](#levelindicator)

---

## HostSDK

`platform/client/HostSDK.js`

PC 호스트 화면에서 사용하는 SDK. `EventTarget`을 상속하며, Socket.IO 연결과 세션 관리를 추상화합니다.

### 초기화

```js
import { HostSDK } from '../../platform/client/HostSDK.js';

const host = new HostSDK({ gameId: 'my-game' });
```

생성자 호출 시 자동으로 서버에 연결(`io()`)하고 `platform:createSession`을 emit합니다.

### 내부 상태

| 속성 | 타입 | 설명 |
|------|------|------|
| `gameId` | `string` | 게임 ID |
| `_sessionId` | `string` | 현재 세션 ID |
| `_players` | `Map<string, Player>` | 접속 중인 플레이어 맵 (id → player) |
| `_qrUrl` | `string` | 모바일 접속용 QR URL |
| `_socket` | `Socket` | Socket.IO 인스턴스 |
| `_messageHandlers` | `Map<string, Function>` | 게임 메시지 핸들러 |
| `_p2p` | `P2PManager \| null` | P2P 매니저 (WebRTC 지원 시 자동 초기화) |

### 플랫폼 이벤트 (`host.on`)

| 이벤트 | 콜백 인자 | 발생 시점 |
|--------|----------|----------|
| `sessionReady` | `{ sessionId: string, qrUrl: string }` | 세션 생성 완료, QR URL 준비 |
| `playerJoin` | `player: { id, color }` | 새 플레이어 입장 |
| `playerDisconnect` | `{ playerId: string }` | 플레이어 일시 연결 끊김 (grace period 시작 시점 — 최종 퇴장은 아직 아님) |
| `playerLeave` | `playerId: string` | 플레이어 연결 해제 (grace period 만료 후) |
| `playerRejoin` | `player: { id, color }` | 플레이어 재연결 (grace period 내 복귀) |
| `readyUpdate` | `{ readyCount: number, total: number }` | 준비 상태 변경 |
| `allReady` | `{}` | 모든 플레이어 준비 완료 |
| `reset` | `{}` | 세션 리셋 후 |
| `hostDisconnect` | `{}` | ⚠️ 등록은 되어 있으나 **사실상 도달 불가능**: 서버는 호스트 소켓이 끊긴 시점에 `hostDisconnected`를 세션 room에 브로드캐스트하는데, 이 시점엔 호스트 자신의 소켓이 이미 room에서 빠져 있어 실제로는 남아있는 모바일 클라이언트만 수신함. 호스트 쪽에서 이 이벤트를 쓰는 코드가 있다면 절대 호출되지 않는다고 가정할 것 |

`on()`은 `this`를 반환하므로 체이닝 가능합니다.

```js
host
  .on('sessionReady', ({ sessionId, qrUrl }) => { ... })
  .on('playerJoin', (player) => { ... })
  .on('allReady', () => { ... });
```

### 게임 메시지 수신 (`host.onMessage`)

모바일이 `sendToHost(type, payload)`로 보낸 메시지를 받습니다. 체이닝 가능.

```js
host.onMessage('launchSpin', (player, payload) => {
  // player: { id, color } — 실제 Player 객체 또는 { id: from } 폴백
  // payload: 모바일이 보낸 데이터
});
```

P2P DataChannel로 수신된 메시지도 동일한 핸들러로 라우팅됩니다.

### 메시지 전송

P2P DataChannel이 열려 있으면 P2P로 전송하고, 실패 시 Socket.IO로 폴백합니다.

```js
// 특정 플레이어에게 전송
host.sendToPlayer(playerId, 'eliminated', { rank: 2, reason: 'out-of-bounds' });

// 전체 플레이어에게 브로드캐스트
// 내부적으로 각 플레이어에게 개별 전송 (P2P 우선, Socket.IO 폴백)
host.broadcast('battleStart', { players: [...] });
```

> **주의**: `broadcast()`는 서버의 `game:broadcast` 이벤트를 사용하지 않고,
> `_players` Map을 순회하며 각 플레이어에게 `game:toPlayer`를 개별 emit합니다.
> 이는 P2P 채널이 열린 플레이어에게는 P2P로, 아닌 플레이어에게는 Socket.IO로 전송하기 위함입니다.

### 유틸리티 메서드

| 메서드 | 반환 타입 | 설명 |
|--------|----------|------|
| `getPlayers()` | `Player[]` | 현재 접속 중인 플레이어 배열 (Map values 복사) |
| `getSessionId()` | `string` | 현재 세션 ID |
| `getQRUrl()` | `string` | QR 코드로 표시할 URL |
| `resetSession()` | `void` | 세션 리셋 (`platform:reset` emit) |
| `kickPlayer(playerId)` | `void` | 해당 플레이어 강퇴 (`platform:kickPlayer` emit — 재연결 유예 없이 즉시 제거) |
| `socketId` | `string \| null` (getter) | 호스트 자신의 현재 Socket.IO 소켓 ID |
| `getRawSocket()` | `Socket` | Socket.IO 소켓 직접 접근 |

### QR URL 형식

```
{scheme}//{host}:{port}/games/{gameId}/mobile/?session={sessionId}
```

현재 브라우저의 `window.location` 기반으로 자동 생성됩니다.

---

## MobileSDK

`platform/client/MobileSDK.js`

모바일 브라우저에서 사용하는 SDK. URL 쿼리스트링의 `?session=` 값을 자동으로 읽어 세션에 입장합니다.

### 초기화

```js
import { MobileSDK } from '../../platform/client/MobileSDK.js';

const mobile = new MobileSDK();

// 호스트 없이 폰만으로 방을 만드는 기능을 지원하려면:
const mobile = new MobileSDK({
  onCreateRoom: () => { /* 숨김 host iframe을 띄워 세션을 생성하는 등 */ },
});
```

생성자 인자: `{ onCreateRoom?: () => void }`(둘 다 선택). `onCreateRoom`을 지정하면 `?session=` 없이 접속했을 때 뜨는 "방에 연결하기" 폴백 모달에 "🏠 새 방 만들기" 버튼이 추가로 노출됩니다 — MobileSDK 자신은 호스트리스 세션을 생성하는 방법을 모르므로, 실제 생성은 게임 쪽(숨김 host iframe 임베딩 등)이 담당하고 완료되면 `mobile.joinSession(sessionId)`로 결과만 넘겨받습니다.

생성자 호출 시:
1. URL에서 `?session=` 파라미터 추출
2. `io()` 연결
3. `SensorManager` 인스턴스 생성
4. 연결 전 QR 스캔 버튼 자동 표시

### 재연결 메커니즘

`sessionStorage`에 stable player ID를 저장합니다 (키: `_sdk_reconnect_{sessionId}`).
브라우저 새로고침 시 같은 탭에서 이전 player ID로 재연결을 시도합니다.

- 재연결 성공: `rejoin` 이벤트 발생 (화면 전환 없이 조용히 복귀)
- 신규 접속: `join` 이벤트 발생
- 호스트 연결 끊김 시: sessionStorage 키 삭제

### 플랫폼 이벤트 (`mobile.on`)

| 이벤트 | 콜백 인자 | 발생 시점 |
|--------|----------|----------|
| `connect` | `{}` | Socket.IO 연결 성공(최초 연결 및 자동 재연결 포함) |
| `disconnect` | `{}` | Socket.IO 연결 끊김 (QR 스캔 버튼 자동 노출 트리거) |
| `join` | `player: { id, color }` | 세션 입장 완료 (신규) |
| `rejoin` | `player: { id, color }` | 재연결 완료 (grace period 내 복귀) |
| `allReady` | `{}` | 모든 플레이어 준비 완료 |
| `reset` | `{}` | 세션 리셋 후 |
| `kicked` | `{}` | 호스트에 의해 강퇴됨 (앱이 자동으로 초기 화면으로 전환) |
| `hostDisconnect` | `{}` | 호스트 연결 종료 |
| `error` | `message: string` | 세션 없음 등 에러 |

`on()`은 `this`를 반환하므로 체이닝 가능합니다.

### 게임 메시지 수신 (`mobile.onMessage`)

호스트가 `sendToPlayer` 또는 `broadcast`로 보낸 메시지를 받습니다. 체이닝 가능.

```js
mobile.onMessage('battleStart', (payload) => {
  // payload: 호스트가 보낸 데이터
});
```

P2P DataChannel로 수신된 메시지도 동일한 핸들러로 라우팅됩니다.

### 메시지 전송

P2P DataChannel이 열려 있으면 P2P로 전송하고, 실패 시 Socket.IO로 폴백합니다.

```js
mobile.sendToHost('launchSpin', { rpm: 1500 });
```

### 준비 상태

```js
mobile.ready();
// 서버에 platform:playerReady emit
// allReady 조건 충족 시 전체 세션에 platform:allReady 브로드캐스트
```

### 센서

iOS에서는 반드시 사용자 제스처(버튼 클릭 등) 내에서 `requestSensors()`를 호출해야 합니다.

```js
const granted = await mobile.requestSensors();

if (granted) {
  mobile.onOrientation(({ alpha, beta, gamma }) => {
    // alpha: 나침반 방향 (0~360)
    // beta:  앞뒤 기울기 (-180~180)
    // gamma: 좌우 기울기 (-90~90)
  });

  mobile.onMotion(({ shakeMagnitude, acc }) => {
    // shakeMagnitude: 중력 제외 흔들기 크기 (max(0, mag - 9.8))
    // acc: accelerationIncludingGravity 원본 { x, y, z }
  });
}
```

### QR 스캐너

```js
await mobile.showQRScanner();
// 카메라 열고 QR 인식 → 해당 URL로 자동 이동
// BarcodeDetector 미지원 브라우저에서는 수동 URL 입력 폴백
```

### QR 스캔 버튼 자동 관리

MobileSDK는 연결 상태에 따라 QR 스캔 버튼을 자동으로 표시/숨김합니다:
- 연결 전 / `disconnect` / `hostDisconnected` → 버튼 표시 (화면 우상단 고정)
- `platform:joined` 수신 → 버튼 숨김

### 유틸리티 메서드

| 메서드 | 반환 타입 | 설명 |
|--------|----------|------|
| `getMyPlayer()` | `{ id, color } \| null` | 나 자신의 플레이어 정보 |
| `getSessionId()` | `string` | 현재 세션 ID |
| `joinSession(sessionId)` | `void` | 생성자 시점에 `?session=`이 없어 미확정 상태로 시작한 경우, 이미 연결된 소켓을 재사용해 사후에 세션 참가를 확정 (페이지 새로고침 불필요 — 호스트리스 "폰으로 방 만들기" 패턴에서 사용) |
| `socketId` | `string \| null` (getter) | 자신의 현재 Socket.IO 소켓 ID |
| `vibrate(pattern)` | `void` | 진동 패턴 (ms 배열). `navigator.vibrate` 래핑 |

---

## HostBaseGame

`platform/client/HostBaseGame.js`

호스트 게임의 베이스 클래스. 직접 HostSDK를 사용하는 대신 이 클래스를 상속하면 반복 코드를 줄일 수 있습니다.

### 초기화

```js
import { HostBaseGame } from '../../platform/client/HostBaseGame.js';

class MyGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, {
      overlayClass: 'my-overlay',    // 기본값: 'game-overlay'
      qrContainerId: 'qr-box',      // 기본값: null (자동 QR 비활성)
    });
  }
}
```

### 자동 관리 기능

- **플레이어 Map**: `this.players` (id → player), 입장/퇴장/재연결 시 자동 갱신
- **QR 렌더링**: `qrContainerId` 옵션 지정 시 `sessionReady`에서 자동 렌더링 (width: 200). `<game-lobby>`가 있으면 그쪽 QR을 우선 사용
- **오버레이 전환**: `setPhase(name)`으로 `data-phase` 기반 자동 전환
- **자동 리셋**: 게임 진행 중(`lobby`/`loading` 아닌 phase) 모든 플레이어가 퇴장하면 자동으로 `resetSession()` 호출
- **60초 유휴 자동 데모**: 로비 phase에서 60초간 아무 변화가 없고 `this._players.size === 0`이면, 게임의 `_demoSimulator`(또는 `demoSimulator`)에 `startDemo()`가 있을 경우 자동 호출. 실제 플레이어가 이미 있으면 절대 끼어들지 않으며, 게임별 수동 "🤖 데모 플레이 실행" 버튼 핸들러에는 이 가드가 자동 적용되지 않으므로 별도로 `if (this.playerCount > 0) return;`를 넣어야 함
- **iframe 임베드 브리지**: 이 호스트 페이지가 다른 페이지의 숨김 `<iframe>`으로 실행 중이면(`window.parent !== window`), 세션 생성 완료 시 부모 창에 `postMessage({ type: 'platform:embeddedSessionReady', sessionId, qrUrl }, location.origin)`을 자동 전송(호스트리스 "폰으로 방 만들기" 패턴에서 사용). iframe이 아니면 완전히 no-op

### 오버레이 컨벤션 (HTML)

```html
<!-- overlayClass="my-overlay" 기준 -->
<div class="my-overlay" data-phase="lobby">로비 UI</div>
<div class="my-overlay hidden" data-phase="game">게임 UI</div>
<div class="my-overlay hidden" data-phase="result">결과 UI</div>
<!-- data-phase 없는 요소는 setPhase 영향을 받지 않음 -->
```

`setPhase('game')` 호출 시:
- `data-phase="game"` → `hidden` 제거
- 나머지 `data-phase` 요소 → `hidden` 추가
- `data-phase` 속성이 없는 `.my-overlay` → `hidden` 추가

### 프로퍼티

| 프로퍼티 | 타입 | 설명 |
|---------|------|------|
| `sdk` | `HostSDK` | SDK 인스턴스 |
| `players` | `Map<string, Player>` | 플레이어 맵 (읽기 전용 권장) |
| `playerCount` | `number` | 현재 참가 인원 수 |
| `phase` | `string` | 현재 페이즈 이름 (초기값: `'loading'`) |

### SDK 단축 메서드

| 메서드 | 설명 |
|--------|------|
| `broadcast(type, payload)` | 전체 플레이어에게 메시지 전송 |
| `sendToPlayer(id, type, payload)` | 특정 플레이어에게 메시지 전송 |
| `onMessage(type, callback)` | 게임 메시지 핸들러 등록. 체이닝 가능 |
| `resetSession()` | 세션 리셋 |
| `kickPlayer(playerId)` | 해당 플레이어 강퇴 |
| `getPlayer(id)` | 특정 플레이어 객체 조회 |
| `getQRUrl()` | 현재 QR URL 반환 |
| `setPlayerName(id, name)` | 플레이어 닉네임 등록(재접속 배너에 이름 표시용 — 게임이 `setProfile` 수신 시 호출) |
| `renderLobbyPlayers(profilesMap?)` | `<game-lobby>`에 현재 플레이어 목록 렌더링 |
| `updateLobbyReady(readyCount)` | `<game-lobby>`의 준비 인원 텍스트·시작 버튼 상태 갱신 |

### 라이프사이클 훅

서브클래스에서 필요한 것만 override합니다.

| 훅 | 인자 | 호출 시점 |
|----|------|----------|
| `onSetup({ qrUrl, sessionId })` | `{ qrUrl: string, sessionId: string }` | 세션 준비 완료 (QR 렌더링 후) |
| `onPlayerJoin(player)` | `{ id, color }` | 플레이어 입장 (players에 이미 추가됨) |
| `onPlayerDisconnect(playerId)` | `string` | 플레이어 일시 연결 끊김 (grace period 시작 — 아직 players에서 제거되지 않음) |
| `onPlayerRejoin(player)` | `{ id, color }` | 플레이어 재연결 (players에 이미 갱신됨) |
| `onPlayerLeave(playerId)` | `string` | 플레이어 퇴장 (players에서 이미 제거됨) |
| `onReadyUpdate({ readyCount, total })` | `{ readyCount, total }` | 준비 상태 변경 |
| `onAllReady()` | - | 전원 준비 완료 |
| `onReset()` | - | 세션 리셋 (players는 SDK 상태로 복원됨, phase는 `'lobby'`로 초기화) |
| `onPhaseChange(from, to)` | `string, string` | `setPhase()` 호출 시 |

### 사용 예시

```js
class SpinGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'spin-overlay', qrContainerId: 'qr-box' });
  }

  async onSetup({ sessionId }) {
    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    // 로비 UI에 플레이어 표시
  }

  onAllReady() {
    this.setPhase('battle');
    this.broadcast('battleStart', { players: [...this.players.values()] });
  }

  onReset() {
    this.setPhase('lobby');
  }
}
```

---

## MobileBaseGame

`platform/client/MobileBaseGame.js`

모바일 게임의 베이스 클래스.

### 초기화

```js
import { MobileBaseGame } from '../../platform/client/MobileBaseGame.js';

class MyMobileGame extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, {
      screenClass: 'my-screen',    // 기본값: 'game-screen'
    });
  }
}
```

### 화면 전환

```js
this.showScreen('waiting');
```

`screenClass`를 가진 요소 중 `data-screen="name"`인 것만 표시, 나머지는 `hidden`.

```html
<div class="my-screen" data-screen="waiting">대기 중...</div>
<div class="my-screen hidden" data-screen="game">게임 화면</div>
<div class="my-screen hidden" data-screen="result">결과 화면</div>
```

### 프로퍼티

| 프로퍼티 | 타입 | 설명 |
|---------|------|------|
| `sdk` | `MobileSDK` | SDK 인스턴스 |
| `player` | `{ id, color } \| null` | 내 플레이어 정보 |
| `playerId` | `string \| null` | 내 플레이어 ID |
| `playerColor` | `string \| null` | 내 플레이어 색상 |

### SDK 단축 메서드

| 메서드 | 설명 |
|--------|------|
| `sendToHost(type, payload)` | 호스트에게 메시지 전송 |
| `ready()` | 준비 완료 신호 전송 |
| `onMessage(type, callback)` | 게임 메시지 핸들러 등록. 체이닝 가능 |
| `vibrate(pattern)` | 진동 패턴 |
| `requestSensors()` | 센서 권한 요청 (Promise) |
| `onOrientation(callback)` | 기울기 센서 등록 |
| `onMotion(callback)` | 모션 센서 등록 |

### 라이프사이클 훅

| 훅 | 인자 | 호출 시점 |
|----|------|----------|
| `onJoin(player)` | `{ id, color }` | 세션 입장 완료 (신규) |
| `onRejoin(player)` | `{ id, color }` | 재연결 완료 (기본: 아무것도 하지 않음, 현재 화면 유지) |
| `onAllReady()` | - | 전원 준비 완료 |
| `onReset()` | - | 세션 리셋 |
| `onHostDisconnect()` | - | 호스트 연결 끊김 (MobileSDK가 QR 스캔 버튼을 자동 표시) |
| `onKicked()` | - | 호스트에 의해 강퇴됨 (기본: 아무것도 하지 않음 — 필요시 안내 메시지 등을 override) |

### 자동 홈 버튼

모든 화면 좌하단에 작은 "⌂" 버튼을 자동 삽입합니다(`_injectHomeButton()`, 게임 코드에서 별도 호출 불필요). 클릭 시 확인창을 띄운 뒤 `/`(게임 선택 화면)로 이동 — 준비 대기 중이거나 게임 도중 언제든 나갈 수 있는 탈출구입니다.

### 사용 예시

```js
class MyMobileGame extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'my-screen' });
  }

  onJoin(player) {
    this.showScreen('waiting');
  }

  onAllReady() {
    this.showScreen('game');
  }

  onReset() {
    this.showScreen('waiting');
  }
}
```

---

## P2PManager

`platform/client/P2PManager.js`

WebRTC DataChannel을 이용한 호스트-모바일 직접 연결(P2P) 매니저.
같은 LAN 환경에서 지연을 줄이기 위해 사용됩니다.

> **게임 개발자가 직접 사용할 필요 없음**: HostSDK와 MobileSDK 내부에서 자동으로 초기화됩니다.
> P2P 연결 가능 시 `sendToPlayer`/`sendToHost`/`broadcast`가 자동으로 DataChannel을 우선 사용하고,
> 실패 시 Socket.IO로 폴백합니다.

### 동작 방식

```
Host                        Server                      Mobile
  │ p2p:offer (SDP) ───────▶│───────▶ p2p:offer        │
  │                         │                            │
  │◀─────── p2p:answer ─────│◀──── p2p:answer (SDP)     │
  │                         │                            │
  │◀────── p2p:ice ─────────│◀──── p2p:ice (candidate)  │
  │ p2p:ice (candidate) ───▶│───────▶ p2p:ice           │
  │                         │                            │
  │═══════ DataChannel (game) ═════════════════════════│
```

### DataChannel 메시지 포맷

```json
{ "type": "launchSpin", "payload": { "rpm": 1500 } }
```

### 정적 메서드

| 메서드 | 설명 |
|--------|------|
| `P2PManager.isSupported()` | `RTCPeerConnection` 지원 여부 확인 |

### STUN 서버

```js
iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
```

---

## 공유 컴포넌트

### LobbyPanel

`platform/client/shared/LobbyPanel.js`

호스트 로비 화면 공통 Web Component(`<game-lobby>`). QR/방코드, 참가자 카드 그리드(강퇴 버튼 포함), 준비 상태 텍스트, 시작 버튼을 전담합니다. **모든 게임은 커스텀 로비 UI를 직접 구현하지 말고 이 컴포넌트를 써야 합니다.**

#### HTML 설정

```html
<!-- 기본 -->
<game-lobby title="게임이름" min-players="2"></game-lobby>

<!-- 게임 설명/설정 슬롯: 자식 요소가 QR 옆 사이드 영역으로 자동 이동 -->
<game-lobby title="Dobble" min-players="2">
  <div class="my-rules">...</div>
  <select id="sel-mode">...</select>
</game-lobby>

<!-- 배너 이미지(선택) -->
<game-lobby title="눈치 10단" min-players="2" banner="/games/nunchi-ten/assets/main.png"></game-lobby>
```

#### JS API

```js
const lobby = document.querySelector('game-lobby');
lobby.onStart = () => game._startGame();      // 시작 버튼 클릭 콜백
lobby.onKick = (playerId) => game.kickPlayer(playerId); // 참가자 카드의 강퇴(✕) 버튼 클릭 콜백
lobby.setSession(sessionId, qrUrl);           // 방 코드 + URL 표시
lobby.renderPlayers(playersMap, profilesMap); // 참가자 카드 그리드 렌더링
lobby.setReady(readyCount, total);            // 준비 상태 텍스트 갱신
lobby.updateStartButton(readyCount, total);   // 시작 버튼 활성화/텍스트 갱신 (반환값: canStart boolean)
lobby.qrContainer;                            // QR 렌더링 대상 <div> (renderQR에 그대로 전달)
```

`HostBaseGame`을 상속하면 `renderLobbyPlayers()`/`updateLobbyReady()`가 이 컴포넌트를 자동으로 찾아 위임 호출하므로 대부분의 게임은 `lobby.onStart`/`lobby.onKick` 연결 정도만 직접 하면 됩니다.

#### 테마 CSS 변수

```css
body.my-game-host {
  --lobby-accent: var(--my-game-accent);      /* 시작 버튼 등 강조색 — 반드시 오버라이드할 것 */
  --lobby-accent-dim: ...;
  /* --lobby-panel-bg, --lobby-panel2-bg, --lobby-border, --lobby-text, --lobby-sub, --lobby-avatar-size 도 조정 가능 */
}
```

오버라이드를 생략하면 플랫폼 기본값(골드 `#f59e0b`)으로 조용히 폴백되므로, 게임 고유 강조색이 골드가 아니라면 반드시 연결해야 합니다.

---

### AppBar

`platform/client/shared/AppBar.js`
`platform/client/shared/appbar.css`

게임 호스트 화면의 공통 상단 바 컴포넌트. 모든 게임이 공유하는 뒤로가기·타이틀·다시하기 UI를 제공합니다.

`AppBar`는 `customElements.define('game-appbar', AppBar)`로 등록된 **Web Component**입니다. `new AppBar(...)`처럼 클래스를 직접 생성자 호출하면 안 됩니다 — 커스텀 `constructor()`가 없어 인자가 전부 무시되고, DOM에 붙지 않아 `connectedCallback()`(실제 렌더링)이 실행되지 않습니다. 반드시 HTML 태그로 배치한 뒤, JS에서는 `querySelector`로 찾아 속성/콜백만 연결하세요. `HostBaseGame.js`가 이미 `AppBar.js`를 import해 커스텀 엘리먼트를 등록해주므로 게임 쪽에서 별도 import도 불필요합니다.

#### HTML 설정

```html
<!-- body에 배치. title/back-url/back-label은 HTML 속성으로 지정 -->
<game-appbar
  title="눈치 10단"
  back-url="/"
  back-label="← 로비"
></game-appbar>
```

#### 초기화

```js
const appbar = document.querySelector('game-appbar');
appbar.onRestart = () => game.resetSession(); // 다시하기 버튼 등록 (미설정 시 버튼 자체가 생성되지 않음)
appbar.setTitle('새 타이틀');                  // 타이틀 변경 (선택)
```

#### 오른쪽 슬롯 활용 (게임별 정보 추가)

```js
// 게임별 커스텀 요소를 AppBar 오른쪽에 삽입
const roundEl = document.createElement('div');
roundEl.id = 'round-display';
roundEl.className = 'round-display';
roundEl.textContent = 'Round - / 10';
document.querySelector('game-appbar').prependRight(roundEl);
// 이후 document.getElementById('round-display').textContent = ... 로 업데이트
```

#### 메서드 / 프로퍼티

| 멤버 | 타입 | 설명 |
|------|------|------|
| `setTitle(text)` | `void` | 타이틀 텍스트 변경 |
| `prependRight(el)` | `void` | 오른쪽 슬롯 맨 앞에 요소 삽입 (다시하기 버튼 왼쪽) |
| `restartBtn` | `HTMLButtonElement \| null` | 다시하기 버튼 참조 (onRestart 미사용 시 null) |
| `rightSlot` | `HTMLDivElement` | 오른쪽 슬롯 div 직접 참조 |

#### 테마 CSS 변수

각 게임의 `body` 클래스에 아래 변수를 정의하면 AppBar 스타일이 게임 테마에 맞게 적용됩니다.

```css
body.my-game-host {
  --appbar-border: #2a3654;           /* 구분선 색상 */
  --appbar-title-color: #f59e0b;      /* 타이틀 색상 */
  --appbar-btn-color: #94a3b8;        /* 버튼 기본 색상 */
  --appbar-btn-border: #2a3654;       /* 버튼 테두리 */
  /* 호버 색상은 기본적으로 --appbar-title-color 값 사용 */
}
```

---

### QRDisplay

`platform/client/shared/QRDisplay.js`

QR 코드를 Canvas에 렌더링하는 유틸리티. `qrcode` 라이브러리를 래핑합니다.

```js
import { renderQR } from '../../platform/client/shared/QRDisplay.js';

const canvas = await renderQR(containerElement, url, {
  width: 200,          // 기본값: 200
  centerText: 'SCAN',  // 기본값: null (중앙 라벨 없음)
});
```

**기능**:
- QR 코드 렌더링 (error correction level: H, 최대 30% 손상 복구)
- 색상: 다크 `#1C5435`, 라이트 `#FFFFFF`
- `centerText` 지정 시 QR 중앙에 텍스트 라벨 삽입 (둥근 흰 배경 + 녹색 테두리/텍스트)
- **롱프레스** (600ms 이상) 시 QR URL을 클립보드에 복사 + 토스트 표시

---

### QRScanner

`platform/client/shared/QRScanner.js`

카메라로 QR 코드를 스캔하여 URL 문자열을 반환하는 유틸리티.

```js
import { QRScanner } from '../../platform/client/shared/QRScanner.js';

const scanner = new QRScanner();
const url = await scanner.scan();  // 취소 시 null
if (url) window.location.href = url;
```

> MobileSDK에서 `showQRScanner()`를 통해 내부적으로 사용합니다.

**우선순위**:
1. `BarcodeDetector` API (Chrome Android, iOS 17+, Samsung Internet) — rAF 루프로 실시간 감지
2. 미지원 브라우저 → 수동 URL 입력 폴백

**카메라 컨트롤** (하드웨어 지원 시):
- 줌 조절 (±)
- 노출 보정 (±EV)

---

### SensorManager

`platform/client/shared/SensorManager.js`

iOS DeviceMotion/Orientation 권한 요청 + 이벤트 래핑.

> MobileSDK 내부에서 자동 생성됩니다. 직접 사용할 필요 없음.

```js
import { SensorManager } from '../../platform/client/shared/SensorManager.js';

const sensor = new SensorManager();
```

**메서드**:

| 메서드 | 설명 |
|--------|------|
| `requestPermission()` | 센서 권한 요청. iOS 13+에서는 `DeviceMotionEvent.requestPermission()` 호출. 비-iOS는 항상 `true` 반환 |
| `onOrientation(callback)` | `deviceorientation` 이벤트 등록. 콜백: `{ alpha, beta, gamma }` (미지원 값은 `0` 폴백) |
| `onMotion(callback)` | `devicemotion` 이벤트 등록. 콜백: `{ shakeMagnitude, acc }`. `shakeMagnitude`는 `max(0, √(x²+y²+z²) - 9.8)` |
| `destroy()` | 이벤트 리스너 제거 |

---

### LevelIndicator

`platform/client/shared/LevelIndicator.js`

기울기를 시각적으로 보여주는 버블 UI 컴포넌트.

```js
import { LevelIndicator } from '../../platform/client/shared/LevelIndicator.js';

const level = new LevelIndicator({
  bubble:  document.getElementById('level-bubble'),
  betaEl:  document.getElementById('level-beta'),   // 선택적 (β 값 텍스트 표시)
  gammaEl: document.getElementById('level-gamma'),  // 선택적 (γ 값 텍스트 표시)
});

mobile.onOrientation(({ beta, gamma }) => {
  level.update(beta, gamma);
});
```

**동작**:
- `BOWL_RADIUS`: 46px 고정
- 기울기 ±45° 범위를 ±46px로 매핑
- 실제 기울기와 **반대 방향**으로 버블 이동 (실제 수평계처럼 동작)
- `dist > BOWL_RADIUS * 0.4` 일 때 버블에 `tilted` CSS 클래스 추가

---

## Player 객체 구조

서버에서 생성되어 SDK 전체에서 공통으로 사용되는 플레이어 객체:

```ts
interface Player {
  id: string;      // stable player ID (재연결 시 유지됨, 게임 데이터 키로 사용)
  socketId: string; // 현재 소켓 ID (서버 내부용, 재연결 시 변경됨)
  color: string;    // 서버가 입장 순서에 따라 자동 배정
}
```

### 색상 배정

서버가 입장 순서에 따라 6색을 순환 배정합니다:

```
#FF4444 → #33B5E5 → #99CC00 → #FFBB33 → #AA66CC → #FF00A2
```

---

## P2P와 Socket.IO 이중 전송 구조

```
sendToPlayer / sendToHost / broadcast
       │
       ├─ P2P DataChannel open? ──▶ DataChannel.send(JSON)
       │       ✓ return true
       │
       └─ P2P 불가 ──▶ Socket.IO emit (game:toPlayer / game:toHost)
               ✓ return false (SDK가 자동 폴백)
```

게임 개발자는 전송 경로를 신경 쓸 필요 없이 `sendToPlayer`/`sendToHost`/`broadcast`만 호출하면 됩니다.
