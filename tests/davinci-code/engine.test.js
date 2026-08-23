import { test } from 'node:test';
import assert from 'node:assert';
import {
  createPools, poolCounts, officialInsertIndex, insertPosition, judgeGuess,
  isEliminated, publicTile, publicBoards, finalRevealTiles, computeCandidates,
  startTileCountFor, colorRank,
} from '../../games/davinci-code/shared/DavinciEngine.js';

test('createPools: 조커 없이 24장(색별 12장)', () => {
  const pools = createPools({ includeJokers: false });
  assert.strictEqual(pools.black.length, 12);
  assert.strictEqual(pools.white.length, 12);
  const nums = pools.black.map(t => t.number).sort((a, b) => a - b);
  assert.deepStrictEqual(nums, [0,1,2,3,4,5,6,7,8,9,10,11]);
  assert.ok(pools.black.every(t => !t.joker));
});

test('createPools: 조커 포함 26장(색별 13장)', () => {
  const pools = createPools({ includeJokers: true });
  assert.strictEqual(pools.black.length, 13);
  assert.strictEqual(pools.white.length, 13);
  assert.strictEqual(pools.black.filter(t => t.joker).length, 1);
  assert.strictEqual(pools.white.filter(t => t.joker).length, 1);
});

test('createPools: uid는 숫자를 인코딩하지 않는 불투명 문자열이며 전부 유일함', () => {
  const pools = createPools({ includeJokers: true });
  const all = [...pools.black, ...pools.white];
  const uids = all.map(t => t.uid);
  assert.strictEqual(new Set(uids).size, uids.length);
  // uid 포맷은 t00, t01... 순서로만 발급되고 색/숫자와 무관해야 함
  assert.ok(all.every(t => /^t\d{2,}$/.test(t.uid)));
});

test('poolCounts', () => {
  const pools = createPools({ includeJokers: false });
  assert.deepStrictEqual(poolCounts(pools), { black: 12, white: 12 });
});

test('startTileCountFor: 4인만 3장, 나머지는 4장', () => {
  assert.strictEqual(startTileCountFor(2), 4);
  assert.strictEqual(startTileCountFor(3), 4);
  assert.strictEqual(startTileCountFor(4), 3);
});

test('colorRank: 흑(B)이 백(W)보다 작음(왼쪽)', () => {
  assert.ok(colorRank('B') < colorRank('W'));
});

test('officialInsertIndex: 빈 판에 삽입 시 0', () => {
  assert.strictEqual(officialInsertIndex([], { color: 'B', number: 5, joker: false }), 0);
});

test('officialInsertIndex: 오름차순 위치에 삽입', () => {
  const tiles = [
    { uid: 'a', color: 'B', number: 2, joker: false, revealed: false },
    { uid: 'b', color: 'W', number: 7, joker: false, revealed: false },
  ];
  assert.strictEqual(officialInsertIndex(tiles, { color: 'B', number: 5, joker: false }), 1);
  assert.strictEqual(officialInsertIndex(tiles, { color: 'B', number: 9, joker: false }), 2);
  assert.strictEqual(officialInsertIndex(tiles, { color: 'B', number: 0, joker: false }), 0);
});

test('officialInsertIndex: 동점이면 흑이 백의 왼쪽 — 백5 보유 중 흑5 삽입 시 백5 왼쪽', () => {
  const tiles = [
    { uid: 'w5', color: 'W', number: 5, joker: false, revealed: false },
  ];
  const idx = officialInsertIndex(tiles, { color: 'B', number: 5, joker: false });
  assert.strictEqual(idx, 0); // 흑5가 백5보다 왼쪽(인덱스 0)
});

test('officialInsertIndex: 동점 반대 방향 — 흑5 보유 중 백5 삽입 시 흑5 오른쪽', () => {
  const tiles = [
    { uid: 'b5', color: 'B', number: 5, joker: false, revealed: false },
  ];
  const idx = officialInsertIndex(tiles, { color: 'W', number: 5, joker: false });
  assert.strictEqual(idx, 1); // 흑5(인덱스0) 다음, 오른쪽
});

