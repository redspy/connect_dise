# Design: WebRTC P2P 로컬 네트워크 직접 통신

> 기능 ID: webrtc-p2p
> 작성일: 2026-03-10
> Plan 문서: docs/01-plan/features/webrtc-p2p.plan.md

---

## 1. 아키텍처 개요

### 통신 레이어 분리

```
┌─────────────────────────────────────────────────────────────┐
│  레이어 1: 플랫폼 (Socket.io — 원격 서버)                      │
│  - 세션 생성/입장, 플레이어 준비, 리셋, 호스트 연결 끊김          │
│  - WebRTC 시그널링 relay (offer/answer/ICE — 소량, 1회성)      │
├─────────────────────────────────────────────────────────────┤
│  레이어 2: 게임 데이터 (WebRTC DataChannel — LAN 직접)          │
│  - 센서 데이터 (motion/orientation) — 고빈도                   │
│  - 게임 액션 메시지 (sendToHost, sendToPlayer, broadcast)      │
│  - P2P 불가 시 → 레이어 1(Socket.io)로 자동 폴백               │
└─────────────────────────────────────────────────────────────┘
```

### 전체 연결 다이어그램

```
          원격 서버 (Socket.io)
          ┌──────────────────┐
          │  SessionManager  │
          │  + P2P Signaling │
          └────────┬─────────┘
         시그널링만  │  시그널링만
    ┌──────────────┼──────────────┐
    ▼              │              ▼
[호스트 브라우저]   │        [모바일 A]
    │              │              │
    └──────────────┼──────────────┘
         WebRTC DataChannel (LAN 직접, <5ms)
              [모바일 B] [모바일 C] ...
```

---

## 2. 컴포넌트 설계

### 2.1 신규 파일

#### `platform/client/P2PManager.js`

WebRTC 연결 생명주기 전체를 관리하는 핵심 클래스.

```
P2PManager
├── _socket: Socket                    // 시그널링용 Socket.io 소켓
├── _connections: Map<peerId, RTCPeerConnection>
├── _channels: Map<peerId, RTCDataChannel>
├── _callbacks: { onMessage, onChannelOpen, onChannelClose }
│
├── constructor(socket, callbacks)
│
├── [Host용] initiateConnection(peerId, sessionId)
│   → RTCPeerConnection 생성
│   → DataChannel('game') 생성
│   → createOffer() → socket.emit('p2p:offer', { to: peerId, sdp, sessionId })
│   → ICE 핸들러 등록
│
├── [Mobile용] acceptOffer(peerId, sessionId, sdp)
│   → RTCPeerConnection 생성
│   → setRemoteDescription(offer)
│   → createAnswer() → socket.emit('p2p:answer', { sdp, sessionId })
│   → ICE 핸들러 등록
│   → ondatachannel 이벤트로 채널 수신
│
├── setRemoteAnswer(peerId, sdp)        // 호스트: answer 수신 처리
├── addIceCandidate(peerId, candidate)  // 양쪽: ICE 후보 추가
├── send(peerId, type, payload)         // DataChannel로 메시지 전송
├── isReady(peerId) → boolean           // DataChannel open 여부
├── closeConnection(peerId)             // 연결 정리
└── closeAll()                          // 전체 연결 정리
```

**RTCPeerConnection 설정:**
```js
const config = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  // LAN 환경에서는 STUN 불필요하나, 원격 폴백을 위해 포함
};
```

**DataChannel 설정:**
```js
// 기본값 (ordered: true, reliable)
// LAN에서는 사실상 무손실이므로 단순하게 유지
const channel = pc.createDataChannel('game');
```

**메시지 포맷 (DataChannel):**
```json
{ "type": "sensor:motion", "payload": { "x": 1.2, "y": 0.3, "z": 9.8, "ts": 1709123456789 } }
```

---

### 2.2 변경 파일

#### `platform/client/HostSDK.js` 변경사항

추가 필드:
```
_p2p: P2PManager | null
```

변경 메서드:

| 메서드 | 변경 내용 |
|--------|-----------|
| `constructor` | `_p2p = null` 초기화 |
| `_setup()` | `platform:playerJoined` 후 P2P offer 시작; 시그널링 이벤트 리스너 추가 |
| `sendToPlayer(id, type, payload)` | P2P ready → DataChannel 사용; 아니면 Socket.io fallback |
| `broadcast(type, payload)` | 모든 플레이어에 P2P/fallback 라우팅 |

새 메서드:
- `_initP2P()` — P2PManager 생성 및 Socket.io 시그널링 이벤트 연결
- `_onP2PMessage(peerId, type, payload)` — DataChannel 수신 → `_messageHandlers` 경유

