# Dobble 멀티플레이어 게임 포팅 계획

## 컨셉 변경 요약

| 항목 | 원본 (Dobble/) | 플랫폼 포팅 |
|------|--------------|------------|
| 인원 | 2인 고정 (한 기기) | 2~6인 (각자 폰) |
| 중앙 카드 | 화면 중앙 | 호스트 PC 화면에 표시 |
| 플레이어 카드 | 화면 상/하 | 각 플레이어 폰 화면 전체 |
| 모드 선택 | 게임 시작 전 | 호스트 로비에서 선택 |
| 점수 목표 | 10점 고정 | 호스트 설정 (5/10/15) |
| 이미 구현 안된 것 | 모바일 세로 모드 레이아웃 미완성 | 새로 작성 |

---

## 게임 흐름

```
로비 → QR 스캔 (2~6명) → 전원 준비
→ 호스트: 중앙 카드 + 전체 점수판 표시
→ 모바일: 각자 자신의 카드 (8개 심볼) 표시
→ 일치 심볼 탭 → 정답: 내 카드가 새 중앙 카드로, 새 카드 수령
                   오답: 3초 freeze 패널티
→ 설정 점수 선취 → 승리 → 결과 화면 → 다시하기/로비
```

---

## 생성할 파일 (9개)

| 파일 | 역할 |
|------|------|
| `games/dobble/host/main.js` | HostSDK 초기화 + DobbleGame 인스턴스 |
| `games/dobble/host/DobbleGame.js` | HostBaseGame 상속, 로비/게임/결과 관리 |
| `games/dobble/host/index.html` | 중앙 카드 + QR + 점수판 |
| `games/dobble/host/style.css` | `db-` 접두사 스타일 |
| `games/dobble/mobile/main.js` | MobileSDK 초기화 + DobbleMobile 인스턴스 |
| `games/dobble/mobile/DobbleMobile.js` | MobileBaseGame 상속, 카드 렌더/탭 처리 |
| `games/dobble/mobile/index.html` | 셋업/대기/게임/결과 화면 |
| `games/dobble/mobile/style.css` | 모바일 카드 풀스크린 레이아웃 |
| `games/dobble/shared/DobbleEngine.js` | 덱 생성 + 심볼 데이터 (shared) |

## 수정할 파일 (2개)

| 파일 | 변경 |
|------|------|
| `games/registry.js` | dobble 항목 추가 (`group: 'multi'`) |
| `vite.config.js` | host/mobile 엔트리 2개 추가 |

## 에셋 복사

```
/Users/soul/Source/Dobble/symbols/*.png (143개)
→ games/dobble/assets/symbols/
```
게임에서 실제 사용하는 심볼은 57개 (`validSymbolIndices` 기준).

---

## DobbleEngine.js (shared)

호스트와 모바일 양쪽이 import하여 심볼 데이터와 덱 생성 로직을 공유.

```js
// 심볼 상수
export const TOTAL_SYMBOLS = 57;
export const SYMBOLS_PER_CARD = 8;

// 이미지 모드: 원본 validSymbolIndices (57개)
export const validSymbolIndices = [3,4,5,7,...,80];

// 텍스트 모드 심볼 배열 (각 57개)
export const hanjaSymbols     = ["天","地",...];
export const hiraganaSymbols  = ["あ","い",...];
export const katakanaSymbols  = ["ア","イ",...];

// 피드백 배열
export const hanjaMeanings    = ["하늘","땅",...];
export const kanaHangulFeedback = ["아","이",...];

// 이미지 경로 생성
export function getSymbolPath(idx) {
  return `/games/dobble/assets/symbols/symbol_${String(validSymbolIndices[idx]).padStart(3,'0')}.png`;
}

// Projective Plane Order 7 덱 생성 (57장, 카드당 8심볼)
export function generateDeck() { ... }  // 원본 generateDobbleDeck() 포팅

// 덱 셔플
export function shuffleDeck(deck) { ... }
```

---

## 호스트 (DobbleGame.js)

**패턴**: NunchiGame과 동일하게 HostBaseGame 상속

```
constructor(sdk)
  super(sdk, { overlayClass: 'db-overlay', qrContainerId: null })
  _profiles: Map<id, { nickname, color }>
  _scores:   Map<id, number>
  _frozen:   Map<id, timeout>    // 패널티 중인 플레이어
  _deck:     number[][]          // 남은 덱
  _centerCard: number[]          // 현재 중앙 카드
  _playerCards: Map<id, number[]>
  _mode: 'image' | 'hanja' | 'hiragana' | 'katakana'
  _winScore: 5 | 10 | 15
  _roundActive: boolean          // 동시 탭 중복 방지용 짧은 lock
```

**페이즈**: `lobby` → `playing` → `result`

