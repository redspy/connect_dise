# Connect Dise

PC(호스트) 1대와 모바일 n대를 실시간 연결하는 멀티플레이어 게임 플랫폼입니다.

## 수록 게임

| 게임 | 인원 | 비고 |
|---|---:|---|
| 눈치 10단 | 2~6 | 숫자 카드 심리전 |
| Digit Puzzle | 2~4 | 4x4 슬라이딩 퍼즐 레이스 |
| 팽이 배틀 | 2~6 | 센서 기반 배틀 + 아이템 |
| 주사위 | 1~6 | 모바일 동작으로 3D 주사위 던지기 |
| Give You Fire | 1~4 | 배틀 테트리스 |
| 그림 릴레이 | 2~8 | 그림/단어 릴레이 파티게임 |
| 오목 | 1인 | 로컬 AI 대전 |

## 기술 스택
- Frontend: Vanilla JS, Vite
- Backend: Node.js, Express 5, Socket.IO
- 실시간 전송: WebRTC DataChannel(P2P) 우선 + Socket.IO 폴백
- 3D: Three.js, `@3d-dice/dice-box`

## 실행

```bash
npm install
npm run dev
```

- Express: `http://0.0.0.0:3000`
- Vite: `https://0.0.0.0:5173`

프로덕션:

```bash
npm run build
node server/index.js
```

## 프로젝트 구조

```text
connect_dise/
├── docs/                        # 공식 문서
├── games/                       # 게임별 구현
├── platform/                    # SDK / SessionManager / 공용 컴포넌트
├── server/                      # Express + Socket.IO 서버
├── src/                         # 로비 페이지
├── vite.config.js
└── README.md
```

## 문서

- 문서 인덱스: [`docs/README.md`](./docs/README.md)
- 아키텍처: [`docs/architecture.md`](./docs/architecture.md)
- 이벤트 프로토콜: [`docs/protocol.md`](./docs/protocol.md)
- SDK API: [`docs/sdk-api.md`](./docs/sdk-api.md)
- 구현 이슈: [`docs/known-issues.md`](./docs/known-issues.md)
