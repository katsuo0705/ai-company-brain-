/**
 * SNS画像をDriveにアップロードし、スプレッドシートの「画像」列に =IMAGE(URL) を挿入する
 *
 * 使い方:
 *   node server/scripts/sns-image-upload.mjs                   ← 今週・先週の全画像
 *   node server/scripts/sns-image-upload.mjs 2026_7.6~7.12     ← 指定フォルダのみ
 */

import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve, basename } from "path";
import { readdirSync, createReadStream, existsSync } from "fs";
import { google } from "googleapis";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const SHEET_ID   = process.env.SNS_SHEET_ID;
const IMG_DIR    = resolve(__dirname, "../../logs/SNS/画像/images");
const DRIVE_FOLDER = "SNS晩投稿画像";

// 列インデックス（0始まり）: 投稿管理タブの列構成
// 日付(A)曜日(B)時間帯(C)設計(D)投稿文(E)画像案(F)... → F列（index=5）に画像URL
const IMG_COL = 5; // F列

function getAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

/** Drive上のフォルダを取得 or 作成 */
async function getOrCreateFolder(drive) {
  const res = await drive.files.list({
    q: `name='${DRIVE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
  });
  if (res.data.files.length > 0) return res.data.files[0].id;
  const folder = await drive.files.create({
    requestBody: { name: DRIVE_FOLDER, mimeType: "application/vnd.google-apps.folder" },
    fields: "id",
  });
  return folder.data.id;
}

let forceUpload = false;

/** PNGをDriveにアップロードして =IMAGE() 用URLを返す */
async function uploadImage(drive, filePath) {
  const folderId = await getOrCreateFolder(drive);
  const filename = basename(filePath);

  // 同名ファイルが既にあれば削除して上書き（force=trueの場合）またはスキップ
  const existing = await drive.files.list({
    q: `name='${filename}' and '${folderId}' in parents and trashed=false`,
    fields: "files(id)",
  });
  if (existing.data.files.length > 0) {
    if (!forceUpload) {
      const id = existing.data.files[0].id;
      console.log(`  ⏭ スキップ（既存）: ${filename}`);
      return `https://drive.google.com/uc?export=view&id=${id}`;
    }
    // 上書き：既存ファイルを削除
    for (const f of existing.data.files) {
      await drive.files.delete({ fileId: f.id });
    }
  }

  const file = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: "image/png", body: createReadStream(filePath) },
    fields: "id",
  });
  const fileId = file.data.id;

  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  console.log(`  ✅ アップロード: ${filename}`);
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

/**
 * ファイル名から日付文字列を抽出
 * 例: 0706_晩.png → "2026-07-06"
 *     0629_晩.png → "2026-06-29"
 */
function filenameToDate(filename) {
  const m = filename.match(/^(\d{2})(\d{2})_/);
  if (!m) return null;
  const month = parseInt(m[1]);
  const day   = parseInt(m[2]);
  const year  = 2026;
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

/** スプレッドシートから既存データを読み込み、行番号マップを作成 */
async function buildRowMap(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "投稿管理!A2:F",
  });
  const rows = res.data.values || [];
  // "日付_時間帯" をキーに行番号（2始まり）を返す
  const map = {};
  rows.forEach((row, i) => {
    const date = row[0] || "";
    const slot = (row[2] || "").split("\n")[0].trim();
    if (date && slot) map[`${date}_${slot}`] = i + 2;
  });
  return map;
}

/** =IMAGE(URL) をシートのF列に書き込む */
async function writeImageFormula(sheets, rowNum, url) {
  const cell = `F${rowNum}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `投稿管理!${cell}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[`=IMAGE("${url}",4,100,178)`]] },
  });
}

export async function main(folderArg) {
  const auth   = getAuth();
  const drive  = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });

  // 対象フォルダを決定
  let targetFolders;
  if (folderArg) {
    targetFolders = [join(IMG_DIR, folderArg)];
  } else {
    // imagesフォルダ以下の全週フォルダ
    targetFolders = readdirSync(IMG_DIR)
      .filter(d => /^\d{4}_/.test(d))
      .map(d => join(IMG_DIR, d));
  }

  const rowMap = await buildRowMap(sheets);
  console.log(`📋 スプレッドシート: ${Object.keys(rowMap).length}行読み込み`);

  let uploaded = 0, skipped = 0, notFound = 0;

  for (const folder of targetFolders) {
    if (!existsSync(folder)) { console.log(`⚠ フォルダなし: ${folder}`); continue; }
    const pngs = readdirSync(folder).filter(f => f.endsWith(".png"));
    console.log(`\n📁 ${basename(folder)} (${pngs.length}枚)`);

    for (const png of pngs) {
      const date = filenameToDate(png);
      if (!date) { console.log(`  ⚠ 日付解析不可: ${png}`); continue; }

      const key = `${date}_晩`;
      const rowNum = rowMap[key];
      if (!rowNum) {
        console.log(`  ⚠ シートに未登録: ${date} 晩`);
        notFound++;
        continue;
      }

      const url = await uploadImage(drive, join(folder, png));
      await writeImageFormula(sheets, rowNum, url);
      uploaded++;
    }
  }

  console.log(`\n📊 完了: アップロード${uploaded}件 / スキップ${skipped}件 / シート未登録${notFound}件`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  forceUpload = args.includes("--force");
  const folderArg = args.find(a => !a.startsWith("--"));
  main(folderArg).catch(console.error);
}
