// 裁量トレード用ロット計算
// 使い方: ロット計算 USD/JPY 149.50 149.00
import { fetchBalance } from "./myfxbook.js";

const SUPPORTED_PAIRS = ["USD/JPY", "EUR/USD", "GBP/USD", "EUR/JPY", "GBP/JPY", "XAU/USD", "AUD/USD", "AUD/JPY"];

function pipSize(pair) {
  if (pair.includes("JPY")) return 0.01;
  if (pair === "XAU/USD") return 0.1;
  return 0.0001;
}

// 日本語ペア名 → 標準コード
const PAIR_ALIASES = {
  "ドル円": "USD/JPY", "USDJPY": "USD/JPY",
  "ユーロ円": "EUR/JPY", "EURJPY": "EUR/JPY",
  "ユーロドル": "EUR/USD", "EURUSD": "EUR/USD",
  "ポンド円": "GBP/JPY", "GBPJPY": "GBP/JPY",
  "ポンドドル": "GBP/USD", "GBPUSD": "GBP/USD",
  "ゴールド": "XAU/USD", "金": "XAU/USD", "XAUUSD": "XAU/USD",
  "豪ドル円": "AUD/JPY", "AUDJPY": "AUD/JPY",
  "豪ドルドル": "AUD/USD", "AUDUSD": "AUD/USD",
};

function parsePair(input) {
  const trimmed = input.replace("/", "").replace("_", "");
  if (PAIR_ALIASES[trimmed]) return PAIR_ALIASES[trimmed];
  const upper = trimmed.toUpperCase();
  if (PAIR_ALIASES[upper]) return PAIR_ALIASES[upper];
  for (const p of SUPPORTED_PAIRS) {
    if (p.replace("/", "") === upper) return p;
  }
  return null;
}

// 自然な書き方からエントリー・LCを抽出
// 例: "ドル円 エントリー162.370 ロスカット162.200"
function parseNaturalFormat(text) {
  const pairMatch = text.match(/^([^\s　]+)/);
  const entryMatch = text.match(/エントリー[：:\s]*([0-9.]+)/);
  const lcMatch = text.match(/(?:ロスカット|LC|lc|損切)[：:\s]*([0-9.]+)/);
  if (pairMatch && entryMatch && lcMatch) {
    return {
      pairStr: pairMatch[1],
      entry: parseFloat(entryMatch[1]),
      lc: parseFloat(lcMatch[1]),
    };
  }
  return null;
}

export function isLotCalcRequest(text) {
  const t = text.trim();
  // "ロット計算"コマンド or 自然形式（ペア名＋エントリー＋ロスカット）
  if (/^ロット計算/.test(t)) return true;
  if (parseNaturalFormat(t)) return true;
  return false;
}

export async function handleLotCalc(text) {
  const t = text.trim();
  let pairStr, entry, lc;

  if (/^ロット計算/.test(t)) {
    // "ロット計算 USD/JPY 149.50 149.00"
    const parts = t.split(/\s+/);
    if (parts.length < 4) {
      return `📊 ロット計算の使い方：\nロット計算 USD/JPY 149.50 149.00\nまたは：\nドル円 エントリー162.37 ロスカット162.20\n\n対応ペア：\n${SUPPORTED_PAIRS.join(" / ")}`;
    }
    pairStr = parts[1];
    entry = parseFloat(parts[2]);
    lc = parseFloat(parts[3]);
  } else {
    // 自然形式
    const parsed = parseNaturalFormat(t);
    pairStr = parsed.pairStr;
    entry = parsed.entry;
    lc = parsed.lc;
  }

  const pair = parsePair(pairStr);
  if (!pair) {
    return `❌ 対応していないペアです。\n対応ペア：${SUPPORTED_PAIRS.join(" / ")}`;
  }
  if (isNaN(entry) || isNaN(lc)) {
    return `❌ 数値が正しくありません。\n例：ロット計算 USD/JPY 149.50 149.00`;
  }
  if (entry === lc) {
    return `❌ エントリーとLCが同じ値です。`;
  }

  const pip = pipSize(pair);
  const lcPips = Math.abs(entry - lc) / pip;
  const direction = entry > lc ? "ロング" : "ショート";

  // 口座残高取得
  const balance = await fetchBalance();
  if (!balance) {
    // 残高取得できない場合はpips情報だけ返す
    return `📊 ロット計算結果

通貨ペア：${pair}
方向：${direction}
エントリー：${entry}
LC：${lc}
LC幅：${lcPips.toFixed(1)}pips

⚠️ 口座残高を取得できませんでした。
Myfxbookの接続を確認してください。`;
  }

  const riskAmount = balance * 0.02;

  // pip価値/lot（円換算）
  let pipValuePerLot;
  let usdjpy = 150; // フォールバック

  if (!pair.includes("JPY")) {
    try {
      const res = await fetch(
        `https://api.twelvedata.com/price?symbol=USD/JPY&apikey=${process.env.TWELVE_DATA_API_KEY}`
      );
      const d = await res.json();
      usdjpy = parseFloat(d.price || 150);
    } catch {}
  }

  if (pair.includes("JPY")) {
    pipValuePerLot = 1000; // 1pip = 0.01円 × 100,000 = 1,000円/lot
  } else if (pair === "XAU/USD") {
    pipValuePerLot = 10 * usdjpy; // $10/pip/lot × レート
  } else {
    pipValuePerLot = 10 * usdjpy; // $10/pip/lot × レート
  }

  const lot = riskAmount / (lcPips * pipValuePerLot);
  const lotRounded = Math.floor(lot * 100) / 100;
  const actualRisk = lotRounded * lcPips * pipValuePerLot;

  return `📊 ロット計算結果

通貨ペア：${pair}
方向：${direction}
エントリー：${entry}
LC：${lc}
LC幅：${lcPips.toFixed(1)}pips

💰 推奨ロット：${lotRounded.toFixed(2)}lot
口座残高：${Math.round(balance).toLocaleString()}円
リスク金額：${Math.round(actualRisk).toLocaleString()}円（残高の2%）
${!pair.includes("JPY") ? `参照USD/JPY：${usdjpy.toFixed(2)}\n` : ""}
⚠️ 実際のエントリーは社長ご自身の判断で。`;
}
