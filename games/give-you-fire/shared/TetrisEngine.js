/**
 * TetrisEngine.js — Give You Fire 공용 테트리스 게임 엔진
 * 호스트(미니 보드 렌더링)와 모바일(실제 게임 플레이) 모두에서 사용됩니다.
 * DOM 의존성 없이 순수 JS로 구성되어 있습니다.
 */

export const BOARD_COLS = 10;
export const BOARD_ROWS = 20;

// 테트로미노 타입 ID: 1=I, 2=O, 3=T, 4=S, 5=Z, 6=J, 7=L
// 색상은 파이어-민트 다크 테마에 맞게 설정
export const PIECE_COLORS = [
  null,
  '#00e5ff', // 1 = I  (시안)
  '#ffea00', // 2 = O  (옐로우)
  '#cc44ff', // 3 = T  (퍼플)
  '#00ffb3', // 4 = S  (민트)
  '#ff2244', // 5 = Z  (레드)
  '#0077ff', // 6 = J  (블루)
  '#ff8800', // 7 = L  (오렌지)
];

// 각 테트로미노의 기본(rotation=0) 모양을 4×4 바운딩 박스 내 [행, 열] 좌표 배열로 정의
const BASE_SHAPES = [
  null,                                             // index 0 미사용
  [[1, 0], [1, 1], [1, 2], [1, 3]],                // I
  [[0, 1], [0, 2], [1, 1], [1, 2]],                // O
  [[0, 1], [1, 0], [1, 1], [1, 2]],                // T
  [[0, 1], [0, 2], [1, 0], [1, 1]],                // S
  [[0, 0], [0, 1], [1, 1], [1, 2]],                // Z
  [[0, 0], [1, 0], [1, 1], [1, 2]],                // J
  [[0, 2], [1, 0], [1, 1], [1, 2]],                // L
];

/**
 * 4×4 그리드 내에서 90° 시계 방향 회전: (r, c) → (c, 3-r)
 * @param {number[][]} cells
 * @returns {number[][]}
 */
function rotateCW(cells) {
  return cells.map(([r, c]) => [c, 3 - r]);
}

// 각 피스의 4가지 회전 상태를 미리 계산 (PIECE_SHAPES[type][rotation] = [[r,c], ...])
const PIECE_SHAPES = BASE_SHAPES.map((base) => {
  if (!base) return null;
  const rotations = [base];
  for (let k = 1; k < 4; k++) {
    rotations.push(rotateCW(rotations[k - 1]));
  }
  return rotations;
});

/**
 * 단계별 중력 낙하 간격 (ms)
 * 레벨 1 = 1000ms, 레벨 100 = 50ms (선형 보간)
 * @param {number} level 1~100
 * @returns {number} ms
 */
export function dropInterval(level) {
  return Math.max(50, Math.round(1000 - (level - 1) * 9.6));
}

export class TetrisEngine {
  constructor() {
    /** @type {number[][]} 20×10 보드. 0=빈칸, 1-7=블록 타입 */
    this.board = Array.from({ length: BOARD_ROWS }, () => new Array(BOARD_COLS).fill(0));

    /** @type {{ type: number, rotation: number, row: number, col: number } | null} 현재 낙하 중인 피스 */
    this.current = null;

    /** @type {number | null} 다음 피스 타입 (미리보기용) */
    this.nextType = null;

    // 7-bag 랜덤 시스템용 큐
    this._bag = [];
    this._refillBag();
    // 첫 번째 피스를 미리 뽑아 nextType에 저장
    this.nextType = this._draw();
  }

  // ─── Bag 관리 ──────────────────────────────────────────────────────────────

