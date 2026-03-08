# Spinner Battle - 배틀 팽이 게임 기획서

## 1. 개요

**장르**: 멀티플레이어 실시간 배틀
**컨셉**: 스마트폰의 자이로 센서로 팽이를 조종하여 상대 팽이를 보드 밖으로 밀어내는 대전 게임
**플랫폼**: PC(보드 화면) + 모바일(컨트롤러)
**플레이어**: 2~6명
**렌더링**: Three.js 기반 3D

---

## 2. 게임 흐름

```
[대기] → [런칭] → [배틀] → [결과]
```

### 2-1. 대기 (Lobby)

- 호스트(PC)가 보드 화면을 열면 세션 생성
- QR 코드로 모바일 플레이어 접속
- 각 플레이어에게 고유 색상 배정
- 최소 2명 접속 시 "START" 버튼 활성화

### 2-2. 런칭 (Launch)

- 호스트가 START → 3초 카운트다운
- 모바일에서 **폰을 빠르게 회전(비틀기)** → 초기 회전력(RPM) 결정
- 센서: `devicemotion`의 `rotationRate.alpha` 값으로 측정
- 회전력이 강할수록 팽이가 오래 버팀
- 런칭 제한 시간: 3초

### 2-3. 배틀 (Battle)

- 모든 팽이가 보드 위에 동시에 스폰
- **폰 기울기 → 팽이 이동 방향** (deviceorientation beta/gamma)
- 팽이끼리 충돌 → 물리 반응 (밀려남)
- 시간이 지날수록 RPM 감소 → 팽이 흔들림 증가
- 보드 밖으로 나가면 탈락
- RPM이 0이 되면 쓰러져서 탈락

### 2-4. 결과 (Result)

- 마지막 생존자 승리
- 보드에 순위 표시 + 승자 이펙트
- "다시 하기" 버튼

---

## 3. 게임 메카닉 상세

### 3-1. 팽이 속성

| 속성 | 설명 | 범위 |
|------|------|------|
| RPM | 회전 속도. 런칭 시 결정, 시간/충돌로 감소 | 0 ~ 3000 |
| position | 보드 위 x, z 좌표 | 원형 보드 반경 내 |
| velocity | 현재 이동 속도 벡터 | - |
| mass | 충돌 시 밀리는 정도 (모든 팽이 동일) | 1.0 |

### 3-2. RPM 감소 규칙

```
매 프레임:
  rpm -= BASE_DECAY (자연 감소, ~2/frame)

충돌 시:
  rpm -= COLLISION_PENALTY (충돌 페널티, ~50~150)

보드 가장자리 접촉 시:
  rpm -= EDGE_PENALTY (가장자리 마찰, ~5/frame)
```

### 3-3. 기울기 → 이동 변환

```javascript
// deviceorientation 이벤트
const tiltX = gamma / 45;  // -1 ~ 1 (좌우)
const tiltZ = beta  / 45;  // -1 ~ 1 (전후)

// 이동력은 RPM에 비례 (RPM 낮으면 조종 불가)
const movePower = (rpm / MAX_RPM) * MAX_MOVE_FORCE;
topBody.applyForce(tiltX * movePower, tiltZ * movePower);
```

### 3-4. 충돌 물리

- 원형 충돌체 (Circle-Circle collision)
- 충돌 시 RPM이 높은 쪽이 유리 (반발력 차이)
- 충돌 반발 공식:
  ```
  pushForce = (myRPM - opponentRPM) * COLLISION_FACTOR
  // 양수면 상대를 밀어냄, 음수면 내가 밀림
  ```

### 3-5. 보드 경계

- 원형 보드 (카지노 테이블 재활용)
- 경계선에 닿으면 반발 + RPM 페널티
- 경계선 밖으로 완전히 나가면 즉시 탈락

---

## 4. 화면 구성

### 4-1. 보드 화면 (PC - `top.html`)

```
+--------------------------------------------------+
|  [QR]                                      [QR]  |
|        +----------------------------------+       |
|        |        원형 배틀 보드             |       |
|        |                                   |       |
|        |   🔴 ← 플레이어1 팽이            |       |
|        |          🔵 ← 플레이어2 팽이     |       |
|        |     🟢 ← 플레이어3 팽이          |       |
|        |                                   |       |
|        +----------------------------------+       |
|  [QR]    P1: ■■■■■■□□ 2100rpm      [QR]  |
|           P2: ■■■■□□□□ 1400rpm            |
|           P3: ■■■■■□□□ 1800rpm            |
+--------------------------------------------------+
```

