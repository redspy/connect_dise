# Connect Dise

1대의 PC(호스트 화면) + n대의 스마트폰(컨트롤러)을 실시간으로 연결하는 멀티플레이어 게임 플랫폼입니다.
QR코드로 간편하게 입장하고, 모바일 센서(자이로/가속도계)와 터치를 활용해 PC 화면의 게임을 조작합니다.

![tech-stack](https://img.shields.io/badge/Tech-Vite%20%7C%20Socket.io%20%7C%20Node.js-blue)
![status](https://img.shields.io/badge/Status-Active-brightgreen)

---

## 수록 게임

| 게임 | 설명 | 인원 |
|------|------|------|
| 팽이 배틀 | 모바일을 흔들어 팽이를 회전시키고, 기울여서 조종해 상대 팽이를 튕겨내라 | 2~6명 |
| 주사위 | 모바일을 흔들어 PC 화면에 3D 주사위를 굴려라 | 1~6명 |

---

## 기술 스택

- **Frontend**: Vanilla JS, Vite, `@vitejs/plugin-basic-ssl`
- **Backend**: Node.js, Express, Socket.IO
- **통신**: Socket.IO (WebSocket)
- **3D**: `@3d-dice/dice-box` (주사위 게임)
- **기타**: `qrcode` (QR 코드 생성)

---

## 실행 방법

Node.js v20 이상이 필요합니다.

```bash
# 의존성 설치
npm install

# 개발 서버 시작 (Express :3000 + Vite :5173 동시 실행)
npm run dev
```

### PC 브라우저 접속

터미널에 출력된 주소 중 **`Network` 주소**를 사용하세요.

```
Local:   https://localhost:5173/      <- 사용 금지
Network: https://192.168.x.x:5173/   <- 이 주소 사용
```

> **주의**: `localhost`로 접속하면 QR코드에도 `localhost`가 포함되어 모바일에서 접속이 불가합니다.
> 반드시 로컬 네트워크 IP 주소로 접속하세요.

### 모바일 접속

1. PC와 동일한 Wi-Fi에 연결된 스마트폰으로 화면의 **QR코드를 스캔**합니다.
2. 자체 서명 인증서 경고가 표시되면 **고급 > 안전하지 않음으로 이동**을 눌러 계속 진행합니다.
3. 센서 권한 요청 버튼을 눌러 **모션 센서를 허용**합니다.
4. 준비 버튼을 누르면 게임이 시작됩니다.

---

## 프로젝트 구조

```
connect_dise/
├── index.html                          # 게임 선택 로비
├── src/
│   ├── lobby.js                        # 로비 페이지 JS
│   └── style.css                       # 공통 스타일
├── platform/                           # 플랫폼 SDK (게임과 독립)
│   ├── client/
│   │   ├── HostSDK.js                  # 호스트 SDK
│   │   ├── MobileSDK.js               # 모바일 SDK
│   │   └── shared/
│   │       ├── SensorManager.js        # iOS 센서 권한 + 리스너
│   │       ├── LevelIndicator.js       # 기울기 인디케이터 컴포넌트
│   │       └── QRDisplay.js            # QR 코드 렌더링 유틸
│   └── server/
│       └── SessionManager.js           # 세션/플레이어/준비 상태 관리
├── games/                              # 게임별 코드
│   ├── registry.js                     # 게임 목록 등록
│   ├── spin-battle/
│   │   ├── host/                       # 팽이 배틀 호스트 화면
│   │   └── mobile/                     # 팽이 배틀 모바일 컨트롤러
│   └── dice/
│       ├── host/                       # 주사위 호스트 화면
│       └── mobile/                     # 주사위 모바일 컨트롤러
├── server/
│   └── index.js                        # Express + Socket.IO 서버
└── vite.config.js
```

---

## 문서

| 문서 | 내용 |
|------|------|
| [.docs/architecture/overview.md](.docs/architecture/overview.md) | 플랫폼 전체 아키텍처 |
| [.docs/architecture/sdk-api.md](.docs/architecture/sdk-api.md) | HostSDK / MobileSDK API 레퍼런스 |
| [.docs/architecture/protocol.md](.docs/architecture/protocol.md) | Socket.IO 이벤트 프로토콜 |
| [.docs/game-dev-guide.md](.docs/game-dev-guide.md) | 새 게임 추가 구현 가이드 |
