# 플랫폼 아키텍처 개요

## 설계 철학

Connect Dise는 **플랫폼(인프라)과 게임(콘텐츠)을 완전히 분리**하는 SDK 패턴을 사용합니다.

- **플랫폼**: 세션 생성, 플레이어 입장/퇴장, 준비 상태, 메시지 라우팅, 재연결 처리를 담당
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
                    │  └──────────┘     │  (HostBaseGame)   │ │
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
                    │  │  │  - 재연결 유예 (30초)        │  │  │
                    │  │  └─────────────────────────────┘  │  │
                    │  └───────────────────────────────────┘  │
                    └───────┬─────────────────────────────────┘
                            │ Socket.IO
                    ┌───────┼─────────────────────────────────┐
                    │       ▼        Browser (Mobile)          │
                    │  ┌───────────┐    ┌────────────────────┐│
                    │  │ MobileSDK │───▶│ Game Mobile Code   ││
                    │  └───────────┘    │ (MobileBaseGame)   ││
                    │                   └────────────────────┘│
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
│   │   ├── MobileSDK.js          # 모바일용 클라이언트 SDK
│   │   ├── HostBaseGame.js       # 호스트 게임 베이스 클래스
│   │   ├── MobileBaseGame.js     # 모바일 게임 베이스 클래스
│   │   └── shared/
│   │       ├── SensorManager.js  # iOS DeviceMotion 권한 요청 + 이벤트 래핑
│   │       ├── LevelIndicator.js # 기울기 버블 UI 컴포넌트
│   │       ├── QRDisplay.js      # qrcode 라이브러리 래핑 유틸
│   │       └── QRScanner.js      # QR 코드 스캐너 유틸
│   └── server/
│       └── SessionManager.js     # 서버 측 세션·플레이어 상태 관리
│
├── games/                        # 게임 콘텐츠 레이어
│   ├── registry.js               # 게임 목록 (로비에서 참조)
│   ├── nunchi-ten/               # 눈치 10단
│   │   ├── assets/               #   아바타(8종), 사운드, 이미지
│   │   ├── host/                 #   NunchiGame.js, NunchiDevPanel.js
│   │   └── mobile/               #   NunchiMobile.js
│   ├── spin-battle/
│   │   ├── host/
│   │   │   ├── index.html
│   │   │   ├── main.js           # 호스트 진입점 — HostSDK 사용
│   │   │   ├── SpinGame.js       # 게임 상태 머신
│   │   │   ├── SpinPhysics.js    # 팽이 물리 엔진
│   │   │   ├── SpinRenderer.js   # Three.js 렌더러
│   │   │   ├── DevPanel.js       # 개발자 패널
│   │   │   └── style.css
│   │   └── mobile/
│   │       ├── index.html
│   │       └── main.js           # 모바일 진입점 — MobileSDK 사용
│   └── dice/
│       ├── host/
│       └── mobile/
│
├── server/
│   └── index.js                  # Express + Socket.IO 서버 (프로덕션: dist/ 정적 서빙)
├── .github/workflows/deploy.yml  # CI/CD 자동 배포
├── deploy.bat                    # Windows 배포 스크립트
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
       └─▶ server: SessionManager.joinSession() → 색상 부여, 안정 ID 생성
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
   └─▶ (모바일) 30초 유예 후 완전 제거
       ├─▶ 유예 중 재연결: platform:playerRejoined → 호스트
       └─▶ 유예 만료: platform:playerLeft, platform:readyUpdate → 호스트
```

---

## 플레이어 시스템

### 색상 배정
서버가 입장 순서에 따라 자동으로 색상을 배정합니다 (게임 코드에서 색상을 직접 지정하지 않아도 됩니다).

```
순서: #FF4444 → #33B5E5 → #99CC00 → #FFBB33 → #AA66CC → #FF00A2 (6색 순환)
```

`player.color` 속성으로 접근합니다.

### 안정 플레이어 ID
소켓 재연결 시에도 플레이어 ID가 유지됩니다. SessionManager가 소켓 ID와 별도로 안정 플레이어 ID를 관리하며, MobileSDK는 sessionStorage를 통해 reconnectId를 자동으로 전송합니다.

### 재연결 유예
플레이어 연결이 끊기면 30초 유예 기간이 주어집니다. 유예 중 재연결하면 기존 플레이어 정보가 복원되고, 유예 만료 시 완전 제거됩니다.

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
  nunchiHost:       'games/nunchi-ten/host/index.html',
  nunchiMobile:     'games/nunchi-ten/mobile/index.html',
}
```

새 게임을 추가할 때 이 목록에 엔트리를 추가해야 합니다.

`gameAssetsPlugin`이 각 게임의 `assets/` 폴더를 자동으로 감지하여 개발 시 미들웨어로 서빙하고, 빌드 시 `dist/`로 복사합니다.

---

## 배포

- **GitHub Actions**: `main` 브랜치에 push 시 Windows self-hosted runner에서 자동 배포
- **deploy.yml**: `git fetch` + `git reset --hard` → `deploy.bat` 실행
- **deploy.bat**: 서버 중지 → `npm install` → `npm run build` → `wmic`으로 서버 독립 프로세스 실행
- **프로덕션 서버**: Express가 포트 3000에서 Socket.IO + `dist/` 정적 파일 서빙
