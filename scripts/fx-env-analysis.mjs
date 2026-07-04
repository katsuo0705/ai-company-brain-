/**
 * 毎日16:00 環境認識レポート
 * 3ペアの朝の動き・4H/1Hトレンド・注目レベル・本日方針をLINEに送信
 */
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OWNER_ID   = process.env.LINE_OWNER_USER_ID;
const TD_KEY     = process.env.TWELVE_DATA_API_KEY;

const PAIRS = ["USD/JPY", "EUR/USD", "XAU/USD"];

function pipSize(pair) {
  if (pair.includes("JPY")) return 0.01;
  if (pair === "XAU/USD") return 0.1;
  return 0.0001;
}

async function sendLine(text) {
  if (!OWNER_ID || !LINE_TOKEN) { console.log(text); return; }
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: OWNER_ID, messages: [{ type: "text", text }] }),
  });
}

async function fetchCandles(pair, interval, count = 30) {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(pair)}&interval=${interval}&outputsize=${count}&apikey=${TD_KEY}&timezone=Asia/Tokyo`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.status === "error") throw new Error(`Twelve Data: ${data.message}`);
  return (data.values || []).map(v => ({
    time:  v.datetime,
    open:  parseFloat(v.open),
    high:  parseFloat(v.high),
    low:   parseFloat(v.low),
    close: parseFloat(v.close),
  })).reverse();
}

// SMA計算
function calcSMA(candles, period) {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  return slice.reduce((s, c) => s + c.close, 0) / period;
}

// ATR計算（直近N本の真の値幅の平均）
function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = candles.slice(-period - 1).map((c, i, arr) => {
    if (i === 0) return c.high - c.low;
    const prev = arr[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  }).slice(1);
  return trs.reduce((s, v) => s + v, 0) / period;
}

// RSI計算（直近N本）
function calcRSI(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const closes = candles.slice(-period - 1).map(c => c.close);
  let gains = 0, losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// 前日高値・安値（日足の1本前）
function prevDayLevels(candlesDaily) {
  if (candlesDaily.length < 2) return null;
  const prev = candlesDaily[candlesDaily.length - 2];
  return { high: prev.high, low: prev.low };
}

// トレンド判定（高値・安値の切り上げ/切り下げ）
function detectTrend(candles, lookback = 3) {
  if (candles.length < lookback * 2) return "不明";
  const recent = candles.slice(-lookback);
  const prev   = candles.slice(-lookback * 2, -lookback);
  const recentHigh = Math.max(...recent.map(c => c.high));
  const recentLow  = Math.min(...recent.map(c => c.low));
  const prevHigh   = Math.max(...prev.map(c => c.high));
  const prevLow    = Math.min(...prev.map(c => c.low));
  if (recentHigh > prevHigh && recentLow > prevLow) return "上昇";
  if (recentHigh < prevHigh && recentLow < prevLow) return "下降";
  return "レンジ";
}

// 朝の動き（JST 0:00〜現在の高値・安値・値幅・方向）
function analyzeMorning(candles1H) {
  // 直近8本（=8時間分）をアジア時間の目安として使用
  const morning = candles1H.slice(-8);
  if (morning.length === 0) return null;
  const high  = Math.max(...morning.map(c => c.high));
  const low   = Math.min(...morning.map(c => c.low));
  const open  = morning[0].open;
  const close = morning[morning.length - 1].close;
  const diff  = close - open;
  return { high, low, open, close, diff };
}

// 注目レベル（直近の高値・安値）
function keyLevels(candles4H) {
  const recent = candles4H.slice(-10);
  const high   = Math.max(...recent.map(c => c.high));
  const low    = Math.min(...recent.map(c => c.low));
  return { high, low };
}

async function analyzePair(pair) {
  const pip = pipSize(pair);
  const dec = pair === "XAU/USD" ? 2 : pair.includes("JPY") ? 3 : 5;
  const fmt = n => n.toFixed(dec);

  const candles1H    = await fetchCandles(pair, "1h",   210);
  await new Promise(r => setTimeout(r, 1500));
  const candles4H    = await fetchCandles(pair, "4h",   210);
  await new Promise(r => setTimeout(r, 1500));
  const candlesDaily = await fetchCandles(pair, "1day", 210);

  const trend4H  = detectTrend(candles4H.slice(-20), 2);
  const trend1H  = detectTrend(candles1H.slice(-24), 3);
  const morning  = analyzeMorning(candles1H.slice(-24));
  const levels   = keyLevels(candles4H.slice(-10));

  const currentPrice = candles1H[candles1H.length - 1]?.close;

  // 前日高値・安値
  const prevDay = prevDayLevels(candlesDaily);

  // ATR（4H・14本）→ pips換算
  const atr4H     = calcATR(candles4H, 14);
  const atrPips   = atr4H ? Math.round(atr4H / pip) : null;
  const atrLevel  = atrPips
    ? atrPips >= 80 ? "高め⚡" : atrPips <= 30 ? "低め😴" : "普通"
    : "-";

  // RSI（4H・14本）
  const rsi4H    = calcRSI(candles4H, 14);
  const rsiText  = rsi4H
    ? `${rsi4H.toFixed(0)}${rsi4H >= 70 ? " 買われすぎ⚠️" : rsi4H <= 30 ? " 売られすぎ⚠️" : ""}`
    : "-";

  // 各時間足・各期間のSMAを計算
  const smaMap = {
    "1H":   { 25: calcSMA(candles1H, 25),    75: calcSMA(candles1H, 75),    200: calcSMA(candles1H, 200)    },
    "4H":   { 25: calcSMA(candles4H, 25),    75: calcSMA(candles4H, 75),    200: calcSMA(candles4H, 200)    },
    "日足": { 25: calcSMA(candlesDaily, 25), 75: calcSMA(candlesDaily, 75), 200: calcSMA(candlesDaily, 200) },
  };

  // 「意識されているMA」を判定：現在値との乖離が小さいものを抽出
  // 閾値：JPY=20pips, XAU=2.0, その他=0.0020
  const threshold = pair.includes("JPY") ? 20 * pip : pair === "XAU/USD" ? 2.0 : 20 * pip;

  const consciousLines = [];
  for (const [tf, smas] of Object.entries(smaMap)) {
    for (const [period, sma] of Object.entries(smas)) {
      if (!sma || !currentPrice) continue;
      const dist = Math.abs(currentPrice - sma);
      if (dist <= threshold) {
        const above = currentPrice > sma;
        // MAに沿ったトレンド方向を判定（直近3本のMAの傾き）
        const tfCandles = tf === "1H" ? candles1H : tf === "4H" ? candles4H : candlesDaily;
        const p = parseInt(period);
        const smaRecent = calcSMA(tfCandles.slice(0, -1), p);
        const rising = sma > smaRecent;
        const slopeStr = rising ? "上昇中" : "下落中";
        const posStr   = above ? "の上で推移" : "の下で推移";
        consciousLines.push(`　${tf} ${period}MA（${slopeStr}）${posStr} 📌`);
      }
    }
  }

  const smaText = consciousLines.length > 0
    ? consciousLines.join("\n")
    : "　現在、近接MAなし（各MAから乖離中）";

  // 方針：4H・1H・朝の動き の多数決
  const bullish = [trend4H, trend1H].filter(t => t === "上昇").length;
  const bearish = [trend4H, trend1H].filter(t => t === "下降").length;
  const morningBias = morning && morning.diff > 0 ? "上昇" : morning && morning.diff < 0 ? "下降" : "レンジ";

  let policy = "様子見";
  const totalBull = bullish + (morningBias === "上昇" ? 1 : 0);
  const totalBear = bearish + (morningBias === "下降" ? 1 : 0);
  if (totalBull >= 2) policy = "ロング狙い 🟢";
  else if (totalBear >= 2) policy = "ショート狙い 🔴";

  // 朝の動き文
  let morningText = "データなし";
  if (morning) {
    const pipDiff = Math.abs(morning.diff) / pip;
    const dir = morning.diff > 0 ? "上昇" : morning.diff < 0 ? "下落" : "横ばい";
    morningText = `${fmt(morning.open)}→${fmt(morning.close)}（${pipDiff.toFixed(0)}pips ${dir}）`;
  }

  const t4 = trend4H === "上昇" ? "↑" : trend4H === "下降" ? "↓" : "→";
  const t1 = trend1H === "上昇" ? "↑" : trend1H === "下降" ? "↓" : "→";

  const prevDayText = prevDay
    ? `前日高値：${fmt(prevDay.high)}　前日安値：${fmt(prevDay.low)}`
    : "前日データなし";

  return [
    `【${pair}】`,
    `4H：${trend4H} ${t4}　1H：${trend1H} ${t1}`,
    `朝の動き：${morningText}`,
    `→ 本日方針：${policy}`,
    `${prevDayText}`,
    `ATR(4H)：${atrPips ? atrPips + "pips " : ""}${atrLevel}（値幅目安）　RSI(4H)：${rsiText}（30↓売られすぎ・70↑買われすぎ）`,
    `移動平均（意識されているMA）`,
    smaText,
  ].join("\n");
}

export async function main() {
  if (!TD_KEY) { console.log("TWELVE_DATA_API_KEY未設定"); return; }

  try {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const dateStr = `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;

    const results = [];
    for (const pair of PAIRS) {
      try {
        const analysis = await analyzePair(pair);
        results.push(analysis);
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) {
        results.push(`【${pair}】取得エラー`);
      }
    }

    const msg = [
      `📊 本日の環境認識（${dateStr} 16:00）`,
      "",
      results.join("\n\n"),
    ].join("\n");

    await sendLine(msg);
    console.log("環境認識レポート送信完了");
  } catch (e) {
    console.error("環境認識エラー:", e.message);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(console.error);
