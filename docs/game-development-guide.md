# 새 게임 추가 가이드 (구현 기준)

## 1. 디렉토리
- `games/<game-id>/host/`
- `games/<game-id>/mobile/`
- 선택: `games/<game-id>/assets/`

## 2. 등록
1. `games/registry.js`에 게임 추가
2. `vite.config.js` `build.rollupOptions.input`에 엔트리 추가

## 3. 권장 패턴
- 호스트: `HostSDK + HostBaseGame`
- 모바일: `MobileSDK + MobileBaseGame`

## 4. 최소 체크리스트
- 호스트/모바일 `index.html`, `main.js`
- `onMessage` 타입 매칭 검증
- 준비/리셋/재연결 처리
- `npm run build` 후 엔트리 출력 확인

## 5. 에셋 경로
- 개발/빌드 모두 `/games/<game-id>/assets/...` 사용
- `vite.config.js`의 `gameAssetsPlugin`이 자동 서빙/복사
