import { test } from '@playwright/test';
import * as path from 'path';

const BASE = 'https://localhost:5173';
const SCREENSHOT_DIR = '/Users/soul/.gemini/antigravity/brain/0ef4c056-cfcf-43e9-9550-f3e89a6917ec/screenshots';

const MOBILE_VIEWPORTS = [
  { name: 'iPhone_SE_Small', width: 320, height: 568 },
  { name: 'iPhone_12_Standard', width: 390, height: 844 },
  { name: 'iPad_Mini_Tablet', width: 768, height: 1024 }
];

const HOST_VIEWPORTS = [
  { name: 'Tablet_Landscape', width: 1024, height: 768 },
  { name: 'FHD_TV_1080p', width: 1920, height: 1080 }
];

test.describe('다차원 해상도 레이아웃 검수 및 스크린샷 캡처', () => {

  // 그림 릴레이 모바일 셋업 화면 검수
  for (const vp of MOBILE_VIEWPORTS) {
    test(`Relay Drawing Mobile Setup - ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      
      // 모바일 셋업 페이지 로드 (가상의 세션 ID 쿼리 파라미터 부여)
      await page.goto(`${BASE}/games/relay-drawing/mobile/?session=TEST`);
      await page.locator('#nickname').waitFor({ timeout: 10_000 });
      
      // 1초 안정화 대기
      await page.waitForTimeout(1000);
      
      const file = path.join(SCREENSHOT_DIR, `relay_drawing_mobile_setup_${vp.name}.png`);
      await page.screenshot({ path: file });
      console.log(`Saved screenshot: ${file}`);
    });
  }

  // 그림 릴레이 호스트 로비 화면 검수
  for (const vp of HOST_VIEWPORTS) {
    test(`Relay Drawing Host Lobby - ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}/games/relay-drawing/host/`);
      
      // 로비 웹 컴포넌트 렌더링 완료 대기
      await page.locator('game-lobby').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(1500);
      
      const file = path.join(SCREENSHOT_DIR, `relay_drawing_host_lobby_${vp.name}.png`);
      await page.screenshot({ path: file });
      console.log(`Saved screenshot: ${file}`);
    });
  }

  // 해적의 전리품 모바일 셋업 화면 검수
  for (const vp of MOBILE_VIEWPORTS) {
    test(`Pirate Plunder Mobile Setup - ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}/games/pirate-plunder/mobile/?session=TEST`);
      await page.locator('#input-nickname').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(1000);
      
      const file = path.join(SCREENSHOT_DIR, `pirate_plunder_mobile_setup_${vp.name}.png`);
      await page.screenshot({ path: file });
      console.log(`Saved screenshot: ${file}`);
    });
  }

  // 해적의 전리품 호스트 로비 화면 검수
  for (const vp of HOST_VIEWPORTS) {
    test(`Pirate Plunder Host Lobby - ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}/games/pirate-plunder/host/`);
      await page.locator('game-lobby').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(1500);
      
      const file = path.join(SCREENSHOT_DIR, `pirate_plunder_host_lobby_${vp.name}.png`);
      await page.screenshot({ path: file });
      console.log(`Saved screenshot: ${file}`);
    });
  }

});
