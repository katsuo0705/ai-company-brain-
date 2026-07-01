// 配布クリーン走査の「共通ルール」＝第三者配布の不変条件（唯一の真実）
// ─────────────────────────────────────────────────────────────
// 第三者に配るものには、次の3つを絶対に含めない：
//   ① APIキー・トークン（秘密情報）
//   ② 個人情報（メールアドレス等）
//   ③ 他プロジェクトフォルダ／個人環境への依存（絶対パス・社長個人の連携）
//
// このファイルを唯一の基準とし、
//   - server/handoff.mjs      … お客さまお渡しzipの安全確認
//   - scripts/export-kit.mjs  … 公開配布キット(dist)生成の安全確認
// の両方が参照する（ルールが2か所に分かれてズレるのを防ぐ）。
//
// ※ このファイル自身も配布物・走査対象に含まれるため、
//    検出パターンの「リテラル文字列」が自分自身に誤ヒットしないよう配慮している
//    （例：my-perfect-days は分割して組み立てる）。

// ── ① APIキー・トークンの実値 ──
export const SECRET_PATTERNS = [
  [/ya29\.[A-Za-z0-9_\-]{10,}/,            "Googleアクセストークン(ya29.)"],
  [/1\/\/[A-Za-z0-9_\-]{30,}/,             "Googleリフレッシュトークン(1//)"],
  [/AIza[A-Za-z0-9_\-]{30,}/,              "Google APIキー(AIza)"],
  [/sk-[A-Za-z0-9]{20,}/,                  "APIシークレットキー(sk-)"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/,         "Slackトークン(xox)"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/,   "秘密鍵(PRIVATE KEY)"],
  [/GOCSPX-[A-Za-z0-9_\-]{10,}/,           "Google OAuthクライアントシークレット(GOCSPX-)"],
  // キー名＋「引用符で囲まれた実値(20文字以上)」のときだけ検出（process.env や説明文は対象外）
  [/(refresh_token|client_secret|access_token|channelAccessToken|channelSecret|api[_-]?key)["']?\s*[:=]\s*["'][A-Za-z0-9_\-\/+=.]{20,}["']/i, "認証情報の実値(引用符付き)"],
];

// ── ③ 他プロジェクト／個人環境への依存 ──
const MY_PERFECT_DAYS = ["my", "perfect", "days"].join("-"); // リテラルを避けて自己誤ヒット防止
export const CROSS_PROJECT_PATTERNS = [
  [/\/Users\/[A-Za-z0-9._-]{2,}\//,  "絶対パス(/Users/…)＝個人環境/他プロジェクトへの依存"],
  [/\/home\/[A-Za-z0-9._-]{2,}\//,   "絶対パス(/home/…)＝個人環境への依存"],
  [new RegExp(MY_PERFECT_DAYS, "i"), `${MY_PERFECT_DAYS} への参照（社長個人の連携・配布不可）`],
];

// ── 誤検知防止の「サンプル」許可リスト ──
export const DOC_EXAMPLE_HOSTS = new Set(["my-ai-company.onrender.com", "ai-company-brain.onrender.com"]);
export const DOC_EXAMPLE_EMAILS = new Set([
  "example@example.com", "you@example.com", "name@example.com", "noreply@anthropic.com",
]);

// onrender 実URL（サンプル以外）＝個人デプロイへの依存
export function findHostViolations(text) {
  const out = [];
  const hosts = text.match(/[a-z0-9-]+\.onrender\.com/gi) || [];
  for (const h of new Set(hosts.map((x) => x.toLowerCase()))) {
    if (!DOC_EXAMPLE_HOSTS.has(h)) out.push(`RenderのURL(${h})＝個人デプロイへの依存`);
  }
  return out;
}

// 一般メールアドレス（サンプル以外）＝個人情報。※「公開dist」向け。
//   お客さまお渡しzip(handoff)では、お客さま自身のメールが正当に含まれうるので使わない。
export function findEmailViolations(text) {
  const out = [];
  const ms = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  for (const m of new Set(ms)) {
    if (DOC_EXAMPLE_EMAILS.has(m.toLowerCase())) continue;
    if (/@example\.(com|org|net)$/i.test(m)) continue;
    out.push(`メールアドレス(${m})`);
  }
  return out;
}

// テキスト1本を「共通ルール（秘密情報＋依存）」で走査し、違反ラベル配列を返す。
//   個人情報メールの走査は文脈で要否が違うため、ここには含めない（findEmailViolations を別途呼ぶ）。
export function scanTextCore(text) {
  const out = [];
  for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) out.push(`秘密情報: ${label}`);
  for (const [re, label] of CROSS_PROJECT_PATTERNS) if (re.test(text)) out.push(`依存: ${label}`);
  for (const v of findHostViolations(text)) out.push(`依存: ${v}`);
  return out;
}