test('officialInsertIndex: 조커는 비교에서 건너뛰고 실물끼리만 비교', () => {
  const tiles = [
    { uid: 'j1', color: 'B', number: null, joker: true, revealed: false },
    { uid: 'b2', color: 'B', number: 2, joker: false, revealed: false },
    { uid: 'w9', color: 'W', number: 9, joker: false, revealed: false },
  ];
  assert.strictEqual(officialInsertIndex(tiles, { color: 'B', number: 5, joker: false }), 2);
});

test('officialInsertIndex: 경계값 0과 11 두 장씩', () => {
  const tiles = [
    { uid: 'w0', color: 'W', number: 0, joker: false, revealed: false },
    { uid: 'b11', color: 'B', number: 11, joker: false, revealed: false },
  ];
  assert.strictEqual(officialInsertIndex(tiles, { color: 'B', number: 0, joker: false }), 0);
  assert.strictEqual(officialInsertIndex(tiles, { color: 'W', number: 11, joker: false }), 2);
});

test('insertPosition: official tieRule은 항상 확정 인덱스', () => {
  const tiles = [{ uid: 'w5', color: 'W', number: 5, joker: false, revealed: false }];
  const pos = insertPosition(tiles, { color: 'B', number: 5, joker: false }, 'official');
  assert.strictEqual(pos.ambiguous, undefined);
  assert.strictEqual(pos.index, 0);
});

test('insertPosition: free tieRule + 동점 반대색 보유 시에만 ambiguous', () => {
  const tiles = [{ uid: 'w5', color: 'W', number: 5, joker: false, revealed: false }];
  const pos = insertPosition(tiles, { color: 'B', number: 5, joker: false }, 'free');
  assert.strictEqual(pos.ambiguous, true);
  assert.strictEqual(pos.leftIndex, 0);
  assert.strictEqual(pos.rightIndex, 1);
});

test('insertPosition: free tieRule이어도 동점 없으면 자동(ambiguous 아님)', () => {
  const tiles = [{ uid: 'w7', color: 'W', number: 7, joker: false, revealed: false }];
  const pos = insertPosition(tiles, { color: 'B', number: 3, joker: false }, 'free');
  assert.strictEqual(pos.ambiguous, undefined);
  assert.strictEqual(pos.index, 0);
});

test('judgeGuess: 숫자 타일은 숫자 일치 여부', () => {
  const tile = { color: 'B', number: 7, joker: false };
  assert.strictEqual(judgeGuess(tile, 7), true);
  assert.strictEqual(judgeGuess(tile, 6), false);
  assert.strictEqual(judgeGuess(tile, 'joker'), false);
});

test("judgeGuess: 조커는 'joker' 선언에만 정답", () => {
  const tile = { color: 'B', number: null, joker: true };
  assert.strictEqual(judgeGuess(tile, 'joker'), true);
  assert.strictEqual(judgeGuess(tile, 7), false);
});

test('isEliminated: 전부 공개면 탈락, 하나라도 비공개면 생존, 빈 배열도 탈락', () => {
  assert.strictEqual(isEliminated([]), true);
  assert.strictEqual(isEliminated([{ revealed: true }, { revealed: true }]), true);
  assert.strictEqual(isEliminated([{ revealed: true }, { revealed: false }]), false);
});

test('publicTile: 비공개 타일은 숫자/조커 필드가 아예 없어야 함(§9 핵심)', () => {
  const hidden = { uid: 'x', color: 'B', number: 7, joker: false, revealed: false };
  const view = publicTile(hidden);
  assert.strictEqual(view.revealed, false);
  assert.strictEqual('number' in view, false);
  assert.strictEqual('joker' in view, false);

  const hiddenJoker = { uid: 'y', color: 'W', number: null, joker: true, revealed: false };
  const jokerView = publicTile(hiddenJoker);
  assert.strictEqual('joker' in jokerView, false);
});

