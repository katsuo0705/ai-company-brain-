/**
 * FXエントリーシグナル検知
 * 4H・1H・15M の3軸でトレンドを確認し、ネックラインブレイクをLINEに通知
 * Twelve Data API（無料枠：800クレジット/日）使用
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OWNER_ID = process.env.LINE_OWNER_USER_ID;
const TD_KEY = process.env.TWELVE_DATA_API_KEY;

// 監視ペアのローテーション（15分ごとに1ペアずつ → 30分で全ペアを1周）
// :00→USD/JPY :15→EUR/JPY :30→GBP/JPY :45→USD/JPY ...
const PAIR_ROTATION = ["USD/JPY", "EUR/JPY", "GBP/JPY"];

// pip単位（JPYクロスは0.01、その他は0.0001）
function pipSize(pair) {
  return pair.includes("JPY") ? 0.01 : 0.0001;
}

// ── LINE送信 ──────────────────────────────────────────
async function sendLine(text) {
  if (!OWNER_ID || !LINE_TOKEN) {
    console.log("[LINE未設定] " + text);
    return;
  }
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: OWNER_ID, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) throw new Error(await res.text());
  console.log(`LINE送信完了: ${text.slice(0, 30)}...`);
}

// ── Twelve Data からローソク足取得 ─────────────────────
async function fetchCandles(pair, interval, count = 30) {
  const symbol = encodeURIComponent(pair);
  const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=${count}&apikey=${TD_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === "error") throw new Error(`${pair}(${interval}) 取得失敗: ${data.message}`);

  // 古い順に並び替えて返す（最後の要素が最新の確定足）
  return (data.values || [])
    .map((v) => ({
      time: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    }))
    .reverse();
}

// ── スイングハイ・スイングロー検出 ────────────────────
function findSwings(candles, lookback = 3) {
  const highs = [];
  const lows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const win = candles.slice(i - lookback, i + lookback + 1);
    if (candles[i].high === Math.max(...win.map((c) => c.high))) {
      highs.push({ i, price: candles[i].high, time: candles[i].time });
    }
    if (candles[i].low === Math.min(...win.map((c) => c.low))) {
      lows.push({ i, price: candles[i].low, time: candles[i].time });
    }
  }
  return { highs, lows };
}

// ── トレンド判定（高値・安値の切り上げ/切り下げ） ────
function detectTrend(candles, lookback = 3) {
  const { highs, lows } = findSwings(candles, lookback);
  if (highs.length < 2 || lows.length < 2) return "不明";
  const h = highs.slice(-2);
  const l = lows.slice(-2);
  const higherHighs = h[1].price > h[0].price;
  const higherLows = l[1].price > l[0].price;
  const lowerHighs = h[1].price < h[0].price;
  const lowerLows = l[1].price < l[0].price;
  if (higherHighs && higherLows) return "上昇";
  if (lowerHighs && lowerLows) return "下降";
  return "レンジ";
}

// ── エントリーシグナル検出 ────────────────────────────
function detectSignal(candles15M, trend1H, trend4H, pip) {
  if (trend1H === "レンジ" || trend1H === "不明") return null;

  const { highs, lows } = findSwings(candles15M, 2);
  const last = candles15M[candles15M.length - 1]; // 最新の確定足
  const prev = candles15M[candles15M.length - 2];

  if (trend1H === "上昇") {
    if (highs.length < 1 || lows.length < 1) return null;
    const neckline = highs[highs.length - 1].price;
    // 前の確定足がネックライン以下で、最新足が終値でブレイク
    if (prev.close <= neckline && last.close > neckline) {
      const swingLow = lows[lows.length - 1].price;
      const prevSwingHigh = highs.length >= 2 ? highs[highs.length - 2].price : neckline;
      const prevSwingLow = lows.length >= 2 ? lows[lows.length - 2].price : swingLow;

      const tp_e = neckline + (neckline - swingLow);          // E値
      const tp_n = swingLow + (prevSwingHigh - prevSwingLow); // N値
      const lc = swingLow - pip * 3;                          // 直近安値 -3pips
      const entry = last.close;
      const rr = (tp_e - entry) / (entry - lc);

      return { direction: "ロング", entry, tp_e, tp_n, lc, neckline, rr, trend4H, trend1H };
    }
  }

  if (trend1H === "下降") {
    if (lows.length < 1 || highs.length < 1) return null;
    const neckline = lows[lows.length - 1].price;
    if (prev.close >= neckline && last.close < neckline) {
      const swingHigh = highs[highs.length - 1].price;
      const prevSwingLow = lows.length >= 2 ? lows[lows.length - 2].price : neckline;
      const prevSwingHigh = highs.length >= 2 ? highs[highs.length - 2].price : swingHigh;

      const tp_e = neckline - (swingHigh - neckline);
      const tp_n = swingHigh - (prevSwingHigh - prevSwingLow);
      const lc = swingHigh + pip * 3;
      const entry = last.close;
      const rr = (entry - tp_e) / (lc - entry);

      return { direction: "ショート", entry, tp_e, tp_n, lc, neckline, rr, trend4H, trend1H };
    }
  }

  return null;
}

// ── シグナルキャッシュに保存（精度の自動入力用） ──────
const CACHE_PATH = join(__dirname, "../../logs/signal-cache.json");

function saveSignalCache(pair, signal, axisCount) {
  let cache = [];
  if (existsSync(CACHE_PATH)) {
    try { cache = JSON.parse(readFileSync(CACHE_PATH, "utf-8")); } catch {}
  }
  // 7日以上前のキャッシュを削除
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  cache = cache.filter(c => new Date(c.time).getTime() > cutoff);

  cache.push({
    pair: pair.replace("/", ""),  // "USD/JPY" → "USDJPY"
    time: new Date().toISOString(),
    axes: axisCount,
    direction: signal.direction,
  });
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  console.log(`[シグナルキャッシュ保存] ${pair} ${axisCount}軸`);
}

// ── LINE通知メッセージ生成 ────────────────────────────
function buildMessage(pair, sig) {
  const isLong = sig.direction === "ロング";
  const trendMatch = (t) =>
    (isLong && t === "上昇") || (!isLong && t === "下降");

  const axisCount = [sig.trend4H, sig.trend1H].filter(trendMatch).length + 1; // +1 は15M確定
  const precision = axisCount >= 3 ? "🔥 高（3軸一致）" : "⚠️ 普通（2軸一致）";
  const dir = isLong ? "🟢" : "🔴";
  const rrOk = sig.rr >= 2 ? "✅" : "⚡";

  const fmt = (n, d = 3) => n.toFixed(d);

  return `📊 エントリーシグナル検知！

通貨ペア：${pair}
方向：${sig.direction} ${dir}
エントリー：${fmt(sig.entry)}
TP：${fmt(sig.tp_e)}（E値）
　　${fmt(sig.tp_n)}（N値）
LC：${fmt(sig.lc)}
RR比：1:${sig.rr.toFixed(1)} ${rrOk}

【根拠】
4H：${trendMatch(sig.trend4H) ? "✅" : "⚠️"} ${sig.trend4H}トレンド
1H：${trendMatch(sig.trend1H) ? "✅" : "⚠️"} ${sig.trend1H}トレンド
15M：✅ ネックライン${fmt(sig.neckline)} 終値ブレイク

精度：${precision}`;
}

// ── メイン（pair省略時は現在時刻でローテーション自動選択） ──
export async function main(targetPair) {
  if (!TD_KEY) {
    console.log("TWELVE_DATA_API_KEY が未設定です（.env に追加してください）");
    return;
  }

  // 引数がなければ現在のJST分から自動選択
  if (!targetPair) {
    const jstMin = new Date().getUTCMinutes();
    const slot = Math.floor(jstMin / 15) % PAIR_ROTATION.length;
    targetPair = PAIR_ROTATION[slot];
  }

  for (const pair of [targetPair]) {
    try {
      // 3つの時間軸を取得（無料枠8req/分を超えないよう1秒間隔）
      const candles15M = await fetchCandles(pair, "15min", 40);
      await new Promise((r) => setTimeout(r, 1200));
      const candles1H = await fetchCandles(pair, "1h", 40);
      await new Promise((r) => setTimeout(r, 1200));
      const candles4H = await fetchCandles(pair, "4h", 20);
      await new Promise((r) => setTimeout(r, 1200));

      const trend4H = detectTrend(candles4H, 2);
      const trend1H = detectTrend(candles1H, 2);

      console.log(`[${pair}] 4H:${trend4H} 1H:${trend1H}`);

      const pip = pipSize(pair);
      const signal = detectSignal(candles15M, trend1H, trend4H, pip);

      if (!signal) {
        console.log(`[${pair}] シグナルなし`);
        continue;
      }
      if (signal.rr < 1.5) {
        console.log(`[${pair}] RR不足 (${signal.rr.toFixed(1)}) → 通知スキップ`);
        continue;
      }

      const msg = buildMessage(pair, signal);
      await sendLine(msg);

      // 精度の自動入力用にシグナルをキャッシュ保存
      const isLong = signal.direction === "ロング";
      const trendMatch = (t) => (isLong && t === "上昇") || (!isLong && t === "下降");
      const axisCount = [signal.trend4H, signal.trend1H].filter(trendMatch).length + 1;
      saveSignalCache(pair, signal, axisCount);
    } catch (e) {
      console.error(`[${pair}] エラー:`, e.message);
    }
  }
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(console.error);
