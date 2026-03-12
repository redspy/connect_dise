# Give You Fire — 구현 상세 기록

이 문서는 Give You Fire 게임의 구현 과정을 단계별로 기록합니다.

---

## Step 1: 프로젝트 구조 설계 및 디렉토리 생성

**생성한 폴더:**
```
games/give-you-fire/
├── shared/   ← 호스트·모바일 공용 라이브러리
├── host/     ← 호스트(PC) 페이지
└── mobile/   ← 모바일(컨트롤러) 페이지
```

**설계 결정:**
- `shared/` 폴더를 두어 테트리스 엔진과 렌더러를 호스트·모바일이 공유하게 함
- 플랫폼 패턴: `HostBaseGame` / `MobileBaseGame` 상속

---

## Step 2: `shared/TetrisEngine.js` — 테트리스 게임 엔진

**역할:** DOM 의존성 없는 순수 게임 로직 라이브러리

**구현 내용:**

### 테트로미노 정의
- 7종 (I, O, T, S, Z, J, L), 타입 ID 1~7
- `BASE_SHAPES`: 각 피스의 기본(회전 0°) 모양을 4×4 바운딩 박스 내 `[행, 열]` 좌표 배열로 정의
- `rotateCW(cells)`: 4×4 그리드에서 90° 시계 방향 회전 `(r, c) → (c, 3-r)`
- `PIECE_SHAPES`: 전체 4가지 회전 상태를 미리 계산 (런타임 성능 확보)

### 7-Bag 랜덤 시스템
- 7종 피스를 Fisher-Yates 셔플로 묶어 큐에 넣음
- 큐가 비면 자동 리필 → 모든 피스가 고르게 등장 보장

### 보드
- `board`: 20×10 2D 배열 (`0`=빈칸, `1-7`=피스 타입)
- 현재 낙하 중인 피스는 보드와 분리 저장

### 주요 메서드
| 메서드 | 설명 |
|--------|------|
| `spawn()` | 다음 피스를 상단 중앙에 스폰, 충돌 시 `false` 반환 (게임오버) |
| `moveLeft/Right()` | 좌우 이동, 충돌 시 false |
| `moveDown()` | 한 칸 아래, 착지 시 false |
| `rotate()` | 90° CW 회전 + Wall Kick (오프셋 0, ±1, ±2 순으로 시도) |
| `hardDrop()` | 즉시 착지 위치로 이동 |
| `lock()` | 보드에 고정 후 완성 줄 제거, 클리어 수 반환 |
| `getBoardSnapshot()` | 현재 피스 포함 보드 스냅샷 (렌더링·전송용) |
| `getGhostCells()` | 고스트 피스(착지 예상 위치) 셀 좌표 |

### Wall Kick
충돌 시 오프셋 `[0, +1, -1, +2, -2]` 순으로 수평 이동 후 재시도.
성공하면 회전 적용, 모두 실패하면 회전 취소.

### 속도 공식
```javascript
dropInterval(level) = Math.max(50, Math.round(1000 - (level - 1) * 9.6))
// 레벨 1 = 1000ms, 레벨 100 = 50ms
```

---

## Step 3: `shared/BoardRenderer.js` — 캔버스 렌더러

**역할:** 보드 스냅샷을 HTMLCanvasElement에 그리는 공용 유틸리티

**구현 내용:**

### `PIECE_COLORS` 배열
| ID | 색상 | 피스 |
|----|------|------|
| 1  | `#00e5ff` | I (시안) |
| 2  | `#ffea00` | O (옐로우) |
| 3  | `#cc44ff` | T (퍼플) |
| 4  | `#00ffb3` | S (민트) |
| 5  | `#ff2244` | Z (레드) |
| 6  | `#0077ff` | J (블루) |
| 7  | `#ff8800` | L (오렌지) |

### `renderBoard(canvas, snapshot, opts)`
- 캔버스 크기에 맞게 셀 크기 자동 계산 (중앙 정렬)
- 블록: 타입별 색상 + 상단/좌측 하이라이트 효과
- 고스트 피스: 반투명 흰색 (`globalAlpha = 0.25`)
- 그리드 선: 미세한 어두운 선 (`showGrid` 옵션)
- 탈락 오버레이: `isDead = true` 시 반투명 오버레이 + "GAME OVER" 텍스트

