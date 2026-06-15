# 🏴‍☠️ [connect_dise] Pirate's Plunder (해적의 전리품) 게임 구현 계획서

본 계획서는 7인 에이전트 보드 회의에서 최종 선정된 죄수의 딜레마 기반의 소셜 심리 게임 **`Pirate's Plunder (해적의 전리품)`**를 플랫폼 내에 신규 구축하기 위한 기술 구현 및 검증 계획안입니다.

---

## 📢 User Review Required

> [!IMPORTANT]
> **1. 망보기(Lookout) 규칙 및 짝꿍 배정 메커니즘**
> - 플레이어 수 N명이 홀수일 때, 1명은 무작위로 **망보기(Lookout)** 역할로 빠지게 되며 20 금화를 기본 보상으로 받고 관전합니다. 
> - 모든 플레이어는 한 번씩만 망보기를 수행할 수 있도록 라운드 로테이션 가드를 호스트 게임 엔진에 설계합니다.
> 
> **2. 미제출 방지(AFK) 및 재연결 유예 시간 연동**
> - 초등학생 플레이 및 트롤링 방지를 위해, 30초 타이머 종료 시 미제출자의 선택은 자동으로 **"나누기(Split)"**로 판정합니다.
> - 플레이어가 튕겼을 때(`onPlayerRejoin`), Host가 현재 라운드의 짝꿍 ID, 누적 골드, 기존 선택 상태를 그대로 유니캐스트(`rejoinState`) 송신하여 모바일 화면이 끊김 없이 상태를 복구하게 만듭니다.

---

## 🛠️ Proposed Changes

새로운 게임을 추가하기 위해 총 8개의 신규 파일을 생성하고, 2개의 기존 설정 파일을 수정합니다.

### 1. 플랫폼 등록 및 빌드 설정 수정

#### [MODIFY] [games/registry.js](file:///Users/soul/Source/connect_dise/games/registry.js)
- `GAMES` 배열 하단에 `pirate-plunder` 게임 레지스트리 정보 등록:
  ```javascript
  {
    id: 'pirate-plunder',
    name: '해적의 전리품 (Pirates Plunder)',
    description: '동맹인가 배신인가! 협상하여 금화를 나눌지 독차지할지 선택하는 고도의 심리 게임 🏴‍☠️',
    hostPath: '/games/pirate-plunder/host/',
    mobilePath: '/games/pirate-plunder/mobile/',
    minPlayers: 3,
    maxPlayers: 8,
    thumbnail: '🏴‍☠️',
    group: 'multi',
  }
  ```

#### [MODIFY] [vite.config.js](file:///Users/soul/Source/connect_dise/vite.config.js)
- `build.rollupOptions.input` 오브젝트 내에 호스트 및 모바일 엔트리 포인트 추가:
  ```javascript
  piratePlunderHost:   resolve(__dirname, 'games/pirate-plunder/host/index.html'),
  piratePlunderMobile: resolve(__dirname, 'games/pirate-plunder/mobile/index.html'),
  ```

---

### 2. 신규 게임 파일 작성

#### [NEW] [games/pirate-plunder/host/index.html](file:///Users/soul/Source/connect_dise/games/pirate-plunder/host/index.html)
- 호스트 화면 마크업: 로비 플레이어 목록, 짝꿍 배정 상태판, 중앙 선술집 테이블, 배신/분배 결과 보물상자 애니메이션 영역, 최종 순위 시상대 렌더링 영역 구성.

#### [NEW] [games/pirate-plunder/host/style.css](file:///Users/soul/Source/connect_dise/games/pirate-plunder/host/style.css)
- 호스트 스타일시트: 어두운 브라운/금색 계열의 해적선 Tavern Felt 스타일, 코인 샤워 파티클 효과, 3D 보물상자 흔들림 및 쪼개짐 카툰 애니메이션 스타일 추가.

#### [NEW] [games/pirate-plunder/host/main.js](file:///Users/soul/Source/connect_dise/games/pirate-plunder/host/main.js)
- 호스트 진입점: `HostSDK` 및 `PiratePlunderGame` 클래스를 인스턴스화하고 플랫폼 바인딩 초기화.