추가 Socket.io 이벤트 리스너 (내부):
```
p2p:answer   { from: playerId, sdp }  → p2p.setRemoteAnswer(from, sdp)
p2p:ice      { from: playerId, candidate } → p2p.addIceCandidate(from, candidate)
```

#### `platform/client/MobileSDK.js` 변경사항

추가 필드:
```
_p2p: P2PManager | null
_hostPeerId: string  // 시그널링에서 호스트 식별용 고정 상수 'host'
```

변경 메서드:

| 메서드 | 변경 내용 |
|--------|-----------|
| `constructor` | `_p2p = null` 초기화 |
| `_setup()` | `platform:joined` 후 P2P 준비; 시그널링 이벤트 리스너 추가 |
| `sendToHost(type, payload)` | P2P ready → DataChannel 사용; 아니면 Socket.io fallback |

새 메서드:
- `_initP2P()` — P2PManager 생성 및 Socket.io 시그널링 이벤트 연결
- `_onP2PMessage(type, payload)` — DataChannel 수신 → `_messageHandlers` 경유

추가 Socket.io 이벤트 리스너 (내부):
```
p2p:offer  { sdp }       → p2p.acceptOffer('host', sessionId, sdp)
p2p:ice    { candidate } → p2p.addIceCandidate('host', candidate)
```

#### `server/index.js` 변경사항

추가 이벤트 핸들러 3개:

```js
// 호스트 → 특정 플레이어에게 offer 전달
socket.on('p2p:offer', ({ sessionId, to, sdp }) => {
  const socketId = sm.getSocketId(sessionId, to);
  if (socketId) io.to(socketId).emit('p2p:offer', { sdp });
});

// 플레이어 → 호스트에게 answer 전달
socket.on('p2p:answer', ({ sessionId, sdp }) => {
  const session = sm.getSession(sessionId);
  const info = sm.socketToSession.get(socket.id);
  if (session && info) {
    io.to(session.hostSocketId).emit('p2p:answer', { from: info.playerId, sdp });
  }
});

// ICE 후보 양방향 relay
// to 있음 → 호스트→플레이어, to 없음 → 플레이어→호스트
socket.on('p2p:ice', ({ sessionId, to, candidate }) => {
  if (to) {
    const socketId = sm.getSocketId(sessionId, to);
    if (socketId) io.to(socketId).emit('p2p:ice', { candidate });
  } else {
    const session = sm.getSession(sessionId);
    const info = sm.socketToSession.get(socket.id);
    if (session && info) {
      io.to(session.hostSocketId).emit('p2p:ice', { from: info.playerId, candidate });
    }
  }
});
```

---

## 3. 시그널링 시퀀스 다이어그램

```
호스트 브라우저          원격 서버           모바일 브라우저
      │                     │                     │
      │ ← platform:playerJoined ─────────────────  │
      │                     │                     │
  [P2P 시작]                │                     │
  createPeerConnection()    │                     │
  createDataChannel('game') │                     │
  createOffer()             │                     │
      │── p2p:offer ────────▶                     │
      │   {to, sdp, sessionId}                    │
      │                     │── p2p:offer ────────▶
      │                     │   {sdp}             │
      │                     │              [offer 수신]
      │                     │          createPeerConnection()
      │                     │          setRemoteDescription()
      │                     │          createAnswer()
      │                     ◀── p2p:answer ────────│
      │                     │   {sdp, sessionId}   │
      ◀── p2p:answer ───────│                     │
      │   {from, sdp}        │                     │
  setRemoteDescription()    │                     │
      │                     │                     │
   [ICE 교환 — 동시 진행]    │                     │
      │── p2p:ice ──────────▶── p2p:ice ──────────▶
      ◀── p2p:ice ──────────◀── p2p:ice ──────────│
      │                     │                     │
   [ICE 완료 — LAN IP 선택]  │                     │
      │◀═══════ DataChannel 'game' OPEN ══════════▶│
      │                     │                     │
  [P2P 게임 데이터 직접 전송]  │                     │
      │◀══ sensor:motion ═══════════════════════════│
      │◀══ sensor:motion ═══════════════════════════│
```

---

## 4. 메시지 라우팅 로직

### HostSDK.sendToPlayer() 의사코드

```
sendToPlayer(playerId, type, payload):
  if _p2p.isReady(playerId):
    _p2p.send(playerId, type, payload)    // DataChannel 경유
  else:
    socket.emit('game:toPlayer', ...)     // Socket.io fallback
```

