// あなたのAI会社の本体（hosted）
// オフィス画面にメール/カレンダー/LINEの実データを供給し、
// LINEからの指示(inbound)を受けてAI社員が動く窓口になる。
//
// 認証情報が無くても起動します（その場合は configured:false を返し、オフィスはサンプル表示）。
import "dotenv/config";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import { existsSync, writeFileSync, readFileSync, copyFileSync, watch } from "node:fs";
import { Script } from "node:vm";
import { execFile } from "node:child_process";
import { listMail, listCalendar, sendMail, createEvent } from "./lib/google.js";
import {
  lineConfigured, verifySignature, replyText, pushRecent, getRecent, isOwner,
} from "./lib/line.js";
import { handleInstruction } from "./lib/ai.js";

const app = express();
const PORT = process.env.PORT || 3000;
const REQUIRE_APPROVAL = String(process.env.REQUIRE_APPROVAL || "true") === "true";

app.use(cors({ origin: process.env.ALLOW_ORIGIN || "*" }));

// LINE webhook は生ボディが必要なので、JSON パーサより前に raw で受ける
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const signature = req.get("x-line-signature") || "";
  const rawBody = req.body instanceof Buffer ? req.body.toString("utf-8") : "";
  if (!verifySignature(rawBody, signature)) {
    return res.status(401).send("bad signature");
  }
  res.status(200).end(); // LINE には即 200 を返す
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return; }
  for (const ev of payload.events || []) {
    try {
      if (ev.type !== "message" || ev.message?.type !== "text") continue;
      const userId = ev.source?.userId;
      const text = ev.message.text;
      console.log(`[LINE] userId: ${userId} | message: ${text}`);
      pushRecent("them", text);
      if (!isOwner(userId)) {
        await replyText(ev.replyToken, "（このAI会社は社長専用です）userId: " + (userId || "不明"));
        continue;
      }
      const reply = await handleInstruction(text);
      pushRecent("me", reply);
      await replyText(ev.replyToken, reply);
    } catch (e) {
      console.error("webhook handling error:", e.message);
    }
  }
});

app.use(express.json());

// ---- 壁アプリ向け：実データ取得 ----
app.get("/api/mail", async (_req, res) => {
  try { res.json(await listMail(20)); }
  catch (e) { console.error(e.message); res.json({ configured: false, items: [] }); }
});

app.get("/api/calendar", async (_req, res) => {
  try { res.json(await listCalendar()); }
  catch (e) { console.error(e.message); res.json({ configured: false, items: [] }); }
});

app.get("/api/line", (_req, res) => {
  res.json(getRecent());
});

// ---- ローカルファイルを「コンピューター上で」開く ----
// オフィスの成果物クリック → OSの標準アプリで開く（macOS: open / Windows: start / Linux: xdg-open）。
// セキュリティ：ローカル起動時のみ・キットのフォルダ配下のみ許可。
const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
app.post("/api/open-file", (req, res) => {
  // リモート（Render等）では無効。自分のPCで動かしているときだけ使える。
  const host = (req.get("host") || "").split(":")[0];
  if (host !== "localhost" && host !== "127.0.0.1") {
    return res.status(403).json({ ok: false, message: "ローカル起動時のみ使えます" });
  }
  const rel = String((req.body || {}).path || "").trim();
  // app: 開くアプリの指定（任意・macOSのみ）。例 "Visual Studio Code", "Numbers", "Google Chrome"
  const appName = String((req.body || {}).app || "").trim();
  if (!rel) return res.status(400).json({ ok: false, message: "path is required" });
  const full = resolve(KIT_ROOT, rel);
  if (!(full + sep).startsWith(KIT_ROOT + sep) && full !== KIT_ROOT) {
    return res.status(400).json({ ok: false, message: "キットのフォルダ外は開けません" });
  }
  if (!existsSync(full)) {
    return res.status(404).json({ ok: false, message: "ファイルが見つかりません: " + rel });
  }
  const opener = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", full]
    : process.platform === "darwin" && appName ? ["-a", appName, full]
    : [full];
  execFile(opener, args, (err) => {
    // アプリ指定が無効（未インストール等）なら、デフォルトアプリで開き直す
    if (err && appName && process.platform === "darwin") {
      return execFile("open", [full], (err2) => {
        if (err2) return res.status(500).json({ ok: false, message: err2.message });
        res.json({ ok: true, opened: rel, note: "指定アプリが見つからず、デフォルトで開きました" });
      });
    }
    if (err) return res.status(500).json({ ok: false, message: err.message });
    res.json({ ok: true, opened: rel, app: appName || undefined });
  });
});

