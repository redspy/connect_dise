import { expect } from '@playwright/test';

export const BASE = 'https://localhost:5173';

/** 호스트 세션 생성 + 로비 코드 획득 */
export async function createHostSession(browser, viewport = { width: 1600, height: 900 }) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[host] ${msg.text()}`); });
  page.on('pageerror', (err) => consoleErrors.push(`[host] ${String(err)}`));
  await page.goto(`${BASE}/games/davinci-code/host/`);
  const lobby = page.locator('game-lobby');
  await lobby.waitFor({ timeout: 15_000 });
  const code = (await lobby.locator('.lobby-session-code').textContent())?.trim();
  return { ctx, page, code, consoleErrors };
}

/** N명의 모바일 플레이어 접속 + 닉네임 + 준비 */
export async function joinPlayers(browser, code, n, consoleErrors) {
  const players = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const nickname = `P${i}`;
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[${nickname}] ${msg.text()}`); });
    page.on('pageerror', (err) => consoleErrors.push(`[${nickname}] ${String(err)}`));
    await page.goto(`${BASE}/games/davinci-code/mobile/?session=${code}`);
    await page.fill('#nickname-input', nickname);
    await page.click('#btn-join');
    await expect(page.locator('[data-screen="waiting"]')).toBeVisible({ timeout: 10_000 });
    await page.click('#btn-ready');
    players.push({ ctx, page, nickname });
  }
  return players;
}

export async function startGameFromHost(host) {
  const startBtn = host.locator('game-lobby .lobby-start-btn:not([disabled])');
  await startBtn.waitFor({ state: 'attached', timeout: 10_000 });
  await host.evaluate(() => document.querySelector('game-lobby .lobby-start-btn')?.click());
  await expect(host.locator('[data-phase="playing"]')).toBeVisible({ timeout: 10_000 });
}

/** 세팅 단계: 뜨는 색 구성 선택 프롬프트를 즉시 기본값으로 확정(전원 완료까지 반복) */
export async function resolveAllSetupPicks(players, { timeoutMs = 30_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let anyActed = false;
    for (const { page } of players) {
      const pickUI = page.locator('#dv-m-setup-pick');
      if (await pickUI.isVisible().catch(() => false)) {
        await page.click('#dv-m-btn-confirm-pick');
        anyActed = true;
      }
      // 조커 옵션이 켜져 있으면 세팅 중 조커 위치선택도 뜰 수 있음 — 맨 끝(마지막 gap)에 배치
      const jokerHint = page.locator('#dv-m-jokerplace-hint');
      if (await jokerHint.isVisible().catch(() => false)) {
        const gaps = page.locator('.dv-m-gap-slot');
        const n = await gaps.count();
        if (n > 0) { await gaps.nth(n - 1).click(); anyActed = true; }
      }
    }
    const allDealt = await Promise.all(players.map(({ page }) => page.locator('#dv-m-hand .dv-tile').count()));
    if (allDealt.every((c) => c > 0)) return;
    if (!anyActed) await players[0].page.waitForTimeout(250);
  }
  throw new Error('세팅(색 구성 선택)이 제한시간 내 완료되지 않음');
}

/** 현재 "내 차례"인 플레이어를 찾는다(opponents-wrap이 안 보이면 아직 turns 단계가 아니거나 탈락 상태일 수 있음) */
async function findActivePlayer(players) {
  for (const p of players) {
    if (await p.page.locator('#dv-m-opponents-wrap:not(.hidden)').isVisible().catch(() => false)) return p;
  }
  return null;
}

/**
 * 정답만 계속 선언해서 게임을 최대한 빠르게 종료까지 밀어붙인다(오답/revealOwn
 * 경로는 다른 스펙에서 이미 검증했으므로 여기서는 탈락 연쇄·좌석 배치·순위만
 * 목적). 상대의 진짜 값은 "소유자 본인 화면엔 항상 숫자가 보인다"(§11.2)는
 * 성질을 이용해 그 플레이어 자신의 페이지에서 읽어온다(치팅이 아니라 그
 * 플레이어의 클라이언트가 실제로 아는 정보를 그대로 읽는 것 — §9 위반 아님).
 */
/**
 * @param {{ maxActions?: number, stopWhen?: () => Promise<boolean> }} [opts]
 *   stopWhen — 매 반복 시작 시 확인하는 조기 종료 조건(예: 특정 플레이어 탈락
 *   시점에서 멈춰 재접속 시나리오를 테스트하고 싶을 때). true를 반환하면
 *   결과 화면을 기다리지 않고 즉시 반환한다.
 */
