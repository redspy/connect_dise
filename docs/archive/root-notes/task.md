# Connect Dise 작업 목록

## 플랫폼 인프라

- [x] Express + Socket.IO 서버 (`server/index.js`)
- [x] SessionManager — 세션/플레이어/준비 상태 관리
- [x] 플레이어 재연결 (30초 유예, 안정 ID, sessionStorage 기반)
- [x] HostSDK — 호스트 클라이언트 SDK
- [x] MobileSDK — 모바일 클라이언트 SDK (재연결 포함)
- [x] HostBaseGame — 호스트 게임 베이스 클래스
- [x] MobileBaseGame — 모바일 게임 베이스 클래스
- [x] 공유 컴포넌트 (QRDisplay, QRScanner, SensorManager, LevelIndicator)
- [x] Vite 멀티 엔트리 빌드 설정
- [x] 게임 에셋 자동 서빙 플러그인 (gameAssetsPlugin)
- [x] 게임 레지스트리 시스템 (`games/registry.js`)
- [x] 로비 페이지 (게임 카드 렌더링)
- [x] 프로덕션 정적 파일 서빙 (`dist/`)

## 게임

- [x] **주사위** — 흔들기/더블탭으로 3D 주사위 굴리기
- [x] **팽이 배틀** — 3D 팽이 물리 배틀 (Three.js + 센서)
- [x] **눈치 10단** — 숫자 카드 심리전
- [x] **Digit Puzzle** — 4×4 슬라이딩 퍼즐 멀티플레이어 레이스

## 배포

- [x] GitHub Actions 워크플로우 (Windows self-hosted runner)
- [x] deploy.bat — 자동 배포 스크립트
- [x] 프로덕션 서버 독립 프로세스 실행 (wmic)
- [x] Express 정적 파일 서빙 (포트 3000)

## 문서

- [x] 아키텍처 개요 (`.docs/architecture/overview.md`)
- [x] SDK API 레퍼런스 (`.docs/architecture/sdk-api.md`)
- [x] Socket.IO 프로토콜 (`.docs/architecture/protocol.md`)
- [x] 새 게임 추가 가이드 (`.docs/game-dev-guide.md`)
- [x] 눈치 10단 기획 문서 (`.docs/games/nunchi-ten/nunchi-ten.md`)
- [x] Digit Puzzle 기획 문서 (`.docs/games/digit-puzzle/digit-puzzle.md`)
- [x] README.md
- [x] 테스트 가이드 (`walkthrough.md`)
