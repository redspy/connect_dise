# 주사위 게임 프로젝트 (Dice Game) 구현 계획서

이 문서는 PC/태블릿의 브라우저(메인 보드)와 모바일 기기(컨트롤러) 간 실시간 통신을 통한 3D 주사위 맵핑 게임 구현 계획입니다. 사용자가 다중 에이전트(기획, 프론트, 백, 디자인, 테스트) 구조의 업무를 요청하였으므로, 이에 맞춰 역할을 세분화하여 설계했습니다.

## 1. 기술 스택 분석 및 추천 (Tech Stack)

### 백엔드 (서버 및 실시간 통신)
*   **Node.js & Express**: 정적 파일 제공 및 로컬 테스트 서버 구축을 위한 가벼운 프레임워크입니다.
*   **Socket.io**: 메인 화면(PC)과 모바일 기기 간의 초저지연 양방향 실시간 통신(WebSockets)을 위해 필수적입니다. 고유 Session ID(룸) 기반 네트워킹을 구현합니다.

### 프론트엔드 (UI 및 3D 렌더링)
*   **Vite**: 빠른 빌드 및 HMR(Hot Module Replacement) 지원을 위해 추천합니다. 프레임워크 없이 **Vanilla JS** 만으로도 충분히 구현 가능합니다.
*   **@3d-dice/dice-box (또는 Three.js + Cannon.js)**: 브라우저 환경에서 주사위의 3D 물리 엔진 동작을 쉽게 렌더링 할 수 있는 전용 라이브러리(`dice-box`)를 추천합니다.
*   **qrcode (npm)**: 프론트엔드에서 고유 세션 URL을 생성한 후 화면 사방에 QR 코드로 렌더링하기 위해 사용합니다.

### 테스트 환경 (네트워크 & 센서)
*   **ngrok / localtunnel / vite-plugin-mkcert**: 모바일 기기에서 자이로 센서 (`DeviceOrientation` / `DeviceMotion` API)에 접근하려면 **반드시 보안 컨텍스트(HTTPS)** 가 필요하므로, 로컬 테스트 시 HTTPS 터널링 설정이 필수입니다.

---

## 2. 에이전트 역할별 상세 설계 (Agent Roles)

### 🎨 디자인 에이전트 (Design Agent)
메인 보드와 모바일 UI의 심미성 및 UX를 담당합니다.
- **메인 보드 (PC)**: 카지노의 녹색 천(Green Felt) 텍스처를 적용한 반응형 전체 화면 레이아웃 구성. 화면 사방 코너에 참가자 접속용 QR코드 및 접속 상태를 표시하는 디자인 구현 (CSS/Assets).
- **모바일 컨트롤러 (Mobile)**: 주사위를 쥐고 있는 듯한 직관적 화면 설계 및 흔들기(Shake), 더블 터치(Double Tap) 유도를 위한 애니메이션/가이드 추가. 모바일 기기의 상단으로 주사위를 튕기듯 던지는 CSS Transition 설계.

### 🌐 프론트엔드 에이전트 (Frontend Agent)
UI 렌더링, 3D 구현 및 소켓 클라이언트 연동을 담당합니다.
- **메인 보드 (`/`)**: `@3d-dice/dice-box` 초기화. 고유 세션 ID별 QR코드 렌더링. 소켓으로 수신된 `throwDice` 이벤트의 가속도 데이터를 적용해 주사위를 보드판에 던짐.
- **모바일 보드 (`/mobile`)**: iOS 13+ 등 주요 기기에 맞는 `DeviceOrientation` 권한 요청 모달 설계. 센서 데이터를 Throttling 적용 후 소켓 전송. 더블 터치 이벤트를 캡처하여 소켓 이벤트로 `throw` 데이터와 함께 메인 보드로 BroadCast 요청.

