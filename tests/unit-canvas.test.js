import { test } from 'node:test';
import assert from 'node:assert';

// 브라우저 document 의존성 없이 수학적 수식 무결성 검증을 위해 
// RelayDrawingMobile에서 사용된 수식을 그대로 구현하여 검증하는 테스트 스위트

// 1. 모바일단 정규화 좌표 구하기 공식 (e.touches가 없거나 clientX/clientY를 direct로 연산)
function normalizeCoords(clientX, clientY, rect) {
  let nx = (clientX - rect.left) / rect.width;
  let ny = (clientY - rect.top) / rect.height;

  nx = Math.max(0, Math.min(1, nx));
  ny = Math.max(0, Math.min(1, ny));

  return { nx, ny };
}

// 2. 모바일/호스트단 복원 공식
function denormalizeCoords(nx, ny, width, height) {
  return {
    x: nx * width,
    y: ny * height
  };
}

// 3. 모바일 기기 회전 시 4:3 강제 고정 및 중앙 레터박스 배치 영역 계산 공식
function calculateCanvasStyles(pWidth, pHeight) {
  let w = pWidth;
  let h = pWidth * (3 / 4);

  if (h > pHeight) {
    h = pHeight;
    w = pHeight * (4 / 3);
  }

  const left = (pWidth - w) / 2;
  const top = (pHeight - h) / 2;

  return { width: w, height: h, left, top };
}

test('1. 정규화 좌표 역함수 수렴성 검증 (0% 오차 입증)', () => {
  const rect = { left: 50, top: 100, width: 360, height: 270 }; // 4:3
  const inputX = 180; // rect 내 상대 X: 130
  const inputY = 220; // rect 내 상대 Y: 120

  const { nx, ny } = normalizeCoords(inputX, inputY, rect);
  
  // 0~1 normalized 실수 값으로 환산되었는지 확인
  assert.ok(nx >= 0 && nx <= 1, 'nx는 0과 1 사이여야 합니다.');
  assert.ok(ny >= 0 && ny <= 1, 'ny는 0과 1 사이여야 합니다.');

  // 논리 800x600 캔버스에서의 역환산 좌표 복원
  const logical = denormalizeCoords(nx, ny, 800, 600);
  
  // 원래 픽셀 비율 대조
  const expectedRatioX = (inputX - rect.left) / rect.width;
  const expectedRatioY = (inputY - rect.top) / rect.height;
  const actualRatioX = logical.x / 800;
  const actualRatioY = logical.y / 600;

  // 부동소수점 오차 감안 비교 (1e-9 이하 오차)
  assert.ok(Math.abs(actualRatioX - expectedRatioX) < 1e-9, 'X 비율이 완벽하게 동기화되어야 합니다.');
  assert.ok(Math.abs(actualRatioY - expectedRatioY) < 1e-9, 'Y 비율이 완벽하게 동기화되어야 합니다.');
});

test('2. 기기 해상도가 극단적으로 변해도 4:3 레터박스 영역 내 좌표 대칭이 완벽한가 검증', () => {
  // 모바일 가로 모드 (넓음)
  const view1 = calculateCanvasStyles(800, 400);
  assert.ok(Math.abs((view1.width / view1.height) - (4 / 3)) < 1e-9, '가로 모드에서도 캔버스 비율은 4:3이어야 합니다.');
  assert.ok(view1.left > 0, '가로 여백(레터박스)이 존재해야 합니다.');

  // 모바일 세로 모드 (길쭉함)
  const view2 = calculateCanvasStyles(360, 640);
  assert.ok(Math.abs((view2.width / view2.height) - (4 / 3)) < 1e-9, '세로 모드에서도 캔버스 비율은 4:3이어야 합니다.');
  assert.ok(view2.top > 0, '세로 여백(레터박스)이 존재해야 합니다.');
});

test('3. 이 기종 디바이스(모바일 ➔ TV 호스트) 복원 좌표 정밀도 매핑 대조', () => {
  // 모바일 뷰포트 상태
  const mobileRect = { left: 10, top: 10, width: 300, height: 225 }; // 4:3
  
  // TV 호스트 뷰포트 상태 (1280x720 중 4:3을 차지하는 캔버스 영역 960x720)
  const hostCanvasWidth = 960;
  const hostCanvasHeight = 720;

  // 사용자가 모바일 캔버스 우하단 터치
  const touchX = 280;
  const touchY = 205;

  const { nx, ny } = normalizeCoords(touchX, touchY, mobileRect);

  // TV 호스트 측에서 드로잉 포인트 복구
  const hostLogical = denormalizeCoords(nx, ny, hostCanvasWidth, hostCanvasHeight);

  // 상대 위치 정합성 대조
  const mobileRelX = (touchX - mobileRect.left) / mobileRect.width;
  const mobileRelY = (touchY - mobileRect.top) / mobileRect.height;
  const hostRelX = hostLogical.x / hostCanvasWidth;
  const hostRelY = hostLogical.y / hostCanvasHeight;

  assert.strictEqual(mobileRelX, hostRelX, '이 기종 변환 후에도 X 상대비는 동일해야 합니다.');
  assert.strictEqual(mobileRelY, hostRelY, '이 기종 변환 후에도 Y 상대비는 동일해야 합니다.');
});
