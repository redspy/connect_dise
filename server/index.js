import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SessionManager } from '../platform/server/SessionManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);

// 프로덕션: vite build 결과물(dist/) 정적 서빙
app.use(express.static(join(__dirname, '..', 'dist')));
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 5e6, // 5MB — 그림 릴레이 base64 이미지 전송 허용
  // 기본값(pingInterval 25s + pingTimeout 20s)이면 죽은 소켓을 최대 45초까지
  // "연결됨"으로 오판할 수 있어, ready 집계 등 connected 플래그를 참조하는 로직이
  // 그만큼 부정확해짐. 재연결 하이재킹 방지 자체는 아래 liveness probe(isSocketAlive)가
  // 매 재연결 시도마다 직접 확인하므로 이 값에 의존하지 않는다 — 즉 이 설정은
  // "일반적인 죽은 연결 감지 지연 단축"만이 목적이라, 와이파이↔LTE 전환처럼
  // 정상적인 핸드오버 시간(보통 5~10초, 길면 그 이상)보다 짧게 잡으면 오히려
  // 전환 도중에 먼저 끊어버려 재연결을 더 유발하는 역효과가 난다. 하이재킹 방지를
  // 이 값에 기대지 않아도 되므로 굳이 공격적으로 줄일 이유가 없어, 기본값보다는
  // 짧지만 흔한 핸드오버 구간은 넉넉히 덮는 값으로 잡음.
  pingInterval: 20000,
  pingTimeout: 15000,
});

const sm = new SessionManager();

// 소켓이 실제로 그 세션의 (그리고 필요하면 특정 역할의) 구성원인지 확인.
// 클라이언트가 보낸 sessionId를 그대로 신뢰하지 않고, 서버가 소켓 연결 시점에
// 기록해둔 socketToSession 매핑을 유일한 진실로 삼는다 — 다른 세션을 리셋/강퇴하거나
// 메시지를 위조해 보내는 것을 막기 위함.
function verifySender(socket, sessionId, requiredRole = null) {
  const info = sm.socketToSession.get(socket.id);
  if (!info || info.sessionId !== sessionId) return null;
  if (requiredRole && info.role !== requiredRole) return null;
  return info;
}

// 재연결 하이재킹 방지 로직이 "아직 connected===true인 소켓"을 거부하기 전에,
// 그 소켓이 진짜 살아있는지 짧은 ack 타임아웃으로 직접 확인한다.
// (클라이언트의 MobileSDK는 이 핑에 즉시 ack하도록 구현되어 있음)
function isSocketAlive(socketId, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const target = io.sockets.sockets.get(socketId);
    if (!target) { resolve(false); return; }
    target.timeout(timeoutMs).emit('platform:_livenessPing', (err) => {
      resolve(!err);
    });
  });
}

// ─── 국내 주식(코스피/코스닥) 일별 시세 프록시 ───────────────────────────
// 브라우저에서 직접 외부 API를 부르면 CORS에 막히므로 서버가 대신 호출해 중계함.
// (games/pit-trade 실전 모드 전용 — 네이버 금융 공개 시세 API, 키 불필요)
app.get('/api/kr-stock/:code', async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'invalid_code' });
    return;
  }
  const days = Math.min(Math.max(Number(req.query.days) || 12, 1), 30);
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

  try {
    const url = `https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=${fmt(start)}&endTime=${fmt(end)}&timeframe=day`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let upstream;
    try {
      upstream = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    const text = await upstream.text();

    // 응답이 strict JSON이 아닌 JS 배열 리터럴이라 관대하게 파싱
    const rows = [];
    const re = /\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g;
    let m;
    while ((m = re.exec(text))) {
      rows.push({
        date: m[1],
        open: Number(m[2]), high: Number(m[3]), low: Number(m[4]), close: Number(m[5]), volume: Number(m[6]),
      });
    }
    res.json({ code, rows });
  } catch (err) {
    console.error(`[kr-stock proxy] ${code} 조회 실패:`, err.message);
    res.status(502).json({ error: 'upstream_failed' });
  }
});

