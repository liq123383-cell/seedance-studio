export const ARK_BASE_URL =
  process.env.ARK_BASE_URL ??
  "https://ark.cn-beijing.volces.com/api/v3";

export const SEEDANCE_MODEL =
  process.env.SEEDANCE_MODEL ?? "doubao-seedance-2-5-260628";

export function arkHeaders() {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    throw new Error("ARK_API_KEY is not configured");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`
  };
}

export function isSafeMediaUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl) {
      return value.startsWith(
        `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/video-inputs/`
      );
    }

    return true;
  } catch {
    return false;
  }
}

export async function safeJson(response: Response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "未知错误";
}