export async function playUntilResult(host, players, { maxActions = 400, stopWhen = null } = {}) {
  const byNick = Object.fromEntries(players.map((p) => [p.nickname, p]));
  for (let i = 0; i < maxActions; i++) {
    if (await host.locator('[data-phase="result"]').isVisible().catch(() => false)) return;
    if (stopWhen && await stopWhen().catch(() => false)) return;

    const active = await findActivePlayer(players);
    if (!active) { await players[0].page.waitForTimeout(300); continue; }
    const { page } = active;

    if (await page.locator('#dv-m-draw-bar:not(.hidden)').isVisible().catch(() => false)) {
      const blackDisabled = await page.locator('#dv-m-btn-draw-black').evaluate((el) => el.classList.contains('dv-m-action-btn-disabled'));
      await page.click(blackDisabled ? '#dv-m-btn-draw-white' : '#dv-m-btn-draw-black');
      await page.waitForTimeout(200);
      continue;
    }

    if (await page.locator('#dv-m-choose-bar:not(.hidden)').isVisible().catch(() => false)) {
      await page.click('#dv-m-btn-continue');
      await page.waitForTimeout(200);
      continue;
    }

    // guess 페이즈: 상대 좌석 중 뒷면 타일이 남은 곳을 찾아 진짜 값을 정확히 선언.
    //
    // 드럼롤(§11.4) 수정 후, 정답 판정의 실제 반영(선택지 텍스트가 바뀌는
    // choose 프롬프트 진입 등)은 서버가 drumrollMs만큼 미뤄서 보낸다. 이
    // 루프는 매 반복 "지금 눌러도 되는 상태인지"를 낙관적으로 클라이언트
    // 로컬 화면만 보고 판단하는데, 화면이 아직 이전 판정의 드럼롤 결과를
    // 못 받아 stale한 'guess 가능해 보이는' 상태로 남아있는 짧은 틈에 탭을
    // 하면, 이후 클라이언트에도 지연 반영된 phasePrompt가 도착해
    // _renderActionUI()가 "이제 guess 페이즈 아님" 판단으로 방금 연 numpad를
    // 도로 닫아버릴 수 있다(제품 자체는 정상 동작 — stale 상태에서의 조작을
    // 스스로 취소하는 올바른 방어) — 그 순간과 Playwright의 클릭 타이밍이
    // 겹치면 "요소가 안정되지 않음→안 보임"으로 영원히 재시도하다 테스트가
    // 멈췄다(3/4인 풀플레이 E2E로 재현, 2026-08-23). 이건 제품 버그가 아니라
    // 이 테스트 봇이 실제 사람보다 훨씬 빠르게 연타해서 생기는 경합이므로,
    // 각 클릭 단계에 짧은 타임아웃을 걸어 실패하면 그냥 다음 반복에서 다시
    // 현재 상태를 읽어 재시도한다(무한 대기 대신 "다시 판단"으로 전환).
    const seats = ['top', 'left', 'right'];
    let acted = false;
    for (const seat of seats) {
      const seatEl = page.locator(`#dv-m-opp-${seat}:not(.hidden)`);
      if (!(await seatEl.isVisible().catch(() => false))) continue;
      const hidden = seatEl.locator('.dv-tile:not(.dv-tile-public)');
      const hiddenCount = await hidden.count();
      if (hiddenCount === 0) continue;
      const targetEl = hidden.first();
      const idx = await targetEl.evaluate((el) => [...el.parentElement.children].indexOf(el)).catch(() => null);
      if (idx === null) continue;
      const nick = (await page.locator(`#dv-m-opp-${seat}-label`).textContent())?.trim();
      const targetPage = byNick[nick]?.page;
      if (!targetPage) continue;
      const trueValue = (await targetPage.locator('#dv-m-hand .dv-tile').nth(idx).textContent())?.trim();
      if (!trueValue) continue;

      try {
        await targetEl.click({ timeout: 3000 });
        await expect(page.locator('#dv-m-numpad-overlay:not(.hidden)')).toBeVisible({ timeout: 3000 });
        await page.locator('.dv-m-numpad-key', { hasText: new RegExp(`^${trueValue}$`) }).first().click({ timeout: 3000 });
        await page.click('#dv-m-btn-declare', { timeout: 3000 });
        acted = true;
      } catch {
        // 위 stale-state 경합으로 중간에 numpad가 닫혔거나 타일이 사라짐 —
        // 다음 반복에서 현재 상태를 다시 읽어 재시도(제품 결함 아님).
      }
      // drumrollMs(기본 1000ms) + 왕복 지연을 넉넉히 덮는 대기 — 900ms는
      // 실측상 종종 살짝 모자라 위 경합을 유발했다(2026-08-23).
      await page.waitForTimeout(1400);
      break;
    }
    if (!acted) await page.waitForTimeout(300);
  }
  throw new Error(`게임이 ${maxActions}회 행동 내에 종료되지 않음`);
}
