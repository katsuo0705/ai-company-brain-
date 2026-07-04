/**
 * 週次振り返りレポート（日曜22:00・週報と同タイミング）
 * 先週の3ペア値動きサマリー＋今週の注目レベル＋シグナル精度振り返りをLINEに送信
 */
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { readFileSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OWNER_ID   = process.env.LINE_OWNER_USER_ID;
const TD_KEY     = process.env.TWELVE_DATA_API_KEY;
const CACHE_PATH = join(__dirname, "../../logs/signal-cache.json");

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

// 先週の週足データ（日足5本）から週次サマリー
async function weekSummary(pair) {
  const pip = pipSize(pair);
  const dec = pair === "XAU/USD" ? 2 : pair.includes("JPY") ? 3 : 5;
  const fmt = n => n.toFixed(dec);

  // 日足を10本取得（先週分を含むよう余裕をもたせる）
  const candles = await fetchCandles(pair, "1day", 10);
  if (candles.length < 5) return `【${pair}】データ不足`;

  // 先週5本（月〜金）
  const lastWeek = candles.slice(-7, -2); // 直近7本から末尾2本（今週）を除く
  if (lastWeek.length === 0) return `【${pair}】先週データなし`;

  const weekOpen  = lastWeek[0].open;
  const weekClose = lastWeek[lastWeek.length - 1].close;
  const weekHigh  = Math.max(...lastWeek.map(c => c.high));
  const weekLow   = Math.min(...lastWeek.map(c => c.low));
  const weekDiff  = weekClose - weekOpen;
  const weekPips  = Math.abs(weekDiff) / pip;
  const weekDir   = weekDiff > 0 ? "上昇 📈" : weekDiff < 0 ? "下落 📉" : "横ばい";

  // 今週の注目レベル（先週高値・安値）
  return [
    `【${pair}】`,
    `先週：${fmt(weekOpen)}→${fmt(weekClose)}（${weekDir} ${weekPips.toFixed(0)}pips）`,
    `　高値：${fmt(weekHigh)}　安値：${fmt(weekLow)}`,
    `今週注目：${fmt(weekHigh)}（抵抗）/ ${fmt(weekLow)}（支持）`,
  ].join("\n");
}

// シグナルキャッシュから先週の精度を集計
function signalAccuracy() {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    const cache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = cache.filter(s => new Date(s.time).getTime() > oneWeekAgo);
    if (recent.length === 0) return null;

    const high = recent.filter(s => s.axes >= 3).length;
    const mid  = recent.filter(s => s.axes === 2).length;
    return `シグナル発火：${recent.length}回（🔥高精度${high}回 / ⚡普通${mid}回）`;
  } catch {
    return null;
  }
}

export async function main() {
  if (!TD_KEY) { console.log("TWELVE_DATA_API_KEY未設定"); return; }

  try {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const month = jst.getUTCMonth() + 1;
    const day   = jst.getUTCDate();

    const results = [];
    for (const pair of PAIRS) {
      try {
        const summary = await weekSummary(pair);
        results.push(summary);
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) {
        results.push(`【${pair}】取得エラー`);
      }
    }

    const accuracy = signalAccuracy();
    const accuracyLine = accuracy ? `\n📡 ${accuracy}` : "";

    const msg = [
      `📋 週次振り返りレポート（${month}/${day}）`,
      "",
      results.join("\n\n"),
      accuracyLine,
    ].join("\n");

    await sendLine(msg);
    console.log("週次振り返りレポート送信完了");
  } catch (e) {
    console.error("週次振り返りエラー:", e.message);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(console.error);
