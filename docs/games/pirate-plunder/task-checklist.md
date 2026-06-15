# 📋 Pirate's Plunder 구현 태스크 리스트

- `[x]` 1. 게임 레지스트리(`games/registry.js`)에 Pirate's Plunder 등록
- `[x]` 2. 빌드 스크립트(`vite.config.js`)에 Entry Point 추가
- `[x]` 3. 호스트(Host) 화면 구현 및 스타일링
  - `[x]` `games/pirate-plunder/host/index.html` (마크업)
  - `[x]` `games/pirate-plunder/host/style.css` (선술집 Felt 스타일링)
  - `[x]` `games/pirate-plunder/host/main.js` (엔트리)
  - `[x]` `games/pirate-plunder/host/PiratePlunderGame.js` (게임 엔진 로직)
- `[x]` 4. 모바일(Mobile) 조작기 구현 및 스타일링
  - `[x]` `games/pirate-plunder/mobile/index.html` (마크업)
  - `[x]` `games/pirate-plunder/mobile/style.css` (fixed 100dvh 스타일링)
  - `[x]` `games/pirate-plunder/mobile/main.js` (엔트리)
  - `[x]` `games/pirate-plunder/mobile/PiratePlunderMobile.js` (슬라이드 제스처 및 진동 연동)
- `[x]` 5. Playwright E2E 통합 테스트 코드 작성 (`tests/pirate-plunder/game.spec.js`)
- `[x]` 6. 전체 검증 (Vite 빌드 및 테스트 패스)
