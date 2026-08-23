import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('다빈치 코드 — 4인 좌석 레이아웃 스모크 테스트', () => {
  test('4인 입장 → 시작 → TV 4좌석 + 폰 좌/상/우 배치 크래시 없이 렌더', async ({ browser }) => {
    test.setTimeout(60_000);
    const hostCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 } });
    const host = await hostCtx.newPage();
    const consoleErrors = [];
    host.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    host.on('pageerror', (err) => consoleErrors.push(String(err)));
    await host.goto(`${BASE}/games/davinci-code/host/`);
    const lobby = host.locator('game-lobby');
    await lobby.waitFor({ timeout: 15_000 });
    const code = (await lobby.locator('.lobby-session-code').textContent())?.trim();

    const pages = [];
    for (let i = 0; i < 4; i++) {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
      const p = await ctx.newPage();
      p.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`p${i}: ${msg.text()}`); });
      p.on('pageerror', (err) => consoleErrors.push(`p${i}: ${String(err)}`));
      await p.goto(`${BASE}/games/davinci-code/mobile/?session=${code}`);
      await p.fill('#nickname-input', `P${i}`);
      await p.click('#btn-join');
      await expect(p.locator('[data-screen="waiting"]')).toBeVisible({ timeout: 10_000 });
      await p.click('#btn-ready');
      pages.push(p);
    }

    const startBtn = host.locator('game-lobby .lobby-start-btn:not([disabled])');
    await startBtn.waitFor({ state: 'attached', timeout: 10_000 });
    await host.evaluate(() => document.querySelector('game-lobby .lobby-start-btn')?.click());
    await expect(host.locator('[data-phase="playing"]')).toBeVisible({ timeout: 10_000 });

    // TV: 4인이면 좌/상/우/하 4석
    await expect(host.locator('#dv-table.dv-table-n4')).toBeVisible({ timeout: 10_000 });
    await expect(host.locator('#dv-table .dv-seat')).toHaveCount(4);

    // 세팅: 4명 전원 순서대로 확정(3장씩 — D2)
    for (let round = 0; round < 4; round++) {
      let acted = false;
      for (const p of pages) {
        const pickUI = p.locator('#dv-m-setup-pick');
        if (await pickUI.isVisible().catch(() => false)) {
          await expect(p.locator('#dv-m-black-count')).toHaveText(/\d/);
          await p.click('#dv-m-btn-confirm-pick');
          acted = true;
          break;
        }
      }
      if (!acted) await pages[0].waitForTimeout(300);
    }
    for (const p of pages) await expect(p.locator('#dv-m-hand .dv-tile')).toHaveCount(3, { timeout: 15_000 });

    // 내 차례인 폰에서 상대 3명이 좌/상/우로 배치되는지 확인
    let activePage = null;
    for (let i = 0; i < 30 && !activePage; i++) {
      for (const p of pages) {
        if (await p.locator('#dv-m-opponents-wrap:not(.hidden)').isVisible().catch(() => false)) { activePage = p; break; }
      }
      if (!activePage) await pages[0].waitForTimeout(300);
    }
    expect(activePage).not.toBeNull();
    await expect(activePage.locator('#dv-m-opp-left:not(.hidden)')).toBeVisible({ timeout: 5000 });
    await expect(activePage.locator('#dv-m-opp-top:not(.hidden)')).toBeVisible({ timeout: 5000 });
    await expect(activePage.locator('#dv-m-opp-right:not(.hidden)')).toBeVisible({ timeout: 5000 });

    const fatalErrors = consoleErrors.filter(e => !/favicon/i.test(e));
    expect(fatalErrors, `콘솔 에러 발생: ${fatalErrors.join('\n')}`).toEqual([]);

    await hostCtx.close();
    for (const p of pages) await p.context().close();
  });
});