### ⚙️ 백엔드 에이전트 (Backend Agent)
웹 서버 구동 및 데이터 중계를 담당합니다.
- **Socket.io 세션 관리**: Node.js 메모리 내에서 생성된 Session 고유 키(Room ID) 관리. PC 브라우저가 접속하면 새 룸을 생성하고, 모바일 브라우저가 접속 시 해당 룸에 조인시킴.
- **데이터 라우팅**: 모바일 센서 데이터(`gyroData`) 및 주사위 던짐(`throw`) 데이터를 필터링하여 해당 세션의 메인 보드로만 정확히 전달(Emit)하는 로직 개발.

### 🧪 테스트 에이전트 (Test Agent)
기기 간 통신 및 센서 등 로컬 테스트 환경 검증을 담당합니다.
- **접속 테스트**: 로컬망에서 IP 직접 입력 방식 및 터널링(ngrok 등)을 통한 HTTPS 모바일 연결 테스트 환경 체크.
- **이벤트 전송 테스트**: 자이로스코프 데이터 전송의 지연 시간 측정. 여러 대의 모바일 기기가 동시에 주사위를 던질 때의 동시성 버그 테스트.

---

## User Review Required

> [!CAUTION]
> 모바일 기기의 자이로스코프(DeviceOrientation API) 기능을 로컬 네트워크에서 구동하려면, 모바일 브라우저 보안 정책 상 **HTTPS 접속이 필수적**입니다. 
> 
> 테스트 시 `ngrok` 과 같은 포트 포워딩 툴을 활용하거나 SSL 인증서(`vite-plugin-mkcert`)를 연동하여 작업할 예정인데 괜찮으신가요?

## Proposed Changes

### 백엔드 (Backend)
#### [NEW] `server/index.js`
Node.js 및 Express 서버 설정. Socket.io 웹소켓 초기화. Session 기반 Room 네트워킹 구성.
#### [NEW] `package.json`
`express`, `socket.io` 패키지 구성.

### 프론트엔드 (Frontend)
#### [NEW] `package.json`
Vite 기반 프로젝트 생성, `socket.io-client`, `qrcode`, `@3d-dice/dice-box` 등 의존성 추가.
#### [NEW] `index.html` & `src/main.js`
메인 화면(보드판) 뷰. 3D 주사위 라이브러리 연동 및 QR코드 렌더링, 주사위 투척 이벤트 수신 로직.
#### [NEW] `mobile.html` & `src/mobile.js`
모바일 접속 뷰. 사용자 인터랙션(DeviceMotion 센서 및 더블 탭 제스처) 캡처 및 Socket 이벤트 송신 로직.
#### [NEW] `src/style.css`
디자인 에이전트의 산출물인 녹색 천 텍스처 배경 및 반응형 사방 QR코드 레이아웃, 모바일 슈팅 애니메이션 스타일 구성.

## Verification Plan

### Automated Tests
*   **서버 구동**: `npm run dev` (또는 `node server/index.js`) 를 통해 Express + Vite 통합 테스트 환경 작동 여부 확인.
*   **소켓 연결**: PC 브라우저 구동 시 콘솔에서 Socket.io 클라이언트 연결 (`connect` 이벤트) 여부 확인 로그 체크.

### Manual Verification
*   **환경 셋업**: 로컬 테스트 환경에서 터널링(ngrok)으로 생성된 HTTPS 주소를 PC 브라우저에 접속.
*   **QR 인식 및 접속**: PC 메인 화면 사방에 생성된 QR코드를 스마트폰(Mobile) 카메라로 스캔하여 전용 컨트롤러 화면 진입 확인. 권한 승인 모달 확인.
*   **센서 및 애니메이션 액션**: 권한 승인 후 스마트폰을 흔들어 데이터가 브로드캐스팅 되는지 확인. 화면 더블 탭 터치 시, 모바일 화면에 주사위가 던져지는 애니메이션이 출력되고 0.5초 이내에 PC 브라우저 메인 보드 화면으로 3D 주사위가 날아와 구르는 물리 연출 확인.
