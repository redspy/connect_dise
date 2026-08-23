/**
 * RummikubEngine.js — 순수 규칙 로직 (host/mobile/bot 공유, 플랫폼 SDK 비의존)
 *
 * 타일 ID 체계 (docs/games/rummikub/plan.md §2.3):
 *   일반: {색1글자}{숫자2자리}{사본a/b/c} 예) r07a, k13c
 *   조커: j1, j2, j3, j4
 */

export const COLORS = ['r', 'b', 'y', 'k']; // 빨강 파랑 노랑 검정
export const JOKER_PENALTY = 30; // 손패에 남은 조커 감점 (§7.4, §8.1)
const COPY_LETTERS = ['a', 'b', 'c'];

// ─── 타일 생성 ──────────────────────────────────────────────────────────────

/** @param {'standard'|'xp'} mode */
export function tileSetModeForPlayerCount(playerCount) {
  return playerCount >= 5 ? 'xp' : 'standard';
}

/** @param {'standard'|'xp'} mode */
export function createDeck(mode) {
  const copies = mode === 'xp' ? 3 : 2;
  const jokerCount = mode === 'xp' ? 4 : 2;
  const tiles = [];
  for (let c = 0; c < copies; c++) {
    for (const color of COLORS) {
      for (let num = 1; num <= 13; num++) {
        tiles.push(`${color}${String(num).padStart(2, '0')}${COPY_LETTERS[c]}`);
      }
    }
  }
  for (let j = 1; j <= jokerCount; j++) tiles.push(`j${j}`);
  return tiles;
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

/**
 * @param {string[]} shuffledDeck
 * @param {string[]} playerIds
 * @param {number} handSize
 * @returns {{ hands: Record<string,string[]>, pool: string[] }}
 */
export function dealHands(shuffledDeck, playerIds, handSize = 14) {
  const pool = [...shuffledDeck];
  const hands = {};
  for (const pid of playerIds) hands[pid] = pool.splice(0, handSize);
  return { hands, pool };
}

// ─── 타일 파싱 ──────────────────────────────────────────────────────────────

export function parseTileId(id) {
  if (id[0] === 'j') return { id, isJoker: true, color: null, num: null };
  return { id, isJoker: false, color: id[0], num: parseInt(id.slice(1, 3), 10), copy: id[3] };
}

export function tileFaceValue(id) {
  const t = parseTileId(id);
  return t.isJoker ? JOKER_PENALTY : t.num;
}

export function scoreHand(hand) {
  return hand.reduce((sum, id) => sum + tileFaceValue(id), 0);
}

// ─── 세트(그룹/런) 검증 (§3) ─────────────────────────────────────────────────

function tryGroup(parsed, reals, size) {
  if (size < 3 || size > 4) return null;
  if (reals.length === 0) return null;
  const nums = new Set(reals.map(t => t.num));
  if (nums.size !== 1) return null;
  const num = reals[0].num;
  const usedColors = new Set(reals.map(t => t.color));
  if (usedColors.size !== reals.length) return null; // 색 중복
  const colorCandidates = COLORS.filter(c => !usedColors.has(c));
  const jokerCount = size - reals.length;
  if (jokerCount > colorCandidates.length) return null;
  return { type: 'group', num, value: num * size, colorCandidates };
}

function tryRun(parsed, reals) {
  if (parsed.length < 3 || parsed.length > 13) return null;
  if (reals.length === 0) return null;
  const colors = new Set(reals.map(t => t.color));
  if (colors.size !== 1) return null; // 색 불일치
  const anchor = reals[0];
  const values = parsed.map((t, i) => anchor.num + (i - anchor.i));
  if (values[0] < 1 || values[values.length - 1] > 13) return null; // wrap-around/범위초과 금지
  for (const rt of reals) {
    if (rt.num !== values[rt.i]) return null; // 실물 배치 불일치
  }
  const value = values.reduce((a, b) => a + b, 0);
  return { type: 'run', color: reals[0].color, values, value };
}

/**
 * 세트 유효성 검증 (§3.3). 그룹/런 둘 다 해석 가능하면 런을 우선 채택.
 * @param {string[]} tileIds 왼쪽→오른쪽 순서 배열
 * @returns {{ valid:boolean, reason?:string, type?:'group'|'run', value?:number,
 *             jokerValues?: Record<string,{color:string|null,num:number,candidates?:string[]}> }}
 */
export function validateMeld(tileIds) {
  if (!Array.isArray(tileIds) || tileIds.length < 3) return { valid: false, reason: 'TOO_SHORT' };
  const parsed = tileIds.map((id, i) => ({ ...parseTileId(id), i }));
  const jokers = parsed.filter(t => t.isJoker);
  const reals = parsed.filter(t => !t.isJoker);
  if (reals.length === 0) return { valid: false, reason: 'ALL_JOKERS' };

  const run = tryRun(parsed, reals);
  const group = tryGroup(parsed, reals, tileIds.length);
  const chosen = run || group;
  if (!chosen) return { valid: false, reason: 'INVALID_SHAPE' };

  const jokerValues = {};
  if (chosen.type === 'run') {
    for (const j of jokers) jokerValues[j.id] = { color: chosen.color, num: chosen.values[j.i] };
  } else {
    const resolved = chosen.colorCandidates.length === 1 ? chosen.colorCandidates[0] : null;
    for (const j of jokers) {
      jokerValues[j.id] = { color: resolved, num: chosen.num, candidates: chosen.colorCandidates };
    }
  }
  return { valid: true, type: chosen.type, value: chosen.value, jokerValues };
}

/**
 * 보드 전체(모든 세트) 검증.
 * @param {Array<{meldId:number, tiles:string[]}>} board
 */
export function validateBoard(board) {
  for (const meld of board) {
    if (!meld.tiles || meld.tiles.length === 0) continue;
    const v = validateMeld(meld.tiles);
    if (!v.valid) return { valid: false, invalidMeldId: meld.meldId, reason: v.reason };
  }
  return { valid: true };
}

/** 지정된 meldId들의 유효 세트 합계 (초기 착수 합산용, §5). 무효 세트는 0으로 취급. */
export function sumOfMelds(board, meldIds) {
  let total = 0;
  for (const id of meldIds) {
    const meld = board.find(m => m.meldId === id);
    if (!meld) continue;
    const v = validateMeld(meld.tiles);
    if (v.valid) total += v.value;
  }
  return total;
}

/** 보드에 존재하는 모든 타일 ID 평면화 */
export function flattenBoard(board) {
  return board.flatMap(m => m.tiles);
}

/**
 * 조커 하나가 현재 어떤 값(색/숫자)으로 해석되는지 조회 (§7.3 회수 후보 하이라이트용).
 * @returns {{color:string|null, num:number, candidates?:string[]}|null}
 */
export function getJokerValue(board, meldId, jokerId) {
  const meld = board.find(m => m.meldId === meldId);
  if (!meld) return null;
  const v = validateMeld(meld.tiles);
  if (!v.valid) return null;
  return v.jokerValues[jokerId] ?? null;
}

/** 조커가 대신하는 값과 일치하는 대체 후보 타일인지 (§7.2-1) */
export function isValidJokerReplacement(jokerValue, replacementTileId) {
  if (!jokerValue) return false;
  const repl = parseTileId(replacementTileId);
  if (repl.isJoker) return false;
  if (repl.num !== jokerValue.num) return false;
  if (jokerValue.color !== null) return repl.color === jokerValue.color;
  return (jokerValue.candidates || []).includes(repl.color);
}

/**
 * 세트에 새 타일을 놓을 때 숫자 순서를 자동으로 맞춰 넣을 삽입 인덱스를
 * 계산한다(사용자 요청 — 드래그로 정확한 위치를 겨냥할 필요 없이 세트
 * 아무 데나 놓으면 알아서 오름차순 자리로 들어감).
 *
 * 그룹(같은 숫자, 다른 색)은 배열 순서가 유효성 판정과 무관하므로(§3.1)
 * 정렬할 필요가 없어 항상 끝에 추가한다. 런은 배열 위치로 값이 확정되므로
 * (§3.2~3.3) 실물 타일들 사이에서 숫자 크기에 맞는 자리를 찾는다. 조커는
 * 그 자체로 확정된 숫자가 없으므로 정렬 비교에서 제외(원래 있던 자리를
 * 건드리지 않고 지나침)하고 실물 타일만 기준으로 삼는다 — 완벽한 자동
 * 배치는 아니지만(조커가 껴 있는 복잡한 gap은 사용자가 수동 조정), 가장
 * 흔한 "숫자 타일을 순서에 맞게 놓는" 경우는 그대로 해결된다.
 *
 * @param {string[]} meldTiles 대상 세트의 현재 타일 배열
 * @param {string} newTileId 새로 넣을 타일 ID
 * @returns {number} 삽입할 인덱스
 */
export function computeAutoSortIndex(meldTiles, newTileId) {
  const t = parseTileId(newTileId);
  if (t.isJoker) return meldTiles.length;

  const reals = meldTiles.map((id, i) => ({ ...parseTileId(id), i })).filter(x => !x.isJoker);
  // 그룹으로 보이면(실물 2장 이상이 전부 같은 숫자) 순서 무관 — 끝에 추가.
  // 실물이 1장 이하면 "같은 숫자"가 트리비얼하게 항상 참이 돼(원소가
  // 하나뿐인 배열은 자기 자신과 항상 같음) 그룹으로 오판, 정렬을 건너뛰고
  // 늘 끝에 붙이는 버그가 있었다(실측 확인 — 첫 타일 11 위에 9를 놓아도
  // [11,9]로 안 바뀜, 2026-08-24). reals.length > 1일 때만 그룹으로 간주.
  if (reals.length > 1 && reals.every(r => r.num === reals[0].num)) return meldTiles.length;

  for (const r of reals) {
    if (t.num < r.num) return r.i;
  }
  return meldTiles.length;
}
