/**
 * 朝3:30 モーニングブリーフィング
 * FX経済指標 + 為替ニュースをLINEに送信
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const OWNER_ID = process.env.LINE_OWNER_USER_ID;

// LINEにプッシュメッセージを送信
async function sendLine(text) {
  if (!OWNER_ID) {
    console.log("LINE_OWNER_USER_ID が未設定です。コンソールに出力します：\n");
    console.log(text);
    return;
  }
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_TOKEN}`,
    },
    body: JSON.stringify({
      to: OWNER_ID,
      messages: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LINE送信エラー: ${err}`);
  }
  console.log("LINE送信完了！");
}

// ForexFactoryカレンダーから本日の重要指標を取得
async function getEconomicEvents() {
  try {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");

    const url = `https://nfs.faireconomy.media/ff_calendar_thisweek.json`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();

    // 本日・高・中インパクトのみ
    const todayStr = `${yyyy}-${mm}-${dd}`;
    const events = data.filter((e) => {
      const eventDate = e.date?.slice(0, 10);
      return eventDate === todayStr && (e.impact === "High" || e.impact === "Medium");
    });

    return events.slice(0, 8);
  } catch (e) {
    console.error("経済指標取得エラー:", e.message);
    return [];
  }
}

// RSSフィードからFX関連ニュースを取得（APIキー不要・GitHub Actionsから動作）
async function getFxNews() {
  const feeds = [
    "https://feeds.reuters.com/reuters/businessNews",
    "https://www.forexlive.com/feed/news",
    "https://feeds.bbci.co.uk/news/business/rss.xml",
  ];

  for (const feedUrl of feeds) {
    try {
      const res = await fetch(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; FXBot/1.0)" },
      });
      if (!res.ok) continue;
      const xml = await res.text();

      // RSSのtitleとlinkを抽出
      const items = [];
      const itemRegex = /<item[\s\S]*?<\/item>/g;
      const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/;
      let match;
      while ((match = itemRegex.exec(xml)) !== null && items.length < 3) {
        const titleMatch = match[0].match(titleRegex);
        const title = (titleMatch?.[1] || titleMatch?.[2] || "").trim();
        if (title && title.length > 5) {
          items.push({ title });
        }
      }
      if (items.length > 0) return items;
    } catch (e) {
      continue;
    }
  }
  return [];
}

// 後方互換のため残す（使用しない）
async function getFxNewsEn() {
  return [];
}

// インパクト絵文字
function impactEmoji(impact) {
  if (impact === "High") return "🔴";
  if (impact === "Medium") return "🟡";
  return "🟢";
}

// メイン（直接実行 or import両方対応）
export async function main() {
  console.log("📊 モーニングブリーフィング作成中...");

  const [events, newsJp, newsEn] = await Promise.all([
    getEconomicEvents(),
    getFxNews(),
    getFxNewsEn(),
  ]);

  const today = new Date();
  const dateStr = `${today.getMonth() + 1}/${today.getDate()}(${["日","月","火","水","木","金","土"][today.getDay()]})`;

  let msg = `📊 ${dateStr} おはようございます！\nFXモーニングブリーフィングです。\n`;
  msg += `${"─".repeat(20)}\n`;

  // 経済指標
  msg += `\n【本日の重要指標】\n`;
  if (events.length === 0) {
    msg += `本日は重要指標なし\n`;
  } else {
    for (const e of events) {
      const time = e.date ? new Date(e.date).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }) : "--:--";
      const forecast = e.forecast ? `予測:${e.forecast}` : "";
      const previous = e.previous ? `前回:${e.previous}` : "";
      const values = [forecast, previous].filter(Boolean).join(" / ");
      msg += `${impactEmoji(e.impact)} ${time} ${e.country} ${e.title}\n`;
      if (values) msg += `　　${values}\n`;
    }
  }

  // ニュース
  const news = newsJp.length > 0 ? newsJp : newsEn;
  msg += `\n【FX関連ニュース】\n`;
  if (news.length === 0) {
    msg += `ニュースを取得できませんでした\n`;
  } else {
    for (const n of news) {
      const title = n.title?.slice(0, 40) || "";
      msg += `・${title}\n`;
    }
  }

  msg += `${"─".repeat(20)}\n`;
  msg += `今日もいいトレードを！🎯`;

  await sendLine(msg);
}

// 直接実行時のみ自動で走らせる（import時は走らない）
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(console.error);
