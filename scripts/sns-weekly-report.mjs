/**
 * SNS週次レポート自動生成
 * ・投稿管理タブから直近1週間の数値を読み込み
 * ・設計ステップ別・時間帯別に集計
 * ・LINEにレポートを送信
 *
 * 使い方（手動）:
 *   node server/scripts/sns-weekly-report.mjs
 *   node server/scripts/sns-weekly-report.mjs 2026-06-29  ← 週の開始日を指定
 *
 * 自動実行: server.js から日曜23:00に呼ばれる
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { google } from "googleapis";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const SHEET_ID = process.env.SNS_SHEET_ID;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OWNER_ID = process.env.LINE_OWNER_USER_ID;

function getSheetsClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.sheets({ version: "v4", auth });
}

async function sendLine(text) {
  if (!OWNER_ID || !LINE_TOKEN) {
    console.log("\n📱 LINE送信内容（テスト出力）:\n");
    console.log(text);
    return;
  }
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_TOKEN}`,
    },
    body: JSON.stringify({ to: OWNER_ID, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) throw new Error(`LINE送信エラー: ${await res.text()}`);
  console.log("LINE送信完了！");
}

/** 週の月曜〜日曜の日付範囲を返す */
function getWeekRange(baseDate) {
  const d = baseDate ? new Date(baseDate) : new Date();
  // 直近の月曜を探す
  const day = d.getDay(); // 0=日
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = (dt) => dt.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(sunday) };
}

function toNum(v) {
  if (!v || v === "") return null;
  return parseFloat(String(v).replace(/[,%K]/g, "")) *
    (String(v).includes("K") ? 1000 : 1);
}

/** 投稿管理タブから指定週のデータを取得 */
async function fetchWeekPosts(sheets, start, end) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "投稿管理!A2:N",
  });
  const rows = r.data.values || [];

  return rows
    .filter((row) => {
      const date = row[0];
      return date && date >= start && date <= end;
    })
    .map((row) => ({
      date: row[0],
      weekday: row[1],
      timeSlot: (row[2] || "").split("\n")[0], // 朝/昼/晩
      step: row[3] || "",
      text: row[4] || "",
      imp: toNum(row[6]),
      likes: toNum(row[7]),
      rt: toNum(row[8]),
      reply: toNum(row[9]),
      eng: toNum(row[10]),
      clicks: toNum(row[11]),
      profile: toNum(row[12]),
    }))
    .filter((p) => p.imp !== null); // 数値が入っているものだけ
}

/** 集計ロジック */
function analyze(posts) {
  if (posts.length === 0) return null;

  const total = {
    imp: 0, likes: 0, rt: 0, reply: 0, eng: 0, clicks: 0, profile: 0, count: 0,
  };
  const byStep = {};
  const bySlot = { 朝: { imp: 0, eng: 0, count: 0 }, 昼: { imp: 0, eng: 0, count: 0 }, 晩: { imp: 0, eng: 0, count: 0 } };

  for (const p of posts) {
    total.imp += p.imp; total.likes += p.likes ?? 0;
    total.rt += p.rt ?? 0; total.reply += p.reply ?? 0;
    total.eng += p.eng ?? 0; total.clicks += p.clicks ?? 0;
    total.profile += p.profile ?? 0; total.count++;

    // 設計ステップ別
    const step = p.step.slice(0, 5) || "その他";
    if (!byStep[step]) byStep[step] = { imp: 0, eng: 0, count: 0 };
    byStep[step].imp += p.imp;
    byStep[step].eng += p.eng ?? 0;
    byStep[step].count++;

    // 時間帯別
    const slot = p.timeSlot;
    if (bySlot[slot]) {
      bySlot[slot].imp += p.imp;
      bySlot[slot].eng += p.eng ?? 0;
      bySlot[slot].count++;
    }
  }

  const engRate = total.imp > 0 ? ((total.eng / total.imp) * 100).toFixed(1) : "0.0";

  // 設計ステップ別エンゲージメント率（降順）
  const stepRanking = Object.entries(byStep)
    .map(([step, d]) => ({
      step,
      engRate: d.imp > 0 ? ((d.eng / d.imp) * 100).toFixed(1) : "0.0",
      avgImp: d.count > 0 ? Math.round(d.imp / d.count) : 0,
      count: d.count,
    }))
    .sort((a, b) => parseFloat(b.engRate) - parseFloat(a.engRate));

  // 時間帯別
  const slotStats = Object.entries(bySlot)
    .filter(([, d]) => d.count > 0)
    .map(([slot, d]) => ({
      slot,
      avgImp: Math.round(d.imp / d.count),
      engRate: d.imp > 0 ? ((d.eng / d.imp) * 100).toFixed(1) : "0.0",
    }));

  // 上位・下位投稿
  const sorted = [...posts].sort((a, b) => (b.eng ?? 0) / (b.imp || 1) - (a.eng ?? 0) / (a.imp || 1));
  const topPost = sorted[0];
  const lowPost = sorted[sorted.length - 1];

  return { total, engRate, stepRanking, slotStats, topPost, lowPost, count: posts.length };
}

