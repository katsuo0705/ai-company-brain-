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

// ── ローソク足チャート描画 ─────────────────────────────
function drawChart(candles, trade) {
  const W = 960, H = 540;
  const PAD = { top: 60, right: 130, bottom: 50, left: 75 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // 背景
  ctx.fillStyle = "#131722";
  ctx.fillRect(0, 0, W, H);

  // 価格レンジ
  const prices = candles.flatMap(c => [c.high, c.low]);
  prices.push(trade.entry, trade.tp, trade.lc);
  const minP = Math.min(...prices) * 0.9998;
  const maxP = Math.max(...prices) * 1.0002;
  const range = maxP - minP;
  const toY = p => PAD.top + cH * (1 - (p - minP) / range);

  const candleW = Math.max(4, Math.floor(cW / candles.length) - 2);

  // グリッド
  ctx.strokeStyle = "#2a2e39";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    const y = PAD.top + (cH / 6) * i;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
    const p = maxP - (range / 6) * i;
    ctx.fillStyle = "#787b86";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(p.toFixed(3), PAD.left - 6, y + 4);
  }

  // ローソク足
  candles.forEach((c, i) => {
    const x = PAD.left + (cW / candles.length) * i + candleW / 2;
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

  // TP・LC 塗りつぶし領域
  const entryY = toY(trade.entry);
  const tpY    = toY(trade.tp);
  const lcY    = toY(trade.lc);
  ctx.fillStyle = "#26a69a22";
  ctx.fillRect(PAD.left, Math.min(entryY, tpY), cW, Math.abs(entryY - tpY));
  ctx.fillStyle = "#ef535022";
  ctx.fillRect(PAD.left, Math.min(entryY, lcY), cW, Math.abs(entryY - lcY));

  // 水平ライン
  const hLine = (y, color, label, price) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right + 10, y); ctx.stroke();
    ctx.setLineDash([]);
    const lw = 118;
    ctx.fillStyle = color;
    ctx.fillRect(W - PAD.right + 12, y - 10, lw, 20);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${label}: ${price.toFixed(3)}`, W - PAD.right + 16, y + 4);
  };
  hLine(tpY,    "#26a69a", "TP",        trade.tp);
  hLine(entryY, "#ffcc00", "エントリー", trade.entry);
  hLine(lcY,    "#ef5350", "LC",         trade.lc);

  // エントリー・決済マーカー
  const isShort = trade.direction === "ショート";
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

  const drawMarker = (candleIdx, isEntry) => {
    if (candleIdx < 0) return;
    const c = candles[candleIdx];
    const x = PAD.left + (cW / candles.length) * candleIdx + candleW / 2;
    ctx.textAlign = "center";

    if (isEntry) {
      // エントリー：ショートは▼上から、ロングは▲下から
      const arrowY = isShort ? toY(c.high) - 28 : toY(c.low) + 10;
      const labelY = isShort ? arrowY - 4 : arrowY + 22;
      ctx.fillStyle = "#ffcc00";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText(isShort ? "▼" : "▲", x, arrowY);
      ctx.font = "bold 10px sans-serif";
      ctx.fillStyle = "#ffcc00";
      ctx.fillText("IN", x, labelY);
    } else {
      // 決済：ショートは▲下から、ロングは▼上から
      const arrowY = isShort ? toY(c.low) + 10 : toY(c.high) - 28;
      const labelY = isShort ? arrowY + 22 : arrowY - 4;
      ctx.fillStyle = "#26a69a";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText(isShort ? "▲" : "▼", x, arrowY);
      ctx.font = "bold 10px sans-serif";
      ctx.fillStyle = "#26a69a";
      ctx.fillText("OUT", x, labelY);
    }
  };

  drawMarker(findNearest(trade.openJSTISO),  true);
  drawMarker(findNearest(trade.closeJSTISO), false);

  // タイトル
  const dir = isShort ? "🔴 ショート" : "🟢 ロング";
  const result = trade.result === "勝ち" ? "✅ 勝ち" : trade.result === "負け" ? "❌ 負け" : "";
  ctx.fillStyle = "#d1d4dc";
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${trade.symbol}  15分足  ${dir}  IN:${trade.openDateTime}  OUT:${trade.closeDateTime}`, PAD.left, 32);
  ctx.fillStyle = "#787b86";
  ctx.font = "12px sans-serif";
  const rr = trade.rr ? `RR ${trade.rr}` : "";
  ctx.fillText(`${rr}  ${result}`, PAD.left, H - 18);

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
