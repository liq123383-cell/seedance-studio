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

export type ResourcePackage = {
  instanceNo: string;
  name: string;
  product: string;
  productName: string;
  totalAmount: number;
  availableAmount: number;
  unit: string;
  specification: string;
  effectiveTime: string;
  expiryTime: string;
  status: string;
  isSeedance: boolean;
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

async function signedRequest(
  method: "GET" | "POST",
  action: string,
  body?: Record<string, unknown>
) {
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
    Action: action,
    Version: "2022-01-01"
  };
  const now = new Date();
  const xDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "");
  const date = xDate.slice(0, 8);
  const headers: Record<string, string> = { "x-date": xDate };
  const sessionToken = process.env.VOLC_SESSION_TOKEN;
  if (sessionToken) {
    headers["x-security-token"] = sessionToken;
  }
  const serializedBody = body ? JSON.stringify(body) : "";
  if (serializedBody) {
    headers["x-content-sha256"] = sha256Hex(serializedBody);
  }
  const activeSignedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key].trim().replace(/\s+/g, " ")}`)
    .join("\n");
  const canonicalRequest = [
    method,
    path,
    canonicalQuery(params),
    `${canonicalHeaders}\n`,
    activeSignedHeaders,
    serializedBody ? headers["x-content-sha256"] : sha256Hex("")
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

  return fetch(
    `https://${host}${path}?${canonicalQuery(params)}`,
    {
      method,
      headers: {
        ...headers,
        ...(serializedBody
          ? { "content-type": "application/json; charset=utf-8" }
          : {}),
        Authorization: authorization
      },
      ...(serializedBody ? { body: serializedBody } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    }
  );
}

export async function queryVolcengineBalance(): Promise<BalanceResult> {
  const response = await signedRequest("GET", "QueryBalanceAcct");
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

export async function queryVolcengineResourcePackages(): Promise<
  ResourcePackage[]
> {
  type PackageItem = {
    InstanceNo?: string;
    InstanceName?: string;
    Product?: string;
    ProductName?: string;
    TotalAmount?: string;
    AvailableAmount?: string;
    Unit?: string;
    Specification?: string;
    EffectiveTime?: string;
    ExpiryTime?: string;
    Status?: string;
    ConfigurationName?: string;
  };
  type PackageResponse = {
    Result?: {
      List?: PackageItem[];
      NextToken?: string;
    };
    ResponseMetadata?: {
      Error?: { Code?: string; Message?: string };
    };
  };

  const items: PackageItem[] = [];
  let nextToken = "";
  let pageCount = 0;

  do {
    const previousToken = nextToken;
    const response = await signedRequest("POST", "ListResourcePackages", {
      ResourceType: "Package",
      MaxResults: "20",
      NextToken: nextToken
    });
    const data = (await response.json()) as PackageResponse;

    if (!response.ok || !data.Result) {
      const apiError = data.ResponseMetadata?.Error;
      throw new Error(
        apiError?.Message ||
          apiError?.Code ||
          `Resource package API returned ${response.status}`
      );
    }

    const pageItems = data.Result.List ?? [];
    items.push(...pageItems);
    nextToken = data.Result.NextToken ?? "";
    pageCount += 1;

    // Some billing responses can echo a token while returning an empty page.
    if (!pageItems.length || nextToken === previousToken) break;
  } while (nextToken && pageCount < 20);

  return items.map((item) => {
    const searchable = `${item.InstanceName ?? ""} ${
      item.ConfigurationName ?? ""
    } ${item.ProductName ?? ""}`.toLowerCase();
    return {
      instanceNo: item.InstanceNo ?? "",
      name:
        item.InstanceName ||
        item.ConfigurationName ||
        "未命名资源包",
      product: item.Product ?? "",
      productName: item.ProductName ?? "",
      totalAmount: Number(item.TotalAmount ?? 0),
      availableAmount: Number(item.AvailableAmount ?? 0),
      unit: item.Unit || item.Specification || "token",
      specification: item.Specification ?? "",
      effectiveTime: item.EffectiveTime ?? "",
      expiryTime: item.ExpiryTime ?? "",
      status: item.Status ?? "",
      isSeedance: searchable.includes("seedance")
    };
  });
}
