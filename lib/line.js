// LINE 連携（Messaging API）
// - 署名検証つき webhook で「LINEからAI社員への指示（inbound）」を受ける
// - 返信は reply / push で行う
// - 壁アプリ用に、直近のやり取りをメモリに保持（無料枠の再起動で消える簡易版）
import crypto from "node:crypto";

const recent = []; // { who: 'them'|'me', text }

export function lineConfigured() {
  return !!(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET);
}

// webhook 署名検証（rawBody が必要）
export function verifySignature(rawBody, signature) {
  if (!process.env.LINE_CHANNEL_SECRET) return false;
  const hash = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  return hash === signature;
}

export function pushRecent(who, text) {
  recent.push({ who, text });
  while (recent.length > 20) recent.shift();
}

export function getRecent() {
  if (!lineConfigured()) return { configured: false, messages: [] };
  return { configured: true, messages: recent.slice(-12) };
}

export function isOwner(userId) {
  const owner = process.env.LINE_OWNER_USER_ID;
  if (!owner) return true; // 未設定なら全員許可（最初の userId 確認に使える）
  return userId === owner;
}

async function lineFetch(path, body) {
  const res = await fetch("https://api.line.me/v2/bot" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.LINE_CHANNEL_ACCESS_TOKEN,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("LINE API error: " + res.status + " " + (await res.text()));
  return res.json().catch(() => ({}));
}

export async function replyText(replyToken, text) {
  if (!lineConfigured()) return;
  await lineFetch("/message/reply", { replyToken, messages: [{ type: "text", text }] });
}

export async function pushText(to, text) {
  if (!lineConfigured()) return;
  await lineFetch("/message/push", { to, messages: [{ type: "text", text }] });
}
