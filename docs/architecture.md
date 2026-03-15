# 플랫폼 아키텍처 (구현 기준)

## 구성
- `server/index.js`: Express + Socket.IO 서버, `dist/` 정적 서빙
- `platform/server/SessionManager.js`: 세션/플레이어/준비 상태/재연결 유예 관리
- `platform/client/HostSDK.js`: 호스트 SDK
- `platform/client/MobileSDK.js`: 모바일 SDK
- `platform/client/P2PManager.js`: WebRTC DataChannel 관리 (P2P)
- `platform/client/HostBaseGame.js`: 호스트 베이스 클래스
- `platform/client/MobileBaseGame.js`: 모바일 베이스 클래스

## 통신 계층
1. 플랫폼 계층: Socket.IO
- 세션 생성/입장/준비/리셋/퇴장 처리
- WebRTC 시그널링 relay (`p2p:*`)

2. 게임 계층: P2P 우선, Socket.IO 폴백
- `HostSDK.sendToPlayer/broadcast`, `MobileSDK.sendToHost`는 DataChannel 전송 우선
- P2P 미연결/실패 시 기존 `game:*` 이벤트로 자동 폴백

## 세션 흐름
1. 호스트: `platform:createSession`
2. 모바일: `platform:joinSession`
3. 준비: `platform:playerReady` -> `platform:allReady`
4. 게임 메시지: `game:*` 또는 P2P 채널
5. 리셋: `platform:reset`
6. 연결 끊김: 플레이어 30초 유예 후 제거

## 현재 게임 목록
- 멀티: `nunchi-ten`, `digit-puzzle`, `spin-battle`, `dice`, `give-you-fire`, `relay-drawing`
- 솔로: `omok`

## 빌드 엔트리
`vite.config.js` 멀티 엔트리에 위 게임 host/mobile(omok 단일) 페이지가 등록되어 있습니다.
