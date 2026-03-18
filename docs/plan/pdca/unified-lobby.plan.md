# Plan: 게임 로비 공통화 (unified-lobby)

> 작성일: 2026-03-17

---

## 1. 배경 및 목표

각 게임 로비가 개별적으로 구현되어 있어 코드 중복이 많고, 플레이어 UX가 게임마다 다르다. 공통 로비 컴포넌트를 `HostBaseGame`에 통합하여 일관된 UX와 코드 재사용을 달성한다.

---

## 2. 현황 분석

### 게임별 로비 구현 비교

| 항목 | spin-battle | nunchi-ten | dobble | digit-puzzle | give-you-fire | relay-drawing |
|------|:-----------:|:----------:|:------:|:------------:|:-------------:|:-------------:|
| QR 코드 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 세션 코드 표시 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (URL) |
| 플레이어 카드 | dot만 | 아바타+닉네임 | dot+닉네임 | 첫글자+닉네임 | dot+닉네임 | 아바타/dot+닉네임 |
| 준비 상태 텍스트 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 시작 버튼 | ❌ (자동) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 게임 규칙 표시 | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 게임 설정 옵션 | ❌ | ❌ | ✅ (모드/점수) | ❌ | ✅ (미리보기) | ✅ (라운드/시간) |
| BGM | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| HostBaseGame 사용 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### 주요 문제점

1. **플레이어 카드 형태 불일치**: 각 게임이 플레이어를 표시하는 방식이 제각각 (dot, 아바타, 첫글자)
2. **준비 텍스트 포맷 불일치**: `{n}명 접속 중 · {m}명 준비완료` vs `{m}/{n}명 준비완료` 등
3. **HTML 구조 중복**: 모든 게임이 거의 동일한 QR+플레이어목록+버튼 구조를 반복
4. **시작 조건 로직 중복**: `_updateStartBtn()` 패턴이 매 게임마다 반복 구현
5. **`_renderLobby()` 중복**: 플레이어 카드 렌더링이 각 게임마다 개별 구현

---

## 3. 요구사항

### FR-01: 공통 로비 HTML 구조 (LobbyPanel)

`HostBaseGame`이 로비 HTML 템플릿을 자동으로 삽입하거나, 공통 구조를 AppBar 수준처럼 표준화한다.

**공통 구조**:
```
[ QR 코드 ] [ 세션 코드 ]
[ 게임 설정 영역 (옵션, slot) ]
[ 플레이어 카드 목록 ]
[ 준비 상태 텍스트 ]
[ 시작 버튼 ]
```

### FR-02: 공통 플레이어 카드 컴포넌트

`platform/client/shared/` 에 `LobbyPlayerCard` 컴포넌트(함수) 제공.
- 아바타 이미지 있으면 표시, 없으면 컬러 dot+이니셜
- 닉네임 표시
- 준비 완료 시 체크 표시

### FR-03: HostBaseGame에 로비 헬퍼 통합

다음 메서드를 `HostBaseGame`에 추가:
- `renderLobbyPlayers(containerId)` — 현재 `this.players` 기반 카드 렌더링
- `updateReadyStatus(containerId, readyCount, total)` — 준비 텍스트 업데이트
- `updateStartButton(btnId, options)` — 시작 버튼 활성화 조건 체크
  - 옵션: `{ minPlayers: 2, requireAllReady: false }`

### FR-04: 각 게임 로비 마이그레이션

기존 게임들이 FR-03 헬퍼를 사용하도록 리팩토링:
- `_renderLobby()` → `this.renderLobbyPlayers('lobby-players')`
- `_updateReadyStatus()` → `this.updateReadyStatus('ready-status', readyCount, total)`
- `_updateStartBtn()` → `this.updateStartButton('btn-start', { minPlayers: 2 })`

### FR-05: 게임별 설정 슬롯 유지

Dobble의 심볼 모드/점수, GiveYouFire의 옵션, RelayDrawing의 라운드/시간 등 게임별 설정은 로비 HTML에 `<div id="lobby-options">` 슬롯으로 유지. HostBaseGame이 이 영역에 간섭하지 않음.

---

## 4. 범위 (Scope)

### In-scope
- `platform/client/HostBaseGame.js` — 로비 헬퍼 메서드 추가
- `platform/client/shared/LobbyPlayerCard.js` — 플레이어 카드 컴포넌트 신규
- 각 게임 `*.js` — `_renderLobby`, `_updateReadyStatus`, `_updateStartBtn` 교체
- 각 게임 `index.html` — 플레이어 카드 컨테이너 id 표준화 (`lobby-players`, `ready-status`, `btn-start`)

### Out-of-scope
- 게임별 로비 디자인/색상/테마 변경 없음
- 게임별 설정 옵션 UI 변경 없음
- Dice 게임 (HostBaseGame 미사용, 별도 처리)

---

## 5. 우선순위

| 우선순위 | 항목 |
|----------|------|
| P0 | FR-03: HostBaseGame 헬퍼 추가 |
| P0 | FR-02: LobbyPlayerCard 컴포넌트 |
| P1 | FR-04: nunchi-ten, dobble, digit-puzzle 마이그레이션 (자주 개발 중인 게임) |
| P2 | FR-04: give-you-fire, relay-drawing 마이그레이션 |
| P3 | FR-01: HTML 구조 공식 표준화 문서 |

---

## 6. 예상 효과

- **코드 절감**: 게임당 약 30~50줄 중복 제거
- **UX 일관성**: 플레이어 카드 표시 방식 통일
- **신규 게임 개발 속도 향상**: 로비 구현 시간 단축
- **버그 집중화**: 로비 버그를 한 곳에서 수정

---

## 7. 리스크

| 리스크 | 대응 |
|--------|------|
| 게임별 HTML id가 다를 수 있음 | FR-04에서 표준 id로 일괄 정리 |
| spin-battle은 dot만 사용 (아바타 없음) | LobbyPlayerCard가 아바타 없는 경우도 지원 |
| 마이그레이션 중 로비 동작 깨짐 | 게임별 순차 마이그레이션, 테스트 후 다음 진행 |
