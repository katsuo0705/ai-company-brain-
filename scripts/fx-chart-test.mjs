/**
 * チャート画像生成テスト（7月トレード用）
 */
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { createCanvas } from "canvas";
import { writeFileSync } from "fs";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const TD_KEY = process.env.TWELVE_DATA_API_KEY;

// ── Twelve Data からローソク足取得 ─────────────────────
async function fetchCandles(symbol, interval, startDate, count = 80) {
  let url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${count}&apikey=${TD_KEY}&timezone=Asia/Tokyo`;
  if (startDate) url += `&start_date=${encodeURIComponent(startDate)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === "error") throw new Error(data.message);
  return (data.values || []).map(v => ({
    time: v.datetime,
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
  })).reverse();
}

// ── ローソク足チャート描画 ─────────────────────────────
function drawChart(candles, trade, outputPath) {
  const W = 960, H = 540;
  const PADDING = { top: 60, right: 120, bottom: 60, left: 80 };
  const chartW = W - PADDING.left - PADDING.right;
  const chartH = H - PADDING.top - PADDING.bottom;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // 背景
  ctx.fillStyle = "#131722";
  ctx.fillRect(0, 0, W, H);

  // 価格レンジ（エントリー・TP・LCを含む）
  const prices = candles.flatMap(c => [c.high, c.low]);
  prices.push(trade.entry, trade.tp, trade.lc);
  const minP = Math.min(...prices) - 0.05;
  const maxP = Math.max(...prices) + 0.05;
  const priceRange = maxP - minP;

  const toY = (price) => PADDING.top + chartH * (1 - (price - minP) / priceRange);
  const candleW = Math.max(4, Math.floor(chartW / candles.length) - 2);

  // グリッド線
  ctx.strokeStyle = "#2a2e39";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = PADDING.top + (chartH / 5) * i;
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y);
    ctx.lineTo(W - PADDING.right, y);
    ctx.stroke();

    const price = maxP - (priceRange / 5) * i;
    ctx.fillStyle = "#787b86";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(price.toFixed(3), PADDING.left - 6, y + 4);
  }

  // ローソク足
  candles.forEach((c, i) => {
    const x = PADDING.left + (chartW / candles.length) * i + candleW / 2;
    const isUp = c.close >= c.open;
    const color = isUp ? "#26a69a" : "#ef5350";

    // ヒゲ
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, toY(c.high));
    ctx.lineTo(x, toY(c.low));
    ctx.stroke();

    // 実体
    const bodyTop = toY(Math.max(c.open, c.close));
    const bodyH = Math.max(1, Math.abs(toY(c.open) - toY(c.close)));
    ctx.fillStyle = color;
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
  });

  // エントリーライン
  const isShort = trade.direction === "ショート";
  const entryY = toY(trade.entry);
  const tpY = toY(trade.tp);
  const lcY = toY(trade.lc);

  const drawHLine = (y, color, label, price) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(PADDING.left, y);
    ctx.lineTo(W - PADDING.right + 10, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // ラベル背景
    const labelW = 110;
    ctx.fillStyle = color;
    ctx.fillRect(W - PADDING.right + 12, y - 10, labelW, 20);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${label}: ${price.toFixed(3)}`, W - PADDING.right + 16, y + 4);
  };

  // TP塗りつぶし（エントリー〜TP）
  const tpColor = isShort ? "#26a69a33" : "#26a69a33";
  const lcColor = "#ef535033";
  ctx.fillStyle = tpColor;
  ctx.fillRect(PADDING.left, Math.min(entryY, tpY), chartW, Math.abs(entryY - tpY));
  ctx.fillStyle = lcColor;
  ctx.fillRect(PADDING.left, Math.min(entryY, lcY), chartW, Math.abs(entryY - lcY));

  drawHLine(tpY,    "#26a69a", "TP", trade.tp);
  drawHLine(entryY, "#ffcc00", "エントリー", trade.entry);
  drawHLine(lcY,    "#ef5350", "LC", trade.lc);

  // エントリー・決済マーカー（▼▲）
  const drawMarker = (candleIndex, type, color) => {
    if (candleIndex < 0) return;
    const c = candles[candleIndex];
    const x = PADDING.left + (chartW / candles.length) * candleIndex + candleW / 2;
    const isEntry = type === "entry";

    ctx.fillStyle = color;
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";

    if (isShort) {
      // ショート：エントリー▼（上から）、決済▲（下から）
      if (isEntry) {
        const y = toY(c.high) - 22;
        ctx.fillText("▼", x, y);
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "#fff";
        ctx.fillText("エントリー", x, y - 6);
      } else {
        const y = toY(c.low) + 22;
        ctx.fillText("▲", x, y);
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "#fff";
        ctx.fillText("決済", x, y + 14);
      }
    } else {
      // ロング：エントリー▲（下から）、決済▼（上から）
      if (isEntry) {
        const y = toY(c.low) + 22;
        ctx.fillText("▲", x, y);
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "#fff";
        ctx.fillText("エントリー", x, y + 14);
      } else {
        const y = toY(c.high) - 22;
        ctx.fillText("▼", x, y);
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "#fff";
        ctx.fillText("決済", x, y - 6);
      }
    }
  };

  // エントリー時刻・決済時刻と最も近いローソク足を探す
  const findNearestCandle = (datetimeStr) => {
    if (!datetimeStr) return -1;
    const target = new Date(datetimeStr.replace(/\//g, "-")).getTime();
    let nearest = -1, minDiff = Infinity;
    candles.forEach((c, i) => {
      const t = new Date(c.time).getTime();
      const diff = Math.abs(t - target);
      if (diff < minDiff) { minDiff = diff; nearest = i; }
    });
    return nearest;
  };

  const entryIdx = findNearestCandle(trade.openDateTimeISO);
  const closeIdx = findNearestCandle(trade.closeDateTimeISO);
  drawMarker(entryIdx, "entry", "#ffcc00");
  drawMarker(closeIdx, "close", "#26a69a");

  // タイトル
  const dir = isShort ? "🔴 ショート" : "🟢 ロング";
  ctx.fillStyle = "#d1d4dc";
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${trade.symbol}  15分足  ${dir}  ${trade.openDateTime}`, PADDING.left, 30);

  // RR・結果
  const rr = trade.rr ? `RR 1:${trade.rr}` : "";
  const result = trade.result ? `  ${trade.result === "勝ち" ? "✅ 勝ち" : "❌ 負け"}` : "";
  ctx.fillStyle = "#787b86";
  ctx.font = "12px sans-serif";
  ctx.fillText(`${rr}${result}`, PADDING.left, H - 20);

  writeFileSync(outputPath, canvas.toBuffer("image/png"));
}

