import {
  authenticationIsRequired,
  getAdminSupabase,
  getRequestUser
} from "@/lib/server-supabase";
import {
  ARK_BASE_URL,
  arkHeaders,
  errorMessage,
  safeJson
} from "@/lib/seedance";
import type { VideoStatus } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function normalizeStatus(value: unknown): VideoStatus {
  if (value === "succeeded") return "succeeded";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "cancelled";
  if (value === "running") return "running";
  return "queued";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;
  if (!/^[a-zA-Z0-9-]+$/.test(taskId)) {
    return Response.json({ error: "任务 ID 无效。" }, { status: 400 });
  }

  try {
    const user = await getRequestUser(request);
    if (authenticationIsRequired() && !user) {
      return Response.json({ error: "请先登录。" }, { status: 401 });
    }

    const admin = getAdminSupabase();
    let job: Record<string, unknown> | null = null;

    if (admin && user) {
      const { data } = await admin
        .from("video_jobs")
        .select("*")
        .eq("provider_task_id", taskId)
        .maybeSingle();
      job = data;

      if (job && job.user_id !== user.id) {
        return Response.json({ error: "任务不存在。" }, { status: 404 });
      }
    }

    const response = await fetch(
      `${ARK_BASE_URL}/contents/generations/tasks/${taskId}`,
      {
        headers: arkHeaders(),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store"
      }
    );

    const data = await safeJson(response);
    if (!response.ok) {
      return Response.json(
        {
          error: "查询视频任务失败。",
          detail:
            (data.error as { message?: string } | undefined)?.message ??
            data.message ??
            response.statusText
        },
        { status: response.status }
      );
    }

    const status = normalizeStatus(data.status);
    const content = (data.content ?? {}) as {
      video_url?: string;
      file_url?: string;
    };
    const providerVideoUrl = content.video_url ?? content.file_url ?? null;
    const providerError = data.error as
      | { message?: string; code?: string }
      | null
      | undefined;

    let storedVideoUrl: string | null =
      typeof job?.stored_video_url === "string" ? job.stored_video_url : null;

    if (
      status === "succeeded" &&
      providerVideoUrl &&
      !storedVideoUrl &&
      process.env.ARCHIVE_VIDEO !== "false" &&
      admin &&
      user
    ) {
      try {
        const videoResponse = await fetch(providerVideoUrl, {
          signal: AbortSignal.timeout(45_000)
        });
        const contentLength = Number(
          videoResponse.headers.get("content-length") ?? 0
        );

        // Vercel functions have limited memory. Large videos remain on the
        // temporary provider URL and can be archived by a dedicated worker.
        if (videoResponse.ok && contentLength > 0 && contentLength < 80_000_000) {
          const bytes = await videoResponse.arrayBuffer();
          const path = `${user.id}/${taskId}.mp4`;
          const { error: uploadError } = await admin.storage
            .from("video-results")
            .upload(path, bytes, {
              contentType: "video/mp4",
              upsert: true
            });

          if (!uploadError) {
            storedVideoUrl = admin.storage
              .from("video-results")
              .getPublicUrl(path).data.publicUrl;
          }
        }
      } catch (archiveError) {
        console.error("Video archive failed:", archiveError);
      }
    }

    if (admin && job?.id) {
      await admin
        .from("video_jobs")
        .update({
          status,
          provider_video_url: providerVideoUrl,
          stored_video_url: storedVideoUrl,
          error_message: providerError?.message ?? null,
          updated_at: new Date().toISOString()
        })
        .eq("id", job.id);
    }

    return Response.json({
      id: taskId,
      status,
      videoUrl: providerVideoUrl,
      storedVideoUrl,
      error: providerError?.message ?? null,
      usage: data.usage ?? null
    });
  } catch (error) {
    console.error("Poll video error:", error);
    return Response.json(
      { error: `查询任务失败：${errorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await context.params;

  try {
    const user = await getRequestUser(request);
    if (authenticationIsRequired() && !user) {
      return Response.json({ error: "请先登录。" }, { status: 401 });
    }

    const admin = getAdminSupabase();
    if (admin && user) {
      const { data: ownedJob } = await admin
        .from("video_jobs")
        .select("id")
        .eq("provider_task_id", taskId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!ownedJob) {
        return Response.json({ error: "任务不存在。" }, { status: 404 });
      }
    }

    const response = await fetch(
      `${ARK_BASE_URL}/contents/generations/tasks/${taskId}`,
      {
        method: "DELETE",
        headers: arkHeaders(),
        signal: AbortSignal.timeout(20_000)
      }
    );
    const data = await safeJson(response);

    if (!response.ok && response.status !== 404) {
      return Response.json(
        { error: "取消任务失败。", detail: data },
        { status: response.status }
      );
    }

    if (admin && user) {
      await admin
        .from("video_jobs")
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString()
        })
        .eq("provider_task_id", taskId)
        .eq("user_id", user.id);
    }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: `取消任务失败：${errorMessage(error)}` },
      { status: 500 }
    );
  }
}
