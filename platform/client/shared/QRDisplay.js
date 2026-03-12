import QRCode from 'qrcode';

const LONG_PRESS_MS = 600; // 롱프레스 판정 시간 (ms)

/**
 * QR 코드를 container에 렌더링합니다.
 * centerText를 지정하면 QR 중앙에 텍스트 라벨이 삽입됩니다.
 * (error correction level H 사용으로 최대 30% 손상 복구 가능)
 *
 * 롱프레스(600ms 이상 누르기) 시 QR URL을 클립보드에 복사합니다.
 */
export async function renderQR(container, url, { width = 200, centerText = null } = {}) {
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  await QRCode.toCanvas(canvas, url, {
    width,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#1C5435', light: '#FFFFFF' },
  });

  if (centerText) {
    _drawCenterLabel(canvas, centerText);
  }

  _bindLongPress(container, url);

  return canvas;
}

/**
 * 롱프레스 이벤트를 container에 등록합니다.
 * 마우스/터치 모두 지원합니다.
 */
function _bindLongPress(container, url) {
  let timer = null;

  const start = () => {
    timer = setTimeout(() => {
      timer = null;
      _copyToClipboard(url, container);
    }, LONG_PRESS_MS);
  };

  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  container.addEventListener('mousedown',   start);
  container.addEventListener('mouseup',     cancel);
  container.addEventListener('mouseleave',  cancel);
  container.addEventListener('touchstart',  start,  { passive: true });
  container.addEventListener('touchend',    cancel);
  container.addEventListener('touchcancel', cancel);
  // 롱프레스 중 컨텍스트 메뉴 방지
  container.addEventListener('contextmenu', (e) => e.preventDefault());
}

/**
 * URL을 클립보드에 복사하고 토스트 메시지를 표시합니다.
 */
async function _copyToClipboard(url, anchor) {
  try {
    await navigator.clipboard.writeText(url);
    _showToast('링크 복사됨 ✓', anchor);
  } catch {
    // clipboard API 실패 시 fallback
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    _showToast('링크 복사됨 ✓', anchor);
  }
}

/**
 * QR 컨테이너 근처에 잠깐 나타났다 사라지는 토스트를 표시합니다.
 */
function _showToast(message, anchor) {
  // 기존 토스트 제거
  document.querySelectorAll('.qr-copy-toast').forEach(el => el.remove());

  const toast = document.createElement('div');
  toast.className = 'qr-copy-toast';
  toast.textContent = message;

  // anchor 위치 기준으로 띄움
  const rect = anchor.getBoundingClientRect();
  Object.assign(toast.style, {
    position:     'fixed',
    left:         `${rect.left + rect.width / 2}px`,
    top:          `${rect.top - 12}px`,
    transform:    'translate(-50%, -100%)',
    background:   '#1C5435',
    color:        '#fff',
    padding:      '6px 14px',
    borderRadius: '20px',
    fontSize:     '13px',
    fontWeight:   '600',
    fontFamily:   'system-ui, sans-serif',
    whiteSpace:   'nowrap',
    pointerEvents:'none',
    zIndex:       '9999',
    opacity:      '0',
    transition:   'opacity .2s ease',
  });

  document.body.appendChild(toast);
  // 다음 프레임에 페이드인
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 1800);
  });
}

function _drawCenterLabel(canvas, text) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const cx = w / 2;
  const cy = w / 2;

  const fontSize = Math.round(w * 0.076);
  ctx.font = `bold ${fontSize}px 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif`;

  const textW = ctx.measureText(text).width;
  const padX = fontSize * 0.55;
  const padY = fontSize * 0.38;
  const boxW = textW + padX * 2;
  const boxH = fontSize + padY * 2;
  const r = Math.round(boxH / 3.5);

  // 흰 배경
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  _roundRect(ctx, cx - boxW / 2, cy - boxH / 2, boxW, boxH, r);
  ctx.fill();

  // 테두리
  ctx.strokeStyle = '#1C5435';
  ctx.lineWidth = Math.max(1.5, w * 0.007);
  ctx.stroke();

  // 텍스트
  ctx.fillStyle = '#1C5435';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}