// ---- 外部URLを「コンピューターの標準ブラウザで」開く ----
// オフィスの資料棚・成果物のリンク（スプシ等）クリック → OSの標準ブラウザで開く。
// プレビューペイン（localhostのみ許可）の中からでも外部URLを開けるようにするための入口。
// セキュリティ：ローカル起動時のみ・http(s) のみ許可。
app.post("/api/open-url", (req, res) => {
  const host = (req.get("host") || "").split(":")[0];
  if (host !== "localhost" && host !== "127.0.0.1") {
    return res.status(403).json({ ok: false, message: "ローカル起動時のみ使えます" });
  }
  const url = String((req.body || {}).url || "").trim();
  if (!url) return res.status(400).json({ ok: false, message: "url is required" });
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ ok: false, message: "URLの形式が不正です" }); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return res.status(400).json({ ok: false, message: "http/https のURLだけ開けます" });
  }
  const opener = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(opener, args, (err) => {
    if (err) return res.status(500).json({ ok: false, message: err.message });
    res.json({ ok: true, opened: url });
  });
});

// ---- 外向きアクション（承認フロー）----
// approve:true が無いと実行しない。まず確認画面を返す = 「決めるのは社長」。
app.post("/api/actions/send-mail", async (req, res) => {
  const { to, subject, body, approve } = req.body || {};
  if (REQUIRE_APPROVAL && !approve) {
    return res.json({ status: "needs_approval", preview: { to, subject, body },
      message: "この内容で送ります。よろしければ approve:true で再送してください。" });
  }
  try { res.json({ status: "sent", ...(await sendMail({ to, subject, body })) }); }
  catch (e) { res.status(400).json({ status: "error", message: e.message }); }
});

app.post("/api/actions/create-event", async (req, res) => {
  const { title, start, end, approve } = req.body || {};
  if (REQUIRE_APPROVAL && !approve) {
    return res.json({ status: "needs_approval", preview: { title, start, end },
      message: "この予定で作成します。よろしければ approve:true で再送してください。" });
  }
  try { res.json({ status: "created", ...(await createEvent({ title, start, end })) }); }
  catch (e) { res.status(400).json({ status: "error", message: e.message }); }
});

// ---- ライブ更新（SSE）----
// Claude が office/state.js を保存した瞬間にブラウザへ通知 → オフィスがほぼリアルタイムで更新される。
// （ブラウザ側はこれを受けて state.js を読み直すだけ。SSEが使えない環境はポーリングにフォールバック）
const sseClients = new Set();
app.get("/api/state-events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  res.write("retry: 2000\n\n");
  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25000);
  req.on("close", () => { clearInterval(ping); sseClients.delete(res); });
});
// state.js の壊れ対策：保存のたびに構文チェックし、壊れていたら最後の正常版に自動復旧する。
// （Claude の編集ミスで JS が壊れると、オフィスが静かに更新されなくなるのを防ぐ）
const STATE_FILE = join(KIT_ROOT, "office", "state.js");
const STATE_BACKUP = join(KIT_ROOT, "server", ".state-backup.js");
function validateState(code) {
  if (!/window\.AI_STATE\s*=/.test(code)) return "window.AI_STATE の定義が見つかりません";
  try { new Script(code); return null; } catch (e) { return e.message; }
}
try {
  const code = readFileSync(STATE_FILE, "utf-8");
  if (!validateState(code)) copyFileSync(STATE_FILE, STATE_BACKUP);
} catch {}

