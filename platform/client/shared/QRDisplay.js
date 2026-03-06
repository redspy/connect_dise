import QRCode from 'qrcode';

export async function renderQR(container, url, { width = 200 } = {}) {
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  await QRCode.toCanvas(canvas, url, {
    width,
    margin: 2,
    color: { dark: '#1C5435', light: '#FFFFFF' },
  });
  return canvas;
}
