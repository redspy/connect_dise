import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

/**
 * 다빈치 코드는 턴 순서와 세팅 선택 순서가 게임마다 랜덤이라, 이 테스트는
 * "누가 지금 행동해야 하는가"를 DOM 상태로 판별해 그 페이지를 조작하는
 * 방식으로 작성함(어느 쪽이 선공이든 동일하게 통과해야 함).
 */
test.describe('다빈치 코드 — 2인 실플레이어 E2E 테스트', () => {
  test('세팅 선택 → 정보 은닉 검증 → 정답/오답 추측 흐름', async ({ browser }) => {
    test.setTimeout(120_000);

    const hostCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 } });
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/davinci-code/host/`);
    const lobby = host.locator('game-lobby');
    await lobby.waitFor({ timeout: 15_000 });
    const codeEl = lobby.locator('.lobby-session-code');
    await expect(codeEl).toBeVisible();
    const code = (await codeEl.textContent())?.trim();

    const p1Ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    const p1 = await p1Ctx.newPage();
    await p1.goto(`${BASE}/games/davinci-code/mobile/?session=${code}`);
    const p2Ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    const p2 = await p2Ctx.newPage();
    await p2.goto(`${BASE}/games/davinci-code/mobile/?session=${code}`);

    for (const p of [p1, p2]) {
      await p.fill('#nickname-input', p === p1 ? 'P1' : 'P2');
      await p.click('#btn-join');
      await expect(p.locator('[data-screen="waiting"]')).toBeVisible({ timeout: 10_000 });
      await p.click('#btn-ready');
    }

    const startBtn = host.locator('game-lobby .lobby-start-btn:not([disabled])');
    await startBtn.waitFor({ state: 'attached', timeout: 10_000 });
    await host.evaluate(() => document.querySelector('game-lobby .lobby-start-btn')?.click());
    await expect(host.locator('[data-phase="playing"]')).toBeVisible({ timeout: 10_000 });
    await expect(p1.locator('[data-screen="game"]')).toBeVisible({ timeout: 10_000 });
    await expect(p2.locator('[data-screen="game"]')).toBeVisible({ timeout: 10_000 });

    // ── 세팅: 색 구성 선택(랜덤 순서) — 뜨는 쪽마다 즉시 확정 ──
    async function resolvePickIfShown(page) {
      const pickUI = page.locator('#dv-m-setup-pick');
      if (await pickUI.isVisible().catch(() => false)) {
        await page.click('#dv-m-btn-confirm-pick');
        return true;
      }
      return false;
    }
    const handCount = async (page) => page.locator('#dv-m-hand .dv-tile').count();
    for (let i = 0; i < 30; i++) {
      if ((await handCount(p1)) > 0 && (await handCount(p2)) > 0) break;
      await resolvePickIfShown(p1);
      await resolvePickIfShown(p2);
      await p1.waitForTimeout(300);
    }
    expect(await handCount(p1)).toBeGreaterThan(0);
    expect(await handCount(p2)).toBeGreaterThan(0);

    // ── 정보 은닉 검증(§9): 상대 뒷면 타일에는 숫자 텍스트가 절대 없어야 함 ──
    async function getActivePage() {
      for (let i = 0; i < 40; i++) {
        const p1Active = await p1.locator('#dv-m-opponents-wrap:not(.hidden)').isVisible().catch(() => false);
        const p2Active = await p2.locator('#dv-m-opponents-wrap:not(.hidden)').isVisible().catch(() => false);
        if (p1Active) return p1;
        if (p2Active) return p2;
        await p1.waitForTimeout(300);
      }
      throw new Error('활성 플레이어를 찾지 못함');
    }
    let active = await getActivePage();
    let passive = active === p1 ? p2 : p1;

    // draw 페이즈면 뽑기
    const drawBar = active.locator('#dv-m-draw-bar:not(.hidden)');
    if (await drawBar.isVisible().catch(() => false)) {
      await active.click('#dv-m-btn-draw-black');
      await active.waitForTimeout(500);
    }

    const oppBoardTiles = active.locator('.dv-m-opp-board .dv-tile');
    await expect(oppBoardTiles.first()).toBeVisible({ timeout: 10_000 });
    const oppTileTexts = await oppBoardTiles.allTextContents();
    expect(oppTileTexts.every(t => t.trim() === ''), `상대 뒷면 타일에 숫자가 노출됨: ${JSON.stringify(oppTileTexts)}`).toBe(true);

    // passive(상대=guess 대상)의 자기 화면에서 진짜 값을 읽는다(소유자 본인
    // 화면에는 항상 숫자가 보여야 하므로 이 자체가 §11.2 검증이기도 함).
    const myTiles = passive.locator('#dv-m-hand .dv-tile');
    const myTileCount = await myTiles.count();
    const trueValues = [];
    for (let i = 0; i < myTileCount; i++) trueValues.push((await myTiles.nth(i).textContent())?.trim());
    expect(trueValues.every(v => v && v.length > 0), `소유자 본인 화면에 내 타일 숫자가 안 보임: ${JSON.stringify(trueValues)}`).toBe(true);

    // ── 정답 추측: 위치0 타일을 진짜 값으로 선언 ──
    const targetIdx = 0;
    const trueValue = trueValues[targetIdx];
    await oppBoardTiles.nth(targetIdx).click();
    await expect(active.locator('#dv-m-numpad-overlay:not(.hidden)')).toBeVisible({ timeout: 5000 });
    await active.locator('.dv-m-numpad-key', { hasText: new RegExp(`^${trueValue}$`) }).first().click();
    await active.click('#dv-m-btn-declare');

    // 정답이면 choose 바가 뜸(성공 처리 확인)
    await expect(active.locator('#dv-m-choose-bar:not(.hidden)')).toBeVisible({ timeout: 5000 });
    // 양쪽 페이지 모두에서 그 타일이 공개(모서리 마킹 + 텍스트 노출)됐는지 확인
    await expect(active.locator('.dv-m-opp-board .dv-tile').nth(targetIdx)).toHaveText(trueValue, { timeout: 5000 });
    await expect(passive.locator('#dv-m-hand .dv-tile').nth(targetIdx)).toHaveClass(/dv-tile-public/, { timeout: 5000 });

    // ── choose에서 "한 번 더"를 눌러 guess로 복귀 → 이번엔 일부러 오답 선언 ──
    const remainingCount = await active.locator('.dv-m-opp-board .dv-tile:not(.dv-tile-public)').count();
    if (remainingCount > 0) {
      const myHandBefore = await active.locator('#dv-m-hand .dv-tile').count();
      await active.click('#dv-m-btn-continue');
      await expect(active.locator('#dv-m-choose-bar')).toBeHidden({ timeout: 5000 });

      const wrongTargetEl = active.locator('.dv-m-opp-board .dv-tile:not(.dv-tile-public)').first();
      await expect(wrongTargetEl).toBeVisible({ timeout: 5000 });
      const wrongIdxOnActive = await wrongTargetEl.evaluate((el) => [...el.parentElement.children].indexOf(el));
      // 대상 인덱스가 이미 공개된 타일 뒤라면, 상대(passive) 본인 화면에서
      // 같은 인덱스의 진짜 값을 다시 읽어 "확실히 틀린 값(진짜값+1 mod 12)"을 계산.
      const trueValueAtIdx = (await passive.locator('#dv-m-hand .dv-tile').nth(wrongIdxOnActive).textContent())?.trim();
      const wrongValue = String((parseInt(trueValueAtIdx, 10) + 1) % 12);

      await wrongTargetEl.click();
      await expect(active.locator('#dv-m-numpad-overlay:not(.hidden)')).toBeVisible({ timeout: 5000 });
      await active.locator('.dv-m-numpad-key', { hasText: new RegExp(`^${wrongValue}$`) }).first().click();
      await active.click('#dv-m-btn-declare');

      // 오답 → 턴 종료. 뽑은 타일이 공개 상태로 active 자신의 판에 삽입됨(§6.4)
      // → 다음 턴이 시작되거나(더미 있었으면 상대 턴), active 자신의 손패가 늘어남.
      await active.waitForTimeout(1200); // 드럼롤 연출 대기
      const myHandAfter = await active.locator('#dv-m-hand .dv-tile').count();
      expect(myHandAfter).toBeGreaterThanOrEqual(myHandBefore);
      // 방금 탭한 타일 자체는 여전히 비공개 유지(오답이어도 대상 타일은 공개되지 않음)
      await expect(wrongTargetEl).not.toHaveClass(/dv-tile-public/);
    }

    await hostCtx.close();
    await p1Ctx.close();
    await p2Ctx.close();
  });
});