### MobileSDK.sendToHost() 의사코드

```
sendToHost(type, payload):
  if _p2p.isReady('host'):
    _p2p.send('host', type, payload)      // DataChannel 경유
  else:
    socket.emit('game:toHost', ...)       // Socket.io fallback
```

### HostSDK.broadcast() 의사코드

```
broadcast(type, payload):
  for each player in _players:
    if _p2p.isReady(player.id):
      _p2p.send(player.id, type, payload)
    else:
      socket.emit('game:toPlayer', { to: player.id, ... })
```

---

## 5. P2P 연결 상태 관리

### 연결 상태 전이

```
[없음]
  │ platform:playerJoined
  ▼
[시그널링 중] — offer/answer/ICE 교환
  │ DataChannel open
  ▼
[P2P 활성] ──── 게임 데이터 직접 전송
  │ 플레이어 disconnect 또는 WebRTC 오류
  ▼
[Socket.io 폴백] ── 원격 서버 경유 (기존 방식)
  │ 플레이어 재연결 후 재시그널링
  ▼
[P2P 활성] (재수립)
```

### 플레이어 재연결 처리

- `platform:playerRejoined` 이벤트 수신 시 기존 RTCPeerConnection 닫고 재시그널링
- 기존 Socket.io 재연결 로직 (`reconnectId`) 은 그대로 유지

### 호스트 disconnect 처리

- `hostDisconnected` 이벤트 → `p2p.closeAll()` 호출 → 모든 DataChannel 정리

---

## 6. 기존 게임 코드 영향

**변경 불필요** (SDK API 동일):

| 게임 | 사용 중인 SDK 메서드 | 영향 |
|------|---------------------|------|
| spin-battle | `sendToHost('tilt', data)`, `broadcast(...)` | 없음 |
| nunchi-ten | `sendToHost('submitCard', data)`, `sendToPlayer(...)` | 없음 |

HostBaseGame, MobileBaseGame 도 변경 불필요 (HostSDK/MobileSDK 위에 올라있으므로).

---

## 7. 폴백 전략

| 상황 | 폴백 동작 |
|------|-----------|
| WebRTC 미지원 브라우저 | 감지 후 P2P 비활성, Socket.io만 사용 |
| ICE 연결 실패 (5초 타임아웃) | `_p2p.isReady()` = false → Socket.io fallback |
| DataChannel 오류 | `onerror` → 해당 플레이어 Socket.io fallback |
| 방화벽으로 P2P 차단 | STUN 실패 → 자동 Socket.io fallback |
| iOS Safari (구버전) | `RTCPeerConnection` 없음 → Socket.io fallback |

---

## 8. 파일 변경 요약

```
신규:
  platform/client/P2PManager.js           (새 파일)

변경:
  platform/client/HostSDK.js              (P2P 통합)
  platform/client/MobileSDK.js            (P2P 통합)
  server/index.js                         (시그널링 이벤트 3개 추가)

변경 불필요:
  platform/client/HostBaseGame.js
  platform/client/MobileBaseGame.js
  platform/server/SessionManager.js
  games/spin-battle/**
  games/nunchi-ten/**
```

---

## 9. 구현 순서 (Do 페이즈)

1. **`P2PManager.js`** — WebRTC 핵심 로직 (독립 구현 가능)
2. **`server/index.js`** — 시그널링 이벤트 3개 추가 (단순 relay)
3. **`HostSDK.js`** — P2PManager 통합 (playerJoined 후 offer 시작)
4. **`MobileSDK.js`** — P2PManager 통합 (joined 후 offer 대기)
5. **브라우저 테스트** — 같은 LAN에서 DataChannel open 확인
6. **기존 게임 회귀 테스트** — spin-battle, nunchi-ten 동작 확인

---

## 10. 검증 기준 (Gap Analysis 기준)

| 항목 | 검증 방법 |
|------|-----------|
| P2PManager 파일 존재 | 파일 존재 확인 |
| initiateConnection / acceptOffer 구현 | 메서드 존재 + RTCPeerConnection 생성 코드 |
| server 시그널링 이벤트 3개 | `p2p:offer`, `p2p:answer`, `p2p:ice` handler 존재 |
| HostSDK sendToPlayer P2P 분기 | `isReady()` 조건부 분기 코드 존재 |
| MobileSDK sendToHost P2P 분기 | `isReady()` 조건부 분기 코드 존재 |
| Socket.io fallback 코드 | 분기의 else 절에 기존 socket.emit 존재 |
| 기존 게임 코드 무수정 | spin-battle, nunchi-ten 파일 미변경 |