### `renderNextPiece(canvas, pieceInfo)`
- 4×4 그리드 기준으로 다음 피스 미리보기 렌더링

---

## Step 4: `host/TetrisGame.js` — 호스트 게임 클래스

**역할:** `HostBaseGame` 상속, 로비·대시보드·결과 화면 관리

**구현 내용:**

### 상태 관리
- `_profiles`: `id → { nickname }`
- `_playerData`: `id → { level, lines, board, alive, rank }`

### 페이즈
- `lobby` → `playing` → `result`

### 4코너 QR
- `onSetup()`에서 `renderQR()`을 4개 코너 컨테이너에 호출
- 모두 동일 URL, 시각적으로 4코너에 배치

### 로비 옵션
- **다음 블록 미리보기 체크박스**: `chk-next-piece` → `_showNextPiece` 상태 관리
- `gameStarted` 메시지에 `showNextPiece` 포함하여 전송

### 메시지 처리
| 수신 메시지 | 처리 |
|------------|------|
| `setProfile` | 닉네임 저장, 로비 갱신, playerListUpdated 브로드캐스트 |
| `boardUpdate` | 미니 보드 캔버스 재렌더링, 레벨 바 갱신 |
| `linesCleared` | 클리어한 플레이어 외 모두에게 `levelUp { newLevel }` 전송 |
| `gameOver` | 해당 플레이어 탈락 처리, 1명 남으면 게임 종료 |
| `soloClear` | 1인 모드 클리어 처리 |
| `requestRematch` | `resetSession()` 호출 |

### 대시보드 렌더링
- 2×2 그리드로 플레이어 카드 배치
- 각 카드: 닉네임 + 레벨 텍스트 / 레벨 프로그래스 바 / 미니 캔버스 / 상태
- 탈락 시 카드 흐리게 + "N위 탈락" 표시

---

## Step 5: `host/index.html` — 호스트 HTML

**구조:**
- `data-phase="lobby"`: 4코너 QR + 중앙 로비 패널 (닉네임 목록, 체크박스, 시작 버튼)
- `data-phase="playing"`: 상단 헤더(게임 타이틀, 경과 시간, 리셋) + 대시보드 그리드
- `data-phase="result"`: 최종 순위 패널

---

## Step 6: `host/style.css` — 호스트 스타일

**색상 팔레트 (CSS 변수):**
```
--gyf-bg: #080c14        (다크 네이비 배경)
--gyf-panel: #0f1923     (카드 패널)
--gyf-fire: #ff6a00      (파이어 오렌지 포인트)
--gyf-mint: #00ffb3      (민트 대비색)
--gyf-text: #dff0ff      (메인 텍스트)
--gyf-sub: #5a80a0       (서브 텍스트)
--gyf-danger: #ff2244    (위험/탈락)
```

**주요 클래스:**
- `.gyf-qr[data-corner]`: 4코너 QR 절대 위치 배치
- `.gyf-dashboard-grid`: 2×2 CSS Grid
- `.gyf-card-bar`: 레벨 프로그래스 바 (`transition: width 0.4s ease`)
- `.gyf-mini-board`: 미니 캔버스 (`max-width: 120px`)

---

## Step 7: `mobile/TetrisMobile.js` — 모바일 게임 클래스

**역할:** `MobileBaseGame` 상속, 실제 테트리스 게임 플레이 처리

**구현 내용:**

### 화면 흐름
`setup` → `waiting` → `game` → `eliminated` / `solo-clear` / `result`

### 게임 루프
1. `gameStarted` 수신 → `TetrisEngine` 생성 → 첫 피스 스폰
2. `_dropTimer`: `dropInterval(level)` ms마다 `moveDown()` 실행
3. 착지 시 `lock()` → 라인 클리어 → 다음 피스 스폰
4. 스폰 실패 시 `gameOver` 전송

### 조작 구현

**DAS (Delayed Auto Shift):**
- `touchstart`: 즉시 1칸 이동
- `DAS_DELAY(150ms)` 후 `DAS_REPEAT(50ms)` 간격으로 연속 이동

**소프트 드롭:**
- 버튼 홀드 중 `SOFT_DROP_MS(50ms)` 간격으로 낙하
- 버튼 해제 시 일반 낙하 타이머 재시작

