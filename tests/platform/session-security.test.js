// server/index.js의 세션 권한 검증(§ audit "Critical — 서버가 호스트/플레이어 권한을 검증하지 않음",
// "Critical — 재연결 계약이 5분 유예 중 복귀로 제한되지 않음") 수정을 고정하는 회귀 테스트.
// 실제 서버 프로세스를 별도 포트로 띄워 socket.io-client로 직접 통신하며 검증한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { io as ioClient } from 'socket.io-client';

const PORT = 34567;
const BASE_URL = `http://localhost:${PORT}`;
let serverProc;

function connect() {
  return new Promise((resolve, reject) => {
    const sock = ioClient(BASE_URL, { transports: ['websocket'], reconnection: false });
    sock.on('connect', () => resolve(sock));
    sock.on('connect_error', reject);
  });
}

function once(sock, event, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    sock.once(event, (payload) => {
      clearTimeout(timer);
      resolve({ timedOut: false, payload });
    });
  });
}

before(async () => {
  serverProc = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'pipe',
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('서버 기동 타임아웃')), 10000);
    serverProc.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Socket.IO Server running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProc.on('error', reject);
  });
});

after(() => {
  serverProc?.kill();
});

test('세션 A의 플레이어는 세션 B를 준비 상태로 만들 수 없다 (playerReady 세션 검증)', async () => {
  const hostA = await connect();
  hostA.emit('platform:createSession', { gameId: 'test' });
  const { payload: createdA } = await once(hostA, 'platform:sessionCreated');
  const sessionA = createdA.sessionId;

  const hostB = await connect();
  hostB.emit('platform:createSession', { gameId: 'test' });
  const { payload: createdB } = await once(hostB, 'platform:sessionCreated');
  const sessionB = createdB.sessionId;

  const playerA = await connect();
  playerA.emit('platform:joinSession', { sessionId: sessionA });
  await once(playerA, 'platform:joined');

  // 공격 시도: A의 플레이어가 B 세션을 대상으로 playerReady를 위조
  const bReadyPromise = once(hostB, 'platform:readyUpdate', 800);
  playerA.emit('platform:playerReady', { sessionId: sessionB });
  const bReady = await bReadyPromise;

  assert.equal(bReady.timedOut, true, 'B 세션 호스트는 위조된 readyUpdate를 받으면 안 됨');

  hostA.close(); hostB.close(); playerA.close();
});

test('세션 A의 플레이어는 세션 B를 리셋하거나 세션 B에서 강퇴를 실행할 수 없다', async () => {
  const hostA = await connect();
  hostA.emit('platform:createSession', { gameId: 'test' });
  const { payload: createdA } = await once(hostA, 'platform:sessionCreated');
  const sessionA = createdA.sessionId;

  const hostB = await connect();
  hostB.emit('platform:createSession', { gameId: 'test' });
  const { payload: createdB } = await once(hostB, 'platform:sessionCreated');
  const sessionB = createdB.sessionId;

  const playerB = await connect();
  playerB.emit('platform:joinSession', { sessionId: sessionB });
  const { payload: joinedB } = await once(playerB, 'platform:joined');

  const playerA = await connect();
  playerA.emit('platform:joinSession', { sessionId: sessionA });
  await once(playerA, 'platform:joined');

  // 공격 시도 1: A의 플레이어가 B를 리셋
  const bResetPromise = once(playerB, 'platform:reset', 800);
  playerA.emit('platform:reset', { sessionId: sessionB });
  assert.equal((await bResetPromise).timedOut, true, 'B는 A의 플레이어가 보낸 위조 reset을 받으면 안 됨');

  // 공격 시도 2: A의 플레이어가 B에서 강퇴 시도(호스트 권한도 없고 세션도 다름)
  const kickPromise = once(playerB, 'platform:kicked', 800);
  playerA.emit('platform:kickPlayer', { sessionId: sessionB, playerId: joinedB.player.id });
  assert.equal((await kickPromise).timedOut, true, 'B의 플레이어는 A의 플레이어가 보낸 위조 kick으로 쫓겨나면 안 됨');

  // 정상 동작 확인: 진짜 호스트 B는 자기 세션을 리셋/강퇴할 수 있어야 함
  const realResetPromise = once(playerB, 'platform:reset', 800);
  hostB.emit('platform:reset', { sessionId: sessionB });
  assert.equal((await realResetPromise).timedOut, false, '정상 호스트의 reset은 반드시 동작해야 함');

  hostA.close(); hostB.close(); playerA.close(); playerB.close();
});

