#!/usr/bin/env node
//
// お客さまお渡し用パッケージャ（ハードン版 / セキュリティ最優先）
// ─────────────────────────────────────────────────────────────
// 使い方:  node server/handoff.mjs [お客さまの名前]
//   例:    node server/handoff.mjs 田中
//   （名前を省くと、フォルダ名 ai-company-<名前> から自動で割り出す）
//
// このスクリプトは「面談で作った会社フォルダ（クローン）」の中で実行する。
// フォルダをまるごとセキュリティチェックし、クリーンと確認できたものだけを
// お客さまお渡し用の「システム一式ファイル」として書き出す。
// 営業マン側の情報（OAuthトークン・APIキー・LINE/Google認証・RenderのURL・
// あなたのPCのユーザー名など）が、お渡しファイルに【絶対に】入らないようにする。
//
// やること（ブロックリストではなく "許可リスト＋全走査" の二段構え）:
//   ① 許可リストにある項目だけを一時フォルダにステージング（symlinkは絶対にたどらない）
//   ② ステージングした【全ファイルを1個残らず】走査し、秘密情報・営業マンの個人情報を検出
//   ③ 1件でも見つかったら zip を作らず中止（何が・どこにあったか全部表示）
//   ④ 何も見つからなければ zip 化（クリーンなものだけが世に出る）
//
// .git は丸ごと除外する（履歴やconfigに個人情報・トークンが残りうるため）。
// お客さまのキット更新は「新しいお渡しファイルを再配布」で行う。
//
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// 第三者配布の不変条件（APIキー／個人情報／他プロジェクト依存）の共通ルール
import { scanTextCore } from "./lib/clean-scan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 名前は引数で受けるが、無ければフォルダ名（ai-company-<名前>）から自動で割り出す（＝営業マンの手間＝変数を減らす）。
const NAME = ((process.argv[2] || "").trim())
  || (path.basename(ROOT).replace(/^ai-company-/i, "").trim());

if (!NAME) {
  console.error("使い方: node server/handoff.mjs <お客さまの名前>   例: node server/handoff.mjs 田中");
  console.error("（フォルダ名が ai-company-<名前> なら、名前は省略しても自動で割り出します）");
  process.exit(1);
}

// ── 出力先（クローンフォルダの隣に作る） ──
const OUT_ZIP = path.join(ROOT, "..", `ai-company-${NAME}.zip`);
const PKG_DIRNAME = `ai-company-${NAME}`;

// ── ① 許可リスト（これ以外はそもそも入れない） ──
//   トップレベルで「お客さまの会社」に必要なものだけ。tools/ や .git は入れない。
const ALLOW_TOP = new Set([
  "office", "server", "skills", ".claude", "agents", "logs",
  "CLAUDE.md", "README.md", "設計図.md", ".gitignore", "使用説明書.md",
]);

// ── 常にスキップする basename（フォルダ/ファイル名そのもの） ──
const SKIP_BASENAME = new Set([
  "node_modules", ".git", ".DS_Store", ".port", ".state-backup.js",
  "settings.local.json", ".playwright-mcp", "tools", ".env",
]);

// ── スキップする basename パターン（秘密ファイルの可能性） ──
const SKIP_PATTERN = [
  /\.env(\..+)?$/i,          // .env / .env.local など
  /tokens?\.json$/i,         // tokens.json
  /credentials.*\.json$/i,   // credentials*.json
  /client[_-]?secret/i,      // client_secret*
  /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i,
  /^\._/,                    // macOS の AppleDouble メタファイル
];

// スキャナ自身（検出パターンの定義ファイル）は内容走査の対象外。zipには含めるが、
// パターンのリテラル文字列に自己ヒットしてしまうため。＝ウイルス対策が自分の定義DBを隔離しないのと同じ。
const SCANNER_SELF = new Set(["server/handoff.mjs", "server/lib/clean-scan.mjs"]);

// ── ② 秘密情報・他プロジェクト依存の検出は共通ルール（lib/clean-scan.mjs）に集約 ──
//    （トークン実値・/Users 絶対パス・my-perfect-days・onrender実URL を走査する scanTextCore）

// ── ③ 営業マン本人の情報（実行時に自動で割り出して走査） ──
function safeGit(args) {
  try { return execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return ""; }
}
const username = (os.userInfo().username || "").trim();
const gitEmail = safeGit(["config", "user.email"]);
const gitName = safeGit(["config", "user.name"]);

const IDENTITY_PATTERNS = [];
if (username && username.length >= 2) {
  IDENTITY_PATTERNS.push([new RegExp("/Users/" + escapeRe(username) + "(/|\\b)"), `あなたのMacユーザー名のパス(/Users/${username})`]);
}
if (gitEmail) IDENTITY_PATTERNS.push([new RegExp(escapeRe(gitEmail), "i"), `あなたのGitメール(${gitEmail})`]);
if (gitName && gitName.length >= 3) IDENTITY_PATTERNS.push([new RegExp(escapeRe(gitName)), `あなたのGit名義(${gitName})`]);

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ── ステージング先（一時フォルダ） ──
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));
const PKG = path.join(STAGE, PKG_DIRNAME);
fs.mkdirSync(PKG, { recursive: true });

let staged = 0, skippedSymlinks = [];

function shouldSkip(name) {
  if (SKIP_BASENAME.has(name)) return true;
  return SKIP_PATTERN.some((re) => re.test(name));
}

// 許可リスト配下を、symlinkを絶対にたどらずに再帰コピー
function copyInto(srcRel) {
  const src = path.join(ROOT, srcRel);
  if (!fs.existsSync(src)) return;
  const base = path.basename(srcRel);
  if (shouldSkip(base)) return;
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) { skippedSymlinks.push(srcRel); return; } // 追従しない＝実体・認証が漏れない
  const dst = path.join(PKG, srcRel);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src)) copyInto(path.join(srcRel, e));
  } else if (st.isFile()) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    staged++;
  }
}

