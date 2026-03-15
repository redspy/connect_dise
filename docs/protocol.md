# 이벤트 프로토콜 (구현 기준)

## platform:*
- `platform:createSession` `{ gameId }` (호스트 -> 서버)
- `platform:sessionCreated` `{ sessionId, localIp }` (서버 -> 호스트)
- `platform:joinSession` `{ sessionId, reconnectId }` (모바일 -> 서버)
- `platform:joined` `{ player, reconnected }` (서버 -> 모바일)
- `platform:playerJoined` `{ player }` (서버 -> 호스트)
- `platform:playerRejoined` `{ player }` (서버 -> 호스트)
- `platform:playerReady` `{ sessionId }` (모바일 -> 서버)
- `platform:readyUpdate` `{ readyCount, totalCount }` (서버 -> 호스트)
- `platform:allReady` `{}` (서버 -> 세션 전체)
- `platform:reset` `{ sessionId }` / `{}`
- `platform:playerDisconnected` `{ playerId }` (유예 시작)
- `platform:playerLeft` `{ playerId }` (유예 만료 후)
- `hostDisconnected` `{}`

## game:* (Socket.IO 폴백 경로)
- `game:toHost` `{ sessionId, type, payload }` -> `game:fromPlayer` `{ from, type, payload }`
- `game:toPlayer` `{ sessionId, to, type, payload }` -> `game:fromHost` `{ type, payload }`
- `game:broadcast` `{ sessionId, type, payload }` -> 각 모바일 `game:fromHost`

## p2p:* (시그널링)
- `p2p:offer` `{ sessionId, to, sdp }`
- `p2p:answer` `{ sessionId, sdp }`
- `p2p:ice` `{ sessionId, to?, candidate }`

## 게임별 메시지 타입
- 눈치 10단: `setProfile`, `submitChoice`, `submissionStatus`, `roundStarted`, `roundRevealed`, `gameFinished`, `rejoinState`, `requestRematch`
- Digit Puzzle: `setProfile`, `progressUpdate`, `puzzleComplete`, `playerListUpdated`, `gameStarted`, `gameFinished`, `requestRematch`
- 팽이 배틀: `launchSpin`, `tiltInput`, `battleStart`, `eliminated`, `gameOver`, `requestReset`
- 주사위: `throwDice`, `resetDice`, `gyroData`
- Give You Fire: `setProfile`, `boardUpdate`, `linesCleared`, `levelUp`, `gameOver`, `soloClear`, `gameStarted`, `gameFinished`, `requestRematch`
- 그림 릴레이: `setProfile`, `roundAssignments`, `submitTurn`, `showResults`, `sendReaction`, `requestRematch`
