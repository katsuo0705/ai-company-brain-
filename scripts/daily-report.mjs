/**
 * 毎日22:00 日報スプレッドシート自動記入（SNS・FX タブ分け）
 * 1行目：今月の目標 / 2行目：今週の目標 / 3行目：ヘッダー / 4行目以降：日次データ
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { google } from "googleapis";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const LINE_TOKEN     = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OWNER_ID       = process.env.LINE_OWNER_USER_ID;
const TRADE_SHEET_ID = process.env.TRADE_SHEET_ID;
const CONFIG_PATH    = join(__dirname, "../.daily-report-config.json");

function getAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

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
}

// ─── 色定義 ──────────────────────────────
const COLOR = {
  darkBg:   { red: 0.15, green: 0.15, blue: 0.15 },
  monthBg:  { red: 0.18, green: 0.32, blue: 0.52 }, // 青系（今月目標）
  weekBg:   { red: 0.22, green: 0.47, blue: 0.34 }, // 緑系（今週目標）
  headerBg: { red: 0.30, green: 0.30, blue: 0.30 },
  white:    { red: 1, green: 1, blue: 1 },
  yellow:   { red: 1, green: 0.93, blue: 0.60 },
};

function cell(value, bgColor, bold = false, wrap = true) {
  return {
    userEnteredValue: { stringValue: String(value) },
    userEnteredFormat: {
      backgroundColor: bgColor,
      textFormat: { foregroundColor: COLOR.white, bold },
      wrapStrategy: wrap ? "WRAP" : "OVERFLOW_CELL",
      verticalAlignment: "MIDDLE",
    }
  };
}

function dataCell(value, bg = null) {
  return {
    userEnteredValue: { stringValue: String(value) },
    userEnteredFormat: {
      ...(bg ? { backgroundColor: bg } : {}),
      wrapStrategy: "WRAP",
      verticalAlignment: "TOP",
    }
  };
}

// ─── 日付ユーティリティ ───────────────────────
function getJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y   = jst.getUTCFullYear();
  const m   = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d   = String(jst.getUTCDate()).padStart(2, "0");
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const dow  = jst.getUTCDay();
  return { today: `${y}/${m}/${d}（${days[dow]}）`, dow, prefix: `${y}-${m}` };
}

// ─── SNS コンテンツ生成 ───────────────────────
function getSnsDidToday(dow) {
  const base = "朝投稿・昼投稿・晩投稿（画像付き）\nリプ5件・いいね20件";
  const extra = { 0: "\n週次制作フロー実施", 6: "\nオープンチャット週次投稿" };
  return base + (extra[dow] || "");
}

function getSnsNextDay(dow) {
  const next = (dow + 1) % 7;
  const tasks = {
    0: "朝・昼・晩投稿\nリプ5件・いいね20件",
    1: "朝・昼・晩投稿\nリプ5件・いいね20件",
    2: "朝・昼・晩投稿\nリプ5件・いいね20件",
    3: "朝・昼・晩投稿\nリプ5件・いいね20件",
    4: "朝・昼・晩投稿\nリプ5件・いいね20件\n土曜OC文案確認",
    5: "OC週次投稿（朝）\n朝・昼・晩投稿",
    6: "週次制作フロー\n（分析→設計→承認→作成）",
  };
  return tasks[next] || "";
}

// ─── FX コンテンツ生成 ────────────────────────
// タブ名：「2026/07」形式。列：A=エントリー日時 K=結果 L=損益(pips)
function getMonthTabName() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  return `${y}/${m}`;
}

async function getFxTodayTrades(sheets, todayStr) {
  if (!TRADE_SHEET_ID) return { summary: "記録なし", count: 0, pips: 0 };
  try {
    const tab = getMonthTabName();
    // todayStr例: "2026/07/05（日）" → "2026/07/05"
    const dateKey = todayStr.slice(0, 10);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: TRADE_SHEET_ID,
      range: `${tab}!A2:L`,
    });
    const rows = (res.data.values || []).filter(r => r[0] && r[0].startsWith(dateKey));
    if (rows.length === 0) return { summary: "トレードなし", count: 0, pips: 0 };
    const pips = rows.reduce((sum, r) => sum + (parseFloat(r[11]) || 0), 0);
    const wins = rows.filter(r => r[10] === "勝ち").length;
    return {
      summary: `${rows.length}件（勝${wins}敗${rows.length - wins}）\n損益: ${pips >= 0 ? "+" : ""}${pips.toFixed(1)}pips`,
      count: rows.length,
      pips,
    };
  } catch (e) { return { summary: `取得エラー: ${e.message}`, count: 0, pips: 0 }; }
}

async function getFxMonthProgress(sheets, prefix) {
  if (!TRADE_SHEET_ID) return "0件 / 目標10件（0%）";
  try {
    const tab = getMonthTabName();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: TRADE_SHEET_ID,
      range: `${tab}!A2:A`,
    });
    const count = (res.data.values || []).filter(r => r[0] && r[0].trim() !== "").length;
    const pct = Math.round((count / 10) * 100);
    return `${count}件 / 目標10件（${pct}%）`;
  } catch { return "-"; }
}

function getFxChallenges(pips) {
  if (pips < 0) return "・本日マイナス。ルール通りか再確認\n・日次-5%ルール遵守を確認";
  if (pips === 0) return "・機会なし or 見送り（ルール遵守）\n・前日夜に4H環境認識を更新しておく";
  return "・利確タイミングは適切だったか\n・ルール通り率100%を継続";
}

function getFxImprovements(pips) {
  if (pips < 0) return "・負けトレードの根拠を振り返り記録\n・翌日は🔥3軸一致のみに絞る";
  return "・🔥3軸一致シグナルのみ継続\n・RR比1.8以上を意識";
}

function getFxNextDay(dow) {
  const next = (dow + 1) % 7;
  const tasks = {
    0: "環境認識（4H・1H）更新\n今週の方針決定",
    1: "シグナル待機・エントリー判断\n全件記録",
    2: "シグナル待機・エントリー判断\n全件記録",
    3: "シグナル待機・エントリー判断\n全件記録",
    4: "シグナル待機・エントリー判断\n今週仮集計",
    5: "今週トレード振り返りメモ記録",
    6: "リョウと週次振り返りレポート確認",
  };
  return tasks[next] || "";
}

// ─── 列幅設定リクエスト生成 ──────────────────
function colWidthReq(sheetId, widths) {
  return widths.map((px, i) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px },
      fields: "pixelSize"
    }
  }));
}

// ─── ロードマップタブの追加・更新 ────────────
const SNS_ROADMAP = [
  ["7月末",  "1,150人", "55人",  "習慣定着",     "週次フロー定着・投稿3本/日"],
  ["8月末",  "1,400人", "90人",  "信頼構築",     "コンテンツ強化・DM導線"],
  ["9月末",  "1,750人", "130人", "権威性強化",   "DM導線整備・JVコンテンツ準備"],
  ["10月末", "2,200人", "170人", "販売導線整備", "JVコンテンツ最終準備"],
  ["11月末", "2,700人", "210人", "販売キャンペーン", "初販売チャレンジ"],
  ["12月末", "3,000人", "250人", "0→1達成",     "初収益獲得"],
];

const FX_ROADMAP = [
  ["7月末",  "10件", "計測のみ", "計測のみ", "ルール通り率90%が最優先"],
  ["8月末",  "10件", "35%+",    "1.0+",    "v3システム検証・RR1.8以上厳守"],
  ["9月末",  "10件", "40%+",    "1.2+",    "精度安定・週次振り返り定着"],
  ["10月末", "10件", "40%+",    "1.2+",    "データ蓄積・チャレンジ準備（9月実績で判断）"],
  ["11月末", "10件", "45%+",    "1.3+",    "チャレンジ申込・本番開始"],
  ["12月末", "10件", "50%+",    "1.5+",    "クオーツ合格・スケーリング開始"],
];

const COLOR_RM = {
  snsBg:    { red: 0.18, green: 0.32, blue: 0.52 },
  fxBg:     { red: 0.16, green: 0.45, blue: 0.30 },
  nowBg:    { red: 1.00, green: 0.95, blue: 0.75 },
  goalBg:   { red: 0.85, green: 0.95, blue: 0.88 },
};

function rmCell(value, bgColor, bold = false, textColor = null) {
  return {
    userEnteredValue: { stringValue: String(value) },
    userEnteredFormat: {
      backgroundColor: bgColor,
      textFormat: {
        foregroundColor: textColor || COLOR.white,
        bold,
      },
      wrapStrategy: "WRAP",
      verticalAlignment: "MIDDLE",
    }
  };
}

function rmDataCell(value, bg = null, bold = false) {
  return {
    userEnteredValue: { stringValue: String(value) },
    userEnteredFormat: {
      ...(bg ? { backgroundColor: bg } : {}),
      textFormat: { bold },
      wrapStrategy: "WRAP",
      verticalAlignment: "MIDDLE",
    }
  };
}

async function ensureRoadmapSheet(sheets, config) {
  const { sheetId } = config;

  // 既にroadmapSheetIdが保存済みならスキップ
  if (config.roadmapSheetId != null) return config;

  // シート追加
  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{
      addSheet: { properties: { title: "ロードマップ", index: 2 } }
    }]}
  });
  const rmSheetId = addRes.data.replies[0].addSheet.properties.sheetId;

  // 列幅設定
  const rmWidths = [80, 100, 90, 80, 120, 260];
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [
      ...colWidthReq(rmSheetId, rmWidths),
      { updateDimensionProperties: {
          range: { sheetId: rmSheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 44 }, fields: "pixelSize"
      }},
    ]}
  });

  // SNSヘッダー
  const snsHeader = [
    rmCell("📱 SNSロードマップ — 0→1達成へ（12月末）", COLOR_RM.snsBg, true),
    rmCell("", COLOR_RM.snsBg), rmCell("", COLOR_RM.snsBg),
    rmCell("", COLOR_RM.snsBg), rmCell("", COLOR_RM.snsBg), rmCell("", COLOR_RM.snsBg),
  ];
  const snsColHeader = [
    rmCell("月", COLOR.headerBg, true), rmCell("フォロワー目標", COLOR.headerBg, true),
    rmCell("OC目標", COLOR.headerBg, true), rmCell("フェーズ", COLOR.headerBg, true),
    rmCell("", COLOR.headerBg), rmCell("フォーカス", COLOR.headerBg, true),
  ];
  const snsRows = SNS_ROADMAP.map((r, i) => {
    const bg = i === 0 ? COLOR_RM.nowBg : (i === 5 ? COLOR_RM.goalBg : null);
    const tc = bg ? { red: 0.1, green: 0.1, blue: 0.1 } : null;
    return { values: r.map(v => bg
      ? rmCell(v, bg, i === 5, tc)
      : rmDataCell(v)
    )};
  });

  // FXヘッダー（SNS 1+1+6行 + 空1行 = 行9以降）
  const fxHeader = [
    rmCell("📈 FXロードマップ — フィントケイ クオーツ合格へ", COLOR_RM.fxBg, true),
    rmCell("", COLOR_RM.fxBg), rmCell("", COLOR_RM.fxBg),
    rmCell("", COLOR_RM.fxBg), rmCell("", COLOR_RM.fxBg), rmCell("", COLOR_RM.fxBg),
  ];
  const fxColHeader = [
    rmCell("月", COLOR.headerBg, true), rmCell("月間件数", COLOR.headerBg, true),
    rmCell("勝率目標", COLOR.headerBg, true), rmCell("PF目標", COLOR.headerBg, true),
    rmCell("", COLOR.headerBg), rmCell("フォーカス", COLOR.headerBg, true),
  ];
  const fxRows = FX_ROADMAP.map((r, i) => {
    const bg = i === 0 ? COLOR_RM.nowBg : (i === 5 ? COLOR_RM.goalBg : null);
    const tc = bg ? { red: 0.1, green: 0.1, blue: 0.1 } : null;
    return { values: r.map(v => bg
      ? rmCell(v, bg, i === 5, tc)
      : rmDataCell(v)
    )};
  });

  // 注釈行
  const noteRow = { values: [
    rmDataCell("※ チャレンジ申込は9月末実績で判断。勝率40%・PF1.2達成なら10月前倒し可。",
      null, false),
    rmDataCell(""), rmDataCell(""), rmDataCell(""), rmDataCell(""), rmDataCell(""),
  ]};

  // まとめて書き込み
  // 行レイアウト: 0=SNSヘッダー, 1=SNS列ヘッダー, 2〜7=SNSデータ, 8=空, 9=FXヘッダー, 10=FX列ヘッダー, 11〜16=FXデータ, 17=空, 18=注釈
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{
      updateCells: {
        range: { sheetId: rmSheetId, startRowIndex: 0, startColumnIndex: 0 },
        rows: [
          { values: snsHeader },
          { values: snsColHeader },
          ...snsRows,
          { values: Array(6).fill(rmDataCell("")) }, // 空行
          { values: fxHeader },
          { values: fxColHeader },
          ...fxRows,
          { values: Array(6).fill(rmDataCell("")) }, // 空行
          noteRow,
        ],
        fields: "userEnteredValue,userEnteredFormat"
      }
    }]}
  });

  // 1〜2行目を固定
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{
      updateSheetProperties: {
        properties: { sheetId: rmSheetId, gridProperties: { frozenRowCount: 2 } },
        fields: "gridProperties.frozenRowCount"
      }
    }]}
  });

  // config更新・保存
  config.roadmapSheetId = rmSheetId;
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`✅ ロードマップタブ作成完了 sheetId=${rmSheetId}`);
  return config;
}

// ─── スプレッドシート作成（初回のみ） ────────
async function getOrCreateSheet(sheets) {
  if (existsSync(CONFIG_PATH)) {
    const c = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (c.sheetId) return c;
  }

  // SNS列: 日付|やったこと|フォロワー進捗|OC進捗|投稿|リプ|いいね|課題|改善策|明日
  // FX列:  日付|やったこと|今月件数進捗|今日損益|ルール通り|課題|改善策|明日
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: "日報｜ゼロイチSNSラボ × FX" },
      sheets: [
        { properties: { title: "SNS日報",    sheetId: 0, index: 0 } },
        { properties: { title: "FX日報",     sheetId: 1, index: 1 } },
        { properties: { title: "ロードマップ", sheetId: 2, index: 2 } },
      ]
    },
    fields: "spreadsheetId,sheets.properties.sheetId"
  });

  const spreadsheetId = res.data.spreadsheetId;
  const snsSheetId = res.data.sheets[0].properties.sheetId;
  const fxSheetId  = res.data.sheets[1].properties.sheetId;

  // SNS列幅: 日付130 やったこと260 フォロワー170 OC170 投稿70 リプ70 いいね70 課題220 改善策220 明日220
  const snsWidths = [130, 260, 170, 170, 70, 70, 70, 220, 220, 220];
  // FX列幅:  日付130 やったこと260 今月件数170 損益120 ルール通り90 課題220 改善策220 明日220
  const fxWidths  = [130, 260, 170, 120, 90, 220, 220, 220];

  // 行高さ（1行目・2行目は目標行なので少し高く）
  const rowHeightReq = (sheetId, row, px) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: row, endIndex: row + 1 },
      properties: { pixelSize: px },
      fields: "pixelSize"
    }
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [
      // 列幅
      ...colWidthReq(snsSheetId, snsWidths),
      ...colWidthReq(fxSheetId,  fxWidths),
      // 行高さ
      rowHeightReq(snsSheetId, 0, 50),
      rowHeightReq(snsSheetId, 1, 50),
      rowHeightReq(snsSheetId, 2, 36),
      rowHeightReq(fxSheetId,  0, 50),
      rowHeightReq(fxSheetId,  1, 50),
      rowHeightReq(fxSheetId,  2, 36),
    ]}
  });

  // SNS：1行目（今月の目標）・2行目（今週の目標）・3行目（ヘッダー）
  const snsGoalRow1 = [
    cell("【今月の目標】", COLOR.monthBg, true),
    cell("フォロワー：1,150人（目標）", COLOR.monthBg, true),
    cell("進捗：実績/1,150人（%）", COLOR.monthBg),
    cell("OC：55人（目標）", COLOR.monthBg, true),
    cell("進捗：実績/55人（%）", COLOR.monthBg),
    cell("", COLOR.monthBg), cell("", COLOR.monthBg), cell("", COLOR.monthBg),
    cell("", COLOR.monthBg), cell("", COLOR.monthBg),
  ];
  const snsGoalRow2 = [
    cell("【今週の目標】", COLOR.weekBg, true),
    cell("晩投稿7本", COLOR.weekBg, true),
    cell("リプ5件/日", COLOR.weekBg, true),
    cell("いいね20件/日", COLOR.weekBg, true),
    cell("土曜OC投稿", COLOR.weekBg, true),
    cell("", COLOR.weekBg), cell("", COLOR.weekBg), cell("", COLOR.weekBg),
    cell("", COLOR.weekBg), cell("", COLOR.weekBg),
  ];
  const snsHeaderRow = [
    cell("日付", COLOR.headerBg, true),
    cell("今日やったこと", COLOR.headerBg, true),
    cell("フォロワー進捗", COLOR.headerBg, true),
    cell("OC進捗", COLOR.headerBg, true),
    cell("投稿", COLOR.headerBg, true),
    cell("リプ", COLOR.headerBg, true),
    cell("いいね", COLOR.headerBg, true),
    cell("課題", COLOR.headerBg, true),
    cell("改善策", COLOR.headerBg, true),
    cell("明日やること", COLOR.headerBg, true),
  ];

  // FX：1行目・2行目・3行目
  const fxGoalRow1 = [
    cell("【今月の目標】", COLOR.monthBg, true),
    cell("トレード：10件", COLOR.monthBg, true),
    cell("進捗：実績/10件（%）", COLOR.monthBg),
    cell("日次-5%ルール厳守", COLOR.monthBg, true),
    cell("全件記録", COLOR.monthBg, true),
    cell("", COLOR.monthBg), cell("", COLOR.monthBg), cell("", COLOR.monthBg),
  ];
  const fxGoalRow2 = [
    cell("【今週の目標】", COLOR.weekBg, true),
    cell("週2〜3件", COLOR.weekBg, true),
    cell("ルール通り率100%", COLOR.weekBg, true),
    cell("🔥3軸一致のみエントリー", COLOR.weekBg, true),
    cell("", COLOR.weekBg),
    cell("", COLOR.weekBg), cell("", COLOR.weekBg), cell("", COLOR.weekBg),
  ];
  const fxHeaderRow = [
    cell("日付", COLOR.headerBg, true),
    cell("今日やったこと", COLOR.headerBg, true),
    cell("今月件数進捗", COLOR.headerBg, true),
    cell("今日の損益", COLOR.headerBg, true),
    cell("ルール通り", COLOR.headerBg, true),
    cell("課題", COLOR.headerBg, true),
    cell("改善策", COLOR.headerBg, true),
    cell("明日やること", COLOR.headerBg, true),
  ];

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: "SNS日報!A1", values: [[]] }, // ダミー（batchUpdateで上書き）
        { range: "FX日報!A1",  values: [[]] },
      ]
    }
  });

  // rowDataで書き込み（色付き）
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [
      {
        updateCells: {
          range: { sheetId: snsSheetId, startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 10 },
          rows: [
            { values: snsGoalRow1 },
            { values: snsGoalRow2 },
            { values: snsHeaderRow },
          ],
          fields: "userEnteredValue,userEnteredFormat"
        }
      },
      {
        updateCells: {
          range: { sheetId: fxSheetId, startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 8 },
          rows: [
            { values: fxGoalRow1 },
            { values: fxGoalRow2 },
            { values: fxHeaderRow },
          ],
          fields: "userEnteredValue,userEnteredFormat"
        }
      },
      // 1〜3行目を固定（スクロールしても見える）
      { updateSheetProperties: { properties: { sheetId: snsSheetId, gridProperties: { frozenRowCount: 3 } }, fields: "gridProperties.frozenRowCount" } },
      { updateSheetProperties: { properties: { sheetId: fxSheetId,  gridProperties: { frozenRowCount: 3 } }, fields: "gridProperties.frozenRowCount" } },
    ]}
  });

  const config = { sheetId: spreadsheetId, snsSheetId, fxSheetId };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`✅ 日報スプレッドシート作成完了: ${spreadsheetId}`);
  return config;
}

// ─── メイン ──────────────────────────────
export async function main() {
  const auth   = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  let config  = await getOrCreateSheet(sheets);
  config = await ensureRoadmapSheet(sheets, config);
  const { sheetId, snsSheetId, fxSheetId } = config;
  const { today, dow, prefix } = getJST();
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}`;

  const fxToday    = await getFxTodayTrades(sheets, today);
  const fxMonthPrg = await getFxMonthProgress(sheets, prefix);

  // SNS日報に行追加（○×△はデフォルト○で入力済み・確認・修正はシートで）
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{
      appendCells: {
        sheetId: snsSheetId,
        rows: [{ values: [
          dataCell(today),
          dataCell(getSnsDidToday(dow)),
          dataCell(""),
          dataCell(""),
          dataCell("○"),
          dataCell("○"),
          dataCell("○"),
          dataCell("・投稿テーマが固定ポストの設計と連動しているか\n・OC流入があったか確認"),
          dataCell("・晩投稿CTAをOCへの誘導文に統一\n・リプは投稿前10分に固定"),
          dataCell(getSnsNextDay(dow)),
        ]}],
        fields: "userEnteredValue,userEnteredFormat"
      }
    }]}
  });

  // FX日報に行追加
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{
      appendCells: {
        sheetId: fxSheetId,
        rows: [{ values: [
          dataCell(today),
          dataCell(fxToday.summary),
          dataCell(fxMonthPrg),
          dataCell(fxToday.pips !== 0 ? `${fxToday.pips >= 0 ? "+" : ""}${fxToday.pips.toFixed(1)}pips` : "-"),
          dataCell("○"),
          dataCell(getFxChallenges(fxToday.pips)),
          dataCell(getFxImprovements(fxToday.pips)),
          dataCell(getFxNextDay(dow)),
        ]}],
        fields: "userEnteredValue,userEnteredFormat"
      }
    }]}
  });

  console.log(`✅ 日報追加完了: ${today}`);

  const msg = [
    "━━━━━━━━━━━━━━",
    `📝 ${today} 日報`,
    "━━━━━━━━━━━━━━",
    "",
    "【SNS】",
    "✅ " + getSnsDidToday(dow).split("\n")[0],
    "📌 課題：投稿テーマが固定ポストと連動しているか・OC流入確認",
    "💡 改善：晩投稿CTAをOC誘導文に統一・リプは投稿前10分に固定",
    "➡️ 明日：" + getSnsNextDay(dow).split("\n")[0],
    "",
    "【FX】",
    "✅ " + fxToday.summary.split("\n")[0],
    "📌 課題：" + getFxChallenges(fxToday.pips).split("\n")[0].replace("・", ""),
    "💡 改善：" + getFxImprovements(fxToday.pips).split("\n")[0].replace("・", ""),
    "➡️ 明日：" + getFxNextDay(dow).split("\n")[0],
    "",
    "▼ 修正があればシートで編集してください",
    sheetUrl,
    "━━━━━━━━━━━━━━",
  ].join("\n");

  await sendLine(msg);
  console.log("LINE通知送信完了");
}

const isMain = process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main().catch(console.error);
}
