/**
 * 既存の月別タブ全てに列幅・行の高さを一括適用
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

// 月別タブかどうか判定（例: "2026/07" "2026/06"）
function isMonthTab(title) {
  return /^\d{4}\/\d{2}$/.test(title);
}

async function applyFormat(sheets, sheetId, tabName) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [
      // ヘッダー行：太字・背景色・中央揃え・固定
      { repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 1, green: 1, blue: 1 },
            textFormat: { bold: true, fontSize: 11 },
            horizontalAlignment: "CENTER",
            borders: { bottom: { style: "SOLID_MEDIUM", color: { red: 0, green: 0, blue: 0 } } }
          }},
          fields: "userEnteredFormat"
      }},
      { updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount"
      }},
      // 列幅
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0,  endIndex: 2  }, properties: { pixelSize: 155 }, fields: "pixelSize" }},  // 日時列
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2,  endIndex: 3  }, properties: { pixelSize: 90  }, fields: "pixelSize" }},  // ペア
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 3,  endIndex: 6  }, properties: { pixelSize: 80  }, fields: "pixelSize" }},  // 方向・ロット・精度
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 6,  endIndex: 11 }, properties: { pixelSize: 90  }, fields: "pixelSize" }},  // 価格系
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 11, endIndex: 15 }, properties: { pixelSize: 90  }, fields: "pixelSize" }},  // 結果系
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 14, endIndex: 15 }, properties: { pixelSize: 120 }, fields: "pixelSize" }},  // メモ
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 15, endIndex: 18 }, properties: { pixelSize: 200 }, fields: "pixelSize" }},  // チャートURL x3
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 18, endIndex: 19 }, properties: { pixelSize: 250 }, fields: "pixelSize" }},  // チャート画像
      { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 19, endIndex: 20 }, properties: { pixelSize: 0   }, fields: "pixelSize" }},  // myfxbook_ID（非表示）
      // データ行の高さ
      { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 500 }, properties: { pixelSize: 80 }, fields: "pixelSize" }},
    ]}
  });
  console.log(`✅ ${tabName} フォーマット適用`);
}

export async function main() {
  const sheets = getSheetsClient();
  const info = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });

  const monthTabs = info.data.sheets.filter(s => isMonthTab(s.properties.title));

  if (monthTabs.length === 0) {
    console.log("月別タブが見つかりません");
    return;
  }

  console.log(`${monthTabs.length}タブに適用します...`);
  for (const sheet of monthTabs) {
    await applyFormat(sheets, sheet.properties.sheetId, sheet.properties.title);
  }
  console.log("完了！");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(console.error);
