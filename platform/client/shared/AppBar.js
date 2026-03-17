/**
 * AppBar — 게임 호스트 화면 공통 상단 바 컴포넌트.
 *
 * ── 제공 기능 ──────────────────────────────────────────────────────────────
 *  - 로비로 돌아가기 버튼 (왼쪽)
 *  - 게임 타이틀 (왼쪽)
 *  - 다시하기 버튼 (오른쪽, 선택적)
 *  - 오른쪽 커스텀 슬롯 (게임별 정보 삽입용)
 *
 * ── 테마 CSS 변수 (body 또는 :root에 정의) ───────────────────────────────
 *  --appbar-border           기본: rgba(255,255,255,0.1)
 *  --appbar-title-color      기본: #f59e0b
 *  --appbar-btn-color        기본: #94a3b8
 *  --appbar-btn-border       기본: rgba(255,255,255,0.15)
 *  --appbar-btn-hover-border 기본: --appbar-title-color 값
 *  --appbar-btn-hover-color  기본: --appbar-title-color 값
 *
 * ── 기본 사용법 ────────────────────────────────────────────────────────────
 *  const appbar = new AppBar('game-appbar', {
 *    title: '눈치 10단',
 *    onRestart: () => game.resetSession(),
 *  });
 *
 *  // 오른쪽 슬롯에 게임별 정보 추가
 *  const roundEl = document.createElement('div');
 *  roundEl.id = 'round-display';
 *  roundEl.textContent = 'Round - / 10';
 *  appbar.prependRight(roundEl);
 */
export class AppBar {
  /**
   * @param {string | HTMLElement} container - 컨테이너 요소 또는 요소 ID
   * @param {object} options
   * @param {string} options.title          - 게임 제목
   * @param {string} [options.backUrl='/']  - 뒤로가기 URL
   * @param {string} [options.backLabel='← 로비'] - 뒤로가기 버튼 텍스트
   * @param {Function} [options.onRestart]  - 다시하기 버튼 클릭 콜백 (미제공 시 버튼 숨김)
   */
  constructor(container, {
    title,
    backUrl = '/',
    backLabel = '← 로비',
    onRestart,
  } = {}) {
    this._el = typeof container === 'string'
      ? document.getElementById(container)
      : container;
    if (!this._el) throw new Error(`[AppBar] container를 찾을 수 없습니다: ${container}`);

    this._el.classList.add('platform-appbar');
    this._restartBtn = null;
    this._build(title, backUrl, backLabel, onRestart);
  }

  // ─── 내부 ────────────────────────────────────────────────────────────────

  _build(title, backUrl, backLabel, onRestart) {
    // 이미 렌더링된 내용 초기화 (sessionReady 중복 호출 대비)
    this._el.innerHTML = '';

    // 왼쪽: 뒤로가기 버튼 + 타이틀
    const left = document.createElement('div');
    left.className = 'appbar-left';

    const backBtn = document.createElement('a');
    backBtn.className = 'appbar-btn';
    backBtn.href = backUrl;
    backBtn.textContent = backLabel;

    this._titleEl = document.createElement('div');
    this._titleEl.className = 'appbar-title';
    this._titleEl.textContent = title ?? '';

    left.append(backBtn, this._titleEl);

    // 오른쪽: 커스텀 슬롯 + 다시하기 버튼
    this._rightSlot = document.createElement('div');
    this._rightSlot.className = 'appbar-right';

    if (onRestart) {
      this._restartBtn = document.createElement('button');
      this._restartBtn.className = 'appbar-btn appbar-btn-restart';
      this._restartBtn.textContent = '다시하기';
      this._restartBtn.addEventListener('click', onRestart);
      this._rightSlot.appendChild(this._restartBtn);
    }

    this._el.append(left, this._rightSlot);
  }

  // ─── 공개 API ─────────────────────────────────────────────────────────────

  /**
   * 게임 타이틀 텍스트를 변경합니다.
   * @param {string} text
   */
  setTitle(text) {
    this._titleEl.textContent = text;
  }

  /**
   * 오른쪽 슬롯 맨 앞에 요소를 삽입합니다 (다시하기 버튼 왼쪽).
   * 게임별 정보(라운드 표시, 타이머 등)를 추가할 때 사용합니다.
   * @param {HTMLElement} el
   */
  prependRight(el) {
    this._rightSlot.insertBefore(el, this._rightSlot.firstChild);
  }

  /**
   * 다시하기 버튼 요소를 반환합니다.
   * onRestart 옵션 미사용 시 null.
   * @returns {HTMLButtonElement | null}
   */
  get restartBtn() {
    return this._restartBtn;
  }

  /**
   * 오른쪽 슬롯 div를 반환합니다.
   * 직접 DOM 조작이 필요한 경우 사용합니다.
   * @returns {HTMLDivElement}
   */
  get rightSlot() {
    return this._rightSlot;
  }
}
