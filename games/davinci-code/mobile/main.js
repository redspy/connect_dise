/**
 * main.js — 다빈치 코드 모바일 진입점
 */
import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { DavinciMobile } from './DavinciMobile.js';

const sdk = new MobileSDK({ onCreateRoom: createRoomAndJoin });
const game = new DavinciMobile(sdk); // eslint-disable-line no-unused-vars

function createRoomAndJoin() {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = '/games/davinci-code/host/';
  document.body.appendChild(iframe);

  const onMessage = (e) => {
    if (e.origin !== location.origin) return;
    if (e.source !== iframe.contentWindow) return;
    if (e.data?.type !== 'platform:embeddedSessionReady') return;
    window.removeEventListener('message', onMessage);

    const { sessionId, qrUrl } = e.data;
    history.replaceState(null, '', `?session=${sessionId}`);
    sdk.joinSession(sessionId);
    game.setRoomCreatorQr(qrUrl);
    requestWakeLock();
  };
  window.addEventListener('message', onMessage);
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) await navigator.wakeLock.request('screen');
  } catch (err) {
    console.warn('[DavinciCode] Wake Lock 요청 실패:', err);
  }
}
