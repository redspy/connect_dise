# Dixit 구현 플랜 (Execution Plan)

이 문서는 `games/dixit/` 게임을 실제로 구현하기 위한 실행 계획서입니다.

---

## 1. 목표 범위 (MVP)

- 지원 인원: **3~6명** (카드 수 제약으로 7~8인은 2차)
- 플레이 루프 1회 완주:
  - 스토리텔러 힌트 + 카드 제출
  - 일반 플레이어 카드 제출
  - 카드 공개 / 투표
  - 점수 계산 / 결과 공개
  - 손패 보충 후 다음 라운드
- 재연결 / 리셋 동작 보장

MVP 제외:
- 7~8인 (Odyssey 2-토큰 변형)
- 고급 애니메이션
- 카드팩 에디터

> ⚠️ **카드 수 제약**: 3~6인 플레이를 안정적으로 지원하려면 최소 **60장** 필요.
> 현재 생성된 카드는 14장으로, 3인 기본(21장)도 아직 불가능합니다.
> 구현 전 카드 이미지를 **최소 84장**(공식 기준)으로 늘려야 합니다.
> → `cards/IMAGE_PROMPTS_100.md`를 기준으로 생성 진행.

---

## 2. 점수 규칙 (공식 룰 기준)

### 2-1. 케이스별 득점

| 케이스 | 스토리텔러 | 정답자 | 기타 비-스토리텔러 |
|--------|-----------|--------|-----------------|
| **일부만 정답** | **+3점** | **+3점** | 0점 |
| **전원 정답** | **0점** | +2점 | +2점 |
| **전원 오답** | **0점** | — | +2점 |

### 2-2. 미끼 카드 보너스

- 자신이 제출한 카드에 다른 플레이어의 투표가 들어올 때마다 **+1점** (스토리텔러 제외).

### 2-3. 제약

- **스토리텔러는 투표하지 않는다.** 자신의 카드가 어느 것인지 공개하지도 않는다.
- 비-스토리텔러는 자신이 제출한 카드에 투표할 수 없다.

### 2-4. 동점 처리

- 공식 룰: **공동 우승**. 별도 타이브레이커 없음.

---

## 3. 게임 종료 조건

두 가지 중 **먼저** 충족되는 조건에서 종료:

1. **점수 도달**: 어느 한 플레이어가 **30점 이상** 획득한 라운드가 끝난 직후
2. **덱 소진**: 드로우 파일이 소진되어 손패 보충이 불가능해진 시점

> 참고: 공식 최신판은 덱 소진을 주 종료 조건으로 사용.
> 이 구현에서는 30점 도달을 우선으로 하되, 덱 소진도 폴백으로 처리.

---

## 4. 핵심 상수

```js
// shared/constants.js
HAND_SIZE_DEFAULT = 6   // 4인 이상
HAND_SIZE_3P      = 7   // 3인 전용 특수룰
WIN_SCORE         = 30
CLUE_TIMEOUT_MS   = 45_000   // 힌트+카드 제출 제한
SUBMIT_TIMEOUT_MS = 45_000   // 비-스토리텔러 카드 제출
VOTE_TIMEOUT_MS   = 25_000   // 투표 제한
MIN_CARDS_NEEDED  = 84       // 안정적 6인 플레이 최소 카드 수
```

---

## 5. 카드 덱 관리 규칙

- **초기 딜**: 각 플레이어에게 손패 크기만큼 드로우 파일에서 배분.
- **라운드 종료 후**: 이번 라운드에 제출된 모든 카드 → **디스카드 파일** 이동.
- **손패 보충 순서**: 점수 계산 완료 → 결과 공개 → 손패 보충(드로우 파일에서 1장씩).
- **덱 소진 시**: 디스카드 파일 **재셔플 없이** 게임 종료.
  → `deck.drawPile.length < playerCount` 조건으로 사전 감지.

---

## 6. 디렉토리 / 파일 구조

```text
games/dixit/
├── IMPLEMENTATION_PLAN.md
├── PLAN.md
├── cards/
│   └── IMAGE_PROMPTS_100.md  # 100개 프롬프트 가이드 (84장 이상 생성 목표)
├── assets/
│   └── cards/                # card_001.png ~ card_084.png (목표)
├── shared/
│   ├── constants.js
│   ├── deck.js               # 셔플 / 드로우 / 디스카드 / 보충
│   └── scoring.js            # 순수 함수, 단위 테스트 가능
├── host/
│   ├── index.html
│   ├── style.css
│   ├── main.js
│   ├── DixitGame.js          # HostBaseGame 상속
│   └── ui/
│       ├── boardView.js
│       └── resultView.js
└── mobile/
    ├── index.html
    ├── style.css
    ├── main.js
    └── DixitMobile.js        # MobileBaseGame 상속
```

