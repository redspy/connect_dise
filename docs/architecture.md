# 플랫폼 아키텍처 (구현 기준)

Connect Dise는 **플랫폼 레이어**와 **게임 레이어**를 분리한 멀티게임 구조입니다.
서버는 게임 규칙을 알지 않고, 세션/플레이어 관리와 메시지 라우팅만 담당합니다.

## 핵심 구성

- `server/index.js`
  - Express + Socket.IO 서버
  - 프로덕션에서 `dist/` 정적 서빙
  - `platform:*`, `game:*`, `p2p:*` 이벤트 처리
- `platform/server/SessionManager.js`
  - 세션 생성/입장/퇴장, 플레이어 stable id, ready 상태 관리
- `platform/client/HostSDK.js`
  - 호스트 세션 생성, 플레이어 목록/준비 상태/메시지 송수신
- `platform/client/MobileSDK.js`
  - 모바일 세션 입장, ready 신호, 메시지 송수신, 재연결 처리
- `platform/client/HostBaseGame.js`, `MobileBaseGame.js`
  - 게임 공통 라이프사이클/화면 전환 처리

## 통신 레이어

1. 플랫폼 이벤트: `platform:*`
- 세션 생성/입장/준비/리셋/퇴장
- 재연결 유예(30초) 및 재접속 처리

2. 게임 이벤트: `game:*`
- `game:toHost`, `game:toPlayer`, `game:broadcast`
- 게임별 `type`, `payload`는 자유 확장

3. P2P 시그널링: `p2p:*`
- WebRTC DataChannel 연결용 offer/answer/ice 중계

## 프로젝트 구조

```text
connect_dise/
├── docs/
├── games/
│   ├── registry.js
│   ├── nunchi-ten/
│   ├── spin-battle/
│   ├── dice/
│   ├── digit-puzzle/
│   ├── give-you-fire/
│   ├── relay-drawing/
│   ├── dobble/
│   ├── dixit/
│   └── omok/
├── platform/
│   ├── client/
│   └── server/
├── server/
├── src/
└── vite.config.js
```

## 수록 게임

- 멀티: `nunchi-ten`, `spin-battle`, `dice`, `digit-puzzle`, `give-you-fire`, `relay-drawing`, `dobble`, `dixit`
- 솔로: `omok`

## 빌드/런타임

- 개발: `npm run dev` (`server:3000` + `vite:5173`)
- 빌드: `npm run build`
- 실행: `node server/index.js`
- 멀티 엔트리 페이지는 `vite.config.js`의 `build.rollupOptions.input`에서 관리