// ── メイン ────────────────────────────────────────────
export async function main() {
  // 7月のトレード（myfxbook UTC→JST変換済み）
  // openTime: "07/02/2026 09:47" UTC → JST 18:47
  // closeTime: "07/02/2026 11:48" UTC → JST 20:48
  const trade = {
    symbol: "USD/JPY",
    direction: "ショート",
    openDateTime: "2026/07/02 18:47",
    closeDateTime: "2026/07/02 20:48",
    openDateTimeISO:  "2026-07-02T18:47:00",
    closeDateTimeISO: "2026-07-02T20:48:00",
    entry: 162.092,
    tp: 161.000,
    lc: 161.960,
    rr: "1.1",
    result: "勝ち",
  };

  // エントリー1時間前からデータ取得（前後の足も含める）
  const startDate = "2026-07-02 15:00:00";
  console.log("📊 15分足データを取得中（実際のトレード時間帯）...");
  const candles = await fetchCandles("USD/JPY", "15min", startDate, 80);

  if (candles.length === 0) throw new Error("ローソク足データが取得できません");

  const outputPath = join(__dirname, "../../logs/chart-sample.png");
  drawChart(candles, trade, outputPath);

  console.log(`✅ チャート生成完了: ${outputPath}`);
  execSync(`open "${outputPath}"`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(console.error);
