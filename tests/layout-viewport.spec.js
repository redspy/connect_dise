import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const screenshotsDir = '/Users/soul/.gemini/antigravity/brain/0ef4c056-cfcf-43e9-9550-f3e89a6917ec/screenshots';
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

const VIEWPORTS = [
  { name: 'FHD_TV_1080p', width: 1920, height: 1080 },
  { name: 'Tablet_Landscape', width: 1024, height: 768 },
  { name: 'Tablet_Square_Ratio', width: 800, height: 800 },
  { name: 'Short_Wide_Window', width: 1280, height: 500 }
];

test.describe('전체 게임 뷰포트 레이아웃 및 스크롤 감지 검증', () => {

  // 1. 왁자지껄 거래소 (Pit Trade)
  for (const vp of VIEWPORTS) {
    test(`Pit Trade - ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('https://localhost:5173/games/pit-trade/host/');

      // 로비 화면 렌더링 검증
      const title = page.locator('.title');
      await expect(title).toBeVisible();

      // QR 코드 박스 존재 검증
      const qrBox = page.locator('#qr-box');
      await expect(qrBox).toBeVisible();

      // 스크린샷 캡처
      const screenshotPath = path.join(screenshotsDir, `pit_trade_${vp.name}.png`);
      await page.screenshot({ path: screenshotPath });
      console.log(`[Screenshot Saved] Pit Trade ${vp.name} -> ${screenshotPath}`);

      // 데모 버튼 클릭 가능 여부 확인
      const demoPlayBtn = page.locator('#demoPlayBtn');
      await expect(demoPlayBtn).toBeEnabled();
    });
  }

  // 2. 눈치 10단 (Nunchi-ten)
  for (const vp of VIEWPORTS) {
    test(`Nunchi-ten - ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('https://localhost:5173/games/nunchi-ten/host/');

      // 로비 검증
      const lobby = page.locator('game-lobby');
      await expect(lobby).toBeVisible();

      // 스크린샷
      const screenshotPath = path.join(screenshotsDir, `nunchi_ten_${vp.name}.png`);
      await page.screenshot({ path: screenshotPath });
      console.log(`[Screenshot Saved] Nunchi-ten ${vp.name} -> ${screenshotPath}`);
    });
  }

  // 3. 오목 (Omok)
  for (const vp of VIEWPORTS) {
    test(`Omok - ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('https://localhost:5173/games/omok/host/');

      // 데모 플레이 실행하여 게임 화면 전환
      const demoPlayBtn = page.locator('#demoPlayBtn');
      await expect(demoPlayBtn).toBeVisible();
      await demoPlayBtn.click();

      // 게임 판이 노출되는playing 페이즈 대기
      const boardWrap = page.locator('.omok-main-wrap');
      await expect(boardWrap).not.toHaveClass(/hidden/, { timeout: 10000 });

      // 오목판이 화면 높이/너비를 초과하지 않고 들어오는지 검증
      const board = page.locator('#board');
      await expect(board).toBeVisible();

      const boundingBox = await board.boundingBox();
      expect(boundingBox).not.toBeNull();
      
      // 오목판이 세로 길이를 넘치지 않는지 단정
      console.log(`[Omok Board ${vp.name}] Box Height: ${boundingBox.height}px, Viewport Height: ${vp.height}px`);
      expect(boundingBox.height).toBeLessThanOrEqual(vp.height * 0.9);

      // 스크린샷
      const screenshotPath = path.join(screenshotsDir, `omok_${vp.name}.png`);
      await page.screenshot({ path: screenshotPath });
      console.log(`[Screenshot Saved] Omok ${vp.name} -> ${screenshotPath}`);
    });
  }

});
