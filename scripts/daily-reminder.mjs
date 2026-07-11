/**
 * 毎朝7:00 デイリーリマインダー
 * 平日：SNS+FX / 土日：SNS（FX休場）
 * 名言日替わり・残り日数・残り人数を自動計算
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OWNER_ID = process.env.LINE_OWNER_USER_ID;

// ── 目標値（「フォロワー更新して」と言われたらここを更新） ──
const GOAL = {
  followers: { current: 1012, target: 1150 },
  monthEnd: 31, // 7月は31日
};

// ── 日替わり名言 ──
const QUOTES = [
  "続けた人だけが見える景色がある",
  "小さな積み上げが、やがて大きな差になる",
  "今日の投稿が、未来のフォロワーへの手紙",
  "完璧より、継続。",
  "迷ったら動く。止まったら負ける",
  "結果は後からついてくる。今日もやるべきことをやる",
  "昨日より1ミリだけ前へ",
  "発信しない人には、誰も気づけない",
  "習慣が、才能を超える日が来る",
  "今日の自分が、1ヶ月後の自分をつくる",
  "やると決めたことを、やる。それだけ",
  "数字は正直。動いた分だけ動く",
  "焦らず、でも止まらず",
  "信頼は、毎日の投稿で積み上がる",
];

async function sendLine(text) {
  if (!OWNER_ID) {
    console.log("LINE_OWNER_USER_ID 未設定。コンソール出力：\n" + text);
    return;
  }
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
  console.log("✅ デイリーリマインダー送信完了");
}

export async function main() {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const month = jstNow.getUTCMonth() + 1;
  const day = jstNow.getUTCDate();
  const dow = jstNow.getUTCDay(); // 0=日, 6=土
  const isWeekend = dow === 0 || dow === 6;
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];

  // 残り日数・残りフォロワー
  const remainingDays = GOAL.monthEnd - day;
  const remainingFollowers = GOAL.followers.target - GOAL.followers.current;

  // 日替わり名言（日付でローテーション）
  const quote = QUOTES[day % QUOTES.length];

  let msg = `📱 ${month}/${day}(${dayNames[dow]}) おはようございます☀️\n\n`;
  msg += `【今日やること】\n`;

  if (isWeekend) {
    msg += `★★★ 朝・昼・晩の投稿（3本）\n`;
    msg += `★★☆ アウトバウンド（リプ5・いいね20）\n`;
    msg += `★★☆ 来週投稿ストック作成\n`;
    msg += `\n🚫 FX本日休場\n`;
  } else {
    msg += `★★★ 朝・昼・晩の投稿（3本）\n`;
    msg += `★★☆ アウトバウンド（リプ5・いいね20）\n`;
    msg += `★★☆ FX環境認識・シグナル確認\n`;
    msg += `★☆☆ FX夜振り返り・記録更新\n`;
  }

  msg += `\n「${quote}」\n`;
  msg += `━━━━━━━━━━\n`;
  msg += `今月残り${remainingDays}日｜${GOAL.followers.current}→${GOAL.followers.target}人🎯\n`;
  msg += `あと${remainingFollowers}人`;

  await sendLine(msg);
}

// 直接実行時のみ
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(console.error);
