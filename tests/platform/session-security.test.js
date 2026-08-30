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
    // 실제 MobileSDK는 재연결 하이재킹 방지용 생존 확인 핑에 즉시 ack한다 —
    // 이 헬퍼도 진짜 클라이언트처럼 동작하도록 동일하게 흉내낸다. 이게 없으면
    // "연결이 살아있는데도 확인 핑에 응답이 없어 죽은 것으로 오판"되어
    // 하이재킹 방지 테스트가 거꾸로 실패한다.
    sock.on('platform:_livenessPing', (ack) => { if (typeof ack === 'function') ack(); });
    sock.on('connect', () => resolve(sock));
    sock.on('connect_error', reject);
  });
}

// 생존 확인 핑에 절대 응답하지 않는 "좀비" 연결을 흉내낸다(실제로는 살아있지만
// 서버 입장에서는 응답 없음 = 죽은 것으로 판정되는 케이스 재현용).
function connectSilent() {
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
  player.emit('platform:playerReady', { sessionId });
  await once(host, 'platform:readyUpdate'); // 1/1 준비완료

  const disconnectReadyUpdate = once(host, 'platform:readyUpdate');
  player.close(); // 실제로 연결 끊김
  assert.equal((await disconnectReadyUpdate).payload.totalCount, 0, 'disconnect 시 0/0으로 즉시 재집계되어야 함');
  await new Promise((r) => setTimeout(r, 300)); // 서버가 disconnect 이벤트를 처리할 시간

  const reconnecting = await connect();
  const rejoinReadyUpdate = once(host, 'platform:readyUpdate');
  reconnecting.emit('platform:joinSession', { sessionId, reconnectId: stableId });
  const result = await once(reconnecting, 'platform:joined', 2000);

  assert.equal(result.timedOut, false, '실제로 끊긴 플레이어는 재연결에 성공해야 함');
  assert.equal(result.payload.reconnected, true);
  assert.equal(result.payload.player.id, stableId);

  // 회귀 포인트: 재연결로 다시 집계에 포함돼야 하는데 disconnect 때 보낸
  // readyUpdate가 stale한 채로 남아있으면 호스트 화면 카운트가 안 돌아옴
  const rejoinReady = await rejoinReadyUpdate;
  assert.equal(rejoinReady.timedOut, false, '재연결 시에도 readyUpdate가 다시 전송되어야 함');
  assert.equal(rejoinReady.payload.totalCount, 1, '재연결 후 다시 1/1로 집계되어야 함');
  assert.equal(rejoinReady.payload.readyCount, 1, '재연결 전 준비완료 상태가 유지되어 즉시 1/1이어야 함');

  host.close(); reconnecting.close();
});

test('이미 세션에 묶인 소켓은 새 세션을 만들거나 다른 세션에 참가할 수 없다 (중복 획득 방지)', async () => {
  const host = await connect();
  host.emit('platform:createSession', { gameId: 'test' });
  await once(host, 'platform:sessionCreated');

  // 이미 host로 묶인 같은 소켓이 또 createSession을 시도 — 유령 세션 생성 방지
  const secondCreatePromise = once(host, 'platform:sessionCreated', 800);
  host.emit('platform:createSession', { gameId: 'test' });
  assert.equal((await secondCreatePromise).timedOut, true, '이미 세션에 묶인 소켓은 새 세션을 또 만들 수 없어야 함');

  const otherHost = await connect();
  otherHost.emit('platform:createSession', { gameId: 'test' });
  const { payload: otherCreated } = await once(otherHost, 'platform:sessionCreated');

  // 이미 참가된 플레이어 소켓이 다른 세션에 또 참가 시도
  const player = await connect();
  player.emit('platform:joinSession', { sessionId: otherCreated.sessionId });
  await once(player, 'platform:joined');

  player.emit('platform:joinSession', { sessionId: otherCreated.sessionId });
  const dupJoin = await once(player, 'platform:joined', 800);
  assert.equal(dupJoin.timedOut, true, '이미 세션에 묶인 소켓은 (같은 세션이든 다른 세션이든) 다시 join할 수 없어야 함');

  host.close(); otherHost.close(); player.close();
});

