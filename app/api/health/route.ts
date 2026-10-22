import { supabaseIsConfigured } from "@/lib/server-supabase";

export const runtime = "nodejs";

export function GET() {
  return Response.json({
    ok: true,
    seedanceConfigured: Boolean(process.env.ARK_API_KEY),
    supabaseConfigured: supabaseIsConfigured(),
    archiveEnabled: process.env.ARCHIVE_VIDEO !== "false",
    model: process.env.SEEDANCE_MODEL ?? "doubao-seedance-2-5-260628"
  });
}
