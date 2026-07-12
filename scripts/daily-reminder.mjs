/**
 * 毎朝7:00 デイリーリマインダー
 * 平日：SNS+FX / 土日：SNS（FX休場）
 * 名言日替わり・残り日数・残り人数を自動計算
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { buildDailyTaskMessage } from "./daily-task.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OWNER_ID = process.env.LINE_OWNER_USER_ID;

const GOAL = {
  followers: { current: 1012, target: 1150 },
  monthEnd: 31,
};

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
  "見てる人は、必ずいる",
  "量をこなした先に、質が生まれる",
  "今日サボった分、明日の自分が困る",
  "フォロワーは増やすより、信頼を積む",
  "1投稿が、誰かの背中を押すかもしれない",
  "継続は、最強の差別化戦略",
  "動き続ける人に、チャンスは集まる",
  "うまくいかない日も、投稿した日は前進した日",
  "発信とは、自分の言葉で世界に存在すること",
  "今日の種まきが、来月の実りになる",
  "止まらなければ、必ずどこかに着く",
  "比べるのは昨日の自分だけでいい",
  "コツコツは、いつか爆発する",
  "やめない人が、最後に残る",
  "今日も、ひとつだけ前に進めばいい",
  "積み上げた日々は、誰にも奪えない財産",
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
  const dow = jstNow.getUTCDay();
  const isWeekend = dow === 0 || dow === 6;
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
  const remainingDays = GOAL.monthEnd - day;
  const quote = QUOTES[day % QUOTES.length];

  const taskMsg = buildDailyTaskMessage();
  const taskBody = taskMsg.split("\n").slice(2).join("\n");

  let msg = `📱 ${month}/${day}(${dayNames[dow]}) おはようございます☀️\n\n`;

  msg += `【 SNS 】\n`;
  msg += `🎯 ゴール（12月末）\n`;
  msg += `  → 0→1達成（JVコンテンツ初販売）\n\n`;
  msg += `📅 今月の目標（7月末）\n`;
  msg += `  ・Xフォロワー：1,150人\n`;
  msg += `  ・オープンチャット：55人\n`;
  msg += `  ・週次制作フロー定着\n\n`;

  const snsLines = taskBody.split("\n");
  const fxStart = snsLines.findIndex(l => l.includes("FX"));
  const snsPart = fxStart > 0 ? snsLines.slice(0, fxStart).join("\n") : taskBody;
  msg += snsPart.trim() + "\n";

  msg += `\n━━━━━━━━━━\n\n`;
  msg += `【 FX 】\n`;
  msg += `🎯 ゴール（12月末）\n`;
  msg += `  → フィントケイ クオーツ合格\n\n`;
  msg += `📅 今月の目標（7月末）\n`;
  msg += `  ・月間トレード数：10件（週2〜3件）\n`;
  msg += `  ・ルール通り率：90%以上（最優先）\n`;
  msg += `  ・トレード記録を毎件つける\n\n`;

  if (isWeekend) {
    msg += `【今日やること】\n`;
    msg += `📊 今週のトレードを振り返りメモに記録\n`;
    msg += `  → 翌週の環境認識、シナリオ作成\n`;
  } else {
    const fxPart = fxStart > 0 ? snsLines.slice(fxStart).join("\n") : "";
    if (fxPart.trim()) msg += fxPart.trim() + "\n";
  }

  msg += `\n「${quote}」\n`;
  msg += `━━━━━━━━━━\n`;
  msg += `今月残り${remainingDays}日🎯`;

  await sendLine(msg);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(console.error);