---

## 7. 단계별 구현 계획

### Phase 0: 카드 에셋 확보 (선행 필수)

- `cards/IMAGE_PROMPTS_100.md` 기준으로 card_015 ~ card_084 생성
- 완료 기준: `assets/cards/` 폴더에 최소 60장 이상

### Phase 1: 코어 로직

- `shared/constants.js` — 모든 상수 정의
- `shared/deck.js` — 셔플 / 드로우 / 보충 / 덱 소진 감지
- `shared/scoring.js` — 2-1~2-3 규칙을 순수 함수로 구현

완료 기준:
- 입력 상태 → 점수 결과가 deterministic하게 계산됨
- 3가지 케이스(일부 정답 / 전원 정답 / 전원 오답) + 미끼 보너스 모두 정확

### Phase 2: 호스트 구현

- `DixitGame.js` 상태머신
  - `lobby → clue → submit → vote → result → clue → … → finished`
- 제출 / 투표 집계 및 유효성 검증
  - 중복 제출 / 중복 투표 방지
  - 스토리텔러 투표 시도 무시
  - 자기 카드 투표 시도 무시
- 타임아웃 자동처리
  - 미제출자: 손패 첫 번째 카드 자동 선택
  - 미투표자: 첫 번째 선택 가능한 카드 자동 투표
- 호스트 UI
  - 현재 페이즈 / 남은 제출 인원 / 점수판 / 공개 카드 영역

완료 기준:
- 호스트 단독으로 라운드 상태가 안정적으로 전환됨

### Phase 3: 모바일 구현

- 스토리텔러 화면: 힌트 입력 + 손패에서 카드 선택 제출
- 일반 플레이어 화면: 카드 제출 → 대기 → 투표
- 투표 화면: 보드 카드 표시, 자기 카드 비활성화
- 결과 화면: 이번 라운드 득점 + 누적 점수 + 카드 소유자 공개

완료 기준:
- 스토리텔러 / 일반 역할이 페이즈에 맞게 자동 전환됨

### Phase 4: 통합 / 동기화

- `games/registry.js` 등록
- `vite.config.js` 엔트리 추가
- 재연결 처리: `rejoinState` 메시지로 손패 / 점수 / 현재 페이즈 복원
- 리셋 시 전체 상태 초기화 (덱 재셔플 포함)

완료 기준:
- 3인 실기기 테스트 3판 연속 완주

### Phase 5: QA 및 튜닝

- 타임아웃 자동처리 엣지 케이스
- 무응답 플레이어 / 스토리텔러 이탈 처리
- 동일 시점 동시 입력 idempotent 처리
- 덱 소진 종료 시나리오 검증
- 밸런스 값 조정

완료 기준:
- 주요 오류 없이 6인 1판 완주

---

## 8. 이벤트 프로토콜

### Mobile → Host

| 이벤트 | 페이로드 | 설명 |
|--------|----------|------|
| `setProfile` | `{ nickname }` | 닉네임 설정 |
| `submitClueAndCard` | `{ clue, cardId, actionId }` | 스토리텔러 전용 |
| `submitCard` | `{ cardId, actionId }` | 비-스토리텔러 카드 제출 |
| `submitVote` | `{ revealIndex, actionId }` | 투표 (스토리텔러 제외, 자기 카드 불가) |
| `requestRematch` | `{}` | 다시하기 |

### Host → Mobile

| 이벤트 | 페이로드 | 설명 |
|--------|----------|------|
| `playerListUpdated` | `{ players }` | 로비 입장/프로필 갱신 |
| `yourHand` | `{ cards: number[] }` | 내 손패 (라운드마다 갱신) |
| `roundStarted` | `{ round, storytellerId }` | 라운드 시작, 스토리텔러 지정 |
| `phaseChanged` | `{ phase, clue?, boardCards?, deadlineAt? }` | 페이즈 전환 |
| `voteResult` | `{ votes, roundScores, totalScores, cardOwners }` | 라운드 결과 공개 |
| `gameFinished` | `{ rankings }` | 게임 종료 / 최종 순위 |
| `rejoinState` | `{ phase, round, storytellerId, clue?, boardCards?, hand, scores }` | 재접속 상태 복원 |

#### `phaseChanged` 페이즈별 포함 필드

| phase | 추가 필드 |
|-------|-----------|
| `clue` | — |
| `submit` | `clue`, `deadlineAt` |
| `vote` | `boardCards: [{revealIndex, cardId}]`, `deadlineAt` |
| `result` | `boardCards`(소유자 포함), `votes`, `roundScores` |

