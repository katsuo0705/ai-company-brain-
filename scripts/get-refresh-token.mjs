// Google のリフレッシュトークンを取得する補助スクリプト（ローカルで1回だけ実行）
//
// 使い方（Claude Code が案内します）:
//   1. server/.env に GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を入れる
//   2. `node scripts/get-refresh-token.mjs` を実行
//   3. 表示された URL をブラウザで開いて許可 → 戻ってきたトークンを .env の
//      GOOGLE_REFRESH_TOKEN に貼る（デプロイ先の環境変数にも設定）
import "dotenv/config";
import { google } from "googleapis";
import { createServer } from "node:http";

const PORT = 4321;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
];

const id = process.env.GOOGLE_CLIENT_ID;
const secret = process.env.GOOGLE_CLIENT_SECRET;
if (!id || !secret) {
  console.error("先に server/.env の GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定してください。");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(id, secret, REDIRECT);
const url = oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

console.log("\n▼ このURLをブラウザで開いて許可してください:\n");
console.log(url + "\n");
console.log(`（Google Cloud の OAuth クライアントに、リダイレクトURI ${REDIRECT} を登録しておいてください）\n`);

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
  const code = u.searchParams.get("code");
  if (!code) { res.writeHead(400); res.end("no code"); return; }
  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>取得完了！この画面は閉じてOKです。</h2>");
    console.log("\n✅ GOOGLE_REFRESH_TOKEN を取得しました。これを .env に貼ってください:\n");
    console.log("GOOGLE_REFRESH_TOKEN=" + tokens.refresh_token + "\n");
  } catch (e) {
    res.writeHead(500); res.end("error");
    console.error("取得失敗:", e.message);
  } finally {
    server.close();
    process.exit(0);
  }
});
server.listen(PORT, () => console.log(`コールバック待機中: ${REDIRECT}`));
setTimeout(() => { console.log("タイムアウトしました。もう一度実行してください。"); process.exit(1); }, 180000);