**요소:**
- 3D 원형 보드 (약간 오목한 접시 형태)
- 각 플레이어 팽이 (3D 모델, 플레이어 색상 적용)
- 팽이 회전 애니메이션 (RPM에 비례)
- RPM 낮아지면 팽이 축 흔들림(세차 운동) 추가
- 하단에 각 플레이어 RPM 게이지 바
- 충돌 시 스파크/파티클 이펙트

### 4-2. 모바일 컨트롤러 (`top-mobile.html`)

```
+--------------------+
|  Session: ABC123   |
|  ● Connected       |
+--------------------+
|                    |
|  [팽이 3D 미리보기] |
|                    |
+--------------------+
|  RPM: ■■■■■■□□    |
|       2100 rpm     |
+--------------------+
|  기울여서 조종!     |
|  [수평계 인디케이터] |
+--------------------+
```

**런칭 단계:**
```
+--------------------+
|                    |
|    📱 비틀어서     |
|    런칭하세요!     |
|                    |
|  [회전 게이지]     |
|  ████████░░ 2800   |
|                    |
+--------------------+
```

---

## 5. 기술 설계

### 5-1. 신규 파일 구조

```
connect_dise/
├── top.html              # 보드(호스트) 페이지
├── top-mobile.html       # 모바일 컨트롤러 페이지
├── src/
│   ├── top/
│   │   ├── TopGame.js        # 게임 루프, 상태 관리
│   │   ├── TopRenderer.js    # Three.js 3D 렌더링
│   │   ├── TopPhysics.js     # 2D 물리 (충돌, 이동, 경계)
│   │   ├── TopModel.js       # 팽이 3D 모델 생성
│   │   └── TopUI.js          # HUD (RPM 바, 순위, 카운트다운)
│   ├── top-main.js           # 보드 진입점
│   ├── top-mobile.js         # 모바일 진입점
│   └── top-style.css         # 팽이 게임 전용 스타일
├── docs/
│   └── spinner-battle.md     # 이 문서
```

### 5-2. Socket 이벤트 설계

| 이벤트 | 방향 | 페이로드 | 설명 |
|--------|------|----------|------|
| `createTopSession` | Mobile → Server | `{ sessionId }` | 팽이 게임 세션 생성 |
| `topSessionCreated` | Server → Host | `{ sessionId, localIp }` | 세션 생성 확인 |
| `startGame` | Host → Server | `{ sessionId }` | 게임 시작 신호 |
| `launchPhase` | Server → All | `{}` | 런칭 단계 시작 |
| `launchSpin` | Mobile → Server | `{ sessionId, rpm }` | 런칭 회전력 전송 |
| `battleStart` | Server → All | `{ players: [{id, color, rpm}] }` | 배틀 시작, 초기 상태 |
| `tiltInput` | Mobile → Server | `{ sessionId, tiltX, tiltZ }` | 기울기 입력 (30fps) |
| `tiltUpdate` | Server → Host | `{ playerId, tiltX, tiltZ }` | 기울기 포워딩 |
| `playerEliminated` | Host → Server | `{ sessionId, playerId, reason }` | 탈락 알림 |
| `eliminated` | Server → Mobile | `{ rank, reason }` | 탈락 통보 |
| `gameOver` | Server → All | `{ rankings: [{id, color, rank}] }` | 게임 종료 |

### 5-3. 게임 루프 (Host 측, 60fps)

```
매 프레임:
  1. 서버로부터 각 플레이어 tilt 입력 수신
  2. 각 팽이에 tilt 기반 힘 적용
  3. 물리 시뮬레이션 (이동, 충돌 감지, 반발)
  4. RPM 자연 감소 처리
  5. 경계 체크 (탈락 판정)
  6. RPM 0 체크 (쓰러짐 판정)
  7. Three.js 렌더 (위치, 회전, 세차 운동)
  8. HUD 업데이트
```

### 5-4. Three.js 씬 구성