for (const top of fs.readdirSync(ROOT)) {
  if (!ALLOW_TOP.has(top)) continue;   // 許可リスト外のトップ項目は完全に無視
  copyInto(top);
}

// ── サニタイズ：config.js の apiBase を localhost に戻す（Render URL を先に消す） ──
const stagedConfig = path.join(PKG, "office", "config.js");
if (fs.existsSync(stagedConfig)) {
  let c = fs.readFileSync(stagedConfig, "utf8");
  c = c.replace(/apiBase:\s*["'][^"']*["']/, 'apiBase: "http://localhost:3000"');
  fs.writeFileSync(stagedConfig, c);
}

// ── ④ ステージした「全ファイル」を1個残らず走査 ──
const violations = [];
let scanned = 0;
function scan(dir) {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const rel = path.relative(PKG, p).split(path.sep).join("/"); // Windowsの\をスラッシュに正規化（SCANNER_SELF照合・表示の一貫性）
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) { violations.push(`[symlink] ${rel}（シンボリックリンクは渡さない）`); continue; }
    if (st.isDirectory()) { scan(p); continue; }
    // 万一スキップ漏れの秘密ファイル名が残っていたら検出
    if (shouldSkip(e)) { violations.push(`[危険ファイル名] ${rel}`); continue; }
    scanned++;
    if (SCANNER_SELF.has(rel)) continue; // スキャナ自身の定義ファイルは内容走査しない
    // 中身を走査（ASCII/UTF-8パターンはlatin1で拾えるのでバイナリも一応見る）
    let buf;
    try { buf = fs.readFileSync(p); } catch { continue; }
    const text = buf.toString("latin1");
    // 共通ルール：秘密情報・絶対パス依存・my-perfect-days・onrender実URL
    for (const h of scanTextCore(text)) violations.push(`[${h}] ${rel}`);
    // 営業マン本人の情報（このPCのgitメール/名義・ユーザー名パス）
    for (const [re, label] of IDENTITY_PATTERNS) {
      if (re.test(text)) violations.push(`[営業マンの情報: ${label}] ${rel}`);
    }
  }
}
scan(PKG);
for (const s of skippedSymlinks) {
  // シンボリックリンクは「たどらず除外」した（漏れていないが、存在したことは知らせる）
  console.log(`ℹ️  symlinkを除外しました（追従なし・安全）: ${s}`);
}

// ── 判定 ──
console.log(`\n🔍 セキュリティ走査：${scanned} ファイルを全数チェックしました（許可リスト＝${[...ALLOW_TOP].join(", ")}）`);
if (username) console.log(`   照合した営業マン情報：Macユーザー名「${username}」` + (gitEmail ? ` / Gitメール「${gitEmail}」` : "") + (gitName ? ` / Git名義「${gitName}」` : "") + ` / RenderのURL`);

if (violations.length) {
  console.error(`\n🚨 中止：お客さまに渡してはいけない情報が ${violations.length} 件見つかりました。お渡しファイルは作っていません。`);
  for (const v of violations) console.error("   ✗ " + v);
  console.error(`\n→ 上記を取り除く（多くは認証ファイル）か、原因を社長に報告してください。`);
  fs.rmSync(STAGE, { recursive: true, force: true });
  process.exit(2);
}

// ── クリーン → zip 化（OSに合わせて：Windowsは標準のCompress-Archive、それ以外はzip） ──
fs.rmSync(OUT_ZIP, { force: true });
if (process.platform === "win32") {
  execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command",
    `Compress-Archive -Path '${path.join(STAGE, PKG_DIRNAME)}' -DestinationPath '${OUT_ZIP}' -Force`]);
} else {
  execFileSync("zip", ["-rq", OUT_ZIP, PKG_DIRNAME], { cwd: STAGE });
}
fs.rmSync(STAGE, { recursive: true, force: true });

const sizeMB = (fs.statSync(OUT_ZIP).size / 1048576).toFixed(2);
console.log(`\n✅ セキュリティチェック完了（クリーン）！営業マンの情報・秘密情報は1件も含まれていません。`);
console.log(`💾 お渡し用のシステム一式ファイルを保存：${OUT_ZIP}（${sizeMB} MB）`);

// ── ファイルの場所が分からなくならないよう、Finderで開いて当該ファイルを選択状態にする ──
//    （＝「フォルダに飛ぶボタン」を自動で押した状態。営業マンは光っているファイルをDriveにドラッグするだけ）
let revealed = false;
try {
  if (process.platform === "win32") { execFileSync("explorer", ["/select,", OUT_ZIP]); }
  else { execFileSync("open", ["-R", OUT_ZIP]); }
  revealed = true;
} catch { /* explorer は成功でも非0を返すことがある／macOS以外でも本処理は成功扱い */ revealed = process.platform === "win32"; }
if (revealed) console.log(`📂 ${process.platform === "win32" ? "エクスプローラー" : "Finder"}でこのファイルの場所を開きました（ファイルが選択されています）。`);

console.log(`\n次の手順：`);
console.log(`  1. ${revealed ? "いま開いたFinderの" : "保存した"}このファイルを Google Drive にアップロード（共有フォルダ＝リンクを知る全員＝閲覧）`);
console.log(`  2. そのファイルを右クリック →「リンクをコピー」`);
console.log(`  3. コピーしたリンクを秘書に貼る → Lステップ用の案内文を作ってもらう`);
console.log(`  4. お渡しが済んだら、このクローンフォルダと保存したファイルは削除してOK`);
