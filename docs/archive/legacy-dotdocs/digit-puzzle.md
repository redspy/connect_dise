# Digit Puzzle — 게임 기획 문서

## 개요

4×4 슬라이딩 퍼즐(15-puzzle)을 멀티플레이어 레이스로 즐기는 게임입니다.
2~4명의 플레이어가 **동일한 셔플 보드**를 받아 동시에 풀고, **가장 먼저 완성한 사람이 승리**합니다.

---

## 게임 흐름

```
로비 → QR 스캔 (2~4명) → 닉네임 입력 → 전원 준비
→ 호스트: 셔플 보드 생성 + 브로드캐스트 → 대시보드 표시
→ 모바일: 각자 동일한 퍼즐 플레이
→ 누군가 완성 → Winner 표시 → 다시하기/로비
```

---

## 호스트 화면

### 로비 (lobby)
- 4코너 QR 코드 (동일 URL, 시각적 구분용)
- 방 코드 표시
- 참가자 목록 (닉네임 첫 글자 + 플레이어 색상)
- 준비 상태 및 시작 버튼

### 대시보드 (playing)
- 플레이어별 카드: 닉네임, 프로그레스 바, 이동 수, 경과 시간
- 프로그레스 바: `width: ${progress}%`, `transition: width 0.3s ease`, 색상 = 플레이어 색상
- 경과 시간 표시 (1초 간격 갱신)

### 결과 (result)
- 승리자 표시 (트로피 + 닉네임 + 이동수/시간)

---

## 모바일 화면

### 설정 (setup)
- 닉네임 입력 (최대 8자, localStorage 저장)
- 참여하기 버튼

### 대기 (waiting)
- 닉네임 표시
- 함께하는 플레이어 목록
- 준비하기 버튼

### 게임 (game)
- 이동 수 / 경과 시간 표시
- 4×4 퍼즐 보드 (absolute 배치, CSS transition 슬라이딩)
- 터치: 탭 (해당 행/열 전체 이동) + 스와이프 (인접 타일 1개 이동)

### 결과 (result)
- 승패 표시
- 이동 수, 경과 시간
- 다시하기 버튼

---

## 셔플 알고리즘

완성 상태 `[1,2,...,15,0]`에서 **300회 유효 이동**을 반복하여 셔플합니다.
- 직전 빈 칸 위치를 제외하여 왔다갔다 패턴 방지
- **항상 풀 수 있는(solvable) 배치 보장**
- 호스트가 한 번 생성하여 모든 모바일에 동일하게 전송

---

## 진행률 계산

```
correctCount = board[0..14]에서 board[i] === i+1 인 개수
progress = Math.round(correctCount / 15 * 100)
```

타일 이동마다 계산하되 **500ms 스로틀**로 호스트에 전송합니다.

---

## 메시지 프로토콜

| 방향 | type | payload | 시점 |
|------|------|---------|------|
| M→H | `setProfile` | `{ nickname }` | 닉네임 입력 |
| M→H | `progressUpdate` | `{ correctCount, moves, seconds }` | 타일 이동 (500ms 스로틀) |
| M→H | `puzzleComplete` | `{ moves, seconds }` | 퍼즐 완성 |
| M→H | `requestRematch` | `{}` | 다시하기 |
| H→All | `playerListUpdated` | `{ players }` | 입장/프로필 변경 |
| H→All | `gameStarted` | `{ board: number[16] }` | 게임 시작 |
| H→All | `gameFinished` | `{ winner, rankings }` | 최초 완성자 발생 |

---

## 파일 구조

```
games/digit-puzzle/
├── host/
│   ├── index.html       # 4코너 QR + 대시보드 + 결과 오버레이
│   ├── main.js          # SDK 초기화 + PuzzleGame 인스턴스
│   ├── PuzzleGame.js    # HostBaseGame 상속, 로비/대시보드/결과 관리
│   └── style.css        # dp- 접두사 스타일
└── mobile/
    ├── index.html       # 셋업/대기/게임/결과 화면
    ├── main.js          # SDK 초기화 + PuzzleMobile 인스턴스
    ├── PuzzleMobile.js  # MobileBaseGame 상속, puzzle.js 로직 포팅
    └── style.css        # 퍼즐 보드 + 타일 스타일
```

---

## 기술 특징

- **HostBaseGame / MobileBaseGame** 패턴을 따라 플랫폼과 게임 로직 분리
- QR은 `qrContainerId: null`로 자동 렌더링을 비활성화하고 4코너에 수동 렌더링
- 퍼즐 로직은 원본 `puzzle.js`에서 클래스 메서드로 변환하여 포팅
- 테마 기능 제거 (다크 테마 고정), CSS 변수 대신 고정 색상 사용
- 모바일 터치 이벤트 (탭 + 스와이프) 원본 그대로 포팅
