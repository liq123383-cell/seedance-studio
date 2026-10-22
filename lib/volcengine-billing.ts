import { createHash, createHmac } from "node:crypto";

type BalanceResult = {
  available: number;
  cash: number;
  arrears: number;
  creditLimit: number;
  frozen: number;
  currency: string;
  accountId: string;
};

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function uriEscape(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function canonicalQuery(params: Record<string, string>) {
  return Object.keys(params)
    .sort()
    .map((key) => `${uriEscape(key)}=${uriEscape(params[key])}`)
    .join("&");
}

export function volcengineBillingIsConfigured() {
  return Boolean(
    process.env.VOLC_ACCESSKEY && process.env.VOLC_SECRETKEY
  );
}

export async function queryVolcengineBalance(): Promise<BalanceResult> {
  const accessKey = process.env.VOLC_ACCESSKEY;
  const secretKey = process.env.VOLC_SECRETKEY;
  if (!accessKey || !secretKey) {
    throw new Error("VOLC_ACCESSKEY and VOLC_SECRETKEY are required");
  }

  const host = "billing.volcengineapi.com";
  const region = "cn-beijing";
  const service = "billing";
  const path = "/";
  const params = {
    Action: "QueryBalanceAcct",
    Version: "2022-01-01"
  };
  const now = new Date();
  const xDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "");
  const date = xDate.slice(0, 8);
  const signedHeaders = "x-date";
  const headers: Record<string, string> = { "x-date": xDate };
  const sessionToken = process.env.VOLC_SESSION_TOKEN;
  if (sessionToken) {
    headers["x-security-token"] = sessionToken;
  }
  const activeSignedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key].trim().replace(/\s+/g, " ")}`)
    .join("\n");
  const canonicalRequest = [
    "GET",
    path,
    canonicalQuery(params),
    `${canonicalHeaders}\n`,
    activeSignedHeaders,
    sha256Hex("")
  ].join("\n");
  const credentialScope = `${date}/${region}/${service}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(secretKey, date), region), service),
    "request"
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");
  const authorization = `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${activeSignedHeaders}, Signature=${signature}`;

  const response = await fetch(
    `https://${host}${path}?${canonicalQuery(params)}`,
    {
      headers: {
        ...headers,
        Authorization: authorization
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    }
  );
  const data = (await response.json()) as {
    Result?: {
      AvailableBalance?: string;
      CashBalance?: string;
      ArrearsBalance?: string;
      CreditLimit?: string;
      FreezeAmount?: string;
      Currency?: string;
      AccountID?: number;
    };
    ResponseMetadata?: {
      Error?: { Code?: string; Message?: string };
    };
  };

  if (!response.ok || !data.Result) {
    const apiError = data.ResponseMetadata?.Error;
    throw new Error(
      apiError?.Message || apiError?.Code || `Billing API returned ${response.status}`
    );
  }

  return {
    available: Number(data.Result.AvailableBalance ?? 0),
    cash: Number(data.Result.CashBalance ?? 0),
    arrears: Number(data.Result.ArrearsBalance ?? 0),
    creditLimit: Number(data.Result.CreditLimit ?? 0),
    frozen: Number(data.Result.FreezeAmount ?? 0),
    currency: data.Result.Currency ?? "CNY",
    accountId: String(data.Result.AccountID ?? "")
  };
}
