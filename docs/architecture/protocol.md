# Socket.IO 이벤트 프로토콜

서버는 게임 내용을 알지 못합니다. `platform:*` 이벤트는 서버가 직접 처리하고, `game:*` 이벤트는 투명하게 중계합니다.

---

## platform:* 이벤트 (서버가 직접 처리)

### 세션 생성

```
호스트 → 서버
platform:createSession
{ gameId: string }

서버 → 호스트
platform:sessionCreated
{ sessionId: string, localIp: string }
```

### 플레이어 입장

```
모바일 → 서버
platform:joinSession
{ sessionId: string }

서버 → 모바일
platform:joined
{ player: { id: string, color: string } }

서버 → 호스트
platform:playerJoined
{ player: { id: string, color: string } }
```

### 준비 완료

```
모바일 → 서버
platform:playerReady
{ sessionId: string }

서버 → 호스트
platform:readyUpdate
{ readyCount: number, totalCount: number }

서버 → 전체 세션 (조건: readyCount === totalCount > 0)
platform:allReady
{}
```

### 세션 리셋

```
호스트 → 서버
platform:reset
{ sessionId: string }

서버 → 전체 세션
platform:reset
{}
```

### 플레이어 연결 해제 (disconnect)

```
서버 → 호스트
platform:playerLeft
{ playerId: string }

서버 → 호스트
platform:readyUpdate
{ readyCount: number, totalCount: number }
```

### 호스트 연결 해제 (disconnect)

```
서버 → 세션 내 전체 소켓
hostDisconnected
{}
```

---

## game:* 이벤트 (서버가 투명하게 중계)

### 모바일 → 호스트

```
모바일 → 서버
game:toHost
{ sessionId: string, type: string, payload: any }

서버 → 호스트
game:fromPlayer
{ from: string (socketId), type: string, payload: any }
```

### 호스트 → 특정 모바일

```
호스트 → 서버
game:toPlayer
{ to: string (socketId), type: string, payload: any }

서버 → 해당 모바일
game:fromHost
{ type: string, payload: any }
```

### 호스트 → 전체 모바일

```
호스트 → 서버
game:broadcast
{ sessionId: string, type: string, payload: any }

서버 → 세션 내 모든 모바일
game:fromHost
{ type: string, payload: any }
```

---

## 팽이 배틀 게임 메시지 예시

| 방향 | type | payload | 용도 |
|------|------|---------|------|
| 모바일 → 호스트 | `launchSpin` | `{ rpm: number }` | 발사 RPM 전달 |
| 모바일 → 호스트 | `tiltInput` | `{ tiltX: number, tiltZ: number }` | 기울기 조종 (-1~1) |
| 모바일 → 호스트 | `requestReset` | `{}` | 리셋 요청 |
| 호스트 → 전체 | `battleStart` | `{ players: Player[] }` | 배틀 시작 |
| 호스트 → 특정 | `eliminated` | `{ rank: number, reason: string }` | 탈락 통보 |
| 호스트 → 전체 | `gameOver` | `{ rankings: Player[] }` | 게임 종료 |
