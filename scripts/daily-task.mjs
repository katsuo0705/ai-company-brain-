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

// 直接実行時のみ出力
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) console.log(buildDailyTaskMessage());
