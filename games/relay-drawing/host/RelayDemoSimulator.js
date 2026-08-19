export class RelayDemoSimulator {
  constructor(game) {
    this.game = game;
    this.demoTimeouts = [];
    this.demoIntervals = [];
  }

  trackTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    this.demoTimeouts.push(t);
    return t;
  }

  trackInterval(fn, ms) {
    const i = setInterval(fn, ms);
    this.demoIntervals.push(i);
    return i;
  }

  startDemo() {
    this.game._isDemo = true;
    
    // 1. 가상 봇 3명 등록
    const bots = [
      { id: 'bot_amy', nickname: '🤖 에이미 봇', color: '#EF4444', avatar: null },
      { id: 'bot_bob', nickname: '🤖 밥 봇', color: '#10B981', avatar: null },
      { id: 'bot_charles', nickname: '🤖 찰리 봇', color: '#3B82F6', avatar: null }
    ];

    bots.forEach(b => {
      this.game._profiles.set(b.id, { nickname: b.nickname, avatar: b.avatar });
      this.game.players.set(b.id, { id: b.id, color: b.color, _hasSubmitted: false });
      // 스냅샷에도 보존
      this.game._authorSnapshots.set(b.id, { nickname: b.nickname, avatar: b.avatar, color: b.color });
    });

    this.game._updateLobbyPlayers();
    this.game._broadcastPlayerList();

    // 로비 화면에서 QR 블러 처리 및 가이드 오버레이 탑재 (난입 차단)
    const qrWrap = document.querySelector('.qr-container');
    if (qrWrap) {
      qrWrap.style.filter = 'blur(8px)';
      qrWrap.style.pointerEvents = 'none';
      
      const overlayText = document.createElement('div');
      overlayText.id = 'demoQROverlay';
      overlayText.style.position = 'absolute';
      overlayText.style.inset = '0';
      overlayText.style.display = 'flex';
      overlayText.style.flexDirection = 'column';
      overlayText.style.alignItems = 'center';
      overlayText.style.justifyContent = 'center';
      overlayText.style.background = 'rgba(0,0,0,0.72)';
      overlayText.style.color = '#F59E0B';
      overlayText.style.fontWeight = 'bold';
      overlayText.style.fontSize = '1.1rem';
      overlayText.style.textAlign = 'center';
      overlayText.style.padding = '10px';
      overlayText.style.borderRadius = '8px';
      overlayText.style.boxSizing = 'border-box';
      overlayText.style.zIndex = '100';
      overlayText.innerHTML = '<span>🤖 데모 플레이 진행 중...</span><br><small style="font-size:0.78rem;color:#bbb;margin-top:4px;">데모 모드에서는 신규 접속이 불가합니다.</small>';
      qrWrap.parentNode.style.position = 'relative';
      qrWrap.parentNode.appendChild(overlayText);
    }

    // 데모 진행 상단 상시 배너 생성 (어떤 화면에서든 데모 중임을 알리고 수동 중단 가능)
    const banner = document.createElement('div');
    banner.id = 'demoBanner';
    banner.style.position = 'fixed';
    banner.style.top = '0';
    banner.style.left = '0';
    banner.style.width = '100%';
    banner.style.background = 'linear-gradient(90deg, #d97706, #f59e0b)';
    banner.style.color = '#000';
    banner.style.textAlign = 'center';
    banner.style.padding = '8px 16px';
    banner.style.fontSize = '14px';
    banner.style.fontWeight = 'bold';
    banner.style.zIndex = '9999';
    banner.style.display = 'flex';
    banner.style.justifyContent = 'space-between';
    banner.style.alignItems = 'center';
    banner.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';

    const bannerText = document.createElement('span');
    bannerText.textContent = '🤖 데모 플레이 시뮬레이션 동작 중...';
    
    const stopBtn = document.createElement('button');
    stopBtn.textContent = '데모 중단';
    stopBtn.style.background = '#000';
    stopBtn.style.color = '#fff';
    stopBtn.style.border = 'none';
    stopBtn.style.padding = '4px 12px';
    stopBtn.style.borderRadius = '4px';
    stopBtn.style.cursor = 'pointer';
    stopBtn.style.fontSize = '12px';
    stopBtn.onclick = () => {
      this.stopDemo();
      this.game.resetSession();
    };

    banner.appendChild(bannerText);
    banner.appendChild(stopBtn);
    document.body.appendChild(banner);

    // 배너가 position:fixed라 문서 흐름을 차지하지 않아, 각 페이즈(.view)의 헤더/제목이
    // 배너 밑에 깔려 가려지는 버그가 실측 확인됨(예: 결과 화면 제목 "릴레이 결과 발표").
    // 실제 렌더 높이를 측정해 CSS 변수로 넘겨 .view의 상단 여백을 그만큼 밀어낸다.
    requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--rd-demo-banner-h', `${banner.offsetHeight}px`);
    });

    // 로비의 데모 실행 버튼 텍스트 변경
    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.textContent = '🤖 데모 중단';
      demoPlayBtn.classList.add('demo-running');
    }

    // 2. 데모 게임 루프 시작
    this.game._startGame();
  }

  onRoundStarted(roundNumber) {
    const isDrawTurn = (roundNumber % 2 !== 0);
    if (isDrawTurn) {
      // 4초 동안 그림 그리기 시뮬레이션
      this.trackTimeout(() => {
        this.simulateDrawing('bot_amy', 'heart', 3500);
        this.simulateDrawing('bot_bob', 'spiral', 3500);
        this.simulateDrawing('bot_charles', 'face', 3500);
      }, 500);
    } else {
      // 2초 후 단어 알아맞히기 제출 시뮬레이션
      this.trackTimeout(() => {
        this.game._handlePlayerSubmission('bot_amy', { type: 'word', content: '하트 뿅뿅 ❤️' });
        this.game._handlePlayerSubmission('bot_bob', { type: 'word', content: '우주 소용돌이 🌀' });
        this.game._handlePlayerSubmission('bot_charles', { type: 'word', content: '귀여운 고양이 🐱' });
      }, 2000);
    }
  }

  // 봇의 실시간 그리기 시뮬레이션 (16ms 주기로 슥슥 그리는 수학 시뮬레이션)
  simulateDrawing(botId, patternType, durationMs = 3500) {
    const canvas = document.getElementById(`canvas-${botId}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // 드로잉 데이터 헤더 준비
    const strokeId = `demo_${botId}_${Date.now()}`;
    const color = botId === 'bot_amy' ? '#FF3B30' : (botId === 'bot_bob' ? '#007AFF' : '#34C759');
    const lineWidth = 6;
    
    let startX = 400;
    let startY = 300;
    
    if (patternType === 'heart') {
      startX = 400; startY = 220;
    } else if (patternType === 'spiral') {
      startX = 400; startY = 300;
    } else if (patternType === 'face') {
      startX = 300; startY = 250;
    }

    // 가상 strokeStart 호출
    this.game._activeStrokes.set(strokeId, {
      ctx,
      color,
      lineWidth,
      lastX: startX,
      lastY: startY,
      nextSeq: 0,
      seqBuffer: new Map()
    });

    // 시작점 그리기
    ctx.beginPath();
    ctx.arc(startX, startY, lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    const startTime = Date.now();
    const interval = this.trackInterval(() => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= durationMs) {
        clearInterval(interval);
        
        // demoIntervals 배열에서 제거
        const idx = this.demoIntervals.indexOf(interval);
        if (idx !== -1) this.demoIntervals.splice(idx, 1);

        this.game._activeStrokes.delete(strokeId);
        
        // 최종 캔버스 이미지 DataUrl을 turn 제출 처리
        const contentUrl = canvas.toDataURL('image/jpeg', 0.6);
        this.game._handlePlayerSubmission(botId, { type: 'draw', content: contentUrl });
        return;
      }

      const stroke = this.game._activeStrokes.get(strokeId);
      if (!stroke) return;

      const t = (elapsed / durationMs) * Math.PI * 2 * 3; // 회전 주기
      let nx = 0.5;
      let ny = 0.5;

      if (patternType === 'heart') {
        const heartT = (elapsed / durationMs) * Math.PI * 2;
        const hx = 16 * Math.pow(Math.sin(heartT), 3);
        const hy = 13 * Math.cos(heartT) - 5 * Math.cos(2 * heartT) - 2 * Math.cos(3 * heartT) - Math.cos(4 * heartT);
        nx = 0.5 + hx * 0.022;
        ny = 0.5 - hy * 0.022;
      } else if (patternType === 'spiral') {
        const r = (elapsed / durationMs) * 0.35;
        nx = 0.5 + r * Math.cos(t);
        ny = 0.5 + r * Math.sin(t);
      } else {
        const ratio = elapsed / durationMs;
        if (ratio < 0.55) {
          const circleT = (ratio / 0.55) * 2 * Math.PI;
          nx = 0.5 + 0.22 * Math.cos(circleT);
          ny = 0.55 + 0.22 * Math.sin(circleT);
        } else if (ratio < 0.78) {
          const ear1Ratio = (ratio - 0.55) / 0.23;
          nx = 0.32 + ear1Ratio * 0.08;
          ny = 0.38 - ear1Ratio * 0.15;
          if (ear1Ratio > 0.5) {
            nx = 0.4 - (ear1Ratio - 0.5) * 0.08;
            ny = 0.23 + (ear1Ratio - 0.5) * 0.15;
          }
        } else {
          const ear2Ratio = (ratio - 0.78) / 0.22;
          nx = 0.6 + ear2Ratio * 0.08;
          ny = 0.38 - ear2Ratio * 0.15;
          if (ear2Ratio > 0.5) {
            nx = 0.68 - (ear2Ratio - 0.5) * 0.08;
            ny = 0.23 + (ear2Ratio - 0.5) * 0.15;
          }
        }
      }

      const x = nx * 800;
      const y = ny * 600;
      
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(stroke.lastX, stroke.lastY);
      ctx.lineTo(x, y);
      ctx.stroke();

      stroke.lastX = x;
      stroke.lastY = y;
    }, 16);
  }

  stopDemo() {
    // 비활성 상태 호출에도 안전(no-op)해야 함(AGENTS.md 필수 처리 사항) — 이미 크래시는
    // 안 났지만(getter 대입 없음) 불필요하게 플레이어 리스트 브로드캐스트 등을 매번
    // 실행하고 있었음(Codex CLI 리뷰로 발견). onReset()이 데모 여부와 무관하게 항상
    // stopDemo()를 호출하는 안전망 패턴이라 이 가드가 있어야 그 호출들이 진짜 no-op가 됨.
    if (!this.game._isDemo) return;
    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];
    this.demoIntervals.forEach(i => clearInterval(i));
    this.demoIntervals = [];
    
    // QR 블러 및 오버레이 격파
    const overlay = document.getElementById('demoQROverlay');
    overlay?.parentNode?.removeChild(overlay);
    const qrWrap = document.querySelector('.qr-container');
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }

    // 데모 진행 중 배너 제거
    const banner = document.getElementById('demoBanner');
    banner?.parentNode?.removeChild(banner);
    document.documentElement.style.removeProperty('--rd-demo-banner-h');

    // 가상 봇 제거
    const bots = ['bot_amy', 'bot_bob', 'bot_charles'];
    bots.forEach(botId => {
      this.game._profiles.delete(botId);
      this.game.players.delete(botId);
      this.game._authorSnapshots.delete(botId);
    });

    this.game._activeStrokes.clear();
    this.game._updateLobbyPlayers();
    this.game._broadcastPlayerList();

    this.game._isDemo = false;

    // 호스트 로비 버튼 복원
    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.textContent = '🤖 실시간 드로잉 데모 플레이';
      demoPlayBtn.classList.remove('demo-running');
    }
  }
}
