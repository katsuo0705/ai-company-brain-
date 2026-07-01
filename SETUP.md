# 🧠 AI会社の本体（hosted）― セットアップ手順書

> このファイルは **Claude Code（秘書アイ）が読み上げて、あなたを1ステップずつ案内する**ための手順書です。
> あなたは指示に従ってクリック・コピペするだけ。コマンド実行やファイル編集は Claude が代行します。
>
> 連携は**任意・段階的**。やらなくても会社は使えます。「あとで」と言えば飛ばせます。

---

## 連携でできること（2パート）

| パート | できること | デプロイ | 目安 |
|---|---|---|---|
| **パート1：メール・カレンダー** | オフィスに自分のGmail・予定が出る／送信・予定作成 | **不要（ローカル）** | 約10分 |
| **パート2：LINE（外出先から指示）** | スマホのLINEからAI社員に指示・PCを閉じても動く | **必要（Render）** | 約15分 |

> パート1は自分のPCで動かすだけ（ネットの公開不要）。
> パート2は「外から・常時」なので、無料のRenderに自分でデプロイします。

凡例：🙋=あなたがやる（Claudeが手順を提示）／🤖=Claudeが代行

---

# パート1：メール・カレンダー連携（ローカル・約10分）

## 1-1. 本体を準備する
- 🤖 `cd server && npm install`
- 🤖 `.env.example` をコピーして `.env` を作成
- 🤖 `npm start` してローカル起動 → `http://localhost:3000/health` で `ok:true` を確認

## 1-2. Google で「鍵」を作る（OAuthクライアント）
🙋 ブラウザで以下を順に：
1. https://console.cloud.google.com/ を開く（Googleでログイン）
2. 上部のプロジェクト選択 →「新しいプロジェクト」→ 名前（例：`my-ai-company`）→ 作成
3. 左メニュー「APIとサービス」→「ライブラリ」→ **Gmail API** を検索して「有効にする」
4. 同じく「ライブラリ」→ **Google Calendar API** を「有効にする」
5. 「APIとサービス」→「OAuth同意画面」→ ユーザーの種類「外部」→ 作成
   - アプリ名（例：`AI会社`）と自分のメールを入力して保存・続行
   - 「テストユーザー」に**自分のGmailアドレスを追加**（重要）
6. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」
   - 種類：**ウェブアプリケーション**
   - 「承認済みのリダイレクト URI」に **`http://localhost:4321/callback`** を追加
   - 作成 → 表示された **クライアントID** と **クライアントシークレット** をコピー
7. 🙋 その2つをこのチャットに貼る
- 🤖 受け取った値を `server/.env` の `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` に書き込む

## 1-3. 利用許可（リフレッシュトークン取得）
- 🤖 `cd server && node scripts/get-refresh-token.mjs` を実行 → 認可URLを提示
- 🙋 そのURLを開く → 自分のGoogleで許可
  - 「このアプリは確認されていません」と出たら：**詳細 →（アプリ名）に移動 → 許可**（テストユーザーなので安全）
- 🙋 画面に出た `GOOGLE_REFRESH_TOKEN=...` の値をチャットに貼る
- 🤖 `.env` に書き込み → `npm start` で再起動 → `/health` の `google:true` を確認

## 1-4. オフィスにつなぐ
- 🤖 `office/config.js` の `apiBase` を `http://localhost:3000` に設定
- 🤖 オフィスを `http://localhost:3000/` で開き直す（プレビューペイン）
- ✅ オフィスの📧📅が**あなたの実データ**になり、ダッシュボードの「最新の受信」が🟢連携中に

> これで完了。PCで本体を起動している間、メール・カレンダーが本物になります。

---

# パート2：LINE連携＋デプロイ（外出先から指示・約15分・任意）

LINEの「外出先から指示」は、PCを閉じても動くよう**公開サーバー（Render）**が必要です。

## 2-1. LINE公式アカウント（Messaging API）を作る
🙋 ブラウザで：
1. https://developers.line.biz/ を開く → LINEアカウントでログイン
2. 「プロバイダー」を作成（名前は自分の名前でOK）
3. 「新規チャネル作成」→ **Messaging API** を選択 → 必要事項を入力して作成
4. チャネルの「Messaging API設定」タブ：
   - **チャネルアクセストークン（長期）**を発行 → コピー
   - 「チャネル基本設定」タブの **チャネルシークレット** → コピー
5. 🙋 その2つをチャットに貼る
- 🤖 `server/.env` の `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` に書き込む

## 2-2. 本体を GitHub に上げる（Renderが読み込むため）
- 🤖 `server/` を Git リポジトリ化（`git init` など）。`.env` は除外（`.gitignore`済み）
- 🙋 GitHub にログインし、空のリポジトリを1つ作成（例：`ai-company-brain`、Private）
- 🙋 リポジトリのURLをチャットに貼る
- 🤖 そのリポジトリに push（必要なら認証手順も案内）

## 2-3. Render にデプロイする
🙋 ブラウザで：
1. https://render.com/ を開く → GitHubでサインアップ／ログイン
2. 「New +」→「Web Service」→ 先ほどのリポジトリを接続
3. 設定：
   - Root Directory：`server`（リポジトリ直下がserverなら空欄）
   - Build Command：`npm install`
   - Start Command：`npm start`
   - Instance Type：**Free**
4. 「Environment」に、`server/.env` の中身を**1つずつ環境変数として登録**
   （🤖 が登録すべきキーと値の一覧を提示します）
5. 「Create Web Service」→ デプロイ完了を待つ
6. 🙋 発行された URL（例：`https://ai-company-brain.onrender.com`）をチャットに貼る

## 2-4. つなぎ込み
- 🤖 `office/config.js` の `apiBase` を**そのRenderのURL**に書き換え
- 🙋 LINEの「Messaging API設定」→ **Webhook URL** に `<RenderのURL>/webhook` を設定し、「Webhookの利用」をオン
  （🤖 が貼り付ける正確なURLを提示）
- 🙋 自分のスマホでそのLINE公式アカウントを友だち追加し、何かメッセージを送る
- 🤖 返信が来るか／`/health` の `line:true` を確認

## 2-5.（任意）自分専用にする・AI返答にする
- `LINE_OWNER_USER_ID`：本人以外の指示を無視したいとき設定（最初のメッセージで自分のIDを確認できます）
- `ANTHROPIC_API_KEY`：設定すると、LINEの返答がAI（社員になりきり）になります

✅ これで「外出先からLINEで指示 → 会社が動く → 結果がLINEで返る」が完成。

---

## つまずいたら

`http://localhost:3000/health`（または RenderのURL + `/health`）を開いて、
`google` / `line` のどれが `false` かを Claude に伝えてください。原因の切り分けと次の一手を案内します。
