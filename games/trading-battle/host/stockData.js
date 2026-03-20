/**
 * 천하제일단타대회 — 주식 데이터 생성기
 * 현실적인 랜덤 OHLCV 캔들 데이터를 생성합니다.
 */

export function generateStockData({ totalCandles = 300, startPrice = 50000 } = {}) {
  const candles = [];
  let price = startPrice;

  // 영업일(월~금) 커서 — 중복 날짜 방지
  const cursor = new Date('2023-01-02'); // 월요일 시작

  for (let i = 0; i < totalCandles; i++) {
    // 첫 번째 캔들은 cursor 그대로, 이후는 다음 영업일로 이동
    if (i > 0) {
      cursor.setDate(cursor.getDate() + 1);
      while (cursor.getDay() === 0 || cursor.getDay() === 6) {
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    const volatility = price * 0.025;
    const change = (Math.random() - 0.48) * volatility;
    const open = price;
    const close = Math.max(price * 0.5, price + change);
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    const volume = Math.floor(50000 + Math.random() * 200000);

    candles.push({
      time: cursor.toISOString().slice(0, 10),
      open: Math.round(open),
      high: Math.round(high),
      low: Math.round(Math.max(1, low)),
      close: Math.round(close),
      volume,
    });

    price = close;
  }
  return candles;
}

/** 주식 이름 목록 */
export const STOCK_NAMES = [
  '삼스전자', '엘지에너지', '현대모터', '카카오뱅크', '네이버Corp',
  '배달유니온', '쿠팡로지스', '토스뱅크', '크래프톤게임', '두산에너빌',
];

export function randomStockName() {
  return STOCK_NAMES[Math.floor(Math.random() * STOCK_NAMES.length)];
}
