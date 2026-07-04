/**
 * FXチャート自動生成
 * myfxbookのトレードデータ → 15M足チャート画像 → Google Driveアップロード → URL返却
 */
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createCanvas } from "canvas";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { createReadStream } from "fs";
import { google } from "googleapis";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const TD_KEY = process.env.TWELVE_DATA_API_KEY;
const DRIVE_FOLDER_NAME = "FXチャート記録";

// ── Google Drive クライアント ─────────────────────────
function getDriveClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth });
}

// ── チャート保存フォルダIDを取得（なければ作成） ────
let _folderId = null;
async function getOrCreateFolder(drive) {
  if (_folderId) return _folderId;
  const res = await drive.files.list({
    q: `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
  });
  if (res.data.files.length > 0) {
    _folderId = res.data.files[0].id;
    return _folderId;
  }
  const folder = await drive.files.create({
    requestBody: { name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" },
    fields: "id",
  });
  _folderId = folder.data.id;
  return _folderId;
}

// ── Twelve Data からローソク足取得 ─────────────────────
async function fetchCandles(symbol, startDate, count = 80) {
  let url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=15min&outputsize=${count}&apikey=${TD_KEY}&timezone=Asia/Tokyo`;
  if (startDate) url += `&start_date=${encodeURIComponent(startDate)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === "error") throw new Error(`Twelve Data: ${data.message}`);
  return (data.values || []).map(v => ({
    time: v.datetime,
    open:  parseFloat(v.open),
    high:  parseFloat(v.high),
    low:   parseFloat(v.low),
    close: parseFloat(v.close),
  })).reverse();
}

// ── myfxbook日時（UTC）→ JSTのISO文字列 ─────────────
function toJSTISO(myfxStr) {
  if (!myfxStr) return null;
  const [datePart, timePart] = myfxStr.split(" ");
  const [mm, dd, yyyy] = datePart.split("/");
  const utc = new Date(`${yyyy}-${mm}-${dd}T${timePart}:00Z`);
  const jst = new Date(utc.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d  = String(jst.getUTCDate()).padStart(2, "0");
  const h  = String(jst.getUTCHours()).padStart(2, "0");
  const mi = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}:00`;
}

// ── SMA計算 ────────────────────────────────────────────
function calcSMA(candles, period) {
  return candles.map((_, i) => {
    if (i < period - 1) return null;
    const sum = candles.slice(i - period + 1, i + 1).reduce((s, c) => s + c.close, 0);
    return sum / period;
  });
}

// ── バブルラベル描画 ───────────────────────────────────
function drawBubble(ctx, x, y, text, bgColor, direction = "up") {
  ctx.font = "bold 12px sans-serif";
  const tw = ctx.measureText(text).width;
  const bw = tw + 20, bh = 26, r = 6;
  const bx = x - bw / 2, by = direction === "up" ? y - bh - 14 : y + 14;

  // 丸角矩形
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bw - r, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
  ctx.lineTo(bx + r, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();
  ctx.fill();

  // 三角の矢印
  ctx.beginPath();
  if (direction === "up") {
    ctx.moveTo(x - 7, by + bh);
    ctx.lineTo(x + 7, by + bh);
    ctx.lineTo(x, by + bh + 10);
  } else {
    ctx.moveTo(x - 7, by);
    ctx.lineTo(x + 7, by);
    ctx.lineTo(x, by - 10);
  }
  ctx.closePath();
  ctx.fill();

  // テキスト
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText(text, x, by + bh / 2 + 4);
}

// ── ローソク足チャート描画 ─────────────────────────────
function drawChart(candles, trade) {
  const W = 1040, H = 560;
  const PAD = { top: 64, right: 100, bottom: 50, left: 80 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // 背景（TradingViewライク）
  ctx.fillStyle = "#131722";
  ctx.fillRect(0, 0, W, H);

  // SMA計算
  const sma25  = calcSMA(candles, 25);
  const sma75  = calcSMA(candles, 75);
  const sma200 = calcSMA(candles, 200);

  // 価格レンジ（SMAも含める）
  const prices = candles.flatMap(c => [c.high, c.low]);
  prices.push(trade.entry, trade.tp, trade.lc);
  [...sma25, ...sma75, ...sma200].forEach(v => v && prices.push(v));
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pad  = (maxP - minP) * 0.06;
  const lo   = minP - pad, hi = maxP + pad;
  const range = hi - lo;
  const toY = p => PAD.top + cH * (1 - (p - lo) / range);

  const step   = cW / candles.length;
  const candleW = Math.max(3, step * 0.6);

  // グリッド
  ctx.strokeStyle = "#2a2e39";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    const y = PAD.top + (cH / 6) * i;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
    const p = hi - (range / 6) * i;
    ctx.fillStyle = "#787b86";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(p.toFixed(3), PAD.left - 6, y + 4);
  }

  // TP・LC 塗りつぶし領域
  const entryY = toY(trade.entry);
  const tpY    = toY(trade.tp);
  const lcY    = toY(trade.lc);
  const isShort = trade.direction === "ショート";

  ctx.fillStyle = "#26a69a18";
  ctx.fillRect(PAD.left, Math.min(entryY, tpY), cW, Math.abs(entryY - tpY));
  ctx.fillStyle = "#ef535018";
  ctx.fillRect(PAD.left, Math.min(entryY, lcY), cW, Math.abs(entryY - lcY));

  // 水平ライン（破線）
  const hDash = (y, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
    ctx.setLineDash([]);
  };
  hDash(tpY,    "#26a69a");
  hDash(entryY, "#ffcc00");
  hDash(lcY,    "#ef5350");

  // SMAライン
  const drawSMA = (smaArr, color, lineW = 1.5) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.setLineDash([]);
    ctx.beginPath();
    let started = false;
    smaArr.forEach((v, i) => {
      if (v === null) return;
      const x = PAD.left + step * i + step / 2;
      const y = toY(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  drawSMA(sma200, "#e0e0e0", 1.2); // 白（細め）
  drawSMA(sma75,  "#4caf50", 1.5); // 緑
  drawSMA(sma25,  "#ef5350", 1.8); // 赤

  // ローソク足
  candles.forEach((c, i) => {
    const x = PAD.left + step * i + step / 2;
    const isUp = c.close >= c.open;
    const col = isUp ? "#26a69a" : "#ef5350";
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, toY(c.high)); ctx.lineTo(x, toY(c.low)); ctx.stroke();
    const bTop = toY(Math.max(c.open, c.close));
    const bH = Math.max(1, Math.abs(toY(c.open) - toY(c.close)));
    ctx.fillStyle = col;
    ctx.fillRect(x - candleW / 2, bTop, candleW, bH);
  });

  // エントリー・決済マーカー（バブルラベル）
  const findNearest = (isoStr) => {
    if (!isoStr) return -1;
    const target = new Date(isoStr).getTime();
    let idx = -1, minD = Infinity;
    candles.forEach((c, i) => {
      const d = Math.abs(new Date(c.time).getTime() - target);
      if (d < minD) { minD = d; idx = i; }
    });
    return idx;
  };

  const entryIdx = findNearest(trade.openJSTISO);
  const closeIdx = findNearest(trade.closeJSTISO);

  if (entryIdx >= 0) {
    const c = candles[entryIdx];
    const x = PAD.left + step * entryIdx + step / 2;
    const label = `${trade.entry.toFixed(3)} IN(${isShort ? "S" : "L"})`;
    if (isShort) {
      drawBubble(ctx, x, toY(c.high), label, "#e53935", "up");
    } else {
      drawBubble(ctx, x, toY(c.low), label, "#e53935", "down");
    }
  }

  if (closeIdx >= 0) {
    const c = candles[closeIdx];
    const x = PAD.left + step * closeIdx + step / 2;
    const resultColor = trade.result === "勝ち" ? "#26a69a" : "#ef5350";
    const label = `${trade.result === "勝ち" ? "✓" : "✗"} OUT ${parseFloat(trade.pips || 0) >= 0 ? "+" : ""}${parseFloat(trade.pips || 0).toFixed(1)}p`;
    if (isShort) {
      drawBubble(ctx, x, toY(c.low), label, resultColor, "down");
    } else {
      drawBubble(ctx, x, toY(c.high), label, resultColor, "up");
    }
  }

  // 右端ラベル
  const rLabel = (y, color, text) => {
    ctx.fillStyle = color;
    ctx.fillRect(W - PAD.right + 4, y - 10, PAD.right - 4, 20);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(text, W - PAD.right + 8, y + 4);
  };
  rLabel(tpY,    "#26a69a", `TP ${trade.tp.toFixed(3)}`);
  rLabel(entryY, "#ffcc00", `IN ${trade.entry.toFixed(3)}`);
  rLabel(lcY,    "#ef5350", `LC ${trade.lc.toFixed(3)}`);

  // SMA凡例（右下）
  const legend = [
    { label: "SMA25", color: "#ef5350" },
    { label: "SMA75", color: "#4caf50" },
    { label: "SMA200", color: "#e0e0e0" },
  ];
  legend.forEach((l, i) => {
    const lx = W - PAD.right - 230 + i * 78;
    const ly = H - 14;
    ctx.fillStyle = l.color;
    ctx.fillRect(lx, ly - 7, 18, 3);
    ctx.font = "10px sans-serif";
    ctx.fillStyle = l.color;
    ctx.textAlign = "left";
    ctx.fillText(l.label, lx + 22, ly);
  });

  // タイトル
  const dir = isShort ? "SHORT" : "LONG";
  const resultTxt = trade.result === "勝ち" ? " ✓WIN" : trade.result === "負け" ? " ✗LOSE" : "";
  const rrTxt = trade.rr ? `  RR${trade.rr}` : "";
  ctx.fillStyle = "#d1d4dc";
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${trade.symbol}  15min  ${dir}${resultTxt}${rrTxt}`, PAD.left, 32);
  ctx.fillStyle = "#787b86";
  ctx.font = "12px sans-serif";
  ctx.fillText(`IN: ${trade.openDateTime}  →  OUT: ${trade.closeDateTime}`, PAD.left, 50);

  return canvas.toBuffer("image/png");
}

// ── Google Drive にアップロードして公開URL返却 ─────────
async function uploadToDrive(drive, buffer, filename) {
  const folderId = await getOrCreateFolder(drive);

  // 一時ファイルに書き出し
  const tmpDir = join(__dirname, "../../logs/charts");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const tmpPath = join(tmpDir, filename);
  writeFileSync(tmpPath, buffer);

  // Driveにアップロード
  const file = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: "image/png", body: createReadStream(tmpPath) },
    fields: "id",
  });
  const fileId = file.data.id;

  // 公開設定（リンクを知っている全員が閲覧可）
  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  // ローカルの一時ファイルを削除
  unlinkSync(tmpPath);

  // シートの =IMAGE() で使える直接URLを返す
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

// ── メイン：トレードデータからチャートを生成してURL返却 ─
export async function generateChart(trade) {
  if (!TD_KEY) return null;

  try {
    // エントリー2時間前からデータ取得
    const entryJST = toJSTISO(trade.openTime);
    const closeJST = toJSTISO(trade.closeTime);
    if (!entryJST) return null;

    const startDt = new Date(entryJST);
    startDt.setHours(startDt.getHours() - 2);
    const startDate = startDt.toISOString().replace("T", " ").slice(0, 16);

    // myfxbook形式（USDJPY）→ Twelve Data形式（USD/JPY）に変換
    const rawSymbol = (trade.symbol || "").replace(/\./g, "").toUpperCase();
    const symbol = rawSymbol.length === 6
      ? `${rawSymbol.slice(0, 3)}/${rawSymbol.slice(3)}`
      : rawSymbol === "XAUUSD" ? "XAU/USD" : rawSymbol;
    const candles = await fetchCandles(symbol, startDate, 80);
    if (candles.length === 0) return null;

    const entry = parseFloat(trade.openPrice || 0);
    const tp    = parseFloat(trade.tp || 0);
    const lc    = parseFloat(trade.sl || 0);
    if (entry === 0) return null;

    const direction = trade.action === "Buy" ? "ロング" : "ショート";
    const pips = parseFloat(trade.pips || 0);
    const result = pips > 0 ? "勝ち" : pips < 0 ? "負け" : "BE";

    // JST表示用
    const fmtJST = (iso) => iso ? iso.replace("T", " ").slice(0, 16).replace(/-/g, "/") : "";

    const buffer = drawChart(candles, {
      symbol, direction, entry, tp, lc, result,
      openDateTime:  fmtJST(entryJST),
      closeDateTime: fmtJST(closeJST),
      openJSTISO:  entryJST,
      closeJSTISO: closeJST,
      rr: tp > 0 && lc > 0 ? `1:${(Math.abs(tp - entry) / Math.abs(lc - entry)).toFixed(1)}` : "",
    });

    const drive = getDriveClient();
    const safeSymbol = symbol.replace(/\//g, "_");
    const filename = `${safeSymbol}_${entryJST.slice(0, 16).replace(/[-:T]/g, "")}.png`;
    const url = await uploadToDrive(drive, buffer, filename);
    console.log(`📈 チャート生成: ${symbol} → ${url}`);
    return url;
  } catch (e) {
    console.error(`チャート生成失敗: ${e.message}`);
    return null;
  }
}
