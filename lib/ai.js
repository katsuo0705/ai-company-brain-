// AI社員の頭脳：LINEからの「指示」を解釈し、担当社員になりきって返答する。
// ANTHROPIC_API_KEY があれば Claude が応答。なければキーワードで定型応答にフォールバック。
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadCompany() {
  const p = join(__dirname, "..", "company.json");
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, "utf-8")); } catch {}
  }
  return {
    name: "あなたのAI会社",
    ceo: { name: "社長" },
    employees: [
      { name: "リサ", role: "案件リサーチャー" },
      { name: "コトハ", role: "提案ライター" },
      { name: "サトル", role: "要件定義パートナー" },
      { name: "ハック", role: "自動化エンジニア" },
    ],
  };
}

function pickEmployee(company, text) {
  const emps = company.employees || [];
  for (const e of emps) {
    if (e.name && text.includes(e.name)) return e;
  }
  // 役割キーワードで推定
  if (/案件|探|リサーチ|調べ/.test(text)) return emps.find((e) => /リサーチ|案件/.test(e.role || "")) || emps[0];
  if (/提案|応募|営業|文章|ライ/.test(text)) return emps.find((e) => /提案|ライ|営業/.test(e.role || "")) || emps[0];
  if (/要件|整理|ヒアリング/.test(text)) return emps.find((e) => /要件|定義/.test(e.role || "")) || emps[0];
  if (/自動化|ツール|作っ|開発/.test(text)) return emps.find((e) => /自動化|エンジ|開発/.test(e.role || "")) || emps[0];
  return null;
}

async function withClaude(company, text) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const roster = (company.employees || []).map((e) => `- ${e.name}（${e.role}）`).join("\n");
  const system =
    `あなたは「${company.name}」の秘書「アイ」です。社長（${company.ceo?.name || "社長"}）をLINEで支えます。\n` +
    `AI社員チーム:\n${roster}\n\n` +
    `ルール:\n` +
    `- 指示に対し、担当社員になりきって短く（LINE向けに3〜6行で）具体的に応える。\n` +
    `- メール送信・予定作成など"外に出す操作"は、必ず最後に「送ってよいですか？」と社長の承認を求める。\n` +
    `- 明るく前向きに。ただし「何をやるか決めるのは社長」という姿勢を保つ。`;
  const msg = await client.messages.create({
    model: "claude-3-5-haiku-latest",
    max_tokens: 400,
    system,
    messages: [{ role: "user", content: text }],
  });
  return (msg.content || []).map((c) => c.text || "").join("").trim();
}

function fallbackReply(company, text) {
  const emp = pickEmployee(company, text);
  if (emp) {
    return `（${emp.name}・${emp.role}）了解しました、社長！\n「${text}」の件、すぐ取りかかります。\n結果がまとまったらこのLINEにご報告します📩`;
  }
  return `社長、指示を受け取りました：「${text}」\n担当の社員に割り振って進めます。\n（外に送る操作が必要なときは、必ず先に確認します）`;
}

export async function handleInstruction(text) {
  const company = loadCompany();
  if (process.env.ANTHROPIC_API_KEY) {
    try { return await withClaude(company, text); } catch { /* フォールバックへ */ }
  }
  return fallbackReply(company, text);
}
