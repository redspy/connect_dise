/**
 * main.js — 루미큐브 모바일 진입점
 */
import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { RummikubMobile } from './RummikubMobile.js';

const sdk = new MobileSDK({ onCreateRoom: createRoomAndJoin });
const game = new RummikubMobile(sdk); // eslint-disable-line no-unused-vars

function createRoomAndJoin() {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = '/games/rummikub/host/';
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
    console.warn('[Rummikub] Wake Lock 요청 실패:', err);
  }
}
