# Connect Dise 구현 계획서

## 프로젝트 개요

PC/태블릿 브라우저(호스트 화면)와 모바일 기기(컨트롤러) 간 실시간 통신을 통한 멀티플레이어 파티 게임 플랫폼입니다.

---

## 기술 스택

### 백엔드
- **Node.js (v18+) + Express 5**: HTTP 서버 + 프로덕션 정적 파일 서빙
- **Socket.IO**: 호스트-모바일 간 실시간 양방향 통신
- **SessionManager**: 세션/플레이어/준비 상태/재연결 관리

### 프론트엔드
- **Vite**: 멀티 엔트리 빌드, HMR, HTTPS 자동 지원
- **Vanilla JS**: 프레임워크 없이 구현
- **Three.js**: 3D 렌더링 (팽이 배틀)
- **@3d-dice/dice-box**: 3D 주사위 물리 (주사위 게임)
- **qrcode**: QR 코드 생성

### 배포
- **GitHub Actions**: Windows self-hosted runner 자동 배포
- **pm2 / wmic**: 프로덕션 서버 프로세스 관리

---

## 아키텍처 설계

### 핵심 원칙
1. **플랫폼과 게임의 완전 분리** — 서버는 게임 내용을 모름, 메시지 중계만 담당
2. **SDK 패턴** — HostSDK/MobileSDK로 통신 추상화
3. **BaseGame 패턴** — HostBaseGame/MobileBaseGame으로 공통 기능 제공
4. **멀티 엔트리 빌드** — 각 게임이 독립 HTML 페이지로 빌드

### 세션 흐름
1. 호스트가 게임 선택 → 세션 생성 → QR 코드 표시
2. 모바일이 QR 스캔 → 세션 입장 → 색상 자동 배정
3. 모든 플레이어 준비 완료 → 게임 시작
4. 게임 중 메시지: 모바일↔호스트 양방향 실시간 통신
5. 게임 종료 → 리셋 → 대기 상태 복귀

---

## 수록 게임

| 게임 | 상태 | 조작 방식 | 인원 |
|------|------|----------|------|
| 눈치 10단 | 구현 완료 | 터치 (카드 선택) | 2~6명 |
| 팽이 배틀 | 구현 완료 | 흔들기 + 기울기 (센서) | 2~6명 |
| 주사위 | 구현 완료 | 흔들기 + 더블탭 (센서/터치) | 1~6명 |

---

## 프로젝트 구조

```
connect_dise/
├── platform/          # 플랫폼 레이어 (SDK + 서버)
│   ├── client/        #   HostSDK, MobileSDK, BaseGame, shared 컴포넌트
│   └── server/        #   SessionManager
├── games/             # 게임 콘텐츠 레이어
│   ├── registry.js    #   게임 목록
│   ├── nunchi-ten/    #   눈치 10단
│   ├── spin-battle/   #   팽이 배틀
│   └── dice/          #   주사위
├── server/            # Express + Socket.IO 서버
├── src/               # 로비 페이지
└── .github/           # CI/CD
```

상세 구조와 API는 [.docs/architecture/overview.md](.docs/architecture/overview.md)를 참조하세요.