  /**
   * 7종 피스를 섞어 큐에 추가 (Fisher-Yates)
   */
  _refillBag() {
    const types = [1, 2, 3, 4, 5, 6, 7];
    for (let i = 6; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    this._bag.push(...types);
  }

  /**
   * 큐에서 피스 1개를 꺼냄. 큐가 비면 자동으로 리필.
   * @returns {number} 피스 타입 1-7
   */
  _draw() {
    if (this._bag.length === 0) this._refillBag();
    return this._bag.shift();
  }

  // ─── 피스 스폰 ─────────────────────────────────────────────────────────────

  /**
   * 다음 피스를 상단 중앙에 스폰.
   * @returns {boolean} 스폰 위치가 비어 있으면 true, 충돌(게임오버)이면 false
   */
  spawn() {
    const type = this.nextType;
    this.nextType = this._draw();
    this.current = { type, rotation: 0, row: 0, col: 3 };
    return !this._collides(this.current);
  }

  // ─── 충돌 감지 ─────────────────────────────────────────────────────────────

  /**
   * 피스의 현재 상태에서 셀 좌표 목록을 반환
   * @param {{ type, rotation, row, col }} piece
   * @returns {number[][]} [[행, 열], ...]
   */
  _cells(piece) {
    return PIECE_SHAPES[piece.type][piece.rotation].map(([r, c]) => [
      r + piece.row,
      c + piece.col,
    ]);
  }

  /**
   * 주어진 피스 상태가 벽/바닥/기존 블록과 충돌하는지 확인
   * @param {{ type, rotation, row, col }} piece
   * @returns {boolean}
   */
  _collides(piece) {
    for (const [r, c] of this._cells(piece)) {
      if (r >= BOARD_ROWS) return true;      // 바닥 초과
      if (c < 0 || c >= BOARD_COLS) return true; // 좌우 벽
      if (r >= 0 && this.board[r][c] !== 0) return true; // 블록 충돌
    }
    return false;
  }

  // ─── 이동 ─────────────────────────────────────────────────────────────────

  /** 왼쪽으로 1칸 이동. 성공 시 true */
  moveLeft() {
    const next = { ...this.current, col: this.current.col - 1 };
    if (this._collides(next)) return false;
    this.current = next;
    return true;
  }

  /** 오른쪽으로 1칸 이동. 성공 시 true */
  moveRight() {
    const next = { ...this.current, col: this.current.col + 1 };
    if (this._collides(next)) return false;
    this.current = next;
    return true;
  }

  /**
   * 아래로 1칸 이동.
   * @returns {boolean} 이동 성공 시 true, 착지(고정 예정)면 false
   */
  moveDown() {
    const next = { ...this.current, row: this.current.row + 1 };
    if (this._collides(next)) return false;
    this.current = next;
    return true;
  }

  /**
   * 90° 시계 방향 회전 + Wall Kick.
   * 벽/블록과 충돌 시 좌우로 밀어내며 회전 시도.
   * @returns {boolean} 회전 성공 시 true
   */
  rotate() {
    const newRot = (this.current.rotation + 1) % 4;
    const base = { ...this.current, rotation: newRot };
    // Wall Kick 시도 순서: 0, +1, -1, +2, -2 칸 수평 이동
    for (const dx of [0, 1, -1, 2, -2]) {
      const attempt = { ...base, col: base.col + dx };
      if (!this._collides(attempt)) {
        this.current = attempt;
        return true;
      }
    }
    return false; // 회전 불가
  }

  /**
   * 하드 드롭: 피스를 즉시 착지 위치로 이동.
   * @returns {number} 이동한 행 수
   */
  hardDrop() {
    let dropped = 0;
    while (this.moveDown()) dropped++;
    return dropped;
  }

  // ─── 고정 & 라인 클리어 ────────────────────────────────────────────────────

  /**
   * 현재 피스를 보드에 고정하고 완성된 줄을 제거.
   * @returns {number} 클리어된 줄 수 (0~4)
   */
  lock() {
    for (const [r, c] of this._cells(this.current)) {
      if (r >= 0 && r < BOARD_ROWS) {
        this.board[r][c] = this.current.type;
      }
    }
    const cleared = this._clearLines();
    this.current = null;
    return cleared;
  }

  /**
   * 꽉 찬 줄을 찾아 제거하고 위에서 빈 줄을 내림.
   * @returns {number} 제거된 줄 수
   */
  _clearLines() {
    let count = 0;
    for (let r = BOARD_ROWS - 1; r >= 0; r--) {
      if (this.board[r].every(v => v !== 0)) {
        this.board.splice(r, 1);
        this.board.unshift(new Array(BOARD_COLS).fill(0));
        count++;
        r++; // splice 후 같은 인덱스 재확인
      }
    }
    return count;
  }

  // ─── 렌더링용 스냅샷 ───────────────────────────────────────────────────────

  /**
   * 현재 피스를 포함한 보드 스냅샷을 반환 (렌더링 및 호스트 전송용).
   * @returns {number[][]} 20×10 배열
   */
  getBoardSnapshot() {
    const snap = this.board.map(row => [...row]);
    if (this.current) {
      for (const [r, c] of this._cells(this.current)) {
        if (r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS) {
          snap[r][c] = this.current.type;
        }
      }
    }
    return snap;
  }

  /**
   * 고스트 피스(현재 피스가 착지할 위치) 셀 좌표를 반환.
   * @returns {number[][]} [[행, 열], ...]
   */
  getGhostCells() {
    if (!this.current) return [];
    let ghost = { ...this.current };
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const next = { ...ghost, row: ghost.row + 1 };
      if (this._collides(next)) break;
      ghost = next;
    }
    return this._cells(ghost);
  }

  /**
   * 다음 피스의 셀 좌표를 반환 (미리보기 렌더링용, 중앙 정렬).
   * @returns {{ cells: number[][], type: number }}
   */
  getNextPieceCells() {
    if (!this.nextType) return { cells: [], type: 0 };
    return {
      type: this.nextType,
      cells: PIECE_SHAPES[this.nextType][0], // 회전 0 기준
    };
  }
}