**핵심 메서드**:
- `onSetup()`: QR 렌더링, 모드/점수 설정 UI, `setPhase('lobby')`
- `onPlayerJoin(player)`: 로비 플레이어 목록 갱신
- `onAllReady()`: `_startGame()` 호출
- `_startGame()`:
  1. `generateDeck()` → 셔플
  2. 각 플레이어에게 카드 1장 분배
  3. 덱 상단에서 중앙 카드 뽑기
  4. `broadcast('gameStarted', { mode, winScore })`
  5. 각 플레이어에게 `sendToPlayer(id, 'cardDealt', { card })`
  6. `broadcast('centerCardUpdated', { card: _centerCard })`
  7. `setPhase('playing')`
- `_onTapSymbol(id, symbolIndex)`:
  - frozen 중이면 무시
  - `_roundActive` lock 중이면 무시 (동시 탭 방지 30ms)
  - `_centerCard.includes(symbolIndex)` 확인
  - **정답**:
    1. `_roundActive = true` (lock)
    2. 점수++
    3. 승리 체크 → `_endGame()` 분기
    4. 이 플레이어의 현재 카드 → 새 중앙 카드
    5. 덱에서 새 카드 분배 (덱 소진 시 재생성)
    6. 2초 후: `sendToPlayer(id, 'tapResult', { correct: true, newCard })`
    7. `broadcast('stateUpdate', { centerCard, scores, frozenPlayers })`
    8. `_roundActive = false` (unlock)
  - **오답**:
    1. freeze 3초 설정
    2. `sendToPlayer(id, 'tapResult', { correct: false, penaltyMs: 3000 })`
    3. `broadcast('stateUpdate', { ..., frozenPlayers })`
- `_endGame()`: `broadcast('gameFinished', { rankings })`, `setPhase('result')`
- `onReset()`: 점수/덱/카드 초기화, 로비로

**메시지 핸들러**:
```
onMessage('setProfile',     (id, { nickname }))
onMessage('tapSymbol',      (id, { symbolIndex }))
onMessage('requestRematch', (id, {}))
```

---

## 호스트 화면 레이아웃

```
┌─────────────────────────────────────────────────────────────────┐
│  Dobble          모드: [그림▼]  목표: [10점▼]   ← 로비 설정 UI  │
│─────────────────────────────────────────────────────────────────│
│                                                                  │
│              ┌──────────────────────────────┐                   │
│              │                              │                   │
│              │       중앙 카드               │                   │
│              │   (8개 심볼, 원형 4x2 배치)   │                   │
│              │                              │                   │
│              └──────────────────────────────┘                   │
│                                                                  │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│   │  Soul    │  │  Jay     │  │  Kim     │  │  Lee     │      │
│   │  ■■■■░░  │  │  ■■░░░░  │  │  ■░░░░░  │  │ ❄️freeze │      │
│   │   4점    │  │   2점    │  │   1점    │  │   0점    │      │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│                                                                  │
│  [QR 코드]                                                       │
└─────────────────────────────────────────────────────────────────┘
```

- 중앙 카드: 4×2 그리드, 심볼 클릭 불가 (display only)
- 플레이어 카드: 이름 + 점수바 (`width: score/winScore * 100%`) + freeze 표시
- 로비에서만 QR 노출 (게임 중 숨김)

---

## 모바일 (DobbleMobile.js)

**패턴**: RelayDrawingMobile과 동일하게 MobileBaseGame 상속

```
constructor(sdk)
  super(sdk, { screenClass: 'db-screen' })
  _myCard: number[]        // 현재 내 카드 (심볼 인덱스 배열)
  _mode: string
  _isFrozen: boolean
  _freezeTimer: null
  _winScore: number
```

**화면**: `setup` → `waiting` → `game` → `result`

**`game` 화면 구조 (풀스크린 세로)**:
```
┌─────────────────┐
│ 닉네임    3 / 10 │  ← 점수
│─────────────────│
│  ┌───┐  ┌───┐  │
│  │ 🐱│  │ 🌙│  │
│  └───┘  └───┘  │
│  ┌───┐  ┌───┐  │
│  │ ⭐│  │ 🔥│  │  ← 내 카드 (4×2 그리드, 탭 가능)
│  └───┘  └───┘  │
│  ┌───┐  ┌───┐  │
│  │ 🎵│  │ 🌈│  │
│  └───┘  └───┘  │
│  ┌───┐  ┌───┐  │
│  │ 🦊│  │ 💎│  │
│  └───┘  └───┘  │
│─────────────────│
│  ❄️ 패널티 2초... │  ← freeze 오버레이 (평소 hidden)
└─────────────────┘
```

**핵심 메서드**:
- `_renderCard(card)`: 8개 심볼 그리드 렌더 (mode에 따라 이미지/텍스트)
- `_handleTap(symbolIndex)`: freeze 중 무시, `sendToHost('tapSymbol', { symbolIndex })`
- `_applyFreeze(ms)`: 카드 전체에 freeze 오버레이, timer 후 해제
- `_applyMatchEffect(symbolIndex)`: 탭한 심볼에 2초 금빛 pulse 애니메이션

