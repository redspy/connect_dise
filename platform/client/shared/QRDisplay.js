import QRCode from 'qrcode';

/**
 * QR 코드를 container에 렌더링합니다.
 * centerText를 지정하면 QR 중앙에 텍스트 라벨이 삽입됩니다.
 * (error correction level H 사용으로 최대 30% 손상 복구 가능)
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

  return canvas;
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
