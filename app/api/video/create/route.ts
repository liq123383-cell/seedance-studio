import {
  anonymousGenerationIsAllowed,
  authenticationIsRequired,
  getAdminSupabase,
  getRequestUser
} from "@/lib/server-supabase";
import {
  ARK_BASE_URL,
  SEEDANCE_MODEL,
  arkHeaders,
  errorMessage,
  isSafeMediaUrl,
  safeJson
} from "@/lib/seedance";
import type { AspectRatio, Resolution } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const RATIOS = new Set<AspectRatio>(["16:9", "9:16", "1:1", "4:3", "3:4"]);
const RESOLUTIONS = new Set<Resolution>(["480p", "720p", "1080p"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      prompt?: string;
      ratio?: AspectRatio;
      duration?: number;
      resolution?: Resolution;
      generateAudio?: boolean;
      firstFrameUrl?: string;
    };

    const prompt = body.prompt?.trim();
    const ratio = body.ratio ?? "16:9";
    const duration = Number(body.duration ?? 5);
    const resolution = body.resolution ?? "720p";
    const firstFrameUrl = body.firstFrameUrl?.trim();
    const admin = getAdminSupabase();

    if (!prompt || prompt.length < 4) {
      return Response.json(
        { error: "请至少输入 4 个字的画面描述。" },
        { status: 400 }
      );
    }

    if (prompt.length > 2500) {
      return Response.json(
        { error: "提示词过长，请控制在 2500 个字符以内。" },
        { status: 400 }
      );
    }

    if (!RATIOS.has(ratio)) {
      return Response.json({ error: "不支持的视频比例。" }, { status: 400 });
    }

    if (!Number.isInteger(duration) || duration < 4 || duration > 30) {
      return Response.json(
        { error: "视频时长必须为 4–30 秒的整数。" },
        { status: 400 }
      );
    }

    if (!RESOLUTIONS.has(resolution)) {
      return Response.json({ error: "不支持的视频分辨率。" }, { status: 400 });
    }

    if (firstFrameUrl && !isSafeMediaUrl(firstFrameUrl)) {
      return Response.json(
        { error: "首帧图片必须来自本站配置的公开存储桶。" },
        { status: 400 }
      );
    }

    const user = await getRequestUser(request);
    if (
      (authenticationIsRequired() || !anonymousGenerationIsAllowed()) &&
      !user
    ) {
      return Response.json(
        { error: "请先登录后再创建视频。" },
        { status: 401 }
      );
    }

    if (authenticationIsRequired() && !admin) {
      return Response.json(
        {
          error:
            "生产模式需要 Supabase service role 配置，才能安全保存用户任务。"
        },
        { status: 503 }
      );
    }

    if (admin && user) {
      const dailyLimit = Number(process.env.DAILY_VIDEO_LIMIT ?? "10");
      const activeLimit = Number(process.env.MAX_ACTIVE_JOBS ?? "2");
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const activeSince = new Date(
        Date.now() - 35 * 60 * 1000
      ).toISOString();

      if (dailyLimit > 0) {
        const { count: dailyCount, error: dailyError } = await admin
          .from("video_jobs")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .gte("created_at", dayAgo);

        if (dailyError) {
          return Response.json(
            { error: "暂时无法检查今日生成额度，请稍后重试。" },
            { status: 503 }
          );
        }
        if ((dailyCount ?? 0) >= dailyLimit) {
          return Response.json(
            { error: `今日生成额度已用完（每天 ${dailyLimit} 次）。` },
            { status: 429 }
          );
        }
      }

      if (activeLimit > 0) {
        const { count: activeCount, error: activeError } = await admin
          .from("video_jobs")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .in("status", ["queued", "running"])
          .gte("created_at", activeSince);

        if (activeError) {
          return Response.json(
            { error: "暂时无法检查运行中的任务，请稍后重试。" },
            { status: 503 }
          );
        }
        if ((activeCount ?? 0) >= activeLimit) {
          return Response.json(
            { error: `同时最多运行 ${activeLimit} 个视频任务。` },
            { status: 429 }
          );
        }
      }
    }

    if (!process.env.ARK_API_KEY) {
      return Response.json(
        {
          error:
            "服务端尚未配置 ARK_API_KEY。请按照项目 README 配置后再试。"
        },
        { status: 503 }
      );
    }

    const content: Array<Record<string, unknown>> = [
      { type: "text", text: prompt }
    ];

    if (firstFrameUrl) {
      content.push({
        type: "image_url",
        role: "first_frame",
        image_url: { url: firstFrameUrl }
      });
    }

    const response = await fetch(
      `${ARK_BASE_URL}/contents/generations/tasks`,
      {
        method: "POST",
        headers: arkHeaders(),
        body: JSON.stringify({
          model: SEEDANCE_MODEL,
          content,
          ratio: firstFrameUrl ? "adaptive" : ratio,
          duration,
          resolution,
          generate_audio: Boolean(body.generateAudio),
          watermark: true
        }),
        signal: AbortSignal.timeout(45_000)
      }
    );

    const data = await safeJson(response);
    if (!response.ok) {
      return Response.json(
        {
          error: "Seedance 创建任务失败。",
          detail:
            (data.error as { message?: string } | undefined)?.message ??
            data.message ??
            response.statusText
        },
        { status: response.status }
      );
    }

    const providerTaskId = String(data.id ?? "");
    if (!providerTaskId) {
      return Response.json(
        { error: "Seedance 未返回任务 ID。" },
        { status: 502 }
      );
    }

    let jobId = providerTaskId;
    let persisted = false;
    if (admin && user) {
      const { data: job, error } = await admin
        .from("video_jobs")
        .insert({
          user_id: user.id,
          provider_task_id: providerTaskId,
          prompt,
          status: "queued",
          ratio: firstFrameUrl ? "adaptive" : ratio,
          duration,
          resolution
        })
        .select("id")
        .single();

      if (error) {
        console.error("Failed to persist video job:", error);
      } else {
        jobId = job.id;
        persisted = true;
      }
    }

    return Response.json({
      jobId,
      providerTaskId,
      status: "queued",
      persisted
    });
  } catch (error) {
    console.error("Create video error:", error);
    return Response.json(
      { error: `创建视频失败：${errorMessage(error)}` },
      { status: 500 }
    );
  }
}
