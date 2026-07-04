/**
 * 月別タブのデータ行を全消去してヘッダーだけ残す（1回だけ使う）
 */
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { google } from "googleapis";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const SHEET_ID = process.env.TRADE_SHEET_ID;

function getSheetsClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.sheets({ version: "v4", auth });
}

function isMonthTab(title) {
  return /^\d{4}\/\d{2}$/.test(title);
}

export async function main() {
  const sheets = getSheetsClient();
  const info = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const monthTabs = info.data.sheets.filter(s => isMonthTab(s.properties.title));

  for (const sheet of monthTabs) {
    const title = sheet.properties.title;
    // ヘッダー行（1行目）以外を全消去
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `${title}!A2:Z1000`,
    });
    console.log(`🗑️ ${title} データ消去完了`);
  }
  console.log("全消去完了。次にfx-record.mjsを実行します...");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(console.error);
