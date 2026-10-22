import { getRequestUser } from "@/lib/server-supabase";
import {
  queryVolcengineBalance,
  queryVolcengineResourcePackages,
  volcengineBillingIsConfigured
} from "@/lib/volcengine-billing";

export const runtime = "nodejs";

let cache:
  | {
      value: Awaited<ReturnType<typeof queryVolcengineBalance>>;
      packages: Awaited<ReturnType<typeof queryVolcengineResourcePackages>>;
      expiresAt: number;
    }
  | null = null;

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) {
    return Response.json(
      { error: "登录后才能查看账户余额。" },
      { status: 401 }
    );
  }

  if (!volcengineBillingIsConfigured()) {
    return Response.json({
      configured: false,
      balance: null
    });
  }

  try {
    if (!cache || cache.expiresAt < Date.now()) {
      const [balance, packages] = await Promise.all([
        queryVolcengineBalance(),
        queryVolcengineResourcePackages()
      ]);
      cache = {
        value: balance,
        packages,
        expiresAt: Date.now() + 30_000
      };
    }

    return Response.json(
      {
        configured: true,
        balance: cache.value,
        resourcePackages: cache.packages
      },
      {
        headers: {
          "Cache-Control": "private, no-store"
        }
      }
    );
  } catch (error) {
    console.error("Balance query failed:", error);
    return Response.json(
      {
        configured: true,
        balance: null,
        error: error instanceof Error ? error.message : "余额查询失败"
      },
      { status: 502 }
    );
  }
}
