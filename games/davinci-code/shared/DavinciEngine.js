/**
 * DavinciEngine.js — 순수 규칙 로직 (host/bot 공유, 플랫폼 SDK 비의존)
 * docs/games/davinci-code/plan.md 기준.
 *
 * 타일 표현: { uid, color: 'B'|'W', number: 0~11 (조커면 null), joker: boolean, revealed: boolean }
 * uid는 숫자를 인코딩하지 않는 불투명 문자열(§2.3) — 절대 숫자/조커 정보를 유추할 수 있는 형태로 짓지 않는다.
 */

export const COLORS = ['B', 'W'];

/** 공식 룰(D4): 같은 숫자면 흑이 백의 왼쪽 — 정렬/동점 판정에 쓰는 비교 우선순위 */
export function colorRank(color) { return color === 'B' ? 0 : 1; }

export function poolKey(color) { return color === 'B' ? 'black' : 'white'; }

/** @param {number} playerCount @returns {number} 시작 타일 장수 (D2 — 4인만 3장) */
export function startTileCountFor(playerCount) {
  return playerCount === 4 ? 3 : 4;
}

/** Fisher-Yates. 원본을 변경하지 않고 새 배열 반환. */
export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── 타일/풀 생성 (§2, §5.2) ─────────────────────────────────────────────────

/**
 * 색상별로 독립된 풀을 만든다(§6.1 — 드로우가 색 선택 방식이라 풀도 색별로
 * 분리해두는 것이 자연스러움). 각 풀은 이미 셔플되어 있어 앞에서부터
 * shift()하는 것이 "그 색 안에서 균등 랜덤 추출"과 동치.
 * @param {{ includeJokers?: boolean, rng?: () => number }} [opts]
 * @returns {{ black: object[], white: object[] }}
 */
export function createPools({ includeJokers = false, rng = Math.random } = {}) {
  let uidCounter = 0;
  const nextUid = () => `t${String(uidCounter++).padStart(2, '0')}`;
  const makePool = (color) => {
    const specs = [];
    for (let n = 0; n <= 11; n++) specs.push({ color, number: n, joker: false });
    if (includeJokers) specs.push({ color, number: null, joker: true });
    return shuffle(specs, rng).map(s => ({ uid: nextUid(), ...s, revealed: false }));
  };
  return { black: makePool('B'), white: makePool('W') };
}

export function poolCounts(pools) {
  return { black: pools.black.length, white: pools.white.length };
}

// ─── 정렬/삽입 (§3) ──────────────────────────────────────────────────────────

/**
 * 공식 룰(흑좌) 기준으로 확정되는 삽입 인덱스를 계산한다. 동점(같은 숫자,
 * 반대색)이 있어도 항상 유일하게 결정됨 — tiebreak 옵션의 "자동 폴백" 및
 * TV/봇의 확정적 정렬 계산에 사용.
 * 조커는 숫자가 없어 이 함수의 대상이 아님(§6.7에서 별도 처리) — 호출 전에
 * newTile.joker가 아님을 보장해야 한다.
 * @param {object[]} tiles 현재 판(조커 포함 가능, 조커는 비교에서 건너뜀)
 * @param {object} newTile
 */
export function officialInsertIndex(tiles, newTile) {
  const reals = tiles.map((t, i) => ({ ...t, i })).filter(t => !t.joker);
  for (const r of reals) {
    if (newTile.number < r.number) return r.i;
    if (newTile.number === r.number) {
      return colorRank(newTile.color) <= colorRank(r.color) ? r.i : r.i + 1;
    }
  }
  return tiles.length;
}

/**
 * 삽입 위치를 계산한다(§3.2). tieRule==='free'이고 동점(같은 숫자, 반대색)
 * 타일을 이미 보유 중이면 좌/우 선택이 필요함을 알리는 ambiguous 결과를
 * 반환한다 — 이 경우 호출자가 §6.6 tiebreak 페이즈로 전환해야 한다.
 * @param {object[]} tiles
 * @param {object} newTile
 * @param {'official'|'free'} tieRule
 * @returns {{ index:number } | { ambiguous:true, leftIndex:number, rightIndex:number, tiedUid:string }}
 */
export function insertPosition(tiles, newTile, tieRule) {
  const reals = tiles.map((t, i) => ({ ...t, i })).filter(t => !t.joker);
  const same = reals.find(r => r.number === newTile.number);
  if (same) {
    if (tieRule === 'free') {
      return { ambiguous: true, leftIndex: same.i, rightIndex: same.i + 1, tiedUid: same.uid };
    }
    return { index: colorRank(newTile.color) <= colorRank(same.color) ? same.i : same.i + 1 };
  }
  for (const r of reals) {
    if (newTile.number < r.number) return { index: r.i };
  }
  return { index: tiles.length };
}

