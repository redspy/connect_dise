import { test, expect } from '@playwright/test';
import { BASE, joinPlayers, startGameFromHost, resolveAllSetupPicks } from './_helpers.js';

/**
 * 순수 랜덤 플레이로는 동점/조커가 세팅 단계에 걸리길 기다려야 해서 느리고
 * 불안정하므로, 호스트 페이지의 Math.random만 결정적으로 고정해 특정 시나리오를
 * 확실히 재현한다. 서버(세션 코드 생성)는 별도 Node 프로세스라 영향받지 않고,
 * 모바일 페이지들은 건드리지 않는다 — 오직 이 호스트 인스턴스의 셔플
 * (turnOrder 셔플 + createPools 셔플) 결과만 결정적으로 만든다.
 *
 * rng()=>0.999999 로 고정하면 Fisher-Yates가 전부 no-op 스왑이 되어 흑/백
 * 풀이 항등순서([0,1,...,11] 또는 조커 포함 시 [0,1,...,11,조커])로 유지된다
 * (games/davinci-code/shared/DavinciEngine.js의 shuffle 구현 기준, 직접 계산해
 * 검증 완료). 조커를 맨 앞으로 보내고 싶을 때만 첫 호출에 0을 섞어 쓴다.
 */
async function gotoHostWithFixedRng(browser, rngSeq, viewport = { width: 1600, height: 900 }) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  await page.addInitScript((seq) => {
    let i = 0;
    Math.random = () => seq[i++ % seq.length];
  }, rngSeq);
  await page.goto(`${BASE}/games/davinci-code/host/`);
  const lobby = page.locator('game-lobby');
  await lobby.waitFor({ timeout: 15_000 });
  const code = (await lobby.locator('.lobby-session-code').textContent())?.trim();
  return { ctx, page, code, consoleErrors };
}

