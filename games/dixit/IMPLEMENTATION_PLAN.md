# Dixit 구현 상태 (Implementation Status)

이 문서는 `games/dixit/` 게임의 현재 구현 상태와 설계를 기록합니다.

---

## 1. 구현 상태

| 항목 | 상태 |
|------|------|
| 카드 에셋 | ✅ 48장 완료 (card_001~048) |
| `shared/constants.js` | ✅ 완료 |
| `shared/deck.js` | ✅ 완료 |
| `shared/scoring.js` | ✅ 완료 |
| `host/main.js` + `DixitGame.js` | ✅ 완료 (단일 파일) |
| `host/index.html` | ✅ 완료 (`<game-lobby>` + `<game-appbar>`) |
| `host/style.css` | ✅ 완료 (`dx-` 접두사) |
| `mobile/main.js` | ✅ 완료 |
| `mobile/DixitMobile.js` | ✅ 완료 |
| `mobile/index.html` | ✅ 완료 |
| `mobile/style.css` | ✅ 완료 (`dx-` 접두사) |
| `games/registry.js` 등록 | ✅ 완료 |
| `vite.config.js` 엔트리 | ✅ 완료 |

---

## 2. 지원 인원 및 게임 구성

- 지원 인원: **3~8명**
- 손패 크기: 3인 7장 / 4인 이상 6장
- 게임 종료: 30점 도달 또는 덱 소진
- 카드 수: **48장** (card_001.png ~ card_048.png)

---

## 3. 점수 규칙

### 케이스별 득점

| 케이스 | 스토리텔러 | 정답자 | 기타 비-스토리텔러 |
|--------|-----------|--------|-----------------|
| **일부만 정답** | +3점 | +3점 | 0점 |
| **전원 정답** | 0점 | +2점 | +2점 |
| **전원 오답** | 0점 | — | +2점 |

### 미끼 카드 보너스
- 자신이 제출한 카드에 다른 플레이어 투표가 들어올 때마다 **+1점** (스토리텔러 제외)

### 제약
- 스토리텔러는 투표하지 않는다
- 비-스토리텔러는 자신이 제출한 카드에 투표할 수 없다

---

## 4. 핵심 상수 (`shared/constants.js`)

```js
MIN_PLAYERS = 3
MAX_PLAYERS = 8
WIN_SCORE   = 30
CARD_COUNT  = 48
getHandSize(playerCount)  // 3인 → 7, 나머지 → 6
```

---

## 5. 파일 구조

```text
games/dixit/
├── IMPLEMENTATION_PLAN.md
├── assets/
│   └── cards/              # card_001.png ~ card_048.png (48장)
├── cards/
│   └── IMAGE_PROMPTS_100.md
├── shared/
│   ├── constants.js        # 상수 (CARD_COUNT=48, WIN_SCORE=30 등)
│   ├── deck.js             # DeckManager, buildCardList, shuffle
│   └── scoring.js          # calculateRoundScores 순수 함수
├── host/
│   ├── index.html          # <game-appbar> + <game-lobby> + dx-overlay 페이즈들
│   ├── style.css           # dx- 접두사
│   └── main.js             # HostSDK + DixitGame 클래스
└── mobile/
    ├── index.html           # dx-screen 화면들
    ├── style.css            # dx- 접두사
    ├── main.js              # MobileSDK 초기화
    └── DixitMobile.js       # MobileBaseGame 상속
```

---

## 6. 이벤트 프로토콜

### Mobile → Host

| 이벤트 | 페이로드 | 설명 |
|--------|----------|------|
| `setProfile` | `{ nickname }` | 닉네임 설정 |
| `submitClue` | `{ cardId, clue }` | 스토리텔러 힌트+카드 제출 |
| `submitCard` | `{ cardId }` | 비-스토리텔러 카드 제출 |
| `submitVote` | `{ cardId }` | 투표 (스토리텔러 제외, 자기 카드 불가) |

### Host → Mobile

| 이벤트 | 페이로드 | 설명 |
|--------|----------|------|
| `playerListUpdated` | `{ players }` | 로비 입장/프로필/점수 갱신 |
| `roundStarted` | `{ round, storytellerId }` | 라운드 시작, 스토리텔러 지정 |
| `dealHand` | `{ hand }` | 내 손패 (개인 전송) |
| `clueSubmitted` | `{ clue }` | 스토리텔러가 힌트 제출 완료 |
| `votingStarted` | `{ clue, boardCards }` | 투표 단계 시작 (boardCards: 셔플된 cardId 배열) |
| `roundResult` | `{ deltas, totals, storytellerId, submissions, votes }` | 라운드 결과 |
| `gameFinished` | `{ rankings }` | 게임 종료/최종 순위 |
| `rejoinState` | `{ phase, players, round, storytellerId, clue, hand, boardCards, alreadySubmitted, alreadyVoted, mySubmittedCard, myProfile, totals }` | 재접속 상태 복원 |

---

## 7. 호스트 페이즈

```
lobby → storytelling → card-selection → voting → round-result → (다음 라운드 or final)
```

| 페이즈 | 설명 |
|--------|------|
| `lobby` | `<game-lobby>` 표시, 준비 대기 |
| `storytelling` | 스토리텔러가 카드+힌트 제출 대기 |
| `card-selection` | 비-스토리텔러 카드 제출 대기 |
| `voting` | 전체 보드 공개, 투표 대기 |
| `round-result` | 점수 계산 결과 표시, 다음 라운드 진행 |
| `final` | 최종 순위 표시 |

---

## 8. 모바일 화면

| `data-screen` | 표시 시점 |
|---------------|----------|
| `setup` | 최초 접속, 닉네임 입력 |
| `waiting` | 게임 시작 대기 / 다른 플레이어 대기 중 |
| `storyteller-clue` | 이야기꾼 턴 (카드+힌트 입력) |
| `card-select` | 비-스토리텔러 카드 선택 |
| `vote` | 보드 카드 중 스토리텔러 카드 투표 |
| `round-result` | 라운드/게임 종료 결과 |

---

## 9. 검증 시나리오 체크리스트

- [ ] 3인 기본 라운드 진행 (손패 7장)
- [ ] 4인 기본 라운드 진행 (손패 6장)
- [ ] 전원 정답 케이스 점수 검증 (storyteller 0, 나머지 각 +2)
- [ ] 전원 오답 케이스 점수 검증 (storyteller 0, 나머지 각 +2 + 미끼 보너스)
- [ ] 일부 정답 케이스 점수 검증 (storyteller +3, 정답자 +3, 미끼 보너스)
- [ ] 스토리텔러가 submitVote 시도 시 서버에서 무시되는지 확인
- [ ] 자기 카드 투표 시도 시 서버에서 무시되는지 확인
- [ ] 재연결 후 hand / 점수 / phase 복원 확인
- [ ] 덱 소진 종료 처리 확인
- [ ] 30점 도달 종료 처리 확인
- [ ] 공동 우승 시 rankings 동점 표시 확인
- [ ] 리셋 후 초기 상태 복원 확인
