import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });
const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const sheets = google.sheets({ version: "v4", auth });
const res = await sheets.spreadsheets.values.get({
  spreadsheetId: process.env.SNS_SHEET_ID,
  range: "投稿管理!A2:C10",
});
console.log(JSON.stringify(res.data.values, null, 2));
