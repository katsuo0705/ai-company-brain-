/**
 * FX日次サマリー
 * 毎日21:00にその日の損益・勝敗・今月累計をLINEに送信
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const EMAIL = process.env.MYFXBOOK_EMAIL;
const PASSWORD = process.env.MYFXBOOK_PASSWORD;
const ACCOUNT_ID = process.env.MYFXBOOK_ACCOUNT_ID;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OWNER_ID = process.env.LINE_OWNER_USER_ID;

async function sendLine(text) {
  if (!OWNER_ID || !LINE_TOKEN) { console.log(text); return; }
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: OWNER_ID, messages: [{ type: "text", text }] }),
  });
}

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

function toJST(str) {
  if (!str) return null;
  const [datePart, timePart] = str.split(" ");
  const [mm, dd, yyyy] = datePart.split("/");
  const dt = new Date(`${yyyy}-${mm}-${dd}T${timePart}:00Z`);
  return new Date(dt.getTime() + 9 * 60 * 60 * 1000);
}

export async function main() {
  if (!EMAIL || !PASSWORD || !ACCOUNT_ID) return;

  const session = await getSession();
  const [trades, account] = await Promise.all([
    getAllTrades(session),
    getAccountInfo(session),
  ]);

  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayY = jstNow.getUTCFullYear();
  const todayM = jstNow.getUTCMonth() + 1;
  const todayD = jstNow.getUTCDate();

  // 今日のトレード
  const todayTrades = trades.filter(t => {
    const closeJST = toJST(t.closeTime);
    return closeJST &&
      closeJST.getUTCFullYear() === todayY &&
      closeJST.getUTCMonth() + 1 === todayM &&
      closeJST.getUTCDate() === todayD;
  });

  // 今月のトレード
  const monthTrades = trades.filter(t => {
    const closeJST = toJST(t.closeTime);
    return closeJST &&
      closeJST.getUTCFullYear() === todayY &&
      closeJST.getUTCMonth() + 1 === todayM;
  });

  const todayProfit = todayTrades.reduce((s, t) => s + parseFloat(t.profit || 0), 0);
  const monthProfit = monthTrades.reduce((s, t) => s + parseFloat(t.profit || 0), 0);
  const todayWins = todayTrades.filter(t => parseFloat(t.pips || 0) > 0).length;
  const todayLosses = todayTrades.filter(t => parseFloat(t.pips || 0) < 0).length;
  const balance = parseFloat(account.balance || account.equity || 0);

  const profitSign = (v) => (v > 0 ? "+" : "") + Math.round(v).toLocaleString();
  const dateLabel = `${todayM}/${todayD}`;

  // 取引なしの場合
  if (todayTrades.length === 0) {
    await sendLine(
      `📅 本日の結果（${dateLabel}）\n\n取引なし\n\n今月累計：${profitSign(monthProfit)}円${balance > 0 ? `\n口座残高：${Math.round(balance).toLocaleString()}円` : ""}`
    );
    return;
  }

  // 明日への一言（ルールベース）
  let advice = "";
  if (todayLosses >= 3) {
    advice = "\n\n⚠️ 明日は少し休んで、エントリー条件を見直してみてください。";
  } else if (todayWins > 0 && todayLosses === 0) {
    advice = "\n\n✅ 今日はルール通り動けましたか？この調子で継続しましょう。";
  } else if (todayProfit > 0) {
    advice = "\n\n👍 プラスで終われました。明日も同じ基準でエントリーしましょう。";
  }

  const msg =
    `📅 本日の結果（${dateLabel}）\n\n` +
    `取引数：${todayTrades.length}回　勝敗：${todayWins}勝${todayLosses}敗\n` +
    `損益：${profitSign(todayProfit)}円\n` +
    `今月累計：${profitSign(monthProfit)}円` +
    (balance > 0 ? `\n口座残高：${Math.round(balance).toLocaleString()}円` : "") +
    advice;

  await sendLine(msg);
  console.log("✅ 日次サマリー送信完了");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(console.error);
