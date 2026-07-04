/**
 * myfxbook → Googleスプレッドシート 自動記録（月別タブ）
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { google } from "googleapis";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const EMAIL = process.env.MYFXBOOK_EMAIL;
const PASSWORD = process.env.MYFXBOOK_PASSWORD;
const ACCOUNT_ID = process.env.MYFXBOOK_ACCOUNT_ID;
const SHEET_ID = process.env.TRADE_SHEET_ID;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OWNER_ID = process.env.LINE_OWNER_USER_ID;

const HEADERS = ['エントリー日時(JST)','決済日時(JST)','ペア','方向','ロット数','精度','エントリー価格','TP','LC','RR比','結果','損益(pips)','損益(円)','ルール通り','メモ','チャートURL(4H)','チャートURL(1H)','チャートURL(15M)','myfxbook_ID'];

// ── Google Sheets クライアント ────────────────────────
function getSheetsClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.sheets({ version: "v4", auth });
}

// ── LINE送信 ─────────────────────────────────────────
async function sendLine(text) {
  if (!OWNER_ID || !LINE_TOKEN) { console.log(text); return; }
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: OWNER_ID, messages: [{ type: "text", text }] }),
  });
}

// ── シグナルキャッシュから精度を照合 ─────────────────
const CACHE_PATH = join(__dirname, "../../logs/signal-cache.json");

function lookupPrecision(pair, openTimeStr) {
  if (!existsSync(CACHE_PATH)) return "";
  let cache = [];
  try { cache = JSON.parse(readFileSync(CACHE_PATH, "utf-8")); } catch { return ""; }

  const normalPair = pair.replace(/\./g, "").toUpperCase().replace("/", "");
  const openJST = toJSTDate(openTimeStr);
  if (!openJST) return "";

  // エントリー時刻の前後30分以内に同ペアのシグナルがあれば照合
  const WINDOW = 30 * 60 * 1000;
  const match = cache.find(c =>
    c.pair === normalPair &&
    Math.abs(new Date(c.time).getTime() - openJST.getTime()) <= WINDOW
  );
  if (!match) return "";
  return match.axes >= 3 ? "🔥 3軸" : "⚠️ 2軸";
}

// ── RR比からルール通りを判定 ──────────────────────────
function judgeRuleCompliance(tp, lc, entry) {
  if (!tp || !lc || !entry || tp === 0 || lc === 0) return "△"; // TP/LC未設定
  const reward = Math.abs(tp - entry);
  const risk = Math.abs(lc - entry);
  if (risk === 0) return "△";
  const rr = reward / risk;
  if (rr >= 1.5) return "○";
  if (rr >= 1.0) return "△";
  return "×";
}

// ── myfxbookログイン ──────────────────────────────────
async function getSession() {
  const res = await fetch(
    `https://www.myfxbook.com/api/login.json?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`
  );
  const data = await res.json();
  if (data.error) throw new Error("myfxbookログイン失敗: " + data.message);
  return data.session;
}

// ── 決済済みトレード取得 ──────────────────────────────
async function getClosedTrades(session) {
  const res = await fetch(
    `https://www.myfxbook.com/api/get-history.json?session=${session}&id=${ACCOUNT_ID}`
  );
  const data = await res.json();
  if (data.error) throw new Error("トレード取得失敗: " + data.message);
  return data.history || [];
}

// ── 月タブが存在しなければ作成 ───────────────────────
async function ensureMonthSheet(sheets, monthTab) {
  const info = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = info.data.sheets.find(s => s.properties.title === monthTab);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: monthTab } } }] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${monthTab}!A1:S1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS] }
  });
  const info2 = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheetId = info2.data.sheets.find(s => s.properties.title === monthTab)?.properties.sheetId;
  if (sheetId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 1, green: 1, blue: 1 },
            textFormat: { bold: true, foregroundColor: { red: 0, green: 0, blue: 0 }, fontSize: 11 },
            horizontalAlignment: "CENTER",
            borders: { bottom: { style: "SOLID_MEDIUM", color: { red: 0, green: 0, blue: 0 } } }
          }}, fields: "userEnteredFormat" }},
        { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" }},
      ]}
    });
  }
  console.log(`新しいタブを作成: ${monthTab}`);
}

// ── 全タブから既存IDを取得 ───────────────────────────
async function getExistingIds(sheets) {
  const info = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const allIds = new Set();
  for (const sheet of info.data.sheets) {
    const title = sheet.properties.title;
    if (title === "シート1") continue;
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${title}!Q2:Q1000`,
      });
      (res.data.values || []).flat().forEach(id => allIds.add(id));
    } catch {}
  }
  return allIds;
}

// ── myfxbook日時 → JSTのDateオブジェクト ────────────
function toJSTDate(str) {
  if (!str) return null;
  const [datePart, timePart] = str.split(" ");
  const [mm, dd, yyyy] = datePart.split("/");
  const dt = new Date(`${yyyy}-${mm}-${dd}T${timePart}:00Z`);
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000);
}

// ── myfxbook日時 → JST変換 ───────────────────────────
function toJST(str) {
  const jst = toJSTDate(str);
  if (!jst) return { date: "", time: "", monthTab: "" };
  const y = jst.getUTCFullYear();
  const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const h = String(jst.getUTCHours()).padStart(2, "0");
  const min = String(jst.getUTCMinutes()).padStart(2, "0");
  return { date: `${y}/${mo}/${d}`, time: `${h}:${min}`, monthTab: `${y}/${mo}` };
}

// ── トレードデータを整形 ──────────────────────────────
function formatTrade(t) {
  const open = toJST(t.openTime);
  const close = toJST(t.closeTime);
  const monthTab = close.monthTab || open.monthTab;
  const date = close.date || open.date;
  const pair = (t.symbol || "").replace(/\./g, "").toUpperCase();
  const direction = t.action === "Buy" ? "ロング" : t.action === "Sell" ? "ショート" : t.action;
  const pips = parseFloat(t.pips || 0);
  const profit = parseFloat(t.profit || 0);
  const result = pips > 0 ? "勝ち" : pips < 0 ? "負け" : "BE";
  const pipsStr = pips > 0 ? `+${pips.toFixed(1)}` : pips.toFixed(1);
  const entry = parseFloat(t.openPrice || 0);
  const tp = parseFloat(t.tp || 0);
  const lc = parseFloat(t.sl || 0);
  const lots = t.sizing?.value || "";

  let rr = "";
  if (tp > 0 && lc > 0 && entry > 0) {
    const reward = Math.abs(tp - entry);
    const risk = Math.abs(lc - entry);
    if (risk > 0) rr = "1:" + (reward / risk).toFixed(1);
  }

  // 精度：シグナルキャッシュと照合（エントリー時刻±30分）
  const precision = lookupPrecision(pair, t.openTime);

  // ルール通り：RR比から自動判定
  const ruleCompliance = judgeRuleCompliance(tp, lc, entry);

  const openDateTime = open.date && open.time ? `${open.date} ${open.time}` : "";
  const closeDateTime = close.date && close.time ? `${close.date} ${close.time}` : "";

  return {
    monthTab,
    row: [
      openDateTime, closeDateTime, pair, direction, lots, precision,
      entry > 0 ? entry.toFixed(3) : "",
      tp > 0 ? tp.toFixed(3) : "",
      lc > 0 ? lc.toFixed(3) : "",
      rr, result, pipsStr, profit.toFixed(0), ruleCompliance, "",
      "", "", "",  // チャートURL(4H), チャートURL(1H), チャートURL(15M)
      String(t.id || ""),
    ]
  };
}

// ── 連敗アラート ──────────────────────────────────────
async function checkLosingStreak(trades) {
  // 直近トレードを決済時刻の新しい順に並べる
  const sorted = [...trades]
    .filter(t => t.closeTime)
    .sort((a, b) => new Date(toJSTDate(b.closeTime)) - new Date(toJSTDate(a.closeTime)));

  if (sorted.length === 0) return;

  // 連続負けを数える
  let streak = 0;
  for (const t of sorted) {
    if (parseFloat(t.pips || 0) < 0) {
      streak++;
    } else {
      break; // 勝ちが出たら終了
    }
  }

  console.log(`連敗チェック: 現在${streak}連敗`);

  if (streak >= 3) {
    const msgs = {
      3: `⚠️ 3連敗アラート\n\n直近3トレードが連続負けです。\n\n今日はいったんトレードを停止して、\nルール通りにエントリーできていたか振り返ることをおすすめします。\n\n📊 シートで確認：\nhttps://docs.google.com/spreadsheets/d/${SHEET_ID}`,
      5: `🚨 5連敗アラート\n\n直近5トレードが連続負けです。\n\n今日のトレードを全て停止してください。\nエントリー条件・ルールの根本的な見直しが必要かもしれません。\n\n📊 シートで確認：\nhttps://docs.google.com/spreadsheets/d/${SHEET_ID}`,
    };

    if (streak === 3 || streak === 5) {
      await sendLine(msgs[streak]);
    } else if (streak > 5 && streak % 2 === 1) {
      // 7連敗以降は奇数のたびに通知（しつこくなりすぎないよう）
      await sendLine(`🚨 ${streak}連敗アラート\n\n直近${streak}トレードが連続負けです。本日のトレードを停止してください。`);
    }
  }
}

// ── 凡例タブを作成（初回のみ） ────────────────────────
async function ensureLegendSheet(sheets) {
  const info = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  if (info.data.sheets.find(s => s.properties.title === "凡例")) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: "凡例", index: 0 } } }] }
  });

  const legend = [
    ["📋 FXトレード記録 － 凡例"],
    [""],
    ["【精度】シグナルの信頼度"],
    ["🔥 3軸", "4H・1H・15M すべてのトレンドが一致（高精度）。最優先でエントリーを検討"],
    ["⚠️ 2軸", "4H・1H または 1H・15M の2軸が一致（中精度）。慎重に判断"],
    ["（空欄）", "シグナル外のエントリー。または手動エントリーのため自動判定なし"],
    [""],
    ["【ルール通り】トレードルール遵守度"],
    ["○", "RR比 1.5以上。ルール通りにエントリー・決済できた"],
    ["△", "RR比 1.0〜1.5。またはTP/LCが未設定。一部ルールを守れなかった"],
    ["×", "RR比 1.0未満。ルール違反（利確が早すぎ、または損切りが遅すぎ）"],
    [""],
    ["【日時フォーマット】"],
    ["エントリー日時(JST)", "例：2026/07/04 22:15　※日をまたぐトレードも正確に記録"],
    ["決済日時(JST)", "例：2026/07/05 09:30"],
    [""],
    ["【チャートURL】TradingViewのチャートリンク"],
    ["チャートURL(4H)", "環境認識用（4時間足）。エントリー前のスクリーンショットリンクを貼る"],
    ["チャートURL(1H)", "トレンド確認用（1時間足）"],
    ["チャートURL(15M)", "エントリー根拠用（15分足）。ネックラインブレイクの確認"],
    [""],
    ["【振り返りのコツ】"],
    ["・ルール通り×のトレードだけ抽出して勝率を比較する"],
    ["・🔥3軸と⚠️2軸それぞれの勝率を週報で確認する"],
    ["・チャートURLを見ながら月報の「振り返り」欄を埋める"],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: "凡例!A1",
    valueInputOption: "RAW",
    requestBody: { values: legend }
  });

  // タイトル行を太字・背景色
  const newInfo = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sid = newInfo.data.sheets.find(s => s.properties.title === "凡例")?.properties.sheetId;
  if (sid !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [
        { repeatCell: {
            range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 13 }, backgroundColor: { red: 0.2, green: 0.6, blue: 0.9 } } },
            fields: "userEnteredFormat(textFormat,backgroundColor)"
        }},
        { repeatCell: {
            range: { sheetId: sid, startRowIndex: 2, endRowIndex: 3 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 1, green: 0.95, blue: 0.8 } } },
            fields: "userEnteredFormat(textFormat,backgroundColor)"
        }},
        { repeatCell: {
            range: { sheetId: sid, startRowIndex: 7, endRowIndex: 8 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.85, green: 0.95, blue: 0.85 } } },
            fields: "userEnteredFormat(textFormat,backgroundColor)"
        }},
        { repeatCell: {
            range: { sheetId: sid, startRowIndex: 12, endRowIndex: 13 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.9, green: 0.9, blue: 1 } } },
            fields: "userEnteredFormat(textFormat,backgroundColor)"
        }},
        { updateDimensionProperties: {
            range: { sheetId: sid, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 160 }, fields: "pixelSize"
        }},
        { updateDimensionProperties: {
            range: { sheetId: sid, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
            properties: { pixelSize: 500 }, fields: "pixelSize"
        }},
      ]}
    });
  }
  console.log("✅ 凡例タブ作成");
}

// ── メイン ────────────────────────────────────────────
export async function main() {
  if (!EMAIL || !PASSWORD || !ACCOUNT_ID || !SHEET_ID) {
    console.log("myfxbook または Sheets の設定が不足しています");
    return;
  }

  const session = await getSession();
  const trades = await getClosedTrades(session);
  if (trades.length === 0) { console.log("トレードなし"); return; }

  const sheets = getSheetsClient();
  await ensureLegendSheet(sheets);
  const existingIds = await getExistingIds(sheets);

  const newTrades = trades.slice(0, 100).filter(t => !existingIds.has(String(t.id)));
  if (newTrades.length === 0) { console.log("未記録のトレードはありません"); return; }

  // 月別にグループ化
  const byMonth = {};
  for (const t of newTrades) {
    const { monthTab, row } = formatTrade(t);
    if (!monthTab) continue;
    if (!byMonth[monthTab]) byMonth[monthTab] = [];
    byMonth[monthTab].push(row);
  }

  // 月タブに追記
  for (const [monthTab, rows] of Object.entries(byMonth)) {
    await ensureMonthSheet(sheets, monthTab);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${monthTab}!A:S`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    });
    console.log(`✅ ${monthTab}：${rows.length}件追記`);
  }

  const total = newTrades.length;
  const summary = newTrades.slice(0, 5).map(t => {
    const pips = parseFloat(t.pips || 0);
    return `・${t.symbol} ${t.action === "Buy" ? "ロング" : "ショート"} ${pips > 0 ? "+" : ""}${pips.toFixed(1)}pips`;
  }).join("\n");

  await sendLine(`📝 トレード記録を更新しました！（${total}件）\n\n${summary}${total > 5 ? "\n　他" + (total - 5) + "件" : ""}\n\n📊 シートで確認：\nhttps://docs.google.com/spreadsheets/d/${SHEET_ID}`);

  // 連敗アラートチェック（全トレードで判定）
  await checkLosingStreak(trades);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(console.error);
