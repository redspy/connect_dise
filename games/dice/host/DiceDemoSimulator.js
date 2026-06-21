export class DiceDemoSimulator {
  constructor(hostSDK, { onStart, onStop } = {}) {
    this.host = hostSDK;
    this.isDemo = false;
    this.demoInterval = null;
    this.onStart = onStart;
    this.onStop = onStop;
  }

  startDemo() {
    if (this.isDemo) return;
    this.isDemo = true;

    // QR 블러 가드
    const qrContainers = document.querySelectorAll('.qr-container');
    qrContainers.forEach(container => {
      container.style.filter = 'blur(8px)';
      container.style.pointerEvents = 'none';

      // 오버레이 텍스트 추가
      if (!container.querySelector('.demo-qr-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'demo-qr-overlay';
        overlay.style.position = 'absolute';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,0.7)';
        overlay.style.color = '#F59E0B';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.fontSize = '0.8rem';
        overlay.style.fontWeight = 'bold';
        overlay.style.borderRadius = '8px';
        overlay.style.zIndex = '10';
        overlay.textContent = '🤖 데모 중';
        container.style.position = 'relative';
        container.appendChild(overlay);
      }
    });

    if (this.onStart) this.onStart();

    const botColors = ['#EF4444', '#10B981', '#3B82F6', '#F59E0B', '#8B5CF6'];
    const botIds = ['bot_amy', 'bot_bob', 'bot_charles'];
    let nextBotIdx = 0;

    const triggerThrow = () => {
      const botId = botIds[nextBotIdx];
      const color = botColors[Math.floor(Math.random() * botColors.length)];
      nextBotIdx = (nextBotIdx + 1) % botIds.length;

      const handler = this.host._messageHandlers.get('throwDice');
      if (handler) {
        handler({ id: botId }, { strength: 1, color });
      }
    };

    // 첫 투척은 1.5초 후
    setTimeout(() => {
      if (this.isDemo) triggerThrow();
    }, 1500);

    this.demoInterval = setInterval(() => {
      triggerThrow();
    }, 7000);
  }

  stopDemo() {
    if (!this.isDemo) return;
    this.isDemo = false;

    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }

    // QR 복구
    const qrContainers = document.querySelectorAll('.qr-container');
    qrContainers.forEach(container => {
      container.style.filter = '';
      container.style.pointerEvents = '';
      const overlay = container.querySelector('.demo-qr-overlay');
      if (overlay) {
        overlay.parentNode.removeChild(overlay);
      }
    });

    if (this.onStop) this.onStop();
  }
}
