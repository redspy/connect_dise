/**
 * 카메라로 QR 코드를 스캔하여 URL 문자열을 반환하는 유틸리티.
 *
 * 우선순위:
 *  1. BarcodeDetector API (Chrome Android, iOS 17+, Samsung Internet)
 *  2. 미지원 브라우저 → 수동 URL 입력 폴백
 *
 * 사용법:
 *   const scanner = new QRScanner();
 *   const url = await scanner.scan(); // 스캔 취소 시 null 반환
 *   if (url) window.location.href = url;
 */
export class QRScanner {
  constructor() {
    this._overlay = null;
    this._stream = null;
    this._rafId = null;
    this._track = null;
    this._zoom = 1;
    this._zoomMin = 1;
    this._zoomMax = 1;
    this._zoomStep = 0.5;
    this._ev = 0;
    this._evMin = 0;
    this._evMax = 0;
    this._evStep = 0.5;
  }

  /** QR 스캔 오버레이를 열고, 읽힌 rawValue(URL)를 반환합니다. 취소하면 null. */
  scan() {
    return new Promise((resolve) => {
      this._open(resolve);
    });
  }

  _open(resolve) {
    // ── 전체화면 오버레이 ─────────────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:9999',
      'background:#000',
      'display:flex;flex-direction:column',
    ].join(';');

    // 카메라 영상 — 전체 면적 채움
    const video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.style.cssText = [
      'flex:1;width:100%;object-fit:cover',
      'display:block',
    ].join(';');

    // 뷰파인더 가이드 (화면 중앙 반투명 사각형)
    const guide = document.createElement('div');
    guide.style.cssText = [
      'position:absolute',
      'top:50%;left:50%;transform:translate(-50%,-50%)',
      'width:min(65vw,260px);height:min(65vw,260px)',
      'border:2px solid rgba(0,238,255,0.7)',
      'border-radius:12px',
      'box-shadow:0 0 0 9999px rgba(0,0,0,0.45)',
      'pointer-events:none',
    ].join(';');

