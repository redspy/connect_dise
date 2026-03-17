# 플랫폼 아키텍처 개요

## 설계 철학

Connect Dise는 **플랫폼(인프라)과 게임(콘텐츠)을 완전히 분리**하는 SDK 패턴을 사용합니다.

- **플랫폼**: 세션 생성, 플레이어 입장/퇴장, 준비 상태, 메시지 라우팅을 담당
- **게임**: 플랫폼 SDK를 통해 통신하고, 게임 로직만 구현

서버는 게임 내용을 전혀 알지 못합니다. 메시지 타입과 페이로드를 투명하게 중계할 뿐입니다.

---

## 전체 구조

```
                    ┌─────────────────────────────────────────┐
                    │              Browser (PC Host)           │
                    │                                          │
                    │  ┌──────────┐     ┌───────────────────┐ │
                    │  │ HostSDK  │────▶│   Game Host Code  │ │
                    │  └──────────┘     │  (SpinGame, etc.) │ │
                    │       │           └───────────────────┘ │
                    └───────┼─────────────────────────────────┘
                            │ Socket.IO
                    ┌───────┼─────────────────────────────────┐
                    │       ▼           Node.js Server        │
                    │  ┌───────────────────────────────────┐  │
                    │  │  Express + Socket.IO              │  │
                    │  │  ┌─────────────────────────────┐  │  │
                    │  │  │      SessionManager          │  │  │
                    │  │  │  - 세션 생성/삭제            │  │  │
                    │  │  │  - 플레이어 관리             │  │  │
                    │  │  │  - 준비 상태 추적            │  │  │
                    │  │  └─────────────────────────────┘  │  │
                    │  └───────────────────────────────────┘  │
                    └───────┬─────────────────────────────────┘
                            │ Socket.IO
                    ┌───────┼─────────────────────────────────┐
                    │       ▼        Browser (Mobile)          │
                    │  ┌───────────┐    ┌────────────────────┐│
                    │  │ MobileSDK │───▶│ Game Mobile Code   ││
                    │  └───────────┘    └────────────────────┘│
                    └─────────────────────────────────────────┘
```

---

## 디렉토리 구조

```
connect_dise/
├── index.html                    # 게임 선택 로비 (진입점)
├── src/
│   ├── lobby.js                  # 로비 페이지 — games/registry.js를 읽어 카드 렌더링
│   └── style.css                 # 공통 CSS (배경, 폰트 등)
│
├── platform/                     # 플랫폼 레이어 (게임 무관)
│   ├── client/
│   │   ├── HostSDK.js            # 호스트용 클라이언트 SDK
│   │   ├── MobileSDK.js         # 모바일용 클라이언트 SDK
│   │   └── shared/
│   │       ├── SensorManager.js  # iOS DeviceMotion 권한 요청 + 이벤트 래핑
│   │       ├── LevelIndicator.js # 기울기 버블 UI 컴포넌트
│   │       └── QRDisplay.js      # qrcode 라이브러리 래핑 유틸
│   └── server/
│       └── SessionManager.js     # 서버 측 세션·플레이어 상태 관리
│
├── games/                        # 게임 콘텐츠 레이어
│   ├── registry.js               # 게임 목록 (로비에서 참조)
│   ├── spin-battle/
│   │   ├── host/
│   │   │   ├── index.html
│   │   │   ├── main.js           # 호스트 진입점 — HostSDK 사용
│   │   │   ├── SpinGame.js       # 게임 상태 머신
│   │   │   ├── SpinPhysics.js    # 팽이 물리 엔진
│   │   │   ├── SpinRenderer.js   # Canvas 렌더러
│   │   │   └── style.css
│   │   └── mobile/
│   │       ├── index.html
│   │       └── main.js           # 모바일 진입점 — MobileSDK 사용
│   └── dice/
│       ├── host/
│       └── mobile/
│
├── server/
│   └── index.js                  # Express + Socket.IO 서버
└── vite.config.js                # 멀티 엔트리 빌드 설정
```

---

## 세션 라이프사이클

```
1. 호스트 접속
   └─▶ platform:createSession { gameId }
       └─▶ server: SessionManager.createSession()
           └─▶ platform:sessionCreated { sessionId, localIp }
               └─▶ HostSDK: QR URL 생성, 'sessionReady' 이벤트 발생

2. 모바일 입장 (QR 스캔)
   └─▶ platform:joinSession { sessionId }
       └─▶ server: SessionManager.joinSession() → 색상 부여
           ├─▶ platform:joined { player }           → 모바일에 전달
           └─▶ platform:playerJoined { player }     → 호스트에 전달

3. 준비 완료
   └─▶ platform:playerReady { sessionId }           (모바일 → 서버)
       └─▶ server: readyPlayers에 추가
           ├─▶ platform:readyUpdate { readyCount, totalCount }  → 호스트
           └─▶ (모두 준비 시) platform:allReady {}  → 전체 세션

4. 게임 중 메시지
   ├─▶ game:toHost { sessionId, type, payload }     (모바일 → 서버 → 호스트)
   ├─▶ game:toPlayer { to, type, payload }          (호스트 → 서버 → 특정 모바일)
   └─▶ game:broadcast { sessionId, type, payload }  (호스트 → 서버 → 전체 모바일)

5. 리셋
   └─▶ platform:reset { sessionId }
       └─▶ server: readyPlayers 초기화
           └─▶ platform:reset {} → 전체 세션

6. 연결 해제
   ├─▶ (호스트) sessionId에 속한 모든 소켓에 hostDisconnected
   └─▶ (모바일) 호스트에 platform:playerLeft, platform:readyUpdate
```

---

## 플레이어 색상

서버가 입장 순서에 따라 자동으로 색상을 배정합니다 (게임 코드에서 색상을 직접 지정하지 않아도 됩니다).

```
순서: #FF4444 → #33B5E5 → #99CC00 → #FFBB33 → #AA66CC → #FF00A2 (6색 순환)
```

`player.color` 속성으로 접근합니다.

---

## Vite 멀티 엔트리 빌드

각 게임의 host/mobile 페이지가 독립적인 HTML 엔트리로 빌드됩니다.

```js
// vite.config.js
input: {
  lobby:            'index.html',
  spinBattleHost:   'games/spin-battle/host/index.html',
  spinBattleMobile: 'games/spin-battle/mobile/index.html',
  diceHost:         'games/dice/host/index.html',
  diceMobile:       'games/dice/mobile/index.html',
}
```

새 게임을 추가할 때 이 목록에 엔트리를 추가해야 합니다.
