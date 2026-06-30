import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Omok — 2인 멀티플레이어 대전 및 재접속 E2E 테스트', () => {

  test('E2E: 2인 플레이어 입장 ➔ 시작 ➔ 흑돌 착수 ➔ 백돌 재접속 ➔ 백돌 대응 착수', async ({ browser }) => {
    // 1. 호스트 화면 실행
    const hostCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/omok/host/`);

    const lobby = host.locator('game-lobby');
    await lobby.waitFor({ timeout: 15_000 });
    const codeEl = lobby.locator('.lobby-session-code');
    await expect(codeEl).toBeVisible();
    const code = (await codeEl.textContent())?.trim();
    expect(code).not.toBe('------');

    // 2. 모바일 플레이어 1(흑돌) 및 2(백돌) 접속
    const p1Ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    const p1 = await p1Ctx.newPage();
    await p1.goto(`${BASE}/games/omok/mobile/?session=${code}`);

    const p2Ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    const p2 = await p2Ctx.newPage();
    await p2.goto(`${BASE}/games/omok/mobile/?session=${code}`);

    // 두 플레이어가 조인 상태(대기실 화면)로 진입할 때까지 대기
    await expect(p1.locator('[data-screen="waiting"]')).toBeVisible({ timeout: 10_000 });
    await expect(p2.locator('[data-screen="waiting"]')).toBeVisible({ timeout: 10_000 });

    // 두 플레이어 준비하기 클릭
    await p1.click('#btn-ready');
    await p2.click('#btn-ready');

    // 3. 호스트에서 '시작하기' 버튼 클릭 (Attached 상태 대기 후 Evaluate 클릭으로 가시성 판정 오작동 회피)
    const startBtn = host.locator('game-lobby .lobby-start-btn:not([disabled])');
    await startBtn.waitFor({ state: 'attached', timeout: 10_000 });
    await host.evaluate(() => {
      const btn = document.querySelector('game-lobby .lobby-start-btn');
      if (btn) btn.click();
    });

    // 호스트가 대국 화면(playing)으로 전환되었는지 검증
    await expect(host.locator('[data-phase="playing"]')).toBeVisible({ timeout: 10_000 });

    // 4. 역할 배정 확인 (P1: 흑돌 선공, P2: 백돌 대기)
    await expect(p1.locator('[data-screen="my-turn"]')).toBeVisible({ timeout: 5000 });
    await expect(p2.locator('[data-screen="opponent-turn"]')).toBeVisible({ timeout: 5000 });

    // 5. 플레이어 1 (흑돌) 착수 진행 (6, 6)
    const p1Cell = p1.locator('.mobile-board .mobile-cell[data-row="6"][data-col="6"]');
    await p1Cell.click();
    
    const p1SubmitBtn = p1.locator('#btn-play-stone');
    await expect(p1SubmitBtn).toBeEnabled();
    await p1SubmitBtn.click();

    // 흑돌 착수 후 턴 교대 검증 (P1 대기, P2 차례)
    await expect(p1.locator('[data-screen="opponent-turn"]')).toBeVisible({ timeout: 5000 });
    await expect(p2.locator('[data-screen="my-turn"]')).toBeVisible({ timeout: 5000 });

    // 호스트 화면에 흑돌이 정상적으로 표시되는지 검증
    const hostBlackStone = host.locator('.cell[data-row="6"][data-col="6"] .stone-piece.black');
    await expect(hostBlackStone).toBeVisible({ timeout: 5000 });

    // 6. 플레이어 2 (백돌) 일시 재접속(화면 새로고침) 테스트
    // 새로고침하면 이전 sessionStorage의 reconnectId에 의거해 복구되어야 함
    await p2.reload();

    // 복구 후 백돌 차례 화면(my-turn)이 정상 복원되었는지 검증
    await expect(p2.locator('[data-screen="my-turn"]')).toBeVisible({ timeout: 10_000 });

    // 7. 플레이어 2 (백돌) 착수 진행 (6, 7)
    const p2Cell = p2.locator('.mobile-board .mobile-cell[data-row="6"][data-col="7"]');
    await p2Cell.click();
    
    const p2SubmitBtn = p2.locator('#btn-play-stone');
    await expect(p2SubmitBtn).toBeEnabled();
    await p2SubmitBtn.click();

    // 백돌 착수 후 다시 흑돌의 차례로 돌아왔는지 검증
    await expect(p1.locator('[data-screen="my-turn"]')).toBeVisible({ timeout: 5000 });

    // 호스트 화면에 백돌이 정상적으로 표시되는지 검증
    const hostWhiteStone = host.locator('.cell[data-row="6"][data-col="7"] .stone-piece.white');
    await expect(hostWhiteStone).toBeVisible({ timeout: 5000 });

    // 리소스 해제
    await p1Ctx.close();
    await p2Ctx.close();
    await hostCtx.close();
  });

});
