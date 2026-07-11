/**
 * 「今日のタスクは？」コマンド
 * ロードマップ → 月次目標 → 週次タスク → 今日のタスクを逆算して返す
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

// ── 目標値（更新時はここを変える） ──
const GOALS = {
  // 月次目標
  monthly: {
    followers: { current: 1012, target: 1150 },
    oc:        { current: 42,   target: 55   },
    fxTrades:  { current: 5,    target: 10   },
    monthEnd:  31, // 7月
  },
  // 週次目標（毎週日曜に更新）
  weekly: {
    followers: 35,  // 週+35人ペース
    oc: 4,          // 週+4人ペース
    fxTrades: 2,    // 週2〜3件
    posts: 21,      // 週21本投稿
    outbound: { replies: 5, likes: 20 }, // 1日あたり
  },
};

export function buildDailyTaskMessage() {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const month = jstNow.getUTCMonth() + 1;
  const day = jstNow.getUTCDate();
  const dow = jstNow.getUTCDay(); // 0=日, 6=土
  const isWeekend = dow === 0 || dow === 6;
  const isSunday = dow === 0;
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];

  // 残り日数・残り数値（月次逆算）
  const remainingDays = GOALS.monthly.monthEnd - day;
  const remainFollowers = GOALS.monthly.followers.target - GOALS.monthly.followers.current;
  const remainOC = GOALS.monthly.oc.target - GOALS.monthly.oc.current;
  const remainFX = GOALS.monthly.fxTrades.target - GOALS.monthly.fxTrades.current;

  // 1日あたりの必要ペース（逆算）
  const paceFollowers = remainingDays > 0 ? Math.ceil(remainFollowers / remainingDays) : remainFollowers;
  const paceFX = remainingDays > 0 ? (remainFX / remainingDays).toFixed(1) : remainFX;

  let msg = `📋 ${month}/${day}(${dayNames[dow]}) 今日のタスク\n\n`;

  // 月次進捗（逆算ベース）
  msg += `【今月の残り・今日のペース目標】\n`;
  msg += `フォロワー：残り${remainFollowers}人／残り${remainingDays}日 → 今日+${paceFollowers}人ペース\n`;
  msg += `OC：残り${remainOC}人\n`;
  if (!isWeekend) {
    msg += `FX：残り${remainFX}件（平均${paceFX}件/日）\n`;
  }
  msg += `\n`;

  // 今日やること
  msg += `【今日やること】\n`;
  msg += `★★★ 朝・昼・晩の投稿（3本）\n`;
  msg += `★★☆ アウトバウンド（リプ5・いいね20）\n`;

  if (isWeekend) {
    if (isSunday) {
      msg += `★★☆ 来週21本の投稿文を作成（週次フロー）\n`;
      msg += `★★☆ 今週の振り返り・来週設計\n`;
      msg += `★☆☆ オプチャ週次振り返り投稿\n`;
    } else {
      msg += `★★☆ 来週ストック作成（今日中に10本目標）\n`;
      msg += `★☆☆ オプチャ投稿文1本\n`;
    }
    msg += `\n🚫 FX本日休場`;
  } else {
    msg += `★★☆ FX環境認識・シグナル確認\n`;
    msg += `★☆☆ FX夜振り返り・記録更新\n`;
  }

  return msg;
}

// 今週のタスク
export function buildWeeklyMessage() {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const month = jstNow.getUTCMonth() + 1;
  const day = jstNow.getUTCDate();
  const dow = jstNow.getUTCDay();

  // 今週の残り日数（日曜=0を週末として計算）
  const daysLeftInWeek = dow === 0 ? 0 : 7 - dow;
  const weekendDays = Math.floor(daysLeftInWeek / 7 * 2); // 土日
  const weekdayDaysLeft = daysLeftInWeek - weekendDays;

  const remainFollowers = GOALS.monthly.followers.target - GOALS.monthly.followers.current;
  const remainOC = GOALS.monthly.oc.target - GOALS.monthly.oc.current;
  const remainFX = GOALS.monthly.fxTrades.target - GOALS.monthly.fxTrades.current;

  let msg = `📆 今週のタスク（${month}/${day}〜）\n\n`;
  msg += `【SNS】\n`;
  msg += `★★★ 毎日3投稿（週21本）\n`;
  msg += `★★☆ アウトバウンド（リプ5・いいね20）× ${daysLeftInWeek}日\n`;
  msg += `★★☆ 来週投稿文ストック21本（日曜）\n`;
  msg += `★☆☆ 週次振り返り・来週設計（日曜）\n`;
  msg += `★☆☆ オプチャ振り返り投稿（日曜）\n\n`;
  msg += `【FX】\n`;
  msg += `★★★ 毎日チャート環境認識更新\n`;
  msg += `★★☆ ルール通りエントリー ${GOALS.weekly.fxTrades}〜3件目標\n\n`;
  msg += `【今週のペース目標】\n`;
  msg += `フォロワー：週+${GOALS.weekly.followers}人（今月残り${remainFollowers}人）\n`;
  msg += `OC：週+${GOALS.weekly.oc}人（今月残り${remainOC}人）\n`;
  msg += `FX：週+${GOALS.weekly.fxTrades}〜3件（今月残り${remainFX}件）`;
  return msg;
}

// 今月の目標
export function buildMonthlyMessage() {
  const { monthly } = GOALS;
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = jstNow.getUTCDate();
  const remainingDays = monthly.monthEnd - day;

  const remainFollowers = monthly.followers.target - monthly.followers.current;
  const remainOC = monthly.oc.target - monthly.oc.current;
  const remainFX = monthly.fxTrades.target - monthly.fxTrades.current;
  const paceFollowers = remainingDays > 0 ? Math.ceil(remainFollowers / remainingDays) : remainFollowers;

  let msg = `📅 今月の目標（7月末）\n`;
  msg += `テーマ：習慣定着・週次フロー定着\n\n`;
  msg += `【SNS】\n`;
  msg += `フォロワー：${monthly.followers.current}→${monthly.followers.target}人\n`;
  msg += `　残り${remainFollowers}人／残り${remainingDays}日（+${paceFollowers}/日ペース）\n`;
  msg += `OC：${monthly.oc.current}→${monthly.oc.target}人（残り${remainOC}人）\n\n`;
  msg += `【FX】\n`;
  msg += `トレード件数：${monthly.fxTrades.current}→${monthly.fxTrades.target}件（残り${remainFX}件）\n`;
  msg += `ルール通り率：90%以上目標（計測中）`;
  return msg;
}

// 6ヶ月ロードマップ
export function buildRoadmapMessage() {
  let msg = `🗺 6ヶ月ロードマップ\n`;
  msg += `最終ゴール（12月末）\n`;
  msg += `SNS：フォロワー3,000人／OC250人／0→1達成\n`;
  msg += `FX：フィントケイ クオーツ合格\n\n`;
  msg += `【月別マイルストーン】\n`;
  msg += `7月：FW1,150・OC55・ルール定着\n`;
  msg += `8月：FW1,400・OC90・RR1.8厳守\n`;
  msg += `9月：FW1,750・OC130・精度安定\n`;
  msg += `10月：FW2,200・OC170・チャレンジ準備\n`;
  msg += `11月：FW2,700・OC210・チャレンジ申込\n`;
  msg += `12月：FW3,000・OC250・🏆合格`;
  return msg;
}

// 直接実行時のみ出力
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) console.log(buildDailyTaskMessage());
