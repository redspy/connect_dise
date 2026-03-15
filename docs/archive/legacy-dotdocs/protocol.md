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
{ sessionId: string, reconnectId: string | null }

서버 → 모바일
platform:joined
{ player: { id: string, color: string }, reconnected: boolean }

서버 → 호스트 (신규 입장)
platform:playerJoined
{ player: { id: string, color: string } }

서버 → 호스트 (재연결)
platform:playerRejoined
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
서버 → 호스트 (일시 연결 끊김 알림)
platform:playerDisconnected
{ playerId: string }

(30초 유예 후 재연결 없으면)
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
{ from: string (stablePlayerId), type: string, payload: any }
```

> `from` 필드에는 소켓 ID가 아닌 **안정 플레이어 ID**가 전달됩니다. 재연결 후에도 동일한 ID를 유지합니다.

### 호스트 → 특정 모바일

```
호스트 → 서버
game:toPlayer
{ to: string (playerId), type: string, payload: any }

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

## 게임별 메시지 예시

### 팽이 배틀

| 방향 | type | payload | 용도 |
|------|------|---------|------|
| 모바일 → 호스트 | `launchSpin` | `{ rpm: number }` | 발사 RPM 전달 |
| 모바일 → 호스트 | `tiltInput` | `{ tiltX: number, tiltZ: number }` | 기울기 조종 (-1~1) |
| 모바일 → 호스트 | `requestReset` | `{}` | 리셋 요청 |
| 호스트 → 전체 | `battleStart` | `{ players: Player[] }` | 배틀 시작 |
| 호스트 → 특정 | `eliminated` | `{ rank: number, reason: string }` | 탈락 통보 |
| 호스트 → 전체 | `gameOver` | `{ rankings: Player[] }` | 게임 종료 |

### 눈치 10단

| 방향 | type | payload | 용도 |
|------|------|---------|------|
| 모바일 → 호스트 | `chooseNumber` | `{ number: number, useDouble: boolean }` | 숫자 카드 선택 |
| 호스트 → 전체 | `roundStart` | `{ round: number, totalRounds: number }` | 라운드 시작 |
| 호스트 → 전체 | `roundResult` | `{ cards: [], scores: [] }` | 라운드 결과 |
| 호스트 → 전체 | `gameOver` | `{ rankings: [] }` | 최종 결과 |

### Digit Puzzle

| 방향 | type | payload | 용도 |
|------|------|---------|------|
| 모바일 → 호스트 | `setProfile` | `{ nickname }` | 닉네임 설정 |
| 모바일 → 호스트 | `progressUpdate` | `{ correctCount, moves, seconds }` | 진행률 (500ms 스로틀) |
| 모바일 → 호스트 | `puzzleComplete` | `{ moves, seconds }` | 퍼즐 완성 |
| 모바일 → 호스트 | `requestRematch` | `{}` | 다시하기 요청 |
| 호스트 → 전체 | `playerListUpdated` | `{ players }` | 플레이어 목록 갱신 |
| 호스트 → 전체 | `gameStarted` | `{ board: number[16] }` | 게임 시작 (셔플된 보드 전송) |
| 호스트 → 전체 | `gameFinished` | `{ winner, rankings }` | 최초 완성자 발생, 게임 종료 |