**하드 드롭:**
- `hardDrop()` 호출 후 즉시 `lock()`

**보드 탭 → 회전:**
- `touchstart` / `click` 이벤트 모두 처리

### 레벨 시스템
- `_startLevelTimer()`: `setInterval(5000ms)`으로 자동 레벨 상승
- `levelUp { newLevel }` 수신 시 `Math.max(current, newLevel)` 적용
- 레벨업 공격 수신 시 레벨 바 플래시 + 진동

### boardUpdate 전송
- 100ms 스로틀 (`BOARD_SEND_MS`)
- 피스 고정 시 즉시 강제 전송 (`_forceBoardSend`)
- 전송 내용: `{ board: number[][], level, lines }`

---

## Step 8: `mobile/index.html` — 모바일 HTML

**화면별 구조:**
- `setup`: 닉네임 입력 + 참여 버튼
- `waiting`: 닉네임 표시 + 대기 중 플레이어 목록 + 준비 버튼
- `game`: 레벨 바 / 보드 캔버스 + 미리보기 패널 / 5버튼 컨트롤
- `eliminated`: "GAME OVER" + 관전 안내
- `solo-clear`: "CLEAR!" + 달성 메시지
- `result`: 내 순위 + 전체 순위 + 다시하기

---

## Step 9: `mobile/style.css` — 모바일 스타일

**레이아웃 전략:**
- `height: 100dvh` (Dynamic Viewport Height — iOS 주소 바 대응)
- `touch-action: none` 전역 적용 → 브라우저 기본 스크롤/줌 방지
- 게임 화면: `flex column`으로 레벨 바 / 보드 / 버튼 영역 분할
- 보드 캔버스: `height: 100%; width: auto`로 세로 꽉 채움

**5버튼 컨트롤 스타일:**
- 5개 버튼 균등 분배 (`flex: 1`)
- 하드 드롭: 파이어 색상 강조
- 소프트 드롭: 민트 색상 강조
- `padding-bottom: max(6px, env(safe-area-inset-bottom))` — iPhone 홈 바 대응

---

## Step 10: 등록 파일 업데이트

### `games/registry.js`
```javascript
{
  id: 'give-you-fire',
  name: 'Give You Fire',
  description: '배틀 테트리스! 라인 클리어로 상대방을 불태워라 🔥',
  hostPath: '/games/give-you-fire/host/',
  mobilePath: '/games/give-you-fire/mobile/',
  minPlayers: 1,
  maxPlayers: 4,
  thumbnail: '🔥',
}
```

### `vite.config.js`
```javascript
giveYouFireHost:   resolve(__dirname, 'games/give-you-fire/host/index.html'),
giveYouFireMobile: resolve(__dirname, 'games/give-you-fire/mobile/index.html'),
```

---

## 아키텍처 다이어그램

```
Mobile (TetrisMobile)           Host (TetrisGame)
─────────────────────           ─────────────────

TetrisEngine (게임 로직)
  └─ spawn/move/rotate/lock
  └─ getBoardSnapshot()

BoardRenderer (공용 렌더러)
  └─ renderBoard(canvas, snap)  ←─ 미니 보드 렌더링
  └─ renderBoard(canvas, snap)  ←─ 풀 보드 렌더링 (모바일)

메시지 흐름:
  M→H: boardUpdate     →  미니 보드 갱신
  M→H: linesCleared    →  levelUp 공격 전송
  M→H: gameOver        →  탈락 처리
  H→M: levelUp         →  속도 강제 상승
  H→M: gameStarted     →  게임 시작
  H→M: gameFinished    →  결과 표시
```

---

## 검증 방법

1. `npm run dev` 실행
2. PC: 로비에서 "Give You Fire" 카드 클릭 → 4코너 QR 확인
3. 모바일: QR 스캔 → 닉네임 입력 → 준비
4. 1인 플레이: 혼자 준비 후 게임 시작 → 레벨 100까지 플레이
5. 멀티: 2명 이상 준비 → 게임 시작 → 라인 클리어 시 상대 레벨 바 상승 확인
6. 블록이 쌓여 탈락 → 탈락 화면 + 호스트 카드 흐리게 확인
7. 1명 남으면 게임 종료 → 결과 화면 확인
8. 다시하기 → 로비로 복귀 확인