test('강퇴된 소켓은 Socket.IO room에서도 제거되어 이후 세션 브로드캐스트를 받지 않는다', async () => {
  const host = await connect();
  host.emit('platform:createSession', { gameId: 'test' });
  const { payload: created } = await once(host, 'platform:sessionCreated');
  const sessionId = created.sessionId;

  const player = await connect();
  player.emit('platform:joinSession', { sessionId });
  const { payload: joined } = await once(player, 'platform:joined');

  const kickedPromise = once(player, 'platform:kicked');
  host.emit('platform:kickPlayer', { sessionId, playerId: joined.player.id });
  assert.equal((await kickedPromise).timedOut, false, '강퇴 알림 자체는 받아야 함');

  // 강퇴 후 room 브로드캐스트(platform:reset)가 더 이상 도달하지 않아야 함
  const resetAfterKick = once(player, 'platform:reset', 800);
  host.emit('platform:reset', { sessionId });
  assert.equal((await resetAfterKick).timedOut, true, '강퇴된 소켓은 세션 room에서 완전히 빠져야 하므로 이후 브로드캐스트를 받으면 안 됨');

  host.close(); player.close();
});

test('연결이 끊긴 플레이어는 준비완료 집계(allReady)에서 제외된다', async () => {
  const host = await connect();
  host.emit('platform:createSession', { gameId: 'test' });
  const { payload: created } = await once(host, 'platform:sessionCreated');
  const sessionId = created.sessionId;

  const p1 = await connect();
  p1.emit('platform:joinSession', { sessionId });
  await once(p1, 'platform:joined');
  p1.emit('platform:playerReady', { sessionId });
  await once(host, 'platform:readyUpdate'); // p1 준비완료 (1/1)

  p1.close(); // p1 연결 끊김 (아직 grace period 중, readyPlayers엔 남아있음)
  const disconnectReadyUpdate = await once(host, 'platform:readyUpdate', 1000);
  assert.equal(disconnectReadyUpdate.timedOut, false, 'disconnect 시 readyUpdate가 즉시 재전송되어야 함');
  assert.equal(disconnectReadyUpdate.payload.totalCount, 0, '연결 끊긴 플레이어는 totalCount에서 제외되어야 함');

  const p2 = await connect();
  p2.emit('platform:joinSession', { sessionId });
  await once(p2, 'platform:joined');
  const allReadyPromise = once(host, 'platform:allReady', 800);
  p2.emit('platform:playerReady', { sessionId });
  const readyUpdate2 = await once(host, 'platform:readyUpdate');

  assert.equal(readyUpdate2.payload.totalCount, 1, 'p1은 여전히 연결 끊김 상태라 집계에서 빠져야 함');
  assert.equal(readyUpdate2.payload.readyCount, 1, 'p2만 카운트되어야 함');
  assert.equal((await allReadyPromise).timedOut, false, 'p1(연결끊김) 없이 p2만으로도 allReady가 발동해야 함');

  host.close(); p2.close();
});

test('생존 프로브 실패(응답 없는 좀비 연결) 시 구 소켓을 실제로 끊어 방치하지 않는다', async () => {
  const host = await connect();
  host.emit('platform:createSession', { gameId: 'test' });
  const { payload: created } = await once(host, 'platform:sessionCreated');
  const sessionId = created.sessionId;

  // 생존 확인 핑에 응답하지 않는 "좀비" 연결(실제로는 살아있지만 서버 입장에선
  // 응답이 없어 죽은 것으로 판정됨)
  const zombie = await connectSilent();
  zombie.emit('platform:joinSession', { sessionId });
  const { payload: joined } = await once(zombie, 'platform:joined');
  const stableId = joined.player.id;

  const zombieDisconnectPromise = once(zombie, 'disconnect', 3000);

  const reconnecting = await connect();
  reconnecting.emit('platform:joinSession', { sessionId, reconnectId: stableId });
  const result = await once(reconnecting, 'platform:joined', 3000);

  assert.equal(result.timedOut, false, '좀비로 판정된 연결의 자리는 재연결이 허용되어야 함');
  assert.equal(result.payload.reconnected, true);

  // 핵심 회귀 포인트: 매핑만 지우고 방치하면 좀비 소켓은 "연결된 것처럼 보이지만
  // 모든 메시지가 조용히 무시되는" 상태가 된다 — 실제로 disconnect 이벤트를
  // 받아야 그 클라이언트도 스스로 재연결을 시도할 수 있다.
  assert.equal((await zombieDisconnectPromise).timedOut, false, '좀비로 판정된 구 소켓은 실제로 disconnect되어야 함');

  host.close(); zombie.close(); reconnecting.close();
});