test('publicTile: 공개 타일은 숫자 또는 조커 표시', () => {
  const revealedNum = { uid: 'x', color: 'B', number: 7, joker: false, revealed: true };
  assert.deepStrictEqual(publicTile(revealedNum), { uid: 'x', color: 'B', revealed: true, number: 7 });

  const revealedJoker = { uid: 'y', color: 'W', number: null, joker: true, revealed: true };
  assert.deepStrictEqual(publicTile(revealedJoker), { uid: 'y', color: 'W', revealed: true, joker: true });
});

test('publicBoards: Map과 plain object 둘 다 지원, 비공개 숫자 유출 없음', () => {
  const tiles = [
    { uid: 'a', color: 'B', number: 3, joker: false, revealed: false },
    { uid: 'b', color: 'W', number: 9, joker: false, revealed: true },
  ];
  const map = new Map([['p1', tiles]]);
  const view = publicBoards(map);
  assert.strictEqual('number' in view.p1[0], false);
  assert.strictEqual(view.p1[1].number, 9);

  const objView = publicBoards({ p1: tiles });
  assert.deepStrictEqual(objView, view);
});

test('finalRevealTiles: 종료 시 전체 공개 포맷(revealed 필드 없이 값만)', () => {
  const tiles = [
    { uid: 'a', color: 'B', number: 3, joker: false, revealed: true },
    { uid: 'j', color: 'W', number: null, joker: true, revealed: true },
  ];
  assert.deepStrictEqual(finalRevealTiles(tiles), [
    { uid: 'a', color: 'B', number: 3 },
    { uid: 'j', color: 'W', joker: true },
  ]);
});

test('computeCandidates: 좌우 공개 이웃으로 범위를 좁히고 이미 공개된 숫자는 제외', () => {
  const targetTiles = [
    { uid: 't0', color: 'B', revealed: true, number: 2 },
    { uid: 't1', color: 'B', revealed: false },
    { uid: 't2', color: 'B', revealed: true, number: 8 },
  ];
  const publicBoardsView = { target: targetTiles };
  const cands = computeCandidates({
    publicBoardsView, targetPlayerId: 'target', tileIndex: 1, includeJokers: false,
  });
  assert.deepStrictEqual(cands, [3, 4, 5, 6, 7]);
});

test('computeCandidates: 내 손의 같은 색 숫자는 후보에서 제외(자기 정보 소거)', () => {
  const targetTiles = [{ uid: 't0', color: 'B', revealed: false }];
  const publicBoardsView = { target: targetTiles };
  const cands = computeCandidates({
    publicBoardsView, myColorKnownNumbers: { B: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], W: [] },
    targetPlayerId: 'target', tileIndex: 0, includeJokers: false,
  });
  assert.deepStrictEqual(cands, [11]);
});

test('computeCandidates: 조커 옵션 켜짐 + 미공개 조커 있으면 후보에 joker 포함', () => {
  const targetTiles = [{ uid: 't0', color: 'B', revealed: false }];
  const publicBoardsView = { target: targetTiles };
  const cands = computeCandidates({
    publicBoardsView, targetPlayerId: 'target', tileIndex: 0, includeJokers: true,
  });
  assert.ok(cands.includes('joker'));
});

test('computeCandidates: 조커가 이미 공개돼 있으면 후보에서 제외', () => {
  const targetTiles = [
    { uid: 't0', color: 'B', revealed: false },
    { uid: 't1', color: 'B', revealed: true, joker: true },
  ];
  const publicBoardsView = { target: targetTiles };
  const cands = computeCandidates({
    publicBoardsView, targetPlayerId: 'target', tileIndex: 0, includeJokers: true,
  });
  assert.ok(!cands.includes('joker'));
});

test('교집합 무결성: createPools 후 임의 시드로 셔플해도 카드 구성이 보존됨', () => {
  let seed = 42;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 1000) / 1000; };
  const pools = createPools({ includeJokers: true, rng });
  const all = [...pools.black, ...pools.white];
  assert.strictEqual(all.length, 26);
  const blackNums = pools.black.filter(t => !t.joker).map(t => t.number).sort((a, b) => a - b);
  assert.deepStrictEqual(blackNums, [0,1,2,3,4,5,6,7,8,9,10,11]);
});
