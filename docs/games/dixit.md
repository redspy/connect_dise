# Dixit

- 경로: `games/dixit/`
- 인원: 3~8명 (현재 구현 로직은 손패 크기/카드 수 기준 3~6명 안정 운용 권장)

## 게임 개요

스토리텔러가 힌트를 제시하고, 다른 플레이어가 힌트에 맞는 카드를 제출한 뒤
섞인 카드 중 스토리텔러의 카드를 맞히는 상상력 기반 파티 카드게임.

## 구현 상태 요약

- 호스트/모바일 화면 기본 플레이 루프 구현 완료
- 점수 계산 로직(`shared/scoring.js`) 분리
- 덱 관리 로직(`shared/deck.js`) 분리
- 게임 등록/빌드 엔트리 연결 완료 (`games/registry.js`, `vite.config.js`)
- 카드 에셋 생성 진행 중: **31/100**

## 파일 구조

```text
games/dixit/
├── assets/cards/              # card_001.png ~ card_031.png (현재)
├── cards/
│   ├── IMAGE_PROMPTS_100.md   # 100개 카드 프롬프트
│   └── PENDING_PROMPTS_FOR_NANOBANANA.md
├── shared/
│   ├── constants.js
│   ├── deck.js
│   └── scoring.js
├── host/
│   ├── index.html
│   ├── main.js
│   └── style.css
└── mobile/
    ├── index.html
    ├── main.js
    ├── DixitMobile.js
    └── style.css
```

## 메시지 프로토콜 (게임 전용)

모바일 -> 호스트
- `setProfile` `{ nickname }`
- `submitClue` `{ cardId, clue }`
- `submitCard` `{ cardId }`
- `submitVote` `{ cardId }`

호스트 -> 모바일
- `playerListUpdated` `{ players }`
- `roundStarted` `{ round, storytellerId }`
- `dealHand` `{ hand }`
- `clueSubmitted` `{ clue }`
- `votingStarted` `{ clue, boardCards }`
- `roundResult` `{ storytellerCardId, boardCards, cardOwnerMap, clue, deltas, totals, scoringCase }`
- `gameFinished` `{ rankings }`
- `rejoinState` `{ phase, players, round, storytellerId, clue, hand, ... }`

## 점수 규칙 (구현 기준)

- 일부 정답: 스토리텔러 +3, 정답자 +3
- 전원 정답/전원 오답: 스토리텔러 0, 비-스토리텔러 +2
- 미끼 카드 득표: 카드 소유자 +1(표당)

## 구현 이슈/메모

- 카드 수가 적으면 라운드 진행 중 덱 소진으로 조기 종료 가능
- 현재는 `assets/cards`의 파일 존재량이 실제 플레이 가능 라운드 수를 결정
- 6인 안정 플레이를 위해 카드 에셋 확충 필요
