import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('다빈치 코드 — 데모 플레이 E2E 테스트', () => {
  test('Attract Mode: 2인 가상 봇 데모 자동화 풀플로우 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const host = await hostCtx.newPage();
    const consoleErrors = [];
    host.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    host.on('pageerror', (err) => consoleErrors.push(String(err)));

    await host.goto(`${BASE}/games/davinci-code/host/`);
    await host.locator('game-lobby').waitFor({ timeout: 15_000 });

    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 카운트다운 → 게임 시작 → 테이블(2석) 렌더링 확인
    await expect(host.locator('[data-phase="playing"]')).toBeVisible({ timeout: 20_000 });
    await expect(host.locator('#dv-table .dv-seat')).toHaveCount(2, { timeout: 15_000 });

    // 봇 2명이 세팅→턴 진행→종료까지 자동으로 마칠 때까지 대기
    await expect(host.locator('[data-phase="result"]')).toBeVisible({ timeout: 90_000 });
    await expect(host.locator('.dv-result-row')).toHaveCount(2);

    const fatalErrors = consoleErrors.filter(e => !/favicon/i.test(e));
    expect(fatalErrors, `콘솔 에러 발생: ${fatalErrors.join('\n')}`).toEqual([]);

    await hostCtx.close();
  });
});
