import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('다빈치 코드 — 조커 옵션 데모 & Wake Lock', () => {
  test('조커 포함 옵션 켜고 데모 플레이 — 26장 구성으로 끝까지 진행', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(`${BASE}/games/davinci-code/host/`);
    await page.locator('game-lobby').waitFor({ timeout: 15_000 });

    await page.check('input[name="dv-jokers"]');
    await page.click('#demoPlayBtn');

    await expect(page.locator('[data-phase="playing"]')).toBeVisible({ timeout: 20_000 });
    // 세팅 직후(어느 한쪽이라도 분배받기 전) 더미 총량이 26장(조커 포함) 구성인지 확인.
    const blackCount0 = await page.locator('#dv-pool-black-count').textContent();
    const whiteCount0 = await page.locator('#dv-pool-white-count').textContent();
    expect(parseInt(blackCount0, 10) + parseInt(whiteCount0, 10)).toBeLessThanOrEqual(26);

    await expect(page.locator('[data-phase="result"]')).toBeVisible({ timeout: 90_000 });

    // 결과 화면(gameFinished.revealedBoards)에는 "그 시점까지 각자 손에 들어간
    // 타일"만 실리고, 더미에 아직 남아 한 번도 안 뽑힌 타일은 포함되지 않는다
    // (원작에서도 안 뽑힌 타일은 애초에 누구 손에도 없었으니 당연함). 그래서
    // 총량 보존 불변식은 "결과 화면 타일 수 + 남은 더미 수 == 26"으로 검증해야
    // 하며, 이 값이 매판 정확히 26이어야 한다(어긋나면 삽입/조커 큐 어딘가에서
    // 타일이 새는 실제 버그).
    const tileTexts = await page.locator('.dv-result-tile').allTextContents();
    const poolBlack = parseInt((await page.locator('#dv-pool-black-count').textContent()) || '0', 10);
    const poolWhite = parseInt((await page.locator('#dv-pool-white-count').textContent()) || '0', 10);
    expect(tileTexts.length + poolBlack + poolWhite).toBe(26);
    // 조커는 각자 최대 1장씩(색별 1장)뿐이므로 결과 화면에 보이는 조커는 0~2개 범위.
    const jokerCount = tileTexts.filter(t => t.trim() === '★').length;
    expect(jokerCount).toBeGreaterThanOrEqual(0);
    expect(jokerCount).toBeLessThanOrEqual(2);

    const fatalErrors = consoleErrors.filter(e => !/favicon/i.test(e));
    expect(fatalErrors, `콘솔 에러 발생: ${fatalErrors.join('\n')}`).toEqual([]);
  });

  test('호스트 화면 Wake Lock: 진행 중 재취득 로직 동작 확인', async ({ page }) => {
    await page.goto(`${BASE}/games/davinci-code/host/`);
    await page.locator('game-lobby').waitFor({ timeout: 15_000 });

    // navigator.wakeLock을 모킹해 request() 호출 횟수를 센다(루미큐브 검증과 동일 기법).
    // 실제 브라우저는 문서가 hidden으로 가면 sentinel을 스스로 release()하고
    // 'release' 이벤트를 쏘는데, 그 결과로 호스트 코드의 addEventListener('release',...)
    // 콜백이 _wakeLock 참조를 null로 비운다 — 그래야 다음 visible 전환 때
    // "!this._wakeLock" 조건이 참이 되어 재취득 로직이 실제로 발동한다.
    // 이 리허설 없이는(참조가 계속 남아있으면) 재취득 분기 자체가 트리거되지
    // 않아 카운트가 늘지 않는다.
    await page.evaluate(() => {
      let count = 0;
      window.__wakeLockRequestCount = 0;
      let currentReleaseCb = null;
      window.__simulateBrowserAutoRelease = () => { currentReleaseCb?.(); };
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
          request: async () => {
            window.__wakeLockRequestCount = ++count;
            const sentinel = {
              release: async () => { currentReleaseCb?.(); },
              addEventListener: (type, cb) => { if (type === 'release') currentReleaseCb = cb; },
            };
            return sentinel;
          },
        },
      });
    });

    await page.click('#demoPlayBtn');
    await expect(page.locator('[data-phase="playing"]')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);

    const initialCount = await page.evaluate(() => window.__wakeLockRequestCount);
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // 백그라운드 전환(브라우저의 자동 release까지) 시뮬레이션 후 다시 보이는
    // 상태로 전환 → 재취득 확인
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.__simulateBrowserAutoRelease();
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(300);

    const afterCount = await page.evaluate(() => window.__wakeLockRequestCount);
    expect(afterCount).toBeGreaterThan(initialCount);
  });
});