#### [NEW] [games/pirate-plunder/host/PiratePlunderGame.js](file:///Users/soul/Source/connect_dise/games/pirate-plunder/host/PiratePlunderGame.js)
- 호스트 핵심 로직 클래스 (`HostBaseGame` 상속):
  - `onSetup`: 상단 `AppBar` 및 QR 영역 초기화.
  - `startNewRound`: 짝꿍 무작위 매칭(홀수 시 1명 Lookout 지정) 및 `roundStart` 유니캐스트 전송.
  - `onMessage`: 모바일에서 온 `submitDecision` 수집, 결정 수집 완료 시 `revealResult` 트리거.
  - `revealResult`: 정산 매트릭스(Split/Steal 조합)에 따라 각각 금화 적립 및 결과 전송. 5라운드 완주 시 `endGame` (순위 발표) 호출.
  - `onPlayerLeave`/`onPlayerRejoin`: 튕김 복구 세션 처리 및 3인 미만 시 세션 리셋.

#### [NEW] [games/pirate-plunder/mobile/index.html](file:///Users/soul/Source/connect_dise/games/pirate-plunder/mobile/index.html)
- 모바일 마크업: 닉네임 입력 셋업 화면, 대기 중 화면, 파트너 및 금화 Plunder 정보 화면, 분배(Split)/훔치기(Steal) 선택 패널, 결과 카드 노출 화면.

#### [NEW] [games/pirate-plunder/mobile/style.css](file:///Users/soul/Source/connect_dise/games/pirate-plunder/mobile/style.css)
- 모바일 스타일시트: `100dvh` 고정 뷰포트, 키보드 간섭 원천 차단을 위해 버튼 방식 채택. Steal 버튼 오조작 방지를 위한 위로 쓸어넘기는 슬라이딩 래치 덮개 스타일.

#### [NEW] [games/pirate-plunder/mobile/main.js](file:///Users/soul/Source/connect_dise/games/pirate-plunder/mobile/main.js)
- 모바일 진입점: `MobileSDK` 및 `PiratePlunderMobile` 초기화.

#### [NEW] [games/pirate-plunder/mobile/PiratePlunderMobile.js](file:///Users/soul/Source/connect_dise/games/pirate-plunder/mobile/PiratePlunderMobile.js)
- 모바일 핵심 클래스 (`MobileBaseGame` 상속):
  - 슬라이드 스와이프 이벤트를 포착하여 "Steal" 잠금 해제 및 버튼 클릭 리스너 바인딩.
  - 진동 API(`navigator.vibrate`) 연동: 선택 확정 시 가벼운 클릭 진동, 배신 성공 시 웅장한 햅틱 진동, 배신당했을 시 충격 진동 피드백.
  - `onMessage` 기반의 화면 전환(`showScreen`) 및 재연결 복구 상태 대응.

---

## 🧪 Verification Plan

### Automated Tests
- **Vite Production Build (`npm run build`)**: 아티팩트 빌드 번들러 무결성 검증.
- **E2E Playwright Test**: `tests/pirate-plunder/game.spec.js`를 작성하여 3인 로컬 모킹 브라우저를 띄우고, 각 라운드 페어 배정, 상호 배신/분배 선택, Lookout 수동 정산, 5라운드 종료 및 최종 순위 보드 렌더링에 이르는 전체 시나리오 자동 검증 실행.

### Manual Verification
- 브라우저 인스턴스를 통해:
  - 3인 이상의 모바일 기기가 짝으로 묶이며, 홀수 명수일 때 1명이 Lookout 역할을 정상적으로 수임하고 UI가 대응하는지 검증.
  - 타이머 30초 만료 시 선택하지 않은 플레이어가 정상적으로 "나누기"로 투표되어 다음 단계로 진행되는지 확인.
  - 게임 도중 모바일 창을 새로고침 시 튕김Banner 노출 및 복귀 후 이전 라운드 짝꿍 정보와 득점 수치가 복구되는지 확인.
