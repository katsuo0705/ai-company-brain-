// Myfxbook 口座残高取得（共通）
export async function fetchBalance() {
  try {
    const loginRes = await fetch(
      `https://www.myfxbook.com/api/login.json?email=${encodeURIComponent(process.env.MYFXBOOK_EMAIL)}&password=${encodeURIComponent(process.env.MYFXBOOK_PASSWORD)}`
    );
    const loginData = await loginRes.json();
    if (loginData.error) return null;

    const accRes = await fetch(
      `https://www.myfxbook.com/api/get-my-accounts.json?session=${loginData.session}`
    );
    const accData = await accRes.json();
    if (accData.error) return null;

    const account = (accData.accounts || []).find(
      (a) => String(a.id) === String(process.env.MYFXBOOK_ACCOUNT_ID)
    );
    return account ? parseFloat(account.balance) : null;
  } catch {
    return null;
  }
}
