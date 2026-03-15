# SDK API (구현 기준)

## HostSDK
파일: `platform/client/HostSDK.js`

주요 메서드:
- `on(event, cb)`
- `onMessage(type, cb)`
- `sendToPlayer(playerId, type, payload)`
- `broadcast(type, payload)`
- `resetSession()`
- `getPlayers()` / `getSessionId()` / `getQRUrl()` / `getRawSocket()`

이벤트:
- `sessionReady`, `playerJoin`, `playerLeave`, `playerRejoin`
- `readyUpdate`, `allReady`, `reset`, `hostDisconnect`

특징:
- P2P 지원 환경에서 전송은 DataChannel 우선
- 실패 시 Socket.IO 폴백

## MobileSDK
파일: `platform/client/MobileSDK.js`

주요 메서드:
- `on(event, cb)`
- `onMessage(type, cb)`
- `sendToHost(type, payload)`
- `ready()`
- `requestSensors()` / `onOrientation(cb)` / `onMotion(cb)`
- `vibrate(pattern)`
- `getMyPlayer()` / `getSessionId()` / `showQRScanner()`

이벤트:
- `join`, `rejoin`, `allReady`, `reset`, `hostDisconnect`, `error`

특징:
- `sessionStorage` 기반 reconnect ID 자동 처리
- 상단 QR 스캔 버튼 자동 표시/숨김

## Base Game
- `HostBaseGame`: 플레이어 맵, phase 전환, QR 자동 렌더링
- `MobileBaseGame`: screen 전환, join/rejoin/reset 공통 처리
