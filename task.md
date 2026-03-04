# 주사위 게임 (Dice Game) 작업 목록

- [x] **Phase 1: 기획 및 구조 설계 (PLANNING)**
  - [x] 프로젝트 전체 데이터 플로우 및 에이전트 역할 세분화.
  - [x] 적용 기술 스택 (Vite, Socket.io, DeviceOrientation, @3d-dice) 선정.
  - [x] 구현 계획서 (Implementation Plan) 작성 및 검토 요청.

- [x] **Phase 2: 프로젝트 초기 세팅 및 백엔드 (EXECUTION - Backend)**
  - [x] 프로젝트 폴더 세팅 (Vite 및 npm 설정).
  - [x] Node.js + Express 기반 HTTP 서버 생성 (`server/index.js`).
  - [x] Socket.io 구성 및 Room(세션) 개설/연결 라우팅 수립.
  - [x] 외부 접속을 허용하는 호스트(`0.0.0.0`) 바인딩 및 라우팅 (HTTPS 터널링 대비).

- [x] **Phase 3: 메인 보드 프론트엔드 및 디자인 (EXECUTION - Frontend / Design)**
  - [x] `index.html` 뷰 구성 및 녹색 천 텍스처 (Green Felt Texture) CSS 백그라운드 적용.
  - [x] 서버로부터 고유 Session ID를 받아와 `qrcode` 라이브러리로 사방 방위에 QR코드 렌더링.
  - [x] 접속된 모바일 디바이스(참가 플레이어) 등록 갯수와 상태 정보를 표시할 UI 작성.

- [x] **Phase 4: 3D 주사위 물리 렌더링 (EXECUTION - Frontend / Design)**
  - [x] `@3d-dice/dice-box` 등 주사위 라이브러리를 메인 보드 화면에 연동.
  - [x] 기본 물리 던지기 테스트 추가 (모바일 연동 전 상태 체크).

- [x] **Phase 5: 모바일 컨트롤러 앱 개발 (EXECUTION - Frontend)**
  - [x] `mobile.html` 전용 UI 디자인 및 구성 (주사위 대기 그래픽 가이드 안내 문구 추가).
  - [x] 모바일 OS 접근을 위한 `DeviceOrientation` / `DeviceMotion` API 권한 획득 플로우(클릭 시 모달) 처리.
  - [x] 흔들기(센서) 정보 최적화 후 소켓 송신 로직 구현.
  - [x] 더블 탭(`dblclick` / `touchend` 연속 감지) 액션 시 소켓 송신 및 CSS 주사위 날아가는 슈팅 이펙트 애니메이션 적용.

- [x] **Phase 6: 이벤트 병합 및 데이터 연출 (EXECUTION - Backend / Frontend)**
  - [x] 모바일 기기의 슈팅이벤트(`throwDice`)가 소켓 서버를 통해 세션 Host(메인 화면) 로 전달되는 파이프라인 형성.
  - [x] 수신한 데이터 강도 기반으로 3D 보드판에 주사위 구르는 액션 최종 통합.

- [x] **Phase 7: 통합 검증 및 시연 준비 (VERIFICATION - Test)**
  - [x] ngrok 기반 HTTPS 포워딩 또는 로컬 인증 체계 구동하여 모바일 실기기 스캔을 통한 End-to-End 동작 확인.
  - [x] 여러 명이 접속하는 상황에서의 Session 격리 및 응답 레이턴시 안정성 평가.
