export class RelayDemoSimulator {
  constructor(game) {
    this.game = game;
    this.demoTimeouts = [];
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
      // HostBaseGame의 players Map에 가상 Player 추가
      this.game.players.set(b.id, { id: b.id, color: b.color, _hasSubmitted: false });
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

    // 2. 3초 카운트다운 없이 데모는 바로 시작
    this.game._startGame();
  }

  // 봇의 실시간 그리기 시뮬레이션 (16ms 주기로 슥슥 그리는 수학 시뮬레이션)
  simulateDrawing(botId, patternType, durationMs = 5000) {
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
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= durationMs) {
        clearInterval(interval);
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
    this.demoTimeouts.forEach(t => clearTimeout(t));
    this.demoTimeouts = [];
    
    // QR 블러 및 오버레이 격파
    const overlay = document.getElementById('demoQROverlay');
    overlay?.parentNode?.removeChild(overlay);
    const qrWrap = document.querySelector('.qr-container');
    if (qrWrap) {
      qrWrap.style.filter = '';
      qrWrap.style.pointerEvents = '';
    }

    this.game._isDemo = false;
  }
}