// エディタ保存は「別ファイルに書いてリネーム」のことがあるため、ファイルでなくフォルダを監視する
let sseNotifyTimer = null;
try {
  watch(join(KIT_ROOT, "office"), (_event, filename) => {
    if (filename !== "state.js") return;
    clearTimeout(sseNotifyTimer);
    sseNotifyTimer = setTimeout(() => {
      let code;
      try { code = readFileSync(STATE_FILE, "utf-8"); } catch { return; }
      const err = validateState(code);
      if (err) {
        console.error("⚠ state.js が壊れています:", err);
        if (existsSync(STATE_BACKUP)) {
          copyFileSync(STATE_BACKUP, STATE_FILE); // 復旧の書き込みで再び watch が発火し、正常版が通知される
          console.error("  → 最後の正常版に自動復旧しました");
        }
        return;
      }
      try { copyFileSync(STATE_FILE, STATE_BACKUP); } catch {}
      for (const c of sseClients) { try { c.write("data: update\n\n"); } catch {} }
    }, 120);
  });
} catch (e) { console.error("state.js の監視を開始できませんでした:", e.message); }

// ---- 状態確認 ----
// name / kitRoot は「この会社の本体か」を他のセッションが見分けるための目印
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    name: "ai-company-brain",
    kitRoot: KIT_ROOT,
    port: app.get("port"),
    google: !!(process.env.GOOGLE_REFRESH_TOKEN),
    line: lineConfigured(),
    ai: !!process.env.ANTHROPIC_API_KEY,
    requireApproval: REQUIRE_APPROVAL,
  });
});

// ---- オフィス画面を配信 ----
// http://localhost:<ポート>/ でオフィスが開く（file:// と違い state.js の自動更新が確実に効く）。
// → Claude Code デスクトップのプレビューペインに、チャットの隣で並べて使える。
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, "..", "office")));

// ポートが使用中なら自動で次を試す（3000 → 3001 → … 最大+10）。
// 起動したポートは server/.port にも書き出す（他のセッション・Claude が参照できる）。
const BASE_PORT = Number(PORT);
function listenWithFallback(port, remaining) {
  const srv = app.listen(port, () => {
    app.set("port", port);
    try { writeFileSync(join(__dirname, ".port"), String(port)); } catch {}
    console.log(`AI会社の本体 起動`);
    console.log(`  オフィス: http://localhost:${port}/`);
    console.log(`  連携状況: http://localhost:${port}/health`);
    if (port !== BASE_PORT) console.log(`  ※ ポート${BASE_PORT}は使用中だったため、${port}で起動しました`);
  });
  srv.on("error", (err) => {
    if (err.code === "EADDRINUSE" && remaining > 0) {
      console.log(`ポート${port}は使用中 → ${port + 1}を試します`);
      listenWithFallback(port + 1, remaining - 1);
    } else {
      console.error("起動できませんでした:", err.message);
      process.exit(1);
    }
  });
}
listenWithFallback(BASE_PORT, 10);

// ---- スケジューラー ----
import { main as morningBriefing } from "./scripts/morning-briefing.mjs";
import { main as fxSignal } from "./scripts/fx-signal.mjs";
import { main as fxRecord } from "./scripts/fx-record.mjs";
import { main as fxReport } from "./scripts/fx-report.mjs";
import { main as fxDailySummary } from "./scripts/fx-daily-summary.mjs";
import { main as fxEnvAnalysis } from "./scripts/fx-env-analysis.mjs";
import { main as fxWeeklyReview } from "./scripts/fx-weekly-review.mjs";
import { main as fxIndicatorResult } from "./scripts/fx-indicator-result.mjs";
import { main as snsWeeklyReport } from "./scripts/sns-weekly-report.mjs";
import { main as snsDailyReminder } from "./scripts/sns-daily-reminder.mjs";
import { main as dailyReport } from "./scripts/daily-report.mjs";

async function runMorningBriefing() {
  try { await morningBriefing(); }
  catch (e) { console.error("モーニングブリーフィングエラー:", e.message); }
}

