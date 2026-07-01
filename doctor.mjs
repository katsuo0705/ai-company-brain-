// 🩺 会社の健康診断（「調子悪い」と言われたら Claude がこれを実行する）
// 使い方: node server/doctor.mjs
// 依存ゼロ・読み取り専用（何も書き換えない）。結果と処方箋を出力する。
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Script } from "node:vm";

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const fixes = [];
function ok(label, note) { results.push("✅ " + label + (note ? "（" + note + "）" : "")); }
function bad(label, note, fix) { results.push("❌ " + label + (note ? "：" + note : "")); if (fix) fixes.push(fix); }
function warn(label, note, fix) { results.push("⚠️ " + label + (note ? "：" + note : "")); if (fix) fixes.push(fix); }

// 1. ブラウザ用JSファイルの構文チェック（壊れているとオフィスが静かに死ぬ）
function checkBrowserJs(rel, mustContain, label) {
  const full = join(KIT_ROOT, rel);
  if (!existsSync(full)) return bad(label, rel + " がありません", rel + " を復元する（同名の .template ファイルがあればコピー、無ければ git か配布元から）");
  const code = readFileSync(full, "utf-8");
  try { new Script(code); } catch (e) {
    return bad(label, "構文エラー（" + e.message + "）",
      rel + " を修復する。state.js なら server/.state-backup.js（最後の正常版）から戻せる");
  }
  if (mustContain && !code.includes(mustContain)) {
    return bad(label, mustContain + " の定義が見つかりません", rel + " の中身を確認・修復する");
  }
  ok(label);
}
checkBrowserJs("office/state.js", "window.AI_STATE", "state.js（ライブミラー）");
checkBrowserJs("office/company.js", "window.COMPANY", "company.js（会社データ）");
if (existsSync(join(KIT_ROOT, "office/config.js"))) checkBrowserJs("office/config.js", null, "config.js（接続設定）");

// 2. サーバーの依存
if (existsSync(join(KIT_ROOT, "server/node_modules"))) ok("サーバーの依存（node_modules）");
else bad("サーバーの依存（node_modules）", "未インストール", "cd server && npm install を実行する");

// 3. 本体（server）の稼働確認
const portFile = join(KIT_ROOT, "server/.port");
const savedPort = existsSync(portFile) ? Number(readFileSync(portFile, "utf-8").trim()) : null;
const candidates = [...new Set([3000, savedPort].filter(Boolean))];
let alivePort = null;
for (const p of candidates) {
  try {
    const r = await fetch(`http://localhost:${p}/health`, { signal: AbortSignal.timeout(2000) });
    const j = await r.json();
    if (j && j.name === "ai-company-brain") { alivePort = p; ok("本体（server）の稼働", `http://localhost:${p}/`); break; }
    warn(`ポート${p}`, "別のアプリが使用中");
  } catch { /* このポートでは動いていない */ }
}
if (!alivePort) {
  bad("本体（server）の稼働", "どのポートでも応答なし",
    "cd server && npm start で起動する（オフィスのライブ更新・ファイルを開く機能に必須）");
}

// 4. 社員の専用ツール（任意・tools/ がある環境のみ）
const TOOLS = [
  ["job-scout", "リサ：案件探索"],
  ["work-lister", "サトル：業務洗い出し"],
  ["ak-outreach", "コトハ：営業文量産"],
  ["ak-deals", "ハック：営業管理ハブ"],
];
if (existsSync(join(KIT_ROOT, "tools"))) {
  for (const [dir, label] of TOOLS) {
    const base = join(KIT_ROOT, "tools", dir);
    if (!existsSync(base)) { warn("社員ツール（" + label + "）", "リンク切れ。実体フォルダが見つかりません"); continue; }
    if (existsSync(join(base, ".env"))) ok("社員ツール（" + label + "）");
    else warn("社員ツール（" + label + "）", ".env 未設定。使うときに「社員ツール連携して」でセットアップできます");
  }
}

// 5. 連携状態（参考情報）
if (alivePort) {
  try {
    const h = await (await fetch(`http://localhost:${alivePort}/health`)).json();
    ok("連携状態", `Google:${h.google ? "🟢" : "⚪未連携"} / LINE:${h.line ? "🟢" : "⚪未連携"}`);
  } catch {}
}

console.log("🩺 診断結果");
console.log(results.map((r) => "  " + r).join("\n"));
if (fixes.length) {
  console.log("\n💊 処方箋（上から順に）");
  console.log(fixes.map((f, i) => `  ${i + 1}. ${f}`).join("\n"));
  console.log(`\nオフィスのURL（復旧後）: http://localhost:${alivePort || savedPort || 3000}/`);
} else {
  console.log("\n💮 すべて正常です。オフィス: http://localhost:" + alivePort + "/");
}