/** LINEメッセージ組み立て */
function buildMessage(start, end, result) {
  const { total, engRate, stepRanking, slotStats, topPost, lowPost, count } = result;

  const startFmt = start.slice(5).replace("-", "/");
  const endFmt = end.slice(5).replace("-", "/");

  let msg = `📊 SNS週次レポート（${startFmt}〜${endFmt}）\n`;
  msg += `${"─".repeat(22)}\n`;

  msg += `\n【週間サマリー】（${count}投稿）\n`;
  msg += `インプレ合計：${total.imp.toLocaleString()}\n`;
  msg += `エンゲージメント率：${engRate}%\n`;
  msg += `いいね：${total.likes}　RT：${total.rt}　リプ：${total.reply}\n`;
  msg += `プロフィールアクセス：${total.profile}\n`;

  msg += `\n【設計ステップ別 エンゲ率ランキング】\n`;
  for (const s of stepRanking) {
    const medal = stepRanking.indexOf(s) === 0 ? "🥇" : stepRanking.indexOf(s) === 1 ? "🥈" : "🥉";
    msg += `${medal} ${s.step}：${s.engRate}%（平均インプレ${s.avgImp}・${s.count}投稿）\n`;
  }

  msg += `\n【時間帯別 平均値】\n`;
  for (const s of slotStats) {
    msg += `${s.slot}：インプレ${s.avgImp} / エンゲ率${s.engRate}%\n`;
  }

  if (topPost) {
    const topRate = ((topPost.eng ?? 0) / topPost.imp * 100).toFixed(1);
    msg += `\n🔥 今週のベスト投稿\n`;
    msg += `${topPost.date} ${topPost.timeSlot} ${topPost.step}\n`;
    msg += `インプレ${topPost.imp} / エンゲ率${topRate}% / いいね${topPost.likes ?? 0}\n`;
    msg += `「${topPost.text.slice(0, 30).replace(/\n/g, " ")}…」\n`;
  }

  if (lowPost && lowPost !== topPost) {
    const lowRate = ((lowPost.eng ?? 0) / lowPost.imp * 100).toFixed(1);
    msg += `\n📉 今週の課題投稿\n`;
    msg += `${lowPost.date} ${lowPost.timeSlot} ${lowPost.step}\n`;
    msg += `インプレ${lowPost.imp} / エンゲ率${lowRate}%\n`;
  }

  msg += `${"─".repeat(22)}\n`;
  msg += `今週もお疲れ様でした！来週に活かしましょう🎯`;

  return msg;
}

export async function main(baseDateArg) {
  const { start, end } = getWeekRange(baseDateArg);
  console.log(`📅 集計期間: ${start} 〜 ${end}`);

  const sheets = getSheetsClient();
  const posts = await fetchWeekPosts(sheets, start, end);

  if (posts.length === 0) {
    console.log("⚠️ 数値が入っている投稿がありません。インプレッション列を入力してください。");
    return;
  }

  console.log(`✅ ${posts.length}件の投稿データを取得`);
  const result = analyze(posts);
  const message = buildMessage(start, end, result);
  await sendLine(message);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main(process.argv[2]).catch(console.error);
}