**메시지 핸들러**:
```
onMessage('playerListUpdated', ({ players }))  → 대기 화면 목록 갱신
onMessage('gameStarted',       ({ mode, winScore }))
onMessage('cardDealt',         ({ card }))      → _myCard 초기값 세팅
onMessage('tapResult',         ({ correct, newCard?, penaltyMs? }))
  → correct: _applyMatchEffect → 2초 후 _renderCard(newCard)
  → !correct: _applyFreeze(penaltyMs)
onMessage('stateUpdate',       ({ scores, frozenPlayers }))  → 점수 표시 갱신
onMessage('gameFinished',      ({ rankings }))  → result 화면
```

---

## 메시지 프로토콜

| 방향 | type | payload | 시점 |
|------|------|---------|------|
| M→H | `setProfile` | `{ nickname }` | 닉네임 입력 |
| M→H | `tapSymbol` | `{ symbolIndex }` | 심볼 탭 |
| M→H | `requestRematch` | `{}` | 다시하기 |
| H→All | `playerListUpdated` | `{ players }` | 입장/변경 |
| H→All | `gameStarted` | `{ mode, winScore }` | 게임 시작 |
| H→player | `cardDealt` | `{ card: number[] }` | 카드 지급 |
| H→All | `centerCardUpdated` | `{ card: number[] }` | 중앙 카드 변경 |
| H→player | `tapResult` | `{ correct, newCard?, penaltyMs? }` | 탭 결과 |
| H→All | `stateUpdate` | `{ centerCard, scores, frozenPlayers }` | 상태 동기화 |
| H→All | `gameFinished` | `{ winner, rankings }` | 게임 종료 |

---

## 동시 탭 처리 전략

여러 플레이어가 거의 동시에 정답을 탭할 경우:
- 호스트가 먼저 수신된 `tapSymbol` 메시지를 처리
- `_roundActive = true` lock으로 30ms 내 중복 처리 차단
- 이후 도착한 동일 라운드 탭은 무시 (오답 처리도 하지 않음)
- lock 해제 후 새 라운드 시작

---

## 원본 미완성 항목 처리

| 원본 task.md 항목 | 포팅 방식 |
|-------------------|----------|
| `Responsive Layout (Mobile Portrait Fix)` | 모바일 CSS를 세로 고정 풀스크린으로 새로 작성 (`100dvh`, 4×2 그리드 `flex: 1` 분할) |
| 2인 고정 | 2~6인 멀티플레이어로 확장, 덱은 플레이어 수에 무관하게 57장 |

---

## 로비 설정 (호스트)

```
모드:    [그림] [한자] [히라가나] [가타카나]
목표점수: [5점]  [10점] [15점]
```
- 기본값: 그림 모드 / 10점
- 설정은 `gameStarted` payload에 포함되어 모바일로 전달

---

## 심볼 렌더링 (모바일 기준)

```
mode === 'image'
  → <img src="/games/dobble/assets/symbols/symbol_XXX.png">
  → random rotation (0~360°), scale(0.9~1.1)

mode === 'hanja'
  → <div class="symbol-text">天</div>
  → 정답 시 피드백: 뜻(하늘) + 훈독(천)

mode === 'hiragana' | 'katakana'
  → <div class="symbol-text">あ</div>
  → 정답 시 피드백: 한글 발음(아)
```

---

## 참조 파일

- `/Users/soul/Source/Dobble/script.js` — 원본 게임 로직 (덱 생성, 심볼 배열, 탭 처리)
- `/Users/soul/Source/Dobble/style.css` — 원본 CSS (심볼 컨테이너, match-highlight, freeze 스타일)
- `/Users/soul/Source/connect_dise/games/nunchi-ten/host/NunchiGame.js` — 호스트 패턴
- `/Users/soul/Source/connect_dise/games/nunchi-ten/mobile/NunchiMobile.js` — 모바일 패턴
- `/Users/soul/Source/connect_dise/games/relay-drawing/mobile/RelayDrawingMobile.js` — 풀스크린 모바일 패턴

---

## 검증 방법

1. `npm run dev`
2. PC에서 로비 → Dobble 카드 확인 (멀티플레이어 탭)
3. 모드/점수 설정 → QR 스캔 (2대 이상)
4. 닉네임 입력 → 준비 → 게임 시작
5. 각 폰에 서로 다른 카드 표시 확인
6. 호스트 화면에 중앙 카드 표시 확인
7. 정답 탭 → 2초 하이라이트 → 새 카드 수령 → 중앙 카드 변경 확인
8. 오답 탭 → 3초 freeze 패널티 확인
9. 동시 탭 → 선착순 1명만 정답 처리 확인
10. 목표 점수 달성 → 결과 화면 → 다시하기 확인
11. 한자/가나 모드: 정답 시 뜻/발음 피드백 표시 확인
12. 모바일 세로 모드 화면 꽉 채움 확인
