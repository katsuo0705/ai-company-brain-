/**
 * SNS投稿文 → Googleスプレッドシート「投稿管理」タブ 転記スクリプト
 * 使い方: node server/scripts/sns-sheet-sync.mjs <投稿文MDファイルのパス>
 * 例: node server/scripts/sns-sheet-sync.mjs logs/SNS投稿文_2026-07-07-12.md
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { readFileSync } from "fs";
import { google } from "googleapis";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const SHEET_ID = process.env.SNS_SHEET_ID;
const SHEET_NAME = "投稿管理";

const WEEKDAY_JA = { "月": "月曜", "火": "火曜", "水": "水曜", "木": "木曜", "金": "金曜", "土": "土曜", "日": "日曜" };

function getSheetsClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.sheets({ version: "v4", auth });
}

/**
 * MDファイルをパースして投稿データ配列に変換
 * 形式: ## 7/7（月）朝 7:00　①問題設計
 */
function parseMd(mdText) {
  const posts = [];
  // セクションを分割
  const sections = mdText.split(/^---$/m).map(s => s.trim()).filter(Boolean);

  for (const section of sections) {
    // ヘッダー行を探す: ## 7/7（月）朝 7:00　①問題設計
    const headerMatch = section.match(/^##\s+(\d+)\/(\d+)（(.)）\s*(朝|昼|晩)\s*([\d:]+)[^①-⑤内省]*([①-⑤].*?|内省エッセイ)/m);
    if (!headerMatch) continue;

    const [, month, day, weekdayShort, timeSlot, time, step] = headerMatch;

    // 投稿文：ヘッダー行の後ろ（【エース投稿】等のサブヘッダーを除く）
    const bodyLines = section.split("\n").filter(l => !l.startsWith("#")).map(l => l.trim()).filter(Boolean);
    if (bodyLines.length === 0) continue;
    const body = bodyLines.join("\n");

    // 日付フォーマット: 2026-07-07
    const year = 2026;
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const weekday = WEEKDAY_JA[weekdayShort] || weekdayShort;
    const timeCell = `${timeSlot}\n${time}`;
    const stepClean = step.trim().replace(/【.*?】/g, "").trim();

    posts.push([
      dateStr,       // 日付
      weekday,       // 曜日
      timeCell,      // 時間帯
      stepClean,     // 設計ステップ
      body,          // 投稿文
      "",            // 画像案（空欄）
      "",            // インプレッション
      "",            // いいね
      "",            // リポスト
      "",            // リプ
      "",            // エンゲージメント
      "",            // 詳細クリック数
      "",            // プロフィールアクセス
      "",            // メモ
    ]);
  }

  return posts;
}

/**
 * 既存データの最終行を取得（重複チェック用に日付+時間帯も返す）
 */
async function getExistingKeys(sheets) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2:C`,
  });
  const rows = r.data.values || [];
  return new Set(rows.map(row => `${row[0]}_${row[2]}`)); // 日付_時間帯 でキー
}

export async function syncPosts(mdFilePath) {
  const absPath = resolve(mdFilePath);
  console.log(`📄 読み込み: ${absPath}`);
  const mdText = readFileSync(absPath, "utf-8");

  const posts = parseMd(mdText);
  if (posts.length === 0) {
    console.log("⚠️  投稿データが見つかりませんでした");
    return;
  }
  console.log(`✅ パース完了: ${posts.length}件`);

  const sheets = getSheetsClient();

  // 重複チェック
  const existingKeys = await getExistingKeys(sheets);
  const newPosts = posts.filter(p => !existingKeys.has(`${p[0]}_${p[2]}`));

  if (newPosts.length === 0) {
    console.log("ℹ️  すべて転記済みです（重複なし）");
    return;
  }
  console.log(`📝 新規転記: ${newPosts.length}件（重複スキップ: ${posts.length - newPosts.length}件）`);

  // 日付・時間帯でソート
  const timeOrder = { "朝": 0, "昼": 1, "晩": 2 };
  newPosts.sort((a, b) => {
    if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
    return (timeOrder[a[2][0]] ?? 9) - (timeOrder[b[2][0]] ?? 9);
  });

  // 末尾に追記
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:N`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: newPosts },
  });

  console.log(`🎉 転記完了！ ${newPosts.length}件を「${SHEET_NAME}」タブに追加しました`);
  newPosts.forEach(p => console.log(`  → ${p[0]} ${p[2].replace("\n", " ")} ${p[3]}`));
}

// 直接実行
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const mdFile = process.argv[2];
  if (!mdFile) {
    console.error("使い方: node server/scripts/sns-sheet-sync.mjs <投稿文MDファイルのパス>");
    process.exit(1);
  }
  syncPosts(mdFile).catch(console.error);
}