> **boardCards 셔플**: 투표 단계에서는 `cardId`는 포함하고 `ownerId`는 숨긴다.
> revealIndex는 0-based 순서로 공개된 카드 번호를 의미. host에서 랜덤 셔플 후 배정.

---

## 9. 상태 모델 (호스트 authoritative)

```js
{
  phase,            // 'lobby' | 'clue' | 'submit' | 'vote' | 'result' | 'finished'
  round,            // 1-based
  storytellerId,
  clue,             // 스토리텔러가 입력한 힌트 문자열
  players: [{
    id,
    nickname,
    score,
    hand: number[],     // cardId 배열
    connected: boolean,
  }],
  submissions: [{       // 제출된 카드 (스토리텔러 포함)
    playerId,
    cardId,
  }],
  boardCards: [{        // 투표 단계용 셔플된 공개 목록
    revealIndex,        // 화면 표시 순서 (0-based)
    cardId,
    ownerId,            // vote 단계에서는 숨김, result에서 공개
  }],
  votes: [{
    voterId,
    revealIndex,
  }],
  processedActionIds: string[], // 최근 actionId 슬라이딩 윈도우 (중복 요청 방지)
  deck: {
    drawPile:    number[],
    discardPile: number[],
  },
  settings: {
    handSize: 6,    // playerCount === 3 이면 7
    winScore: 30,
  },
}
```

---

## 10. scoring.js 인터페이스 (순수 함수)

```js
/**
 * @param {string}   storytellerId
 * @param {Array}    boardCards    [{revealIndex, cardId, ownerId}]
 * @param {Array}    votes         [{voterId, revealIndex}]
 * @returns {Object} { [playerId]: deltaScore }
 */
export function calcRoundScores(storytellerId, boardCards, votes) { ... }
```

테스트 케이스:
- 3인 일부 정답 → storyteller +3, guesser +3, bait holder +1
- 전원 정답 → storyteller 0, others +2
- 전원 오답 → storyteller 0, others +2 각자 + bait 보너스

---

## 11. 카드 에셋 상태 및 계획

| 상태 | 장수 |
|------|------|
| 생성 완료 | 14장 (card_001~014) |
| 프롬프트 작성 완료 | 100개 (card_001~100) |
| 추가 필요 | **70장** (card_015~084 기준) |
| **목표** | **84장** |

> 생성 가이드: `cards/IMAGE_PROMPTS_100.md` 참조.
> 3:4 세로형, 몽환적 동화 스타일, 텍스트/워터마크 없음.

---

## 12. 검증 시나리오 체크리스트

- [ ] 3인 기본 라운드 진행 (손패 7장)
- [ ] 4인 기본 라운드 진행 (손패 6장)
- [ ] 전원 정답 케이스 점수 검증 (storyteller 0, 나머지 각 +2)
- [ ] 전원 오답 케이스 점수 검증 (storyteller 0, 나머지 각 +2 + 미끼 보너스)
- [ ] 일부 정답 케이스 점수 검증 (storyteller +3, 정답자 +3, 미끼 보너스)
- [ ] 미끼 카드 2표 획득 시 +2 보너스 검증
- [ ] 스토리텔러가 submitVote 시도 시 서버에서 무시되는지 확인
- [ ] 타임아웃 자동처리 (미제출 → 첫 카드 자동 선택)
- [ ] 동일 actionId 재전송 시 1회만 반영되는지 확인
- [ ] 재연결 후 hand / 점수 / phase 복원 확인
- [ ] 덱 소진 종료 처리 확인
- [ ] 30점 도달 종료 처리 확인
- [ ] 공동 우승 시 rankings 동점 표시 확인
- [ ] 리셋 후 초기 상태 복원 확인

---

## 13. 현재 준비 상태

- [x] 게임 개념 / 초기 플랜 문서(`PLAN.md`) 작성
- [x] 카드 생성 프롬프트 문서(`cards/IMAGE_PROMPTS_100.md`) 작성 (card_001~100)
- [x] 카드 이미지 14장 생성 완료 (card_001~014)
- [ ] **카드 이미지 84장 목표 달성** ← 구현 전 선행 필수
- [ ] host/mobile/shared 스캐폴딩 파일 생성
- [ ] registry / vite 엔트리 연결
- [ ] MVP 로직 구현 시작

---

## 14. 다음 즉시 작업

1. **[선행]** `cards/IMAGE_PROMPTS_100.md` 기준으로 card_015~084 이미지 생성
2. `shared/constants.js`, `shared/deck.js`, `shared/scoring.js` 생성
3. `host/index.html`, `host/main.js`, `host/DixitGame.js` 생성
4. `mobile/index.html`, `mobile/main.js`, `mobile/DixitMobile.js` 생성
5. `games/registry.js`, `vite.config.js` 연결
6. `npm run build`로 엔트리 검증
