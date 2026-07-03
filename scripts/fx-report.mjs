/**
 * FX週報・月報 自動生成
 * myfxbook → トレード記録と同じスプレッドシートの週報・月報タブに集計＋ルールベース改善提案
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { google } from "googleapis";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const EMAIL = process.env.MYFXBOOK_EMAIL;
const PASSWORD = process.env.MYFXBOOK_PASSWORD;
const ACCOUNT_ID = process.env.MYFXBOOK_ACCOUNT_ID;
// 日々の記録と同じスプレッドシートに統合
const SHEET_ID = process.env.TRADE_SHEET_ID;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OWNER_ID = process.env.LINE_OWNER_USER_ID;

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

// ── myfxbook ─────────────────────────────────────────
async function getSession() {
  const res = await fetch(
    `https://www.myfxbook.com/api/login.json?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`
  );
  const data = await res.json();
  if (data.error) throw new Error("ログイン失敗: " + data.message);
  return data.session;
}

async function getAllTrades(session) {
  const res = await fetch(
    `https://www.myfxbook.com/api/get-history.json?session=${session}&id=${ACCOUNT_ID}`
  );
  const data = await res.json();
  if (data.error) throw new Error("取得失敗: " + data.message);
  return data.history || [];
}

async function getAccountInfo(session) {
  const res = await fetch(
    `https://www.myfxbook.com/api/get-my-accounts.json?session=${session}`
  );
  const data = await res.json();
  const account = (data.accounts || []).find(a => String(a.id) === String(ACCOUNT_ID));
  return account || {};
}

// ── 日時変換（myfxbook → JST） ───────────────────────
function toJST(str) {
  if (!str) return null;
  const [datePart, timePart] = str.split(" ");
  const [mm, dd, yyyy] = datePart.split("/");
  const dt = new Date(`${yyyy}-${mm}-${dd}T${timePart}:00Z`);
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000);
}

// ── 統計計算 ──────────────────────────────────────────
function calcStats(trades, balance) {
  if (trades.length === 0) return null;

  const wins = trades.filter(t => parseFloat(t.pips) > 0);
  const losses = trades.filter(t => parseFloat(t.pips) < 0);
  const winRate = Math.round((wins.length / trades.length) * 100);
  const totalProfit = trades.reduce((s, t) => s + parseFloat(t.profit || 0), 0);

  // 平均RR
  let rrSum = 0, rrCount = 0;
  for (const t of trades) {
    const entry = parseFloat(t.openPrice || 0);
    const tp = parseFloat(t.tp || 0);
    const sl = parseFloat(t.sl || 0);
    if (tp > 0 && sl > 0 && entry > 0) {
      const reward = Math.abs(tp - entry);
      const risk = Math.abs(sl - entry);
      if (risk > 0) { rrSum += reward / risk; rrCount++; }
    }
  }
  const avgRR = rrCount > 0 ? parseFloat((rrSum / rrCount).toFixed(2)) : "-";

  // 最大ドローダウン
  let peak = 0, dd = 0, running = 0;
  for (const t of trades) {
    running += parseFloat(t.profit || 0);
    if (running > peak) peak = running;
    const drawdown = peak - running;
    if (drawdown > dd) dd = drawdown;
  }
  const maxDD = balance > 0 ? parseFloat(((dd / balance) * 100).toFixed(2)) : 0;

  // 期待値
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + parseFloat(t.profit || 0), 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + parseFloat(t.profit || 0), 0) / losses.length) : 0;
  const expectancy = parseFloat(((winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss).toFixed(0));

  // 破産確率（簡易）
  const bankruptcyRisk = winRate < 30 ? 100 : winRate < 40 ? 80 : winRate < 50 ? 50 : winRate < 60 ? 20 : 5;

  return { winRate, totalProfit, avgRR, maxDD, expectancy, bankruptcyRisk, count: trades.length };
}

// ── ルールベース改善分析 ──────────────────────────────
function analyzeAndImprove(stats) {
  if (!stats) return { review: "取引なし", improve: "-" };

  const points = [];
  const improvements = [];

  if (stats.winRate === 0) {
    points.push("全敗。エントリールールの根本的な見直しが必要");
    improvements.push("4H・1H・15Mの3軸確認を徹底し、全軸一致のときのみエントリーする");
  } else if (stats.winRate < 30) {
    points.push(`勝率${stats.winRate}%と低い。エントリー精度に課題あり`);
    improvements.push("ネックライン終値ブレイクの確認を厳密に行う。ダマシが多い場合は15M足の確定を待つ");
  } else if (stats.winRate < 50) {
    points.push(`勝率${stats.winRate}%。改善の余地あり`);
    improvements.push("エントリー根拠が揃っているか再確認。3軸一致のシグナルに絞ることを検討");
  } else {
    points.push(`勝率${stats.winRate}%。良好な水準`);
  }

  if (stats.avgRR !== "-") {
    const rr = parseFloat(stats.avgRR);
    if (rr < 1.0) {
      points.push(`RR比${stats.avgRR}と低い。利確が早すぎるか損切りが遅い`);
      improvements.push("E値・N値まで利確を引っ張る練習をする。損切りは直近安値/高値±3pipsを徹底");
    } else if (rr < 1.5) {
      points.push(`RR比${stats.avgRR}。目標の1.5以上に届いていない`);
      improvements.push("RR1.5未満のシグナルはスキップする。TP位置をE値に設定してから動かさない");
    } else if (rr < 2.0) {
      points.push(`RR比${stats.avgRR}。標準的な水準`);
      improvements.push("RR2.0以上を目指してTP位置をN値まで伸ばすことを意識する");
    } else {
      points.push(`RR比${stats.avgRR}。優秀なリスクリワード`);
    }
  }

  if (stats.count > 20) {
    points.push(`取引回数${stats.count}回。オーバートレードの可能性`);
    improvements.push("🔥3軸一致シグナルのみに絞り、週5回以内に抑える");
  } else if (stats.count > 10) {
    points.push(`取引回数${stats.count}回。やや多め`);
    improvements.push("重要指標前後のトレードを避け、質の高いシグナルのみ選別する");
  } else if (stats.count === 0) {
    points.push("取引なし");
  } else {
    points.push(`取引回数${stats.count}回。適切な水準`);
  }

  const dd = parseFloat(stats.maxDD);
  if (dd > 20) {
    points.push(`最大DD${stats.maxDD}%。リスク管理の見直しが必要`);
    improvements.push("1トレードのリスクを資金の1〜2%以内に抑える。ロットを下げることを検討");
  } else if (dd > 10) {
    points.push(`最大DD${stats.maxDD}%。やや大きい`);
    improvements.push("連敗時は1日のトレードを停止するルールを設ける");
  }

  if (stats.totalProfit < 0) {
    points.push(`損益${Math.round(stats.totalProfit).toLocaleString()}円のマイナス`);
  } else {
    points.push(`損益+${Math.round(stats.totalProfit).toLocaleString()}円のプラス`);
  }

  const review = points.join("。\n");
  const improve = improvements.length > 0
    ? improvements.map((imp, i) => `${i + 1}. ${imp}`).join("\n")
    : "現状のルールを継続";

  return { review, improve };
}

// ── カンマ書式（#,##0）を列に適用 ────────────────────
async function applyNumberFormat(sheets, sheetId, colIndices, startRow = 1) {
  const requests = colIndices.map(colIndex => ({
    repeatCell: {
      range: { sheetId, startRowIndex: startRow, endRowIndex: 200, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } },
      fields: "userEnteredFormat.numberFormat",
    }
  }));
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } });
}

// ── タブのsheetIdを取得 ───────────────────────────────
async function getSheetId(sheets, tabName) {
  const info = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  return info.data.sheets.find(s => s.properties.title === tabName)?.properties.sheetId;
}

// ── 週の日付範囲文字列を生成 ─────────────────────────
function getWeekLabel(date) {
  const d = new Date(date);
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  const fmt = (dt) => `${dt.getMonth() + 1}/${dt.getDate()}`;
  return `${fmt(mon)}~${fmt(fri)}`;
}

// ── 週報タブを確認・作成 ──────────────────────────────
async function ensureWeeklyTab(sheets, tabName) {
  const info = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = info.data.sheets.find(s => s.properties.title === tabName);
  if (existing) return existing.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
  });
  // ヘッダー行
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1:G1`,
    valueInputOption: "RAW",
    requestBody: { values: [["期間", "運用資金(円)", "損益(円)", "RR比率", "取引回数", "勝率", "気付き・改善点（AI分析）"]] }
  });
  // ヘッダー書式
  const newInfo = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sid = newInfo.data.sheets.find(s => s.properties.title === tabName)?.properties.sheetId;
  if (sid !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [
        { repeatCell: {
            range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.9, green: 0.95, blue: 1 } } },
            fields: "userEnteredFormat(textFormat,backgroundColor)"
        }},
        { updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" }},
      ]}
    });
  }
  console.log(`週報タブ作成: ${tabName}`);
  return sid;
}

// ── 週報を更新 ────────────────────────────────────────
async function updateWeeklyReport(sheets, trades, balance) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const tabName = `${year}/${month}週報`;

  const sid = await ensureWeeklyTab(sheets, tabName);

  // 今週のトレードを抽出
  const weekStart = new Date(now);
  const day = weekStart.getDay();
  weekStart.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  weekStart.setHours(0, 0, 0, 0);

  const thisWeekTrades = trades.filter(t => {
    const closeJST = toJST(t.closeTime);
    return closeJST && closeJST >= weekStart;
  });

  const stats = calcStats(thisWeekTrades, balance);
  const { review, improve } = analyzeAndImprove(stats);
  const weekLabel = getWeekLabel(now);
  const comment = stats ? `${review}\n\n【AI改善提案】\n${improve}` : "取引なし";

  // 既存行を確認（上書きか追記か）
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: `${tabName}!A2:A50`,
  });
  const rows = existing.data.values || [];
  const rowIndex = rows.findIndex(r => r[0] === weekLabel);
  const targetRow = rowIndex >= 0 ? rowIndex + 2 : rows.length + 2;

  // 数値はそのまま数値で入れる（USER_ENTERED でカンマ書式が効く）
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A${targetRow}:G${targetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[
      weekLabel,
      Math.round(balance),
      stats ? Math.round(stats.totalProfit) : 0,
      stats && stats.avgRR !== "-" ? stats.avgRR : "-",
      stats ? stats.count : 0,
      stats ? `${stats.winRate}%` : "0%",
      comment,
    ]] }
  });

  // カンマ書式を適用（B列=1, C列=2）
  if (sid !== undefined) {
    await applyNumberFormat(sheets, sid, [1, 2]);
  }

  console.log(`✅ 週報更新: ${tabName} ${weekLabel}`);
  return { tabName, weekLabel, stats };
}

// ── 月報タブを確認・作成 ──────────────────────────────
async function ensureMonthlyTab(sheets, year) {
  const tabName = `${year}月報`;
  const info = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = info.data.sheets.find(s => s.properties.title === tabName);
  if (existing) return existing.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1:L1`,
    valueInputOption: "RAW",
    requestBody: { values: [["月", "運用資金(円)", "損益(円)", "勝率(%)", "リスクリワード", "許容損失率", "取引回数", "最大ドローダウン(%)", "破産確率(%)", "期待値(円)", "今月の振り返り", "来月の改善策"]] }
  });
  const newInfo = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sid = newInfo.data.sheets.find(s => s.properties.title === tabName)?.properties.sheetId;
  if (sid !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [
        { repeatCell: {
            range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 1, green: 0.95, blue: 0.9 } } },
            fields: "userEnteredFormat(textFormat,backgroundColor)"
        }},
        { updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" }},
      ]}
    });
  }
  console.log("月報タブ作成");
  return sid;
}

// ── 月報を更新 ────────────────────────────────────────
async function updateMonthlyReport(sheets, trades, balance) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const tabName = `${year}月報`;
  const sid = await ensureMonthlyTab(sheets, year);

  // 今月のトレードを抽出
  const thisMonthTrades = trades.filter(t => {
    const closeJST = toJST(t.closeTime);
    return closeJST &&
      closeJST.getFullYear() === year &&
      closeJST.getMonth() + 1 === month;
  });

  const stats = calcStats(thisMonthTrades, balance);
  const { review, improve } = analyzeAndImprove(stats);
  const monthLabel = `${year}年${month}月`;
  const reviewComment = stats ? `${review}\n\n【AI改善提案】\n${improve}` : "取引なし";

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: `${tabName}!A2:A50`,
  });
  const rows = existing.data.values || [];
  const rowIndex = rows.findIndex(r => r[0] === monthLabel);
  const targetRow = rowIndex >= 0 ? rowIndex + 2 : rows.length + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A${targetRow}:L${targetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[
      monthLabel,
      Math.round(balance),
      stats ? Math.round(stats.totalProfit) : 0,
      stats ? stats.winRate : 0,
      stats && stats.avgRR !== "-" ? stats.avgRR : "-",
      2,
      stats ? stats.count : 0,
      stats ? stats.maxDD : 0,
      stats ? stats.bankruptcyRisk : "-",
      stats ? stats.expectancy : 0,
      reviewComment,
      "",
    ]] }
  });

  // カンマ書式を適用（B列=1, C列=2, J列=9）
  if (sid !== undefined) {
    await applyNumberFormat(sheets, sid, [1, 2, 9]);
  }

  console.log(`✅ 月報更新: ${tabName} ${monthLabel}`);
  return { monthLabel, stats };
}

// ── メイン ────────────────────────────────────────────
export async function main() {
  if (!SHEET_ID) { console.log("TRADE_SHEET_ID が未設定です"); return; }

  const session = await getSession();
  const [trades, account] = await Promise.all([
    getAllTrades(session),
    getAccountInfo(session),
  ]);

  const balance = parseFloat(account.balance || account.equity || 1000000);
  const sheets = getSheetsClient();

  const [weekly, monthly] = await Promise.all([
    updateWeeklyReport(sheets, trades, balance),
    updateMonthlyReport(sheets, trades, balance),
  ]);

  const ws = weekly.stats;
  const ms = monthly.stats;
  const msg = `📊 週報・月報を更新しました！

【今週 ${weekly.weekLabel}】
取引数：${ws ? ws.count : 0}回
勝率：${ws ? ws.winRate + "%" : "-"}
RR：${ws ? ws.avgRR : "-"}
損益：${ws ? (ws.totalProfit > 0 ? "+" : "") + Math.round(ws.totalProfit).toLocaleString() + "円" : "-"}

【今月】
取引数：${ms ? ms.count : 0}回
勝率：${ms ? ms.winRate + "%" : "-"}
損益：${ms ? (ms.totalProfit > 0 ? "+" : "") + Math.round(ms.totalProfit).toLocaleString() + "円" : "-"}

📋 シートで確認：
https://docs.google.com/spreadsheets/d/${SHEET_ID}`;

  await sendLine(msg);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(console.error);
