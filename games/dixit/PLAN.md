# Dixit 스타일 모바일 파티게임 구현 플랜

## 0) 조사 요약 (게임 이해)

Dixit은 한 장의 이미지 카드를 보고 "스토리텔러"가 힌트(문장/단어/소리)를 제시하고,
다른 플레이어가 손패에서 그 힌트와 가장 비슷한 카드를 제출한 뒤,
모든 제출 카드 중 스토리텔러의 원래 카드를 맞히는 게임입니다.

핵심 점수 규칙(원작 기준 요지):
- 일부(전부도 없고 0명도 아님)만 스토리텔러 카드를 맞히면 스토리텔러와 정답자 점수 획득
- 전원이 맞히거나 전원이 못 맞히면 스토리텔러는 점수 없음, 나머지 플레이어 점수 획득
- 내 카드가 다른 사람에게 선택되면 추가 점수 획득

참고 링크:
- Libellud(공식 사이트): https://www.libellud.com/
- Dixit 규칙 개요(위키): https://en.wikipedia.org/wiki/Dixit_(card_game)

## 1) 이 프로젝트에서의 목표

- PC(호스트): 라운드 진행, 카드 공개/섞기, 투표 집계, 점수판
- 모바일: 손패 확인, 카드 제출, 투표, 결과 확인
- 멀티플레이 3~8인 권장 (2인 특수룰은 2차)
- 기존 `HostSDK`, `MobileSDK`, `HostBaseGame`, `MobileBaseGame` 패턴 준수

## 2) 게임 ID / 디렉토리 구조

- 게임 ID: `dixit`
- 경로: `games/dixit/`

제안 구조:

```text
games/dixit/
├── PLAN.md
├── shared/
│   ├── deck.js                # 카드 메타/덱 셔플/분배 유틸
│   └── scoring.js             # 점수 계산 규칙
├── host/
│   ├── index.html
│   ├── style.css
│   ├── main.js
│   └── DixitGame.js
├── mobile/
│   ├── index.html
│   ├── style.css
│   ├── main.js
│   └── DixitMobile.js
└── assets/
    └── cards/                 # 카드 이미지 리소스
```

## 3) 라운드 플로우 (MVP)

1. 라운드 시작
- 스토리텔러 1명 지정(턴 순환)
- 각 플레이어 손패 N장 유지(권장 6장)

2. 힌트 제출
- 스토리텔러 모바일: 힌트 텍스트 입력 + 본인 손패에서 1장 비공개 제출

3. 미끼 카드 제출
- 나머지 플레이어 모바일: 힌트 보고 각자 손패에서 1장 제출

4. 공개/투표
- 호스트가 제출 카드 섞어 공개
- 비-스토리텔러 플레이어만 투표(자기 카드 선택 불가)

5. 점수 계산
- 원작 규칙 기반으로 점수 계산
- 선택 받은 미끼 카드 보너스 반영

6. 결과/정리
- 라운드 결과 공개(누가 어떤 카드 냈는지, 득점)
- 손패 보충 후 다음 라운드

## 4) 상태 모델

호스트 단일 소스 상태:

```js
{
  phase, // lobby | clue | submit | vote | result | finished
  round,
  storytellerId,
  players: [{ id, name, score, hand: number[] }],
  submissions: [{ playerId, cardId }],
  boardCards: [{ cardId, ownerId, revealIndex }],
  votes: [{ voterId, revealIndex }],
  deckState: { drawPile: number[], discardPile: number[] }
}
```

## 5) 통신 프로토콜 (초안)

모바일 -> 호스트
- `setProfile` `{ nickname }`
- `submitClueAndCard` `{ clue, cardId }` (스토리텔러 전용)
- `submitCard` `{ cardId }`
- `submitVote` `{ revealIndex }`
- `requestRematch` `{}`

호스트 -> 모바일
- `playerListUpdated` `{ players }`
- `roundStarted` `{ round, storytellerId, handCount }`
- `yourHand` `{ cards }`
- `phaseChanged` `{ phase, clue?, boardCards? }`
- `voteResult` `{ votes, pickedBy, roundScores, totalScores }`
- `gameFinished` `{ rankings }`

## 6) UX 설계 포인트

- 모바일 우선: 카드 확대/스크롤, 선택 상태 명확화
- 투표 단계에서 자기 카드 비활성화
- 결과 화면에서 "힌트 적절성" 시각화
  - 전원 정답/전원 오답 시 스토리텔러 0점 강조
- 호스트 화면은 "현재 페이즈 + 남은 인원"을 크게 표시

## 7) 밸런싱 기본값 (초안)

- 시작 손패: 6장
- 승리 점수: 30점(또는 6라운드 고정 후 최고점)
- 라운드 타이머:
  - 힌트/카드 제출 45초
  - 투표 25초

## 8) 구현 단계

1. 프로젝트 골격 생성
- `games/dixit/host`, `mobile`, `shared`, `assets/cards` 스캐폴딩
- `games/registry.js`, `vite.config.js` 엔트리 추가

2. 코어 로직 구현
- `shared/deck.js`: 셔플/드로우/보충
- `shared/scoring.js`: 점수 규칙 단위테스트 가능 구조

3. 호스트 구현
- 페이즈 상태머신
- 카드 공개/섞기/투표 집계/점수판

4. 모바일 구현
- 손패 UI, 힌트 입력, 카드 제출, 투표 UI

5. 안정화
- 재연결 시 상태 복원
- 제출 중복 방지 가드
- 타임아웃 자동처리

6. QA
- 3/4/6/8인 시나리오 점검
- 스토리텔러/투표 예외 케이스(무응답, 동시 제출) 점검

## 9) 리스크와 대응

- 리소스 리스크: 카드 아트 에셋 라이선스
  - 대응: 1차는 플레이스홀더 카드로 개발, 이후 라이선스 확정
- UX 리스크: 모바일 화면에서 카드 가독성
  - 대응: 확대 모달 + 최소 터치 영역 보장
- 진행 리스크: 라운드 동기화 꼬임
  - 대응: 호스트 authoritative 상태 + 모든 액션 idempotent 처리

## 10) 다음 액션

- 이 PLAN 확정 후, 바로 스캐폴딩(파일/엔트리 등록)부터 진행
- MVP 완료 기준: 3인 플레이 1판을 끊김 없이 진행 가능
