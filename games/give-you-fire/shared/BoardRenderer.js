/**
 * BoardRenderer.js — Give You Fire 공용 캔버스 렌더러
 * 호스트(미니 보드)와 모바일(풀 사이즈 보드) 모두에서 사용됩니다.
 */

import { PIECE_COLORS, BOARD_COLS, BOARD_ROWS } from './TetrisEngine.js';

export { PIECE_COLORS };

/** 빈 셀 배경색 */
const EMPTY_COLOR  = '#0a1628';
/** 그리드 선 색상 */
const GRID_COLOR   = '#1a2a44';
/** 고스트 피스 투명도 */
const GHOST_ALPHA  = 0.25;
/** 탈락 오버레이 배경 */
const DEAD_COLOR   = 'rgba(0,0,0,0.65)';

/**
 * 보드 스냅샷을 캔버스에 렌더링합니다.
 *
 * @param {HTMLCanvasElement} canvas        대상 캔버스 엘리먼트
 * @param {number[][] | null} snapshot      20×10 배열 (null이면 빈 보드를 그림)
 * @param {object} [opts]                   옵션
 * @param {number[][]} [opts.ghostCells]    고스트 피스 셀 [[r,c], ...]
 * @param {boolean} [opts.isDead]           탈락 여부 (true면 반투명 오버레이 추가)
 * @param {boolean} [opts.showGrid]         그리드 선 표시 여부 (기본 true)
 */
export function renderBoard(canvas, snapshot, opts = {}) {
  const { ghostCells = [], isDead = false, showGrid = true } = opts;

  const ctx = canvas.getContext('2d');
  const w   = canvas.width;
  const h   = canvas.height;

  // 셀 크기: 가로/세로 중 작은 쪽 기준
  const cellW = w / BOARD_COLS;
  const cellH = h / BOARD_ROWS;
  const cell  = Math.min(cellW, cellH);
  // 중앙 정렬 오프셋
  const ox = (w - cell * BOARD_COLS) / 2;
  const oy = (h - cell * BOARD_ROWS) / 2;

  // ── 배경 ──────────────────────────────────────────────────────────────────
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = EMPTY_COLOR;
  ctx.fillRect(ox, oy, cell * BOARD_COLS, cell * BOARD_ROWS);

  // ── 고스트 셀 세트 구성 ────────────────────────────────────────────────────
  const ghostSet = new Set(ghostCells.map(([r, c]) => `${r},${c}`));

  // ── 셀 렌더링 ──────────────────────────────────────────────────────────────
  const board = snapshot ?? Array.from({ length: BOARD_ROWS }, () => new Array(BOARD_COLS).fill(0));

  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const v = board[r][c];
      const x = ox + c * cell;
      const y = oy + r * cell;

      if (v !== 0) {
        // 실제 블록
        _drawCell(ctx, x, y, cell, PIECE_COLORS[v]);
      } else if (ghostSet.has(`${r},${c}`)) {
        // 고스트 피스
        ctx.save();
        ctx.globalAlpha = GHOST_ALPHA;
        _drawCell(ctx, x, y, cell, '#ffffff');
        ctx.restore();
      }
    }
  }

  // ── 그리드 선 ──────────────────────────────────────────────────────────────
  if (showGrid) {
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth   = 0.5;
    for (let c = 1; c < BOARD_COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(ox + c * cell, oy);
      ctx.lineTo(ox + c * cell, oy + BOARD_ROWS * cell);
      ctx.stroke();
    }
    for (let r = 1; r < BOARD_ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + r * cell);
      ctx.lineTo(ox + BOARD_COLS * cell, oy + r * cell);
      ctx.stroke();
    }
  }

  // ── 탈락 오버레이 ──────────────────────────────────────────────────────────
  if (isDead) {
    ctx.fillStyle = DEAD_COLOR;
    ctx.fillRect(ox, oy, cell * BOARD_COLS, cell * BOARD_ROWS);

    ctx.fillStyle   = '#ff2244';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.font        = `bold ${Math.round(cell * 1.4)}px 'Segoe UI', sans-serif`;
    ctx.fillText('GAME', ox + (cell * BOARD_COLS) / 2, oy + (cell * BOARD_ROWS) / 2 - cell);
    ctx.fillText('OVER', ox + (cell * BOARD_COLS) / 2, oy + (cell * BOARD_ROWS) / 2 + cell);
  }
}

/**
 * 단일 셀을 그립니다 (테두리 하이라이트 포함).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x   픽셀 X (왼쪽)
 * @param {number} y   픽셀 Y (위쪽)
 * @param {number} size 셀 크기
 * @param {string} color 채우기 색상
 */
function _drawCell(ctx, x, y, size, color) {
  const pad = size > 6 ? 1 : 0;
  ctx.fillStyle = color;
  ctx.fillRect(x + pad, y + pad, size - pad * 2, size - pad * 2);

  // 밝은 하이라이트 (상단-좌측)
  if (size >= 8) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + pad, y + pad, size - pad * 2, 2);
    ctx.fillRect(x + pad, y + pad, 2, size - pad * 2);
  }
}

/**
 * 미리보기용 단일 피스를 소형 캔버스에 렌더링합니다.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ cells: number[][], type: number }} pieceInfo  getNextPieceCells() 반환값
 */
export function renderNextPiece(canvas, pieceInfo) {
  const ctx  = canvas.getContext('2d');
  const w    = canvas.width;
  const h    = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = EMPTY_COLOR;
  ctx.fillRect(0, 0, w, h);

  if (!pieceInfo || pieceInfo.cells.length === 0) return;

  const { cells, type } = pieceInfo;
  const color = PIECE_COLORS[type];

  // 4×4 그리드 안에 피스를 그림
  const cellSize = Math.min(w, h) / 4;
  const ox = (w - cellSize * 4) / 2;
  const oy = (h - cellSize * 4) / 2;

  for (const [r, c] of cells) {
    _drawCell(ctx, ox + c * cellSize, oy + r * cellSize, cellSize, color);
  }
}
