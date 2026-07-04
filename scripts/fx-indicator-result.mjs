/**
 * 経済指標 結果通知
 * ForexFactoryの結果（actual）を5分ごとにチェックし、
 * 新しく発表された指標の乖離・変動幅予想をLINEに送信する
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OWNER_ID = process.env.LINE_OWNER_USER_ID;

// 送信済みキャッシュ（重複送信防止）
const CACHE_FILE = join(__dirname, "../.indicator-result-cache.json");

function loadCache() {
  if (!existsSync(CACHE_FILE)) return {};
  try { return JSON.parse(readFileSync(CACHE_FILE, "utf8")); } catch { return {}; }
}

function saveCache(cache) {
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// LINEに送信
async function sendLine(text) {
  if (!OWNER_ID) { console.log("[指標結果]\n" + text); return; }
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: OWNER_ID, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) throw new Error(`LINE送信エラー: ${await res.text()}`);
}

// ──────────────────────────────
// 指標ごとの乖離基準値と変動幅
// ──────────────────────────────
function getIndicatorConfig(title) {
  const t = title.toLowerCase();

  // 政策金利（FED・BOJ等）
  if (t.includes("rate decision") || t.includes("federal funds") || t.includes("interest rate")) {
    return { name: "政策金利", unit: "%", thresholds: [
      { min: 0.5,  label: "めちゃくちゃ", pips: "200pips超", direction: "順張り" },
      { min: 0.25, label: "めっちゃ",     pips: "200pips以上", direction: "順張り" },
      { min: 0.1,  label: "良い",          pips: "100〜150pips", direction: "逆張り" },
    ], skip: false };
  }

  // NFP（非農業部門雇用者数）単位：万人
  if (t.includes("non-farm") || t.includes("nonfarm")) {
    return { name: "NFP", unit: "万人", scale: 0.0001, thresholds: [
      { min: 15, label: "めちゃくちゃ", pips: "200pips以上", direction: "順張り" },
      { min: 15, label: "めっちゃ",     pips: "200pips以上", direction: "順張り" },
      { min: 10, label: "良い",          pips: "150pips前後", direction: "逆張り" },
      { min: 5,  label: "微妙",          pips: "100pips以内", direction: "やらない" },
    ]};
  }

  // 失業率
  if (t.includes("unemployment rate")) {
    return { name: "失業率", unit: "%", thresholds: [
      { min: 0.4, label: "めちゃくちゃ", pips: "200pips以上", direction: "順張り" },
      { min: 0.3, label: "めっちゃ",     pips: "200pips以上", direction: "順張り" },
      { min: 0.2, label: "良い",          pips: "150pips前後", direction: "逆張り" },
      { min: 0.1, label: "微妙（誤差）",  pips: "100pips以内", direction: "やらない" },
    ]};
  }

  // 平均時給
  if (t.includes("average hourly earnings") || t.includes("hourly earnings")) {
    return { name: "平均時給", unit: "%", thresholds: [
      { min: 0.4, label: "めちゃくちゃ", pips: "200pips以上", direction: "順張り" },
      { min: 0.3, label: "めっちゃ",     pips: "200pips以上", direction: "順張り" },
      { min: 0.2, label: "良い",          pips: "150pips前後", direction: "逆張り" },
      { min: 0.1, label: "微妙（誤差）",  pips: "100pips以内", direction: "やらない" },
    ]};
  }

  // CPI（消費者物価指数）
  if (t.includes("cpi") || t.includes("consumer price")) {
    return { name: "CPI", unit: "%", thresholds: [
      { min: 0.4, label: "めちゃくちゃ", pips: "150pips以上", direction: "順張り" },
      { min: 0.3, label: "めっちゃ",     pips: "150pips以上", direction: "順張り" },
      { min: 0.2, label: "良い",          pips: "100pips前後", direction: "逆張り" },
      { min: 0.1, label: "微妙（誤差）",  pips: "100pips以内", direction: "やらない" },
    ]};
  }

  // PCEデフレーター
  if (t.includes("pce")) {
    return { name: "PCEデフレーター", unit: "%", thresholds: [
      { min: 0.3, label: "めっちゃ",     pips: "150pips以上", direction: "順張り" },
      { min: 0.2, label: "良い",          pips: "100pips前後", direction: "逆張り" },
      { min: 0.1, label: "微妙（誤差）",  pips: "100pips以内", direction: "やらない" },
    ]};
  }

  // ISM製造業・非製造業・PMI
  if (t.includes("ism") || t.includes("pmi") || t.includes("manufacturing")) {
    return { name: "ISM/PMI", unit: "pt", thresholds: [
      { min: 3.0, label: "めっちゃ",     pips: "150pips以上", direction: "順張り" },
      { min: 1.5, label: "良い",          pips: "100pips前後", direction: "逆張り" },
      { min: 0.5, label: "微妙",          pips: "100pips以内", direction: "やらない" },
    ]};
  }

  // 小売売上高
  if (t.includes("retail sales")) {
    return { name: "小売売上高", unit: "%", thresholds: [
      { min: 0.5, label: "めっちゃ",     pips: "150pips以上", direction: "順張り" },
      { min: 0.3, label: "良い",          pips: "100pips前後", direction: "逆張り" },
      { min: 0.1, label: "微妙",          pips: "100pips以内", direction: "やらない" },
    ]};
  }

  // GDP
  if (t.includes("gdp")) {
    return { name: "GDP", unit: "%", thresholds: [
      { min: 0.5, label: "めっちゃ",     pips: "100pips以上", direction: "順張り" },
      { min: 0.2, label: "良い",          pips: "50〜100pips", direction: "逆張り" },
      { min: 0.1, label: "微妙",          pips: "50pips以内",  direction: "やらない" },
    ]};
  }

  // ADP雇用者数（単位：万人）
  if (t.includes("adp")) {
    return { name: "ADP雇用", unit: "万人", scale: 0.0001, thresholds: [
      { min: 10, label: "めっちゃ",     pips: "100pips以上", direction: "順張り" },
      { min: 5,  label: "良い",          pips: "50〜100pips", direction: "逆張り" },
      { min: 2,  label: "微妙",          pips: "50pips以内",  direction: "やらない" },
    ]};
  }

  // JOLT求人件数（単位：万件）
  if (t.includes("jolt") || t.includes("job opening")) {
    return { name: "JOLT求人", unit: "万件", scale: 0.0001, thresholds: [
      { min: 20, label: "めっちゃ",     pips: "100pips以上", direction: "順張り" },
      { min: 10, label: "良い",          pips: "50〜100pips", direction: "逆張り" },
    ]};
  }

  // デフォルト（その他指標）
  return null;
}

// 乖離幅から評価を返す
function evaluate(config, deviation) {
  if (!config) return null;
  const absDeviation = Math.abs(deviation);
  for (const t of config.thresholds) {
    if (absDeviation >= t.min) {
      return t;
    }
  }
  return { label: "微妙（誤差）", pips: "様子見", direction: "やらない" };
}

// 数値をパース（"1.2%"→1.2, "180.2K"→180200, etc.）
function parseValue(str) {
  if (!str || str.trim() === "") return null;
  const s = str.trim().replace(/,/g, "");
  if (s.endsWith("K") || s.endsWith("k")) return parseFloat(s) * 1000;
  if (s.endsWith("M") || s.endsWith("m")) return parseFloat(s) * 1000000;
  if (s.endsWith("B") || s.endsWith("b")) return parseFloat(s) * 1000000000;
  return parseFloat(s.replace(/%/g, ""));
}

// 乖離の方向（ドル円ベース）
function getDirection(title, deviation, country) {
  const t = title.toLowerCase();
  const isUS = country === "USD";

  // 雇用系: 実際 > 予想 → ドル買い
  if (t.includes("non-farm") || t.includes("adp") || t.includes("jolt")) {
    return isUS ? (deviation > 0 ? "ドル買い↑" : "ドル売り↓") : "";
  }
  // 失業率: 実際 < 予想 → ドル買い（低いほど良い）
  if (t.includes("unemployment")) {
    return isUS ? (deviation < 0 ? "ドル買い↑" : "ドル売り↓") : "";
  }
  // CPI・PCE・平均時給: 実際 > 予想 → ドル買い（インフレ→利上げ期待）
  if (t.includes("cpi") || t.includes("pce") || t.includes("earnings") || t.includes("consumer price")) {
    return isUS ? (deviation > 0 ? "ドル買い↑（利上げ期待）" : "ドル売り↓（利下げ期待）") : "";
  }
  // ISM/PMI・小売: 実際 > 予想 → ドル買い
  if (t.includes("ism") || t.includes("pmi") || t.includes("retail")) {
    return isUS ? (deviation > 0 ? "ドル買い↑" : "ドル売り↓") : "";
  }
  return deviation > 0 ? "予想超え↑" : "予想下回り↓";
}

// インパクト絵文字
function impactEmoji(impact) {
  if (impact === "High") return "🔴";
  if (impact === "Medium") return "🟡";
  return "🟢";
}

// 評価ラベルの絵文字
function ratingEmoji(label) {
  if (label.includes("めちゃくちゃ")) return "🔥🔥";
  if (label.includes("めっちゃ"))    return "🔥";
  if (label.includes("良い") || label.includes("悪い")) return "⚡";
  return "💤";
}

// LINEメッセージを組み立てる
function buildMessage(e, config, actual, forecast, deviation, rating) {
  const jstTime = new Date(e.date).toLocaleTimeString("ja-JP", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo"
  });

  const name = config ? config.name : e.title;
  const unit = config?.unit || "";
  const scale = config?.scale || 1;

  // 値の表示（NFPなどはK→万に変換）
  const dispDeviation = scale !== 1
    ? `${(deviation * scale).toFixed(1)}万${unit}`
    : `${deviation > 0 ? "+" : ""}${deviation.toFixed(2)}${unit}`;

  const dispActual   = scale !== 1
    ? `${(actual * scale).toFixed(1)}万${unit}`
    : `${actual}${unit}`;
  const dispForecast = scale !== 1
    ? `${(forecast * scale).toFixed(1)}万${unit}`
    : `${forecast}${unit}`;

  const directionStr = getDirection(e.title, deviation, e.country);

  let msg = `${impactEmoji(e.impact)} 【指標結果】${jstTime}\n`;
  msg += `${name}（${e.country}）\n`;
  msg += `${"─".repeat(18)}\n`;
  msg += `予想：${dispForecast}　→　結果：${dispActual}\n`;
  msg += `乖離：${dispDeviation}　${directionStr}\n`;
  msg += `${"─".repeat(18)}\n`;

  if (rating) {
    msg += `【評価】${ratingEmoji(rating.label)} ${rating.label}\n`;
    msg += `【変動幅】${rating.pips}\n`;
    msg += `【戦略】${rating.direction}\n`;
    if (rating.direction === "やらない") {
      msg += `→ 動き小さめ。今回は見送り推奨。\n`;
    } else if (rating.direction === "順張り") {
      msg += `→ 大きく動く可能性。${directionStr}の方向で順張り検討。\n`;
    } else {
      msg += `→ 一時的な動きに注意。反転狙いの逆張り検討。\n`;
    }
  } else {
    msg += `基準値未設定の指標です。チャートで確認を。\n`;
  }

  return msg;
}

// ForexFactoryから本日のイベントを取得
async function fetchTodayEvents() {
  const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json");
  if (!res.ok) throw new Error("ForexFactory取得失敗");
  const data = await res.json();

  const now = new Date();
  const todayJST = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayStr = todayJST.toISOString().slice(0, 10);

  return data.filter(e => {
    const dateStr = e.date?.slice(0, 10);
    return dateStr === todayStr && (e.impact === "High" || e.impact === "Medium");
  });
}

// メイン
export async function main() {
  const cache = loadCache();
  const today = new Date().toISOString().slice(0, 10);

  // 日付が変わったらキャッシュをリセット
  if (cache._date !== today) {
    Object.keys(cache).forEach(k => delete cache[k]);
    cache._date = today;
  }

  let events;
  try {
    events = await fetchTodayEvents();
  } catch (e) {
    console.error("指標取得エラー:", e.message);
    return;
  }

  for (const e of events) {
    const cacheKey = `${e.date}_${e.title}_${e.country}`;

    // すでに送信済みならスキップ
    if (cache[cacheKey]) continue;

    // actualがまだ出ていない（空/null）ならスキップ
    if (!e.actual || e.actual.trim() === "") continue;

    // 予想値がない場合は乖離計算できないが通知はする
    const actual   = parseValue(e.actual);
    const forecast = parseValue(e.forecast);

    let config = getIndicatorConfig(e.title);
    let deviation = null;
    let rating = null;

    if (actual !== null && forecast !== null) {
      deviation = actual - forecast;
      rating = evaluate(config, deviation);
    }

    try {
      const msg = buildMessage(e, config, actual, forecast, deviation, rating);
      await sendLine(msg);
      cache[cacheKey] = { sentAt: new Date().toISOString(), actual: e.actual };
      saveCache(cache);
      console.log(`✅ 指標通知送信: ${e.title}`);
      // 連続送信防止
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`送信エラー (${e.title}):`, err.message);
    }
  }
}

// 直接実行時
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(console.error);