// 毎分チェック（モーニングブリーフィング＋FXシグナル＋トレード記録＋週報月報）
let lastSignalMin = -1; // 同じ15分枠で重複実行しない
let lastRecordHour = -1; // 1時間ごとのトレード記録
let lastReportDay = -1;  // 週報・月報（日曜22:00に実行）
let lastBriefingDay = -1; // モーニングブリーフィング（1日1回）

setInterval(() => {
  const now = new Date();
  const jstHour = (now.getUTCHours() + 9) % 24;
  const jstMin = now.getUTCMinutes();
  const jstDay = now.getUTCDay(); // 0=日曜

  // 朝3:30 モーニングブリーフィング（1日1回のみ・DISABLE_BRIEFING=true で無効化）
  if (jstHour === 3 && jstMin === 30 && lastBriefingDay !== now.getUTCDate()
      && process.env.DISABLE_BRIEFING !== "true") {
    lastBriefingDay = now.getUTCDate();
    console.log("📊 モーニングブリーフィング開始");
    runMorningBriefing();
  }

  // 15分ごと（00/15/30/45分）にFXシグナルチェック
  if (jstMin % 15 === 0 && jstMin !== lastSignalMin) {
    lastSignalMin = jstMin;
    console.log(`📈 FXシグナルチェック開始 (JST ${jstHour}:${String(jstMin).padStart(2,"0")})`);
    fxSignal().catch((e) => console.error("FXシグナルエラー:", e.message));
  }

  // 1時間ごとにトレード記録を同期
  if (jstMin === 0 && jstHour !== lastRecordHour) {
    lastRecordHour = jstHour;
    console.log(`📝 トレード記録同期 (JST ${jstHour}:00)`);
    fxRecord().catch((e) => console.error("トレード記録エラー:", e.message));
  }

  // 日曜22:00に週報・月報を自動生成
  if (jstDay === 0 && jstHour === 22 && jstMin === 0 && lastReportDay !== now.getUTCDate()) {
    lastReportDay = now.getUTCDate();
    console.log("📊 週報・月報 自動生成");
    fxReport().catch((e) => console.error("週報・月報エラー:", e.message));
  }

  // 日曜23:00にSNS週次レポートをLINEに送信
  if (jstDay === 0 && jstHour === 23 && jstMin === 0) {
    console.log("📱 SNS週次レポート自動送信");
    snsWeeklyReport().catch((e) => console.error("SNS週次レポートエラー:", e.message));
  }

  // 毎日22:00に日報スプレッドシートに行追加＋LINE通知
  if (jstHour === 22 && jstMin === 0) {
    console.log("📝 日報自動記入");
    dailyReport().catch((e) => console.error("日報エラー:", e.message));
  }

  // 毎朝8:00にSNSデイリーリマインダーをLINEに送信
  if (jstHour === 8 && jstMin === 0) {
    console.log("📱 SNSデイリーリマインダー送信");
    snsDailyReminder().catch((e) => console.error("SNSリマインダーエラー:", e.message));
  }

  // 毎日21:00に日次サマリーをLINEに送信
  if (jstHour === 21 && jstMin === 0) {
    console.log("📅 日次サマリー送信");
    fxDailySummary().catch((e) => console.error("日次サマリーエラー:", e.message));
  }

  // 5分ごとに経済指標の結果をチェック（指標発表後に乖離・変動幅をLINE送信）
  if (jstMin % 5 === 0) {
    fxIndicatorResult().catch((e) => console.error("指標結果チェックエラー:", e.message));
  }

  // 毎日16:00に環境認識レポートをLINEに送信
  if (jstHour === 16 && jstMin === 0) {
    console.log("📊 環境認識レポート送信");
    fxEnvAnalysis().catch((e) => console.error("環境認識エラー:", e.message));
  }

  // 日曜22:00に週次振り返りレポートをLINEに送信（週報と同タイミング）
  if (jstDay === 0 && jstHour === 22 && jstMin === 0 && lastReportDay !== now.getUTCDate()) {
    fxWeeklyReview().catch((e) => console.error("週次振り返りエラー:", e.message));
  }
}, 60 * 1000);