// ─── 추측 판정 (§6.2) ────────────────────────────────────────────────────────

/**
 * @param {object} tile 대상 타일(호스트 내부 표현 — 진짜 값 포함)
 * @param {number|'joker'} guessValue
 */
export function judgeGuess(tile, guessValue) {
  if (tile.joker) return guessValue === 'joker';
  return guessValue === tile.number;
}

// ─── 탈락 판정 (§7.1) ────────────────────────────────────────────────────────

/** 비공개 타일이 0장이면(애초에 타일이 없는 경우 포함) 탈락 */
export function isEliminated(tiles) {
  return !tiles || tiles.length === 0 || tiles.every(t => t.revealed);
}

// ─── 공개 뷰 파생 (§8, §9의 헌법 — TV 렌더·브로드캐스트는 반드시 이 함수만 사용) ──

/** @param {object} tile 호스트 내부 표현 → 공개 가능한 부분만 남긴 사본 */
export function publicTile(tile) {
  if (tile.revealed) {
    const out = { uid: tile.uid, color: tile.color, revealed: true };
    if (tile.joker) out.joker = true; else out.number = tile.number;
    return out;
  }
  return { uid: tile.uid, color: tile.color, revealed: false };
}

/** @param {Map<string,object[]>|Record<string,object[]>} playerTiles */
export function publicBoards(playerTiles) {
  const entries = playerTiles instanceof Map ? playerTiles.entries() : Object.entries(playerTiles);
  const out = {};
  for (const [pid, tiles] of entries) out[pid] = tiles.map(publicTile);
  return out;
}

/** 종료 시 전원 전체 공개용 — revealed 플래그 없이 색+값만 (§12 gameFinished) */
export function finalRevealTiles(tiles) {
  return tiles.map(t => {
    const out = { uid: t.uid, color: t.color };
    if (t.joker) out.joker = true; else out.number = t.number;
    return out;
  });
}

// ─── 봇용 후보 계산 (§14, D15 — 제약 전파 라이트) ────────────────────────────

/**
 * 대상 타일의 가능한 값 후보를 계산한다. 공용 정보(공개된 타일들)와 호출자
 * 자신의 사적 정보(자기 손의 같은 색 타일 값들)만 입력받는다 — 봇도 호스트가
 * 아는 진짜 값을 몰래 들여다보지 않음(치팅 금지).
 * @param {{
 *   publicBoardsView: Record<string, object[]>, // publicBoards()의 결과
 *   myColorKnownNumbers: { B: number[], W: number[] }, // 내가 이미 아는(내 손 + 이번 턴 뽑은) 같은 색 숫자들
 *   myColorKnownJoker: { B: boolean, W: boolean },      // 내가 이미 조커를 쥐고 있는 색
 *   targetPlayerId: string, tileIndex: number,
 *   includeJokers: boolean,
 * }} args
 * @returns {(number|'joker')[]}
 */
export function computeCandidates({
  publicBoardsView, myColorKnownNumbers = { B: [], W: [] }, myColorKnownJoker = { B: false, W: false },
  targetPlayerId, tileIndex, includeJokers,
}) {
  const targetTiles = publicBoardsView[targetPlayerId] || [];
  const target = targetTiles[tileIndex];
  if (!target || target.revealed) return [];
  const color = target.color;

  const excludedNumbers = new Set(myColorKnownNumbers[color] || []);
  let jokerExcluded = !!myColorKnownJoker[color];
  for (const tiles of Object.values(publicBoardsView)) {
    for (const t of tiles) {
      if (t.color !== color || !t.revealed) continue;
      if (t.joker) jokerExcluded = true; else excludedNumbers.add(t.number);
    }
  }

  let lo = 0, hi = 11;
  for (let i = tileIndex - 1; i >= 0; i--) {
    const t = targetTiles[i];
    if (!t.revealed || t.joker) continue;
    lo = t.number; break;
  }
  for (let i = tileIndex + 1; i < targetTiles.length; i++) {
    const t = targetTiles[i];
    if (!t.revealed || t.joker) continue;
    hi = t.number; break;
  }

  const candidates = [];
  for (let n = lo; n <= hi; n++) if (!excludedNumbers.has(n)) candidates.push(n);
  if (includeJokers && !jokerExcluded) candidates.push('joker');
  return candidates;
}
