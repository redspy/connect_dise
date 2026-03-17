# 구현 이슈 및 개선 포인트

## 1. QR URL 생성 시 `localIp` 미사용
- 위치: `platform/client/HostSDK.js`
- 현상: `platform:sessionCreated`로 받은 `localIp`를 사용하지 않고 `window.location.hostname` 사용
- 영향: 호스트가 `localhost`로 접속하면 QR도 `localhost`가 되어 모바일 접속 실패 가능
- 개선: `hostname === 'localhost'`일 때 `localIp` 우선 사용 또는 옵션화

## 2. 문서/코드 이벤트 명 불일치 히스토리
- 구 문서에 `chooseNumber`, `roundStart` 등 과거 타입이 남아 있었음
- 현재 구현은 `submitChoice`, `roundStarted` 사용
- 조치: 본 문서 세트에서 최신 이벤트명으로 통일

## 3. Relay Drawing 타임아웃 더미 이미지 전송량
- 위치: `games/relay-drawing/*`
- 현상: base64 이미지 전송량이 커질 수 있어 방 수/인원 증가 시 버퍼 부담 가능
- 현재 완화: `maxHttpBufferSize: 5e6`, 모바일 측 JPEG 0.6 압축
- 개선: 이미지 리사이즈/품질 자동 조절, 라운드별 업로드 제한 도입