test.describe('다빈치 코드 — 동점 자유배치 & 세팅 조커 위치선택 E2E (결정적 RNG)', () => {
  test('자유배치 옵션: 동점 보유 상태에서 삽입 시 좌/우 프롬프트가 뜨고 선택대로 반영됨', async ({ browser }) => {
    test.setTimeout(60_000);
    // rng 항상 ~1 → 풀이 항등순서로 유지: black=[0..11], white=[0..11].
    // 두 플레이어 모두 세팅 기본값(=흑 전량 4장)을 그대로 확정하면
    // P1=[흑0,1,2,3], P2=[흑4,5,6,7]가 되고 백 풀은 손대지 않은 채 [0..11]로 남는다.
    const { ctx: hostCtx, page: host, code, consoleErrors } = await gotoHostWithFixedRng(browser, [0.999999]);

    // 로비에서 "자유 배치" 옵션 선택
    await host.check('input[name="dv-tierule"][value="free"]');

    const players = await joinPlayers(browser, code, 2, consoleErrors);
    await startGameFromHost(host);
    await resolveAllSetupPicks(players);

    const [p1, p2] = players;
    // 세팅 결과 검증: P1의 손에 흑0,1,2,3이 정확히 들어왔는지(결정적 RNG 검증)
    const p1HandTexts = await p1.page.locator('#dv-m-hand .dv-tile').allTextContents();
    expect(p1HandTexts.map((t) => t.trim())).toEqual(['0', '1', '2', '3']);

    // P1이 선공(turnOrder 셔플도 no-op이라 join 순서 그대로 P1이 먼저)
    await expect(p1.page.locator('#dv-m-draw-bar:not(.hidden)')).toBeVisible({ timeout: 10_000 });
    const whiteDisabled = await p1.page.locator('#dv-m-btn-draw-white').evaluate((el) => el.classList.contains('dv-m-action-btn-disabled'));
    expect(whiteDisabled).toBe(false);
    await p1.page.click('#dv-m-btn-draw-white'); // 백 풀 맨 앞 = 백0 확정 → 흑0과 동점

    // 뽑은 타일(백0)이 내 드로우 슬롯에 "0"으로 보이는지(소유자 시점 진짜 값 확인)
    await expect(p1.page.locator('#dv-m-drawn-slot .dv-tile')).toHaveText('0', { timeout: 5000 });

    // P2의 타일 0번째(흑4)에 일부러 오답 선언 → 턴 종료 → 뽑은 백0을 P1 판에 삽입
    // → 동점(흑0) 보유 중이므로 자유배치 옵션에서 좌/우 프롬프트가 떠야 함
    const oppTile0 = p1.page.locator('.dv-m-opp-board .dv-tile').first();
    await expect(oppTile0).toBeVisible({ timeout: 5000 });
    await oppTile0.click();
    await expect(p1.page.locator('#dv-m-numpad-overlay:not(.hidden)')).toBeVisible({ timeout: 5000 });
    await p1.page.locator('.dv-m-numpad-key', { hasText: /^5$/ }).first().click(); // 진짜 값은 4 → 5는 오답
    await p1.page.click('#dv-m-btn-declare');

    await expect(p1.page.locator('#dv-m-tiebreak-bar:not(.hidden)')).toBeVisible({ timeout: 10_000 });
    await p1.page.click('#dv-m-btn-tiebreak-left');

    // 왼쪽을 선택했으니 백0이 흑0보다 앞(인덱스0)에 들어가야 함
    await expect(p1.page.locator('#dv-m-hand .dv-tile').first()).toHaveClass(/dv-tile-white/, { timeout: 5000 });
    await expect(p1.page.locator('#dv-m-hand .dv-tile').first()).toHaveText('0');
    await expect(p1.page.locator('#dv-m-hand .dv-tile').nth(1)).toHaveClass(/dv-tile-black/);
    await expect(p1.page.locator('#dv-m-hand .dv-tile').nth(1)).toHaveText('0');

    // 호스트 TV에도 동일하게 반영됐는지(§9 — 위치·색은 공용 정보이므로 TV에도 보여야 함)
    const p1SeatBoard = host.locator('[id^="dv-seat-"]', { hasText: 'P0' }).locator('.dv-board');
    await expect(p1SeatBoard.locator('.dv-tile').first()).toHaveClass(/dv-tile-white/, { timeout: 5000 });

    const fatalErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
    expect(fatalErrors, `콘솔 에러: ${fatalErrors.join('\n')}`).toEqual([]);

    await hostCtx.close();
    for (const p of players) await p.ctx.close();
  });

  test('조커 옵션: 세팅 분배 중 조커를 뽑은 플레이어가 위치선택 UI를 거쳐 확정됨', async ({ browser }) => {
    test.setTimeout(60_000);
    // rng를 "호출 횟수와 무관하게 항상 같은 값을 반환하는 상수 함수"로 고정해야
    // 안정적이다 — 처음엔 [0, 0.999999×11]처럼 앞부분만 다른 시퀀스를 썼는데,
    // QR 렌더링 등 게임 시작 전에도 이미 host 페이지에서 Math.random()이 여러 번
    // 호출되고 있어서(실측: createPools+turnOrder 셔플 전까지 이미 수 회 소비됨)
    // 내가 의도한 인덱스와 실제로 소비되는 인덱스가 어긋나 조커가 엉뚱한 자리로
    // 가버렸다(결정적 RNG E2E로 재현·발견, 2026-08-23) — 상수 함수는 호출
    // 시점/횟수에 무관하게 항상 같은 결과를 주므로 이 문제 자체가 성립하지 않는다.
    // rng=1/13일 때 13장(0~11+조커) 셔플 결과가 정확히 "조커가 맨 앞"이 되는
    // 것을 직접 계산해 검증했다(DavinciEngine.createPools를 노드에서 직접 호출).
    const { ctx: hostCtx, page: host, code, consoleErrors } = await gotoHostWithFixedRng(browser, [1 / 13]);

    await host.check('input[name="dv-jokers"]');

    const players = await joinPlayers(browser, code, 2, consoleErrors);
    await startGameFromHost(host);

    // 상수 rng는 turnOrder 셔플 결과까지 결정적으로 바꾸므로(2인이면 반드시
    // 스왑되어 순서가 뒤집힘) 어느 쪽이 선공인지 하드코딩하지 않고, 실제로
    // #dv-m-setup-pick이 뜨는 페이지를 그대로 찾아 사용한다 — 이 파일의 두
    // 테스트가 서로 다른 rng를 쓰므로 "누가 선공인가"는 매번 달라질 수 있고,
    // 이를 가정하지 않는 편이 더 견고한 테스트다.
    let picker = null;
    for (let i = 0; i < 20 && !picker; i++) {
      for (const p of players) if (await p.page.locator('#dv-m-setup-pick').isVisible().catch(() => false)) { picker = p; break; }
      if (!picker) await players[0].page.waitForTimeout(300);
    }
    expect(picker, '세팅 픽 프롬프트가 아무 페이지에도 뜨지 않음').not.toBeNull();
    await picker.page.click('#dv-m-btn-confirm-pick');

    // 자동 정렬 대신 조커 위치선택 UI(간격 마커)가 떠야 함
    await expect(picker.page.locator('#dv-m-jokerplace-hint:not(.hidden)')).toBeVisible({ timeout: 10_000 });
    const gaps = picker.page.locator('.dv-m-gap-slot');
    const gapCount = await gaps.count();
    expect(gapCount).toBeGreaterThan(0); // 숫자 타일 개수+1 만큼의 틈
    await gaps.first().click(); // 맨 왼쪽에 배치

    // 확정 후 조커가 맨 왼쪽(★)으로 들어갔는지 확인
    await expect(picker.page.locator('#dv-m-hand .dv-tile').first()).toHaveText('★', { timeout: 5000 });
    await expect(picker.page.locator('#dv-m-hand .dv-tile').first()).toHaveClass(/dv-tile-joker/);

    // 나머지 플레이어 세팅도 마저 완료 → turns 단계까지 정상 진행되는지(크래시 없는지) 확인
    await resolveAllSetupPicks(players);
    // 아무 화면 요소든(뽑기 바/상대판/"내 차례 아님" 안내) 하나는 반드시 보여야
    // turns 단계로 정상 진입한 것 — 강한 락업/크래시가 없었는지가 핵심.
    const turnsStarted = await picker.page.locator('#dv-m-draw-bar:not(.hidden)').isVisible().catch(() => false)
      || await picker.page.locator('#dv-m-opponents-wrap:not(.hidden)').isVisible().catch(() => false)
      || await picker.page.locator('#dv-m-not-my-turn:not(.hidden)').isVisible().catch(() => false);
    expect(turnsStarted, '세팅 완료 후 turns 단계로 정상 진입하지 못함').toBe(true);

    const fatalErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
    expect(fatalErrors, `콘솔 에러: ${fatalErrors.join('\n')}`).toEqual([]);

    await hostCtx.close();
    for (const p of players) await p.ctx.close();
  });
});