// 플레이어 연결 끊김 후 실제 제거까지의 유예 시간 (뒤로가기/백그라운드 전환 후 재접속 허용)
const RECONNECT_GRACE_MS = 5 * 60_000; // 5분
const disconnectTimers = new Map(); // playerId → timer

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // ─── Platform events ────────────────────────────────────────────────────────

  socket.on('platform:createSession', ({ gameId }) => {
    const result = sm.createSession(socket.id, gameId);
    if (!result) {
      socket.emit('error', 'Socket already bound to a session');
      return;
    }
    const { sessionId, localIp } = result;
    socket.join(sessionId);
    socket.emit('platform:sessionCreated', { sessionId, localIp });
    console.log(`[${gameId}] Session ${sessionId} created (IP: ${localIp})`);
  });

  socket.on('platform:joinSession', async ({ sessionId, reconnectId = null }) => {
    // 재연결 하이재킹 방지(§SessionManager.joinSession)는 "connected===true인
    // 플레이어는 재연결 거부"가 원칙이지만, 서버의 disconnect 감지는
    // pingInterval+pingTimeout(최대 수십 초)이 지나야 일어나므로, 와이파이↔LTE
    // 전환처럼 실제로는 끊겼지만 서버가 아직 눈치채지 못한 "좀비 연결"도 똑같이
    // connected===true로 보인다. 그대로 거부하면 정상적인 순간 끊김까지 최대
    // pingTimeout만큼 로비 밖으로 튕기게 되므로, 거부하기 전에 구 소켓이 실제로
    // 살아있는지 짧은 타임아웃으로 직접 확인(probe)한다.
    if (reconnectId) {
      const existing = sm.getSession(sessionId)?.players.find(p => p.id === reconnectId);
      if (existing?.connected) {
        const alive = await isSocketAlive(existing.socketId);
        if (alive) {
          socket.emit('error', 'Session not found or invalid');
          return;
        }
        // 응답 없음 = 좀비 연결로 판정. socketToSession 매핑만 지우고 소켓 객체는
        // 그대로 두면, 그 소켓이 사실 지터로 ack만 늦었을 뿐 살아있는 경우
        // "연결된 것처럼 보이지만 보내는 메시지가 전부 조용히 무시되는" 상태로
        // 방치된다 — 실제로 끊어서 그 클라이언트도 자기 disconnect 이벤트를 받고
        // 스스로 재연결을 시도하도록 강제한다.
        const zombieSocket = io.sockets.sockets.get(existing.socketId);
        if (zombieSocket) {
          zombieSocket.disconnect(true); // 기존 disconnect 핸들러가 connected=false 처리까지 담당
        } else {
          sm.markDisconnected(sessionId, reconnectId); // 소켓 자체가 이미 없으면 상태만 직접 정리
        }
      }
    }

    const result = sm.joinSession(sessionId, socket.id, reconnectId);
    if (!result) {
      socket.emit('error', 'Session not found or invalid');
      return;
    }

    const { player, reconnected } = result;

    // 유예 타이머 취소 (재연결 성공)
    if (reconnected) {
      const timer = disconnectTimers.get(player.id);
      if (timer) { clearTimeout(timer); disconnectTimers.delete(player.id); }
      console.log(`Player ${player.id} reconnected to session ${sessionId}`);
    }

    socket.join(sessionId);
    socket.emit('platform:joined', { player, reconnected });

    const session = sm.getSession(sessionId);
    if (reconnected) {
      // 호스트에게 재연결 알림 (playerJoin 재호출 없이)
      io.to(session.hostSocketId).emit('platform:playerRejoined', { player });
      // disconnect 시점에 즉시 재전송했던 readyUpdate(연결 끊긴 플레이어 제외 집계)가
      // 재연결로 다시 무효화되므로, 최신 집계를 한 번 더 보내야 호스트 화면의
      // 카운트가 stale 상태로 남지 않는다.
      const { readyCount, totalCount } = sm.getReadyStatus(session);
      io.to(session.hostSocketId).emit('platform:readyUpdate', { readyCount, totalCount });
    } else {
      io.to(session.hostSocketId).emit('platform:playerJoined', { player });
      console.log(`Player ${player.id} joined session ${sessionId} (color: ${player.color})`);
    }
  });

  socket.on('platform:playerReady', ({ sessionId }) => {
    if (!verifySender(socket, sessionId, 'player')) return;
    const result = sm.setReady(sessionId, socket.id);
    if (!result) return;
    const session = sm.getSession(sessionId);
    if (!session) return;
    const { readyCount, totalCount, allReady } = result;
    io.to(session.hostSocketId).emit('platform:readyUpdate', { readyCount, totalCount });
    console.log(`[${sessionId}] ready ${readyCount}/${totalCount}`);
    if (allReady) {
      io.to(sessionId).emit('platform:allReady', {});
      console.log(`[${sessionId}] All players ready`);
    }
  });

  socket.on('platform:reset', ({ sessionId }) => {
    if (!verifySender(socket, sessionId, 'host')) return;
    sm.resetSession(sessionId);
    io.to(sessionId).emit('platform:reset', {});
    console.log(`[${sessionId}] Session reset`);
  });

  socket.on('platform:kickPlayer', ({ sessionId, playerId }) => {
    if (!verifySender(socket, sessionId, 'host')) return;
    const session = sm.getSession(sessionId);
    if (!session) return;

    // 플레이어의 현재 소켓 ID 조회
    const socketId = sm.getSocketId(sessionId, playerId);
    if (!socketId) return;

    // 세션에서 플레이어 강제 제거
    const idx = session.players.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      const player = session.players[idx];
      session.players.splice(idx, 1);
      session.readyPlayers.delete(playerId);
      sm.socketToSession.delete(player.socketId);

      // 플레이어 클라이언트에 강퇴 알림
      io.to(socketId).emit('platform:kicked', {});

      // Socket.IO room에서도 제거 — 안 그러면 강퇴된 소켓이 여전히 세션 room
      // 브로드캐스트(platform:reset/allReady/hostDisconnected 등)를 계속 수신함
      const kickedSocket = io.sockets.sockets.get(socketId);
      kickedSocket?.leave(sessionId);

      // 호스트에 플레이어 제거 알림
      io.to(session.hostSocketId).emit('platform:playerLeft', { playerId });
      const { readyCount, totalCount } = sm.getReadyStatus(session);
      io.to(session.hostSocketId).emit('platform:readyUpdate', { readyCount, totalCount });

      // grace period 중(연결 끊김 상태)인 플레이어를 강퇴한 경우, 남아있던
      // 5분 유예 타이머도 함께 정리(안 지워도 finalizePlayerRemoval이 이미
      // 없는 플레이어라 no-op으로 끝나긴 하지만, 굳이 5분을 기다릴 이유가 없음)
      const kickTimer = disconnectTimers.get(playerId);
      if (kickTimer) { clearTimeout(kickTimer); disconnectTimers.delete(playerId); }

      console.log(`[${sessionId}] Player ${playerId} kicked`);
    }
  });

  // ─── Game message routing ─────────────────────────────────────────────────

  socket.on('game:toHost', ({ sessionId, type, payload }) => {
    const info = verifySender(socket, sessionId, 'player');
    if (!info) return;
    const session = sm.getSession(sessionId);
    if (!session) return;
    io.to(session.hostSocketId).emit('game:fromPlayer', { from: info.playerId, type, payload });
  });

  socket.on('game:toPlayer', ({ sessionId, to, type, payload }) => {
    if (!verifySender(socket, sessionId, 'host')) return;
    const socketId = sm.getSocketId(sessionId, to);
    if (socketId) io.to(socketId).emit('game:fromHost', { type, payload });
  });

  socket.on('game:broadcast', ({ sessionId, type, payload }) => {
    if (!verifySender(socket, sessionId, 'host')) return;
    const session = sm.getSession(sessionId);
    if (!session) return;
    for (const p of session.players) {
      io.to(p.socketId).emit('game:fromHost', { type, payload });
    }
  });

  // ─── P2P Signaling relay ─────────────────────────────────────────────────

  // 호스트 → 플레이어: offer 전달
  socket.on('p2p:offer', ({ sessionId, to, sdp }) => {
    if (!verifySender(socket, sessionId, 'host')) return;
    const socketId = sm.getSocketId(sessionId, to);
    if (socketId) io.to(socketId).emit('p2p:offer', { sdp });
  });

  // 플레이어 → 호스트: answer 전달
  socket.on('p2p:answer', ({ sessionId, sdp }) => {
    const info = verifySender(socket, sessionId, 'player');
    if (!info) return;
    const session = sm.getSession(sessionId);
    if (session) {
      io.to(session.hostSocketId).emit('p2p:answer', { from: info.playerId, sdp });
    }
  });

  // ICE 후보 양방향 relay
  // to 있음 → 호스트→플레이어, to 없음 → 플레이어→호스트
  socket.on('p2p:ice', ({ sessionId, to, candidate }) => {
    if (to) {
      if (!verifySender(socket, sessionId, 'host')) return;
      const socketId = sm.getSocketId(sessionId, to);
      if (socketId) io.to(socketId).emit('p2p:ice', { candidate });
    } else {
      const info = verifySender(socket, sessionId, 'player');
      if (!info) return;
      const session = sm.getSession(sessionId);
      if (session) {
        io.to(session.hostSocketId).emit('p2p:ice', { from: info.playerId, candidate });
      }
    }
  });

  // ─── Disconnect ───────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    const events = sm.removeSocket(socket.id);

    for (const { sessionId, role, data } of events) {
      if (role === 'host') {
        io.to(sessionId).emit('hostDisconnected');
        console.log(`Session ${sessionId} closed — host disconnected`);

        // 세션이 통째로 사라졌으니, 그 세션 소속 플레이어들의 그레이스 타이머도
        // 더 이상 의미가 없다 — 정리 안 해도 나중에 no-op으로 끝나긴 하지만
        // (session이 이미 없어 finalizePlayerRemoval이 null 반환), 세션 생성/파괴가
        // 잦은 환경(데모 attract 모드 등)에서 타이머가 계속 쌓이는 걸 방지.
        for (const p of data?.players ?? []) {
          const timer = disconnectTimers.get(p.id);
          if (timer) { clearTimeout(timer); disconnectTimers.delete(p.id); }
        }

      } else if (data?.player) {
        const { player, hostSocketId } = data;
        const oldSocketId = socket.id;

        // 호스트에게 일시 연결 끊김 알림 (선택적 UI용)
        io.to(hostSocketId).emit('platform:playerDisconnected', { playerId: player.id });
        console.log(`[${sessionId}] Player ${player.id} disconnected — grace ${RECONNECT_GRACE_MS / 1000}s`);

        // 연결 끊긴 플레이어는 준비 완료 여부와 무관하게 즉시 집계에서 제외
        // (readyPlayers Set 자체는 보존 — 재연결 시 다시 준비 누를 필요 없게)
        const liveSession = sm.getSession(sessionId);
        if (liveSession) {
          const { readyCount, totalCount } = sm.getReadyStatus(liveSession);
          io.to(hostSocketId).emit('platform:readyUpdate', { readyCount, totalCount });
        }

        // 유예 기간 후 완전 제거
        const timer = setTimeout(() => {
          disconnectTimers.delete(player.id);
          const result = sm.finalizePlayerRemoval(sessionId, player.id, oldSocketId);
          if (result) {
            io.to(result.hostSocketId).emit('platform:playerLeft', { playerId: player.id });
            io.to(result.hostSocketId).emit('platform:readyUpdate', {
              readyCount: result.readyCount,
              totalCount: result.totalCount,
            });
            console.log(`[${sessionId}] Player ${player.id} removed after grace period`);
          }
        }, RECONNECT_GRACE_MS);

        disconnectTimers.set(player.id, timer);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Socket.IO Server running on http://0.0.0.0:${PORT}`);
});
