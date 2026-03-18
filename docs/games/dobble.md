# Dobble

- 경로: `games/dobble/`
- 인원: 2~6명

## 게임 개요

중앙 카드와 내 카드에 공통으로 존재하는 심볼을 먼저 찾아 탭하는 스피드 게임.
Projective Plane Order 7 알고리즘으로 생성된 57장 덱 (카드당 8심볼, 모든 카드 쌍이 정확히 1개의 심볼 공유).

## 구현 특징

- **덱 생성**: `DobbleEngine.js`의 `generateDeck()`이 PG(7) 수학으로 57장 생성, Fisher-Yates 셔플
- **심볼 모드 4종**: 그림(PNG 이미지), 한자(千字文), 히라가나, 가타카나
- **멀티탭 처리**: `_roundLock = true` (80ms)로 동시 탭 시 선착순 1명만 처리
- **패널티**: 오답 시 3초 freeze — 모바일 카드 비활성화 + 카운트다운 표시
- **카드 교환**: 정답자의 카드 → 새 중앙 카드, 정답자는 덱에서 새 카드 수령
- **덱 소진 시**: 자동 재생성 (무한 게임 가능)
- **피드백**: 한자 모드는 뜻 표시, 가나 모드는 한글 독음 표시
- **모바일 카드**: 세로 2×4 그리드 (세로 화면 최적화)
- **호스트 카드**: 가로 4×2 그리드

## 파일 구조

```
games/dobble/
├── assets/symbols/          # symbol_000.png ~ symbol_142.png (143개 PNG)
├── shared/DobbleEngine.js   # 덱 생성 + 심볼 데이터 (host/mobile 공유)
├── host/
│   ├── index.html
│   ├── main.js
│   ├── DobbleGame.js        # HostBaseGame 상속
│   └── style.css            # db- 접두사
└── mobile/
    ├── index.html
    ├── main.js
    ├── DobbleMobile.js      # MobileBaseGame 상속
    └── style.css
```

## 메시지 프로토콜

| 방향 | type | payload | 시점 |
|------|------|---------|------|
| M→H | `setProfile` | `{ nickname }` | 닉네임 입력 |
| M→H | `tapSymbol` | `{ symbolIndex }` | 심볼 탭 |
| M→H | `requestRematch` | `{}` | 다시하기 |
| H→All | `playerListUpdated` | `{ players }` | 입장/프로필 변경 |
| H→All | `gameStarted` | `{ mode, winScore }` | 게임 시작 |
| H→Player | `cardDealt` | `{ card: number[] }` | 카드 지급 |
| H→All | `centerCardUpdated` | `{ card: number[] }` | 중앙 카드 변경 |
| H→Player | `tapResult` | `{ correct, newCard?, symbolIndex?, penaltyMs? }` | 탭 결과 |
| H→All | `stateUpdate` | `{ scores, frozenPlayers }` | 점수/패널티 상태 |
| H→All | `gameFinished` | `{ rankings }` | 게임 종료 |

## 주요 상수

```js
FREEZE_MS    = 3000   // 패널티 시간 (ms)
HIGHLIGHT_MS = 2000   // 승리 확인 후 결과 화면 전환 딜레이 (ms)
LOCK_MS      = 80     // 동시 탭 방지 round lock 시간 (ms)
```

## 브라우저 테스트 결과

1명의 호스트 + 2명의 모바일로 전체 플레이 흐름을 점검했습니다.

1. 로비 참여/닉네임 입력/준비 상태 동기화 정상
2. 게임 시작 시 중앙 카드/개인 카드 배분 정상
3. 정답 탭 시 점수 반영 및 카드 교체 정상
4. 오답 탭 시 3초 freeze 패널티 정상
5. 호스트 점수 바/중앙 카드 상태 갱신 정상

## 최근 로비 반응형 개선 영향

- 좁은 화면(320px 포함)에서 카드 폭이 함께 축소되어 가로 스크롤이 발생하지 않음
- 배경 장식 inset이 화면 크기에 맞춰 조정되어 콘텐츠 가림 현상 완화
- 제목/탭/카드 가시성 고정 스타일로 모바일 표시 안정성 향상