test('세션 A의 플레이어는 세션 B 호스트에게 메시지를 위조해 보낼 수 없다 (game:toHost)', async () => {
  const hostA = await connect();
  hostA.emit('platform:createSession', { gameId: 'test' });
  const { payload: createdA } = await once(hostA, 'platform:sessionCreated');
  const sessionA = createdA.sessionId;

  const hostB = await connect();
  hostB.emit('platform:createSession', { gameId: 'test' });
  const { payload: createdB } = await once(hostB, 'platform:sessionCreated');
  const sessionB = createdB.sessionId;

  const playerA = await connect();
  playerA.emit('platform:joinSession', { sessionId: sessionA });
  await once(playerA, 'platform:joined');

  const forgedPromise = once(hostB, 'game:fromPlayer', 800);
  playerA.emit('game:toHost', { sessionId: sessionB, type: 'hack', payload: {} });
  assert.equal((await forgedPromise).timedOut, true, 'B 호스트는 A의 플레이어가 보낸 위조 game:toHost를 받으면 안 됨');

  // 정상 동작: 진짜 세션의 플레이어가 보낸 메시지는 정상 전달돼야 함
  const realPromise = once(hostA, 'game:fromPlayer', 800);
  playerA.emit('game:toHost', { sessionId: sessionA, type: 'ping', payload: { ok: true } });
  const real = await realPromise;
  assert.equal(real.timedOut, false);
  assert.equal(real.payload.type, 'ping');

  hostA.close(); hostB.close(); playerA.close();
});

test('플레이어가 아닌 소켓은 game:toPlayer/game:broadcast로 다른 세션에 메시지를 위조할 수 없다', async () => {
  const hostA = await connect();
  hostA.emit('platform:createSession', { gameId: 'test' });
  const { payload: createdA } = await once(hostA, 'platform:sessionCreated');
  const sessionA = createdA.sessionId;

  const hostB = await connect();
  hostB.emit('platform:createSession', { gameId: 'test' });
  const { payload: createdB } = await once(hostB, 'platform:sessionCreated');
  const sessionB = createdB.sessionId;

  const playerB = await connect();
  playerB.emit('platform:joinSession', { sessionId: sessionB });
  const { payload: joinedB } = await once(playerB, 'platform:joined');

  // 공격 시도: A의 호스트가 B의 플레이어에게 직접 메시지 위조 (호스트 역할이지만 세션이 다름)
  const forgedToPromise = once(playerB, 'game:fromHost', 800);
  hostA.emit('game:toPlayer', { sessionId: sessionB, to: joinedB.player.id, type: 'hack', payload: {} });
  assert.equal((await forgedToPromise).timedOut, true);

  const forgedBroadcastPromise = once(playerB, 'game:fromHost', 800);
  hostA.emit('game:broadcast', { sessionId: sessionB, type: 'hack', payload: {} });
  assert.equal((await forgedBroadcastPromise).timedOut, true);

  // 정상 동작: 진짜 호스트 B가 자기 세션 플레이어에게 브로드캐스트
  const realPromise = once(playerB, 'game:fromHost', 800);
  hostB.emit('game:broadcast', { sessionId: sessionB, type: 'greet', payload: {} });
  assert.equal((await realPromise).timedOut, false);

  hostA.close(); hostB.close(); playerB.close();
});

test('재연결 탈취 방지: 연결이 살아있는 플레이어의 stable ID로는 재연결(하이재킹)할 수 없다', async () => {
  const host = await connect();
  host.emit('platform:createSession', { gameId: 'test' });
  const { payload: created } = await once(host, 'platform:sessionCreated');
  const sessionId = created.sessionId;

  const player = await connect();
  player.emit('platform:joinSession', { sessionId });
  const { payload: joined } = await once(player, 'platform:joined');
  const stableId = joined.player.id;

  // player는 아직 연결된 상태 — 공격자가 stable ID를 알아내 하이재킹 시도
  const attacker = await connect();
  attacker.emit('platform:joinSession', { sessionId, reconnectId: stableId });
  const attackResult = await once(attacker, 'platform:joined', 800);
  const errorResult = await (attackResult.timedOut ? once(attacker, 'error', 800) : Promise.resolve({ timedOut: true }));

  if (!attackResult.timedOut) {
    assert.notEqual(attackResult.payload.reconnected, true, '연결이 살아있는 플레이어의 자리를 가로채면 안 됨');
  }

  // 원래 player 소켓은 여전히 살아있고 정상 동작해야 함 (하이재킹으로 무효화되지 않았어야 함)
  const pingPromise = once(host, 'game:fromPlayer', 800);
  player.emit('game:toHost', { sessionId, type: 'still-alive', payload: {} });
  assert.equal((await pingPromise).timedOut, false, '원래 플레이어 소켓이 하이재킹으로 무효화되면 안 됨');

  host.close(); player.close(); attacker.close();
});

test('정상 재연결: 실제로 연결이 끊긴 플레이어는 유예 시간 내에 재연결 가능하다', async () => {
  const host = await connect();
  host.emit('platform:createSession', { gameId: 'test' });
  const { payload: created } = await once(host, 'platform:sessionCreated');
  const sessionId = created.sessionId;

  const player = await connect();
  player.emit('platform:joinSession', { sessionId });
  const { payload: joined } = await once(player, 'platform:joined');
  const stableId = joined.player.id;

  player.close(); // 실제로 연결 끊김
  await new Promise((r) => setTimeout(r, 300)); // 서버가 disconnect 이벤트를 처리할 시간

  const reconnecting = await connect();
  reconnecting.emit('platform:joinSession', { sessionId, reconnectId: stableId });
  const result = await once(reconnecting, 'platform:joined', 2000);

  assert.equal(result.timedOut, false, '실제로 끊긴 플레이어는 재연결에 성공해야 함');
  assert.equal(result.payload.reconnected, true);
  assert.equal(result.payload.player.id, stableId);

  host.close(); reconnecting.close();
});