    // 상단 컨트롤 바
    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:absolute;top:0;left:0;right:0',
      'display:flex;align-items:center;justify-content:space-between',
      'padding:12px 16px',
      'background:linear-gradient(to bottom,rgba(0,0,0,0.65),transparent)',
    ].join(';');

    const hint = document.createElement('span');
    hint.textContent = 'QR 코드를 사각형에 맞춰주세요';
    hint.style.cssText =
      'color:#cce8ff;font-size:0.9rem;font-family:sans-serif';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕';
    cancelBtn.style.cssText = [
      'background:rgba(255,255,255,0.18);color:#fff',
      'border:none;border-radius:50%;width:34px;height:34px',
      'font-size:1rem;cursor:pointer;flex-shrink:0',
    ].join(';');

    bar.append(hint, cancelBtn);

    // 하단 컨트롤 바 (줌 + 노출)
    const zoomBar = document.createElement('div');
    zoomBar.style.cssText = [
      'position:absolute;bottom:0;left:0;right:0',
      'display:none;flex-direction:column;align-items:center;gap:10px',
      'padding:12px 16px 20px',
      'background:linear-gradient(to top,rgba(0,0,0,0.75),transparent)',
    ].join(';');

    // 줌 행
    const zoomRow = document.createElement('div');
    zoomRow.style.cssText = 'display:flex;align-items:center;gap:14px';
    const zoomOut = this._ctrlBtn('−');
    const zoomLabel = document.createElement('span');
    zoomLabel.style.cssText =
      'color:#fff;font-size:0.85rem;font-family:monospace;min-width:54px;text-align:center';
    zoomLabel.textContent = '🔍 1×';
    const zoomIn = this._ctrlBtn('+');
    zoomOut.addEventListener('click', () =>
      this._adjustZoom(-this._zoomStep, zoomLabel),
    );
    zoomIn.addEventListener('click', () =>
      this._adjustZoom(+this._zoomStep, zoomLabel),
    );
    zoomRow.append(zoomOut, zoomLabel, zoomIn);

    // 노출 행
    const evRow = document.createElement('div');
    evRow.style.cssText = 'display:flex;align-items:center;gap:14px';
    const evDown = this._ctrlBtn('−');
    const evLabel = document.createElement('span');
    evLabel.style.cssText =
      'color:#fff;font-size:0.85rem;font-family:monospace;min-width:54px;text-align:center';
    evLabel.textContent = '☀️ 0EV';
    const evUp = this._ctrlBtn('+');
    evDown.addEventListener('click', () =>
      this._adjustEV(-this._evStep, evLabel),
    );
    evUp.addEventListener('click', () =>
      this._adjustEV(+this._evStep, evLabel),
    );
    evRow.append(evDown, evLabel, evUp);

    zoomBar.append(zoomRow, evRow);

    overlay.append(video, guide, bar, zoomBar);
    document.body.appendChild(overlay);
    this._overlay = overlay;

    const done = (value) => {
      this._cleanup();
      resolve(value);
    };

    cancelBtn.addEventListener('click', () => done(null));

    // ── 카메라 스트림 열기 ─────────────────────────────────────────────────────
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        this._stream = stream;
        this._track = stream.getVideoTracks()[0];
        video.srcObject = stream;
        video.play();

        // 하드웨어 줌 / 노출 지원 여부 확인
        const caps = this._track.getCapabilities?.() ?? {};
        let hasControl = false;

        if (caps.zoom) {
          this._zoomMin = caps.zoom.min ?? 1;
          this._zoomMax = caps.zoom.max ?? 1;
          this._zoomStep = Math.max(0.1, (this._zoomMax - this._zoomMin) / 10);
          this._zoom = this._zoomMin;
          zoomLabel.textContent = `🔍 ${this._zoom.toFixed(1)}×`;
          hasControl = true;
        }

        if (caps.exposureCompensation) {
          this._evMin = caps.exposureCompensation.min ?? -3;
          this._evMax = caps.exposureCompensation.max ?? 3;
          this._evStep = caps.exposureCompensation.step ?? 0.5;
          this._ev = 0;
          evLabel.textContent = '☀️ 0.0EV';
          hasControl = true;
        } else {
          evRow.style.display = 'none'; // 미지원이면 행 숨김
        }

        if (hasControl) zoomBar.style.display = 'flex';

        if ('BarcodeDetector' in window) {
          this._detectLoop(video, done);
        } else {
          this._fallbackInput(overlay, cancelBtn, hint, done);
        }
      })
      .catch(() => {
        video.remove();
        guide.remove();
        this._fallbackInput(overlay, cancelBtn, hint, done);
      });
  }

  _ctrlBtn(label) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = [
      'background:rgba(255,255,255,0.2);color:#fff',
      'border:1px solid rgba(255,255,255,0.4)',
      'border-radius:50%;width:40px;height:40px',
      'font-size:1.3rem;cursor:pointer;line-height:1',
    ].join(';');
    return btn;
  }

  _adjustZoom(delta, label) {
    if (!this._track || !this._zoomMax) return;
    this._zoom = Math.max(
      this._zoomMin,
      Math.min(this._zoomMax, this._zoom + delta),
    );
    this._track
      .applyConstraints({ advanced: [{ zoom: this._zoom }] })
      .catch(() => {});
    label.textContent = `🔍 ${this._zoom.toFixed(1)}×`;
  }

  _adjustEV(delta, label) {
    if (!this._track) return;
    this._ev = Math.max(this._evMin, Math.min(this._evMax, this._ev + delta));
    this._ev = Math.round(this._ev / this._evStep) * this._evStep;
    this._track
      .applyConstraints({
        advanced: [{ exposureMode: 'manual', exposureCompensation: this._ev }],
      })
      .catch(() => {});
    label.textContent = `☀️ ${this._ev > 0 ? '+' : ''}${this._ev.toFixed(1)}EV`;
  }

  /** BarcodeDetector rAF 루프 */
  _detectLoop(video, done) {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });

    const tick = async () => {
      if (!this._overlay) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length > 0) {
          done(codes[0].rawValue);
          return;
        }
      } catch (_) {}
      this._rafId = requestAnimationFrame(tick);
    };

    video.addEventListener(
      'playing',
      () => {
        this._rafId = requestAnimationFrame(tick);
      },
      { once: true },
    );
  }

  /** BarcodeDetector 미지원 시 수동 URL 입력 */
  _fallbackInput(overlay, cancelBtn, hint, done) {
    hint.textContent = 'QR 스캔을 지원하지 않는 브라우저입니다.';

    const wrap = document.createElement('div');
    wrap.style.cssText = [
      'position:absolute;bottom:60px;left:50%;transform:translateX(-50%)',
      'display:flex;flex-direction:column;align-items:center;gap:10px',
      'width:min(80vw,300px)',
    ].join(';');

    const input = document.createElement('input');
    input.type = 'url';
    input.placeholder = 'https://...';
    input.style.cssText = [
      'padding:10px 14px;border-radius:10px;border:none',
      'font-size:1rem;width:100%;box-sizing:border-box',
    ].join(';');

    const goBtn = document.createElement('button');
    goBtn.textContent = '이동';
    goBtn.style.cssText = [
      'padding:10px 0;width:100%',
      'background:rgba(0,238,255,0.25);color:#00eeff',
      'border:1px solid rgba(0,238,255,0.6);border-radius:50px',
      'font-size:1rem;cursor:pointer',
    ].join(';');

    goBtn.addEventListener('click', () => {
      if (input.value) done(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value) done(input.value);
    });

    wrap.append(input, goBtn);
    overlay.appendChild(wrap);
    input.focus();
  }

  _cleanup() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
    this._track = null;
  }
}
