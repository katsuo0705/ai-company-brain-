/**
 * 毎朝8:00 デイリーリマインダー（SNS + FX）
 * ロードマップの目標・今週タスク・今日やることをLINEに送信
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OWNER_ID   = process.env.LINE_OWNER_USER_ID;

async function sendLine(text) {
  if (!OWNER_ID) { console.log(text); return; }
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
  if (!res.ok) throw new Error(`LINE送信エラー: ${await res.text()}`);
  console.log("デイリーリマインダー送信完了");
}

function getSnsWeekTask(dayOfWeek) {
  const tasks = {
    0: "📋 日曜：週次制作フロー実施日\n  → 分析→設計→承認→投稿文＋画像作成",
    1: "✍️ 月曜：今週の投稿スタート\n  → 朝・昼・晩を予定通り投稿",
    2: "✍️ 火曜：投稿継続\n  → 朝・昼・晩を予定通り投稿",
    3: "✍️ 水曜：投稿継続\n  → 朝・昼・晩を予定通り投稿",
    4: "✍️ 木曜：投稿継続\n  → 朝・昼・晩を予定通り投稿",
    5: "✍️ 金曜：投稿継続\n  → 朝・昼・晩を予定通り投稿\n  → 土曜オープンチャット文案確認",
    6: "📢 土曜：オープンチャット投稿日\n  → 朝にメンバーへのメッセージを投稿",
  };
  return tasks[dayOfWeek] || "";
}

function getFxWeekTask(dayOfWeek) {
  const tasks = {
    0: "📋 日曜：リョウと週次振り返りレポート確認\n  → 勝率・PF・ルール通り率をチェック",
    1: "📈 月曜：今週のトレード開始\n  → 環境認識（4H・1H）を更新して方針決定",
    2: "📈 火曜：トレード継続\n  → シグナル確認・全件記録",
    3: "📈 水曜：トレード継続\n  → シグナル確認・全件記録",
    4: "📈 木曜：トレード継続\n  → シグナル確認・全件記録",
    5: "📈 金曜：トレード継続\n  → 今週の損益・ルール通り率を仮集計",
    6: "📊 土曜：今週のトレードを振り返りメモに記録\n  → 明日の週次レポートに備える",
  };
  return tasks[dayOfWeek] || "";
}

export async function main() {
  const now = new Date();
  const jstDay = now.getUTCDay();

  const message = [
    "━━━━━━━━━━━━━━",
    "おはようございます！本日のロードマップ確認です",
    "━━━━━━━━━━━━━━",
    "",
    "【 SNS 】",
    "🎯 ゴール（12月末）",
    "  → 0→1達成（JVコンテンツ初販売）",
    "",
    "📅 今月の目標（7月末）",
    "  ・Xフォロワー：1,150人",
    "  ・オープンチャット：55人",
    "  ・週次制作フロー定着",
    "",
    "📍 今日のSNSタスク",
    getSnsWeekTask(jstDay),
    "",
    "💪 アウトバウンド",
    "  ・リプ5件（投稿前10分）",
    "  ・いいね20件（手動）",
    "",
    "━━━━━━━━━━━━━━",
    "",
    "【 FX 】",
    "🎯 ゴール（12月末）",
    "  → フィントケイ クオーツ合格",
    "  → スケーリング道場でステップアップ",
    "",
    "📅 今月の目標（7月末）",
    "  ・月間トレード数：10件（週2〜3件）",
    "  ・ルール通り率：90%以上（最優先）",
    "  ・トレード記録を毎件つける",
    "  ・日次-5%ルールを厳守",
    "",
    "📍 今日のFXタスク",
    getFxWeekTask(jstDay),
    "",
    "⚠️ 日次損失上限 -5%厳守",
    "  → 達したら即終了・翌日に持ち越さない",
    "━━━━━━━━━━━━━━",
  ].join("\n");

  await sendLine(message);
}

// 直接実行時（日本語パスでもURLエンコードせずに比較）
const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main().catch(console.error);
}