```
Scene
├── AmbientLight (부드러운 전체 조명)
├── DirectionalLight (위에서 비추는 주 조명 + 그림자)
├── PointLight (보드 중앙, 따뜻한 톤)
├── Board (오목한 원형 접시, 카지노 느낌 텍스처)
│   ├── BoardRim (골드 테두리)
│   └── BoardSurface (그린 펠트)
├── Top[] (팽이 배열)
│   ├── Body (원뿔 + 원기둥 조합)
│   ├── Tip (뾰족한 하단)
│   └── Ring (플레이어 색상 링)
├── ParticleSystem (충돌 스파크)
└── Camera (위에서 약간 비스듬하게 내려다보는 구도)
```

### 5-5. 팽이 3D 모델 (프로시저럴 생성)

```javascript
// LatheGeometry로 팽이 실루엣 생성
const profile = [
  new Vector2(0,    -0.5),   // 뾰족한 끝
  new Vector2(0.1,  -0.3),   // 하단 좁은 부분
  new Vector2(0.8,   0.0),   // 넓은 디스크
  new Vector2(0.7,   0.1),   // 디스크 상단
  new Vector2(0.2,   0.3),   // 상단 좁아지는 부분
  new Vector2(0.05,  0.5),   // 꼭대기
  new Vector2(0,     0.5),   // 중심축
];
const geometry = new LatheGeometry(profile, 32);
```

---

## 6. Vite 설정 변경

```javascript
// vite.config.js - input 추가
input: {
  main: resolve(__dirname, 'index.html'),
  mobile: resolve(__dirname, 'mobile.html'),
  top: resolve(__dirname, 'top.html'),
  topMobile: resolve(__dirname, 'top-mobile.html'),
}
```

---

## 7. 서버 변경 사항 (`server/index.js`)

기존 세션 관리에 `gameMode` 필드 추가:

```javascript
sessions.set(sessionId, {
  hostSocket: socket.id,
  players: [],
  gameMode: 'dice' | 'spinner',  // 게임 모드 구분
  gameState: 'lobby' | 'launching' | 'battle' | 'result'
});
```

팽이 전용 소켓 이벤트 핸들러 추가 (기존 주사위 이벤트와 병렬).

---

## 8. 재사용 가능한 기존 코드

| 기존 모듈 | 재사용 내용 |
|-----------|-------------|
| `server/index.js` | 세션 관리, 색상 배정, Socket.IO 기반 구조 |
| `src/style.css` | QR 컨테이너, 모달, 모바일 컨트롤러 기본 레이아웃 |
| `vite.config.js` | 멀티페이지 빌드, SSL, 프록시 설정 |
| `mobile.js` (센서) | DeviceOrientation/Motion 퍼미션 플로우, 수평계 UI |
| 카지노 테이블 CSS | 보드 배경 스타일 (펠트 텍스처, 골드 레일) |

---

## 9. 구현 우선순위

### Phase 1: MVP (핵심 플레이 가능)
1. `top.html` + `top-main.js` — Three.js 씬, 보드, 팽이 모델 렌더링
2. `top-mobile.html` + `top-mobile.js` — 기울기 입력 + 런칭 UI
3. `server/index.js` 이벤트 추가 — tilt 포워딩
4. `TopPhysics.js` — 2D 원형 충돌 + 경계 체크
5. 기본 게임 루프 (lobby → launch → battle → result)

### Phase 2: 게임성 강화
6. RPM 세차 운동 시각화 (팽이 축 흔들림)
7. 충돌 스파크 파티클
8. RPM 게이지 바 HUD
9. 카운트다운 + 결과 화면 연출

### Phase 3: 폴리싱
10. 사운드 이펙트 (충돌, 런칭, 승리)
11. 팽이 커스터마이징 (모양/색상)
12. 관전 모드 (탈락 후 보드 시청)

---

## 10. 리스크 및 고려사항

- **센서 정밀도**: iOS vs Android 자이로 센서 편차 → 캘리브레이션 필요할 수 있음
- **네트워크 지연**: tilt 데이터 30fps 전송 시 지연이 체감될 수 있음 → 클라이언트 보간 필요
- **Three.js 번들 크기**: ~600KB gzip → 별도 청크로 분리 권장
- **동시 접속**: 6명까지 초당 30회 tilt 이벤트 = 180msg/s → Socket.IO로 충분
