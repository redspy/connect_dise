/**
 * main.js — Give You Fire 모바일 진입점
 * MobileSDK를 초기화하고 TetrisMobile 인스턴스를 생성합니다.
 *
 * 호스트리스 모드(폰만으로 방 만들기): ?session= 없이 접속하면 MobileSDK가
 * 자동으로 "방에 연결하기" 모달을 띄우는데, onCreateRoom 콜백을 넘기면 그
 * 모달에 "🏠 새 방 만들기" 버튼이 추가로 노출됨. 눌리면 화면에 안 보이는
 * <iframe>으로 이 게임의 host 페이지를 백그라운드에 띄워 진짜 세션을
 * 만들고(HostBaseGame이 postMessage로 sessionId를 알려줌 — 플랫폼 공통
 * 브릿지), 그 세션에 이 페이지 자신도 평범한 플레이어로 합류시킨다.
 */

import { MobileSDK }    from '../../../platform/client/MobileSDK.js';
import { TetrisMobile } from './TetrisMobile.js';

const sdk  = new MobileSDK({ onCreateRoom: createRoomAndJoin });
const game = new TetrisMobile(sdk); // eslint-disable-line no-unused-vars

function createRoomAndJoin() {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = '/games/give-you-fire/host/';
  document.body.appendChild(iframe);

  const onMessage = (e) => {
    if (e.origin !== location.origin) return;
    if (e.source !== iframe.contentWindow) return;
    if (e.data?.type !== 'platform:embeddedSessionReady') return;
    window.removeEventListener('message', onMessage);

    const { sessionId, qrUrl } = e.data;
    // 새로고침 없이 세션 확정 — 이 시점부터는 QR로 들어온 플레이어와
    // 완전히 동일한 흐름(닉네임 입력 → 준비하기)을 그대로 밟는다.
    history.replaceState(null, '', `?session=${sessionId}`);
    sdk.joinSession(sessionId);
    game.setRoomCreatorQr(qrUrl);
    requestWakeLock();
  };
  window.addEventListener('message', onMessage);
}

// 방을 만든 폰 화면이 꺼지면 숨겨진 host iframe의 소켓이 끊기며 세션
// 자체가 즉시 종료됨(SessionManager: 호스트 연결 끊김 = 유예 없이 즉시
// 종료) — Wake Lock으로 화면이 꺼지지 않게 해 위험을 낮춘다(완전한
// 해결은 아님: 사용자가 수동으로 앱을 벗어나면 여전히 위험).
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) await navigator.wakeLock.request('screen');
  } catch (err) {
    console.warn('[GiveYouFire] Wake Lock 요청 실패:', err);
  }
}
