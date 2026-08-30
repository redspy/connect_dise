# Socket.IO 이벤트 프로토콜

서버는 게임 내용을 알지 못합니다.
`platform:*` 이벤트는 서버가 직접 처리하고, `game:*` 이벤트는 투명하게 중계합니다.

모든 내용은 `server/index.js`와 `platform/server/SessionManager.js` 실제 구현을 기준으로 작성되었습니다.

---

## 목차

1. [세션 라이프사이클](#세션-라이프사이클)
2. [platform:* 이벤트](#platform-이벤트)
3. [game:* 이벤트](#game-이벤트)
4. [p2p:* 이벤트](#p2p-이벤트)
5. [연결 해제와 재연결](#연결-해제와-재연결)

---

## 세션 라이프사이클

```
1. 호스트 접속
   └─▶ platform:createSession { gameId }
       └─▶ SessionManager.createSession()
           └─▶ platform:sessionCreated { sessionId, localIp }

2. 모바일 입장 (QR 스캔)
   └─▶ platform:joinSession { sessionId, reconnectId? }
       └─▶ SessionManager.joinSession()
           ├─ (신규) platform:joined { player, reconnected: false } → 모바일
           │         platform:playerJoined { player }               → 호스트
           └─ (재연결) platform:joined { player, reconnected: true } → 모바일
                       platform:playerRejoined { player }            → 호스트

3. 준비 완료
   └─▶ platform:playerReady { sessionId }
       └─▶ SessionManager.setReady()
           ├─▶ platform:readyUpdate { readyCount, totalCount }      → 호스트
           └─▶ (모두 준비 시) platform:allReady {}                  → 전체 세션

4. 게임 메시지 (투명 중계)
   ├─▶ game:toHost     → game:fromPlayer  (모바일 → 서버 → 호스트)
   ├─▶ game:toPlayer   → game:fromHost    (호스트 → 서버 → 모바일)
   └─▶ game:broadcast  → game:fromHost    (호스트 → 서버 → 전체 모바일)

5. 리셋
   └─▶ platform:reset { sessionId }
       └─▶ SessionManager.resetSession() (readyPlayers 초기화)
           └─▶ platform:reset {} → 전체 세션

6. 연결 해제
   ├─▶ (호스트 disconnect) → hostDisconnected → 전체 세션, 세션 즉시 삭제
   └─▶ (모바일 disconnect) → 5분 유예 기간
       ├─ (유예 내 재연결) → platform:joined { reconnected: true }
       └─ (유예 만료)     → platform:playerLeft + platform:readyUpdate → 호스트
```

---

## platform:* 이벤트

서버가 직접 처리하는 플랫폼 이벤트입니다.

### 세션 생성

```
호스트 → 서버
platform:createSession
{ gameId: string }
```

```
서버 → 호스트
platform:sessionCreated
{ sessionId: string, localIp: string }
```

- `sessionId`: 6자리 랜덤 영숫자 (대문자)
- `localIp`: 서버의 LAN IP (WSL/Hyper-V 인터페이스 제외)
- 호스트 소켓은 자동으로 `sessionId` room에 join

---

### 플레이어 입장

```
모바일 → 서버
platform:joinSession
{ sessionId: string, reconnectId?: string | null }
```

- `reconnectId`: 이전 stable player ID (재연결 시 sessionStorage에서 전달)

- `player` 페이로드 실제 구조: `{ id: string, socketId: string, color: string }`. `socketId`는 서버 내부 라우팅(직접 메시지 전송)에 쓰이는 현재 소켓 ID로, 재연결 때마다 바뀝니다 — 게임 로직에서 플레이어를 식별하는 키로는 항상 안정적인 `id`(stable player ID)를 쓰고 `socketId`는 사용하지 마세요.
- 재연결 하이재킹 방지: `reconnectId`로 지목한 플레이어가 **실제로 연결이 끊긴 상태(grace period 진입 상태)** 가 아니면 서버가 재연결을 거부합니다(연결이 살아있는 플레이어의 자리를 다른 소켓이 가로채는 것을 방지).

**신규 입장 시**:

```
서버 → 모바일
platform:joined
{ player: { id, socketId, color }, reconnected: false }
```

```
서버 → 호스트
platform:playerJoined
{ player: { id, socketId, color } }
```

**재연결 시** (`reconnectId`로 기존 플레이어 매칭):

```
서버 → 모바일
platform:joined
{ player: { id, socketId, color }, reconnected: true }
```

```
서버 → 호스트
platform:playerRejoined
{ player: { id, socketId, color } }
```

**실패 시** (세션 없음):

```
서버 → 모바일
error
"Session not found or invalid"
```

---

### 준비 완료

```
모바일 → 서버
platform:playerReady
{ sessionId: string }
```

```
서버 → 호스트
platform:readyUpdate
{ readyCount: number, totalCount: number }
```

```
서버 → 전체 세션 (조건: readyCount === totalCount && totalCount > 0)
platform:allReady
{}
```

---

### 세션 리셋

```
호스트 → 서버
platform:reset
{ sessionId: string }
```

```
서버 → 전체 세션
platform:reset
{}
```

- `readyPlayers` Set 초기화
- 플레이어 목록은 유지됨

---

### 강퇴

```
호스트 → 서버
platform:kickPlayer
{ sessionId: string, playerId: string }
```

```
서버 → 해당 플레이어
platform:kicked
{}
```

```
서버 → 호스트
platform:playerLeft
{ playerId: string }
```

```
서버 → 호스트
platform:readyUpdate
{ readyCount: number, totalCount: number }
```

- 세션에서 해당 플레이어를 즉시 제거(재연결 유예 없음)
- `MobileSDK`는 `kicked` 이벤트 수신 시 앱을 초기 화면(홈)으로 자동 전환

---

### 서버 측 권한 검증 (모든 세션 스코프 이벤트 공통)

`sessionId`를 페이로드로 받는 모든 이벤트(`platform:reset`, `platform:kickPlayer`, `platform:playerReady`, `game:toHost`, `game:toPlayer`, `game:broadcast`, `p2p:*`)는 서버가 **소켓의 실제 세션 소속과 역할**을 `socketToSession` 매핑으로 재검증합니다 — 페이로드의 `sessionId`를 그대로 신뢰하지 않습니다. 다른 세션을 대상으로 리셋/강퇴/메시지 전송을 시도하면 서버가 조용히 무시합니다(별도 에러 응답 없음). 호스트 전용 이벤트(`platform:reset`, `platform:kickPlayer`, `game:toPlayer`, `game:broadcast`, `p2p:offer`)는 발신자 역할이 `host`인지도 함께 확인합니다.

---

### 플레이어 일시 연결 끊김

모바일 소켓 disconnect 시 즉시 발생합니다 (grace period 시작).

```
서버 → 호스트
platform:playerDisconnected
{ playerId: string }
```

> 이 이벤트는 grace period 중 일시적 연결 끊김을 알립니다.
> 최종 퇴장은 grace period 만료 후 `platform:playerLeft`로 전달됩니다.

---

### 플레이어 최종 퇴장

Grace period (5분) 만료 후 재연결하지 않은 경우:

```
서버 → 호스트
platform:playerLeft
{ playerId: string }
```

```
서버 → 호스트
platform:readyUpdate
{ readyCount: number, totalCount: number }
```

---

### 호스트 연결 해제

```
서버 → 세션 내 전체 소켓
hostDisconnected
{}
```

- 세션 즉시 삭제
- 모든 플레이어의 socketToSession 매핑 제거

---

## game:* 이벤트

서버가 투명하게 중계하는 게임 메시지입니다.
`type`과 `payload`는 게임이 자유롭게 정의합니다.

### 모바일 → 호스트

```
모바일 → 서버
game:toHost
{ sessionId: string, type: string, payload: any }
```

```
서버 → 호스트
game:fromPlayer
{ from: string (stable playerId), type: string, payload: any }
```

> `from`은 소켓 ID가 아니라 **stable player ID**입니다.

---

### 호스트 → 특정 모바일

```
호스트 → 서버
game:toPlayer
{ sessionId: string, to: string (stable playerId), type: string, payload: any }
```

```
서버 → 해당 모바일
game:fromHost
{ type: string, payload: any }
```

> 서버는 `SessionManager.getSocketId()`로 stable playerId → 현재 socketId를 변환합니다.

---

### 호스트 → 전체 모바일

```
호스트 → 서버
game:broadcast
{ sessionId: string, type: string, payload: any }
```

```
서버 → 세션 내 모든 모바일 (각각에게 개별 emit)
game:fromHost
{ type: string, payload: any }
```

> 서버는 `session.players`를 순회하며 각 플레이어의 `socketId`로 개별 emit합니다.

---

## p2p:* 이벤트

WebRTC P2P 연결 수립을 위한 시그널링 이벤트입니다.
서버는 SDP와 ICE candidate를 단순 중계합니다.

### Offer (호스트 → 모바일)

```
호스트 → 서버
p2p:offer
{ sessionId: string, to: string (stable playerId), sdp: RTCSessionDescription }
```

```
서버 → 해당 모바일
p2p:offer
{ sdp: RTCSessionDescription }
```

---

### Answer (모바일 → 호스트)

```
모바일 → 서버
p2p:answer
{ sessionId: string, sdp: RTCSessionDescription }
```

```
서버 → 호스트
p2p:answer
{ from: string (stable playerId), sdp: RTCSessionDescription }
```

---

### ICE Candidate (양방향)

**호스트 → 모바일** (`to` 필드 있음):

```
호스트 → 서버
p2p:ice
{ sessionId: string, to: string (stable playerId), candidate: RTCIceCandidateInit }
```

```
서버 → 해당 모바일
p2p:ice
{ candidate: RTCIceCandidateInit }
```

**모바일 → 호스트** (`to` 필드 없음):

```
모바일 → 서버
p2p:ice
{ sessionId: string, candidate: RTCIceCandidateInit }
```

```
서버 → 호스트
p2p:ice
{ from: string (stable playerId), candidate: RTCIceCandidateInit }
```

---

## 연결 해제와 재연결

### 재연결 유예 기간 (Grace Period)

| 항목 | 값 |
|------|---|
| 유예 시간 | 5분 (300초) (`RECONNECT_GRACE_MS`) |
| 대상 | 모바일 플레이어만 (호스트 disconnect 시 세션 즉시 삭제) |

### 재연결 흐름

```
1. 모바일 소켓 disconnect
   └─▶ server: removeSocket() → 유예 타이머 시작
       └─▶ platform:playerDisconnected { playerId } → 호스트

2-A. 유예 기간 내 재연결
   └─▶ platform:joinSession { sessionId, reconnectId: stablePlayerId }
       └─▶ SessionManager: 기존 player.socketId를 새 socketId로 교체
           ├─▶ 유예 타이머 취소
           ├─▶ platform:joined { player, reconnected: true } → 모바일
           └─▶ platform:playerRejoined { player } → 호스트

2-B. 유예 기간 만료
   └─▶ server: finalizePlayerRemoval()
       ├─▶ session.players에서 제거
       ├─▶ session.readyPlayers에서 제거
       ├─▶ platform:playerLeft { playerId } → 호스트
       └─▶ platform:readyUpdate { readyCount, totalCount } → 호스트
```

### Stable Player ID

- 서버가 `joinSession()` 시 생성하는 8자리 랜덤 영숫자 (대문자)
- 소켓 ID와 별도로 관리되며, 재연결 시에도 유지됨
- 게임 데이터의 키로 사용 (플레이어 점수, 상태 등)
- 모바일은 `sessionStorage`에 저장 (키: `_sdk_reconnect_{sessionId}`)

### 플레이어 색상

서버가 입장 순서에 따라 6색을 순환 배정합니다:

```
인덱스 0: #FF4444 (빨강)
인덱스 1: #33B5E5 (파랑)
인덱스 2: #99CC00 (초록)
인덱스 3: #FFBB33 (노랑)
인덱스 4: #AA66CC (보라)
인덱스 5: #FF00A2 (분홍)
```

---

## 전체 이벤트 요약

### 클라이언트 → 서버

| 이벤트 | 발신자 | 페이로드 |
|--------|--------|---------|
| `platform:createSession` | 호스트 | `{ gameId }` |
| `platform:joinSession` | 모바일 | `{ sessionId, reconnectId? }` |
| `platform:playerReady` | 모바일 | `{ sessionId }` |
| `platform:reset` | 호스트 | `{ sessionId }` |
| `platform:kickPlayer` | 호스트 | `{ sessionId, playerId }` |
| `game:toHost` | 모바일 | `{ sessionId, type, payload }` |
| `game:toPlayer` | 호스트 | `{ sessionId, to, type, payload }` |
| `game:broadcast` | 호스트 | `{ sessionId, type, payload }` |
| `p2p:offer` | 호스트 | `{ sessionId, to, sdp }` |
| `p2p:answer` | 모바일 | `{ sessionId, sdp }` |
| `p2p:ice` | 양쪽 | `{ sessionId, to?, candidate }` |

### 서버 → 클라이언트

| 이벤트 | 수신자 | 페이로드 |
|--------|--------|---------|
| `platform:sessionCreated` | 호스트 | `{ sessionId, localIp }` |
| `platform:joined` | 모바일 | `{ player, reconnected }` |
| `platform:playerJoined` | 호스트 | `{ player }` |
| `platform:playerRejoined` | 호스트 | `{ player }` |
| `platform:playerDisconnected` | 호스트 | `{ playerId }` |
| `platform:playerLeft` | 호스트 | `{ playerId }` |
| `platform:readyUpdate` | 호스트 | `{ readyCount, totalCount }` |
| `platform:allReady` | 전체 세션 | `{}` |
| `platform:reset` | 전체 세션 | `{}` |
| `platform:kicked` | 해당 플레이어 | `{}` |
| `hostDisconnected` | 전체 세션 | `{}` |
| `game:fromPlayer` | 호스트 | `{ from, type, payload }` |
| `game:fromHost` | 모바일 | `{ type, payload }` |
| `error` | 모바일 | `string` |
| `p2p:offer` | 모바일 | `{ sdp }` |
| `p2p:answer` | 호스트 | `{ from, sdp }` |
| `p2p:ice` | 양쪽 | `{ from?, candidate }` |

---

## 게임별 메시지 타입 예시 (구현 반영)

### Dixit (`games/dixit`)

모바일 -> 호스트
- `setProfile` `{ nickname }`
- `submitClue` `{ cardId, clue }`
- `submitCard` `{ cardId }`
- `submitVote` `{ cardId }`

호스트 -> 모바일
- `playerListUpdated` `{ players }`
- `roundStarted` `{ round, storytellerId }`
- `dealHand` `{ hand }`
- `clueSubmitted` `{ clue }`
- `votingStarted` `{ clue, boardCards }`
- `roundResult` `{ storytellerCardId, boardCards, cardOwnerMap, clue, deltas, totals, scoringCase }`
- `gameFinished` `{ rankings }`
- `rejoinState` `{ phase, players, round, storytellerId, clue, hand, ... }`
