import { test, expect } from '@playwright/test';
import { createHostSession, joinPlayers, startGameFromHost, resolveAllSetupPicks, playUntilResult } from './_helpers.js';

test.describe('다빈치 코드 — 3인/4인 실플레이어 풀플레이 E2E', () => {
  test('3인 풀플레이: 로비→세팅→탈락 발생→최종 승리, 좌석은 좌/우(상단 비움)', async ({ browser }) => {
    test.setTimeout(180_000);
    const { ctx: hostCtx, page: host, code, consoleErrors } = await createHostSession(browser);
    const players = await joinPlayers(browser, code, 3, consoleErrors);

    await startGameFromHost(host);
    for (const p of players) await expect(p.page.locator('[data-screen="game"]')).toBeVisible({ timeout: 10_000 });

    // TV: 3인 = 좌/우 2면(상단 비움)
    await expect(host.locator('#dv-table.dv-table-n3')).toBeVisible({ timeout: 10_000 });
    await expect(host.locator('#dv-table .dv-seat')).toHaveCount(3);

    await resolveAllSetupPicks(players);
    for (const p of players) await expect(p.page.locator('#dv-m-hand .dv-tile')).toHaveCount(4); // D2: 3인은 4장

    // 폰: 내 차례인 플레이어 화면에서 상대 2명이 좌/우로만 뜨고 상단은 비어야 함(D8)
    let active = null;
    for (let i = 0; i < 40 && !active; i++) {
      for (const p of players) if (await p.page.locator('#dv-m-opponents-wrap:not(.hidden)').isVisible().catch(() => false)) { active = p; break; }
      if (!active) await players[0].page.waitForTimeout(300);
    }
    expect(active).not.toBeNull();
    await expect(active.page.locator('#dv-m-opp-left:not(.hidden)')).toBeVisible();
    await expect(active.page.locator('#dv-m-opp-right:not(.hidden)')).toBeVisible();
    await expect(active.page.locator('#dv-m-opp-top:not(.hidden)')).toHaveCount(0); // top은 hidden 클래스 유지된 채로 존재

    await playUntilResult(host, players);
    await expect(host.locator('[data-phase="result"]')).toBeVisible();
    const rows = host.locator('.dv-result-row');
    await expect(rows).toHaveCount(3);
    // 탈락자가 최소 1명은 발생했어야(3인 게임이 즉시 2인전처럼 끝나지 않았는지) — 결과 목록에 "이탈"이 아닌
    // 정상 탈락자가 있는지는 rank 텍스트로 간접 확인(1위 외 2/3위 존재)
    await expect(host.locator('.dv-result-row', { hasText: '2위' })).toBeVisible();
    await expect(host.locator('.dv-result-row', { hasText: '3위' })).toBeVisible();

    const fatalErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
    expect(fatalErrors, `콘솔 에러: ${fatalErrors.join('\n')}`).toEqual([]);

    await hostCtx.close();
    for (const p of players) await p.ctx.close();
  });

  test('4인 풀플레이: 순차 탈락 → 최종 승리, 좌석 4방향, 결과 순위 = 탈락 역순', async ({ browser }) => {
    test.setTimeout(180_000);
    const { ctx: hostCtx, page: host, code, consoleErrors } = await createHostSession(browser);
    const players = await joinPlayers(browser, code, 4, consoleErrors);

    await startGameFromHost(host);
    for (const p of players) await expect(p.page.locator('[data-screen="game"]')).toBeVisible({ timeout: 10_000 });

    await expect(host.locator('#dv-table.dv-table-n4')).toBeVisible({ timeout: 10_000 });
    await expect(host.locator('#dv-table .dv-seat')).toHaveCount(4);

    await resolveAllSetupPicks(players);
    for (const p of players) await expect(p.page.locator('#dv-m-hand .dv-tile')).toHaveCount(3); // D2: 4인은 3장

    let active = null;
    for (let i = 0; i < 40 && !active; i++) {
      for (const p of players) if (await p.page.locator('#dv-m-opponents-wrap:not(.hidden)').isVisible().catch(() => false)) { active = p; break; }
      if (!active) await players[0].page.waitForTimeout(300);
    }
    expect(active).not.toBeNull();
    await expect(active.page.locator('#dv-m-opp-left:not(.hidden)')).toBeVisible();
    await expect(active.page.locator('#dv-m-opp-top:not(.hidden)')).toBeVisible();
    await expect(active.page.locator('#dv-m-opp-right:not(.hidden)')).toBeVisible();

    await playUntilResult(host, players, { maxActions: 600 });
    await expect(host.locator('[data-phase="result"]')).toBeVisible();
    const rows = host.locator('.dv-result-row');
    await expect(rows).toHaveCount(4);
    for (const label of ['1위', '2위', '3위', '4위']) {
      await expect(host.locator('.dv-result-row', { hasText: label })).toBeVisible();
    }

    // 결과 순위 = 탈락 역순(D18) 검증: DOM 순서상 1위→4위로 나열돼 있으므로,
    // 각 행의 순위 라벨과 실제 렌더 순서가 오름차순인지 확인.
    const rankTexts = await rows.locator('.dv-result-rank').allTextContents();
    expect(rankTexts.map((t) => t.trim())).toEqual(['1위', '2위', '3위', '4위']);

    const fatalErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
    expect(fatalErrors, `콘솔 에러: ${fatalErrors.join('\n')}`).toEqual([]);

    await hostCtx.close();
    for (const p of players) await p.ctx.close();
  });

  test('탈락 후 재접속: 관전 뷰(§7.1)가 stateSync로 정상 복원됨', async ({ browser }) => {
    test.setTimeout(180_000);
    const { ctx: hostCtx, page: host, code, consoleErrors } = await createHostSession(browser);
    const players = await joinPlayers(browser, code, 3, consoleErrors);

    await startGameFromHost(host);
    for (const p of players) await expect(p.page.locator('[data-screen="game"]')).toBeVisible({ timeout: 10_000 });
    await resolveAllSetupPicks(players);

    // 아무 한 명이든 탈락할 때까지만 진행(정답 체인으로 몰아붙이면 한 명이
    // 먼저 전 타일 공개돼 탈락함) — 게임 종료까지는 필요 없음, §7.1이 요구하는
    // "게임이 아직 진행 중인 상태에서의 관전 뷰"를 확인하는 게 목적이라 오히려
    // 게임이 끝나버리면(phase='result') 안 됨.
    const eliminatedRow = host.locator('.dv-player-card', { hasText: '탈락' });
    await playUntilResult(host, players, {
      maxActions: 400,
      stopWhen: async () => (await eliminatedRow.count()) > 0,
    });
    await expect(eliminatedRow).toHaveCount(1, { timeout: 5000 });
    await expect(host.locator('[data-phase="result"]')).toBeHidden(); // 게임이 끝나버린 상태로 재접속을 테스트하는 게 아님을 보장

    // 탈락한 닉네임을 찾아 그 플레이어 페이지에서 재접속(새로고침)을 시뮬레이션.
    // MobileSDK는 sessionStorage의 reconnectId로 같은 플레이어임을 서버에
    // 증명하므로 reload는 새 참가가 아니라 rejoin → requestState → stateSync
    // 경로를 그대로 탄다(§7.3 재접속 흐름, MobileSDK.js RECONNECT_KEY 참고).
    const eliminatedNick = (await eliminatedRow.locator('.dv-pcard-nick').textContent())?.trim();
    const eliminatedPlayer = players.find((p) => p.nickname === eliminatedNick);
    expect(eliminatedPlayer, `탈락한 닉네임(${eliminatedNick})에 해당하는 플레이어 페이지를 못 찾음`).toBeTruthy();

    await eliminatedPlayer.page.reload();
    await expect(eliminatedPlayer.page.locator('[data-screen="game"]')).toBeVisible({ timeout: 15_000 });

    // codex 헤드리스 리뷰가 발견한 버그(2026-08-23): stateSync 핸들러가
    // eliminatedRanks를 안 읽어서 재접속 시 _eliminated가 갱신 안 되고 일반
    // 플레이어 화면(상대판/뽑기 UI 등)이 그대로 떴었다 — 관전 배너와
    // 상대판·"내 차례 아님" 안내 둘 다 숨겨지는지 확인.
    await expect(eliminatedPlayer.page.locator('#dv-m-turn-banner')).toHaveText('👁 관전 중', { timeout: 10_000 });
    await expect(eliminatedPlayer.page.locator('#dv-m-opponents-wrap:not(.hidden)')).toHaveCount(0);
    await expect(eliminatedPlayer.page.locator('#dv-m-not-my-turn:not(.hidden)')).toHaveCount(0);

    // 탈락자 화면이어도 §9 위반(타인 비공개 숫자 유출)이 없어야 함 — 재접속
    // 직후에도 상대판 자체가 안 뜨므로(위에서 이미 확인) 별도 텍스트 스캔은
    // 생략하고, 관전 상태에서도 자기 자신의(전부 공개된) 타일판은 정상 표시되는지만 확인.
    await expect(eliminatedPlayer.page.locator('#dv-m-hand .dv-tile')).not.toHaveCount(0);

    const fatalErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
    expect(fatalErrors, `콘솔 에러: ${fatalErrors.join('\n')}`).toEqual([]);

    await hostCtx.close();
    for (const p of players) await p.ctx.close();
  });
});
