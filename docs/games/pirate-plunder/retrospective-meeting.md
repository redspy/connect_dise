# 🏴‍☠️ 신규 게임 선정 보고서 및 기획 명세: Pirate's Plunder (해적의 전리품)

본 문서는 **확장된 7인 에이전트 협업 체계(Scout, Producer, Kids Expert, Tech, UIUX, Dev, PM)**를 구동하여, 온라인 멀티플레이어 환경 및 아동 친화적 사용성을 모두 극대화할 수 있는 신규 게임을 선정하고 플랫폼 연동 스펙을 구체화한 결과 보고서입니다.

---

## 💬 1. 가상 7자 보드 회의록 (Board Meeting Minutes)

- **주제**: 플랫폼의 차기작 선정 및 4대 지표(아동 플레이 적합성, 개발 속도/재사용성, UI/UX 사용성, 기술 안정성) 종합 평가
- **참석자**: 
  - **PMOrchestrator** (프로젝트 매니저 - 중재)
  - **GameScout** (게임 콘셉트 리서처)
  - **OnlineGameProducer** (온라인 멀티플레이어 기획)
  - **KidsBoardGameExpert** (아동 보드게임 전문가)
  - **UIUXDesigner** (UI/UX 디자이너)
  - **TechAnalyst** (기술 분석 아키텍트)
  - **SeniorGameDev** (시니어 개발 엔지니어)

### 토의 주요 쟁점 및 의사결정 과정
1. **기술 및 개발 속도 대립 (`TechAnalyst` vs `SeniorGameDev`)**:
   - `Rune Rumble` 및 `Deep Sea Sync`는 실시간 자이로 조작 및 P2P 실시간 룬 그리기를 요구하여 네트워크 패킷 지연 및 충돌 물리 엔진 연산(Three.js) 부하가 매우 커 일정 내 개발이 어려움.
   - 반면 `Under-the-Table` (전리품 분배)은 기존 `hidden-agent` 소스코드의 동맹 그래프, 투표 로직, 역할 배정, 타이머 코드를 **70% 이상 재사용** 가능하므로 개발 속도 면에서 초월적 효율성이 검증됨.
2. **아동 플레이 적합성 조율 (`KidsBoardGameExpert` vs `OnlineGameProducer`)**:
   - `Under-the-Table`에 적용된 죄수의 딜레마(협동과 배신)는 기획적으로 몰입도가 매우 높으나, 어두운 마피아/조폭 테마는 아동 및 가족 플레이 시 배신으로 인한 개인적 감정 상함이 발생할 우려가 있음.
   - 이를 극복하기 위해 테마를 귀엽고 익살스러운 캐주얼 판타지인 **`Pirate's Plunder (해적의 전리품)`**로 피벗(Retheme)하기로 합의함. 
   - 동시 배신 시 "갈매기가 금화를 채가거나 상자가 폭발하는" 식의 카툰 연출을 적용해 감정 상함을 웃음으로 승화시킴.
3. **UI/UX 편의성 검토 (`UIUXDesigner`)**:
   - 모바일 웹의 최대 숙제인 소프트 키보드 활성화 시의 레이아웃 깨짐을 완전히 차단하기 위해 텍스트 입력을 최소화하고, 거대하고 직관적인 두 개의 버튼("나누기 🤝", "훔치기 🏴‍☠️") 및 배신 버튼 오작동 방지 슬라이더 래치(Safety Latch)를 이식하여 터치 사용성을 극대화함.

---

## 🏴‍☠️ 2. 최종 선정 결과: 해적의 전리품 (Pirate's Plunder)

### 게임 개요
- **핵심 규칙**: 해적 동맹들이 획득한 보물상자(금화 100닢)를 두고, 두 플레이어씩 짝을 지어 30초 동안 협상한 뒤 "나누기(Split)"와 "훔치기(Steal)"를 동시에 선택합니다.
- **선정 사유**:
  1. **최고 수준의 개발 효율**: `hidden-agent` 템플릿의 로비 프로필, 타이머, 투표 시스템을 완벽 재활용 가능.
  2. **가족/아동 친화성 확보**: 직관적인 규칙 구조 및 배신의 부정적 감정을 해소하는 익살스러운 연출 적용.
  3. **모바일 웹 안정성**: 소프트 키보드 간섭을 원천 차단한 순수 버튼/제스처 기반 UI 구현.
  4. **통신 무결성**: 턴제 구조로 소켓 재연결 복원(`rejoinState`)에 매우 강함.

---

## 📝 3. 플랫폼 연동 명세 (Vite / SDK Integration)

### 1) 신규 파일 구조
```text
games/pirate-plunder/
├── shared/
│   └── (없음 - 호스트 authoritative 상태로 간단 구현)
├── host/
│   ├── index.html             # 호스트 선술집/보물 테이블 화면
│   ├── style.css              # 나무 패널, 금화 입자 물리 등 호스트 CSS
│   ├── main.js                # HostSDK 및 PiratePlunderGame 구동
│   └── PiratePlunderGame.js   # HostBaseGame 상속 짝배정 및 정산 물리 구현
└── mobile/
    ├── index.html             # 모바일 대기/조작(나누기/훔치기) 화면
    ├── style.css              # 모바일 fixed 100dvh 버튼 UI CSS
    ├── main.js                # MobileSDK 및 PiratePlunderMobile 구동
    └── PiratePlunderMobile.js # MobileBaseGame 상속 햅틱 진동 및 의사결정 송출
```

### 2) 게임 레지스트리 및 빌드 엔트리 등록
- **`games/registry.js`** 추가:
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
- **`vite.config.js`** 추가:
  ```javascript
  piratePlunderHost:   resolve(__dirname, 'games/pirate-plunder/host/index.html'),
  piratePlunderMobile: resolve(__dirname, 'games/pirate-plunder/mobile/index.html'),
  ```

### 3) 딜레마 정산 공식 (100금화 기준)
- **나누기 🤝 나누기**: 상호 협동. 각각 **50 금화** 획득.
- **나누기 🤝 훔치기**: 배신. 훔친 사람 **100 금화**, 나눈 사람 **0 금화** 획득.
- **훔치기 🤝 훔치기**: 상호 욕심. 둘 다 **0 금화** 획득. 상자가 깨지며 금화가 바다로 추락하는 애니메이션 재생.
- **망보기(Lookout) 규칙**: 플레이어가 홀수일 때, 1명은 무작위로 망보기를 담당하여 안전하게 **20 금화**를 수급하되 투표에서 제외됩니다. (게임당 인당 최대 1회).

### 4) 예외 처리 및 방어 코드 설계
- **AFK 타임아웃 방지**: 30초 내에 입력을 안 하면 강제로 **"나누기(Cooperate)"**로 제출되어 게임 지연 및 고의 트롤링을 원천 방어합니다.
- **재연결 세션 보존**: 플레이어 새로고침 시 Host의 `onPlayerRejoin`에서 해당 라운드의 짝꿍 정보 및 득점 정보를 그대로 포함한 `roundStart` 패킷을 재송신하여 중단 없는 복구가 가능하게 합니다.
