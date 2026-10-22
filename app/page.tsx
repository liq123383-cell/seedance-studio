"use client";

import { createClient, type User } from "@supabase/supabase-js";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent
} from "react";
import { Icon } from "@/components/icons";
import { estimateSeedanceCost, formatCny } from "@/lib/pricing";
import type {
  ResourcePackage,
  SavingsPlanSnapshot
} from "@/lib/volcengine-billing";
import type {
  AspectRatio,
  GenerationRequest,
  Resolution,
  VideoJob,
  VideoStatus
} from "@/lib/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

const LOCAL_HISTORY_KEY = "liuguang-seedance-jobs-v1";

type ConfigState = {
  seedanceConfigured: boolean;
  supabaseConfigured: boolean;
  model?: string;
};

type ResultState = {
  videoUrl: string;
  prompt: string;
  duration: number;
  resolution: Resolution;
  stored: boolean;
  actualCost?: number;
  actualTokens?: number;
};

type BalanceState = {
  configured: boolean;
  balance: {
    available: number;
    cash: number;
    arrears: number;
    currency: string;
    accountId: string;
  } | null;
  resourcePackages?: ResourcePackage[];
  savingsPlan?: SavingsPlanSnapshot | null;
  error?: string;
};

function getLocalHistory(): VideoJob[] {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as VideoJob[];
  } catch {
    return [];
  }
}

function setLocalHistory(jobs: VideoJob[]) {
  try {
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(jobs.slice(0, 12)));
  } catch {
    // Storage may be unavailable in private browsing.
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, "0")}` : `${rest} 秒`;
}

function statusCopy(status: VideoStatus | "idle") {
  switch (status) {
    case "queued":
      return "镜头正在候场";
    case "running":
      return "正在编织画面";
    case "succeeded":
      return "成片已就绪";
    case "failed":
      return "本次生成未完成";
    case "cancelled":
      return "任务已取消";
    default:
      return "等待一个画面";
  }
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<AspectRatio>("16:9");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [generateAudio, setGenerateAudio] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] =
    useState<VideoStatus | "idle">("idle");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<ResultState | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [history, setHistory] = useState<VideoJob[]>([]);
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [balanceState, setBalanceState] = useState<BalanceState | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const runRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const previewRatio = useMemo(() => {
    if (imageFile) return "4 / 3";
    return ratio.replace(":", " / ");
  }, [imageFile, ratio]);

  const progress = useMemo(() => {
    if (!isGenerating && generationStatus !== "succeeded") return 0;
    if (generationStatus === "queued") return Math.min(28, 10 + elapsed * 0.5);
    if (generationStatus === "running") return Math.min(94, 32 + elapsed * 0.8);
    return 100;
  }, [elapsed, generationStatus, isGenerating]);

  const estimatedCost = useMemo(
    () => estimateSeedanceCost(resolution, ratio, duration),
    [duration, ratio, resolution]
  );

  const seedancePackageSummary = useMemo(() => {
    const packages =
      balanceState?.resourcePackages?.filter(
        (item) => item.isSeedance && item.status === "Effective"
      ) ?? [];
    if (!packages.length) return null;

    const totals = new Map<string, number>();
    packages.forEach((item) => {
      totals.set(item.unit, (totals.get(item.unit) ?? 0) + item.availableAmount);
    });
    const nearestExpiry = packages
      .map((item) => item.expiryTime)
      .filter(Boolean)
      .sort()[0];

    return {
      text: Array.from(totals.entries())
        .map(
          ([unit, amount]) =>
            `${amount.toLocaleString("zh-CN")} ${unit}`
        )
        .join(" + "),
      nearestExpiry
    };
  }, [balanceState?.resourcePackages]);
  const savingsPlan = balanceState?.savingsPlan ?? null;
  const accountBalanceView = useMemo(() => {
    if (!user) {
      return {
        label: "Seedance 账户",
        amount: "登录后查看",
        detail: "登录后自动同步余额"
      };
    }

    if (balanceLoading) {
      return {
        label:
          savingsPlan?.name ??
          (seedancePackageSummary ? "Seedance 资源包" : "火山方舟余额"),
        amount: "读取中…",
        detail: "正在同步费用中心数据"
      };
    }

    if (savingsPlan) {
      const expiry = savingsPlan.expiresAt
        ? `${new Date(savingsPlan.expiresAt).toLocaleDateString("zh-CN")} 到期`
        : "以火山控制台为准";
      const updatedAt = savingsPlan.updatedAt
        ? ` · 最近同步 ${new Date(
            savingsPlan.updatedAt
          ).toLocaleString("zh-CN")}`
        : "";
      return {
        label: savingsPlan.name,
        amount: formatCny(savingsPlan.remaining),
        detail: `当前周期剩余 · ${expiry}${updatedAt}`
      };
    }

    if (seedancePackageSummary) {
      return {
        label: "Seedance 资源包",
        amount: seedancePackageSummary.text,
        detail: seedancePackageSummary.nearestExpiry
          ? `生效中 · 最近到期 ${new Date(
              seedancePackageSummary.nearestExpiry
            ).toLocaleDateString("zh-CN")}`
          : "生效中的资源包"
      };
    }

    if (balanceState?.resourcePackages) {
      return {
        label: "Seedance 资源包",
        amount: "暂无可用余量",
        detail: `现金余额 ${
          balanceState.balance
            ? formatCny(balanceState.balance.available)
            : "暂时不可用"
        } · 生成将按量后付费`
      };
    }

    if (balanceState?.balance) {
      return {
        label: "火山方舟余额",
        amount: formatCny(balanceState.balance.available),
        detail: `现金可用余额 · ${balanceState.balance.currency}`
      };
    }

    return {
      label: "火山方舟余额",
      amount: balanceState?.configured === false ? "待配置" : "暂时不可用",
      detail:
        balanceState?.error || "需要配置只读费用中心 AccessKey"
    };
  }, [
    balanceLoading,
    balanceState,
    savingsPlan,
    seedancePackageSummary,
    user
  ]);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 4200);
  }

  async function requestHeaders() {
    if (!supabase) return {} as Record<string, string>;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token
      ? { Authorization: `Bearer ${data.session.access_token}` }
      : ({} as Record<string, string>);
  }

  async function refreshBalance() {
    if (!user) {
      setBalanceState(null);
      return;
    }

    setBalanceLoading(true);
    try {
      const headers = await requestHeaders();
      const response = await fetch("/api/balance", {
        headers,
        cache: "no-store"
      });
      const data = (await response.json()) as BalanceState & {
        error?: string;
      };
      setBalanceState(data);
    } catch {
      setBalanceState({
        configured: true,
        balance: null,
        error: "余额暂时无法读取"
      });
    } finally {
      setBalanceLoading(false);
    }
  }

  async function loadHistory(nextUser: User | null) {
    if (!supabase || !nextUser) {
      setHistory(getLocalHistory());
      return;
    }

    const { data, error: historyError } = await supabase
      .from("video_jobs")
      .select(
        "id,provider_task_id,prompt,status,ratio,duration,resolution,provider_video_url,stored_video_url,error_message,created_at"
      )
      .order("created_at", { ascending: false })
      .limit(8);

    if (historyError) {
      console.error("Failed to load history:", historyError);
      setHistory(getLocalHistory());
      return;
    }

    setHistory((data ?? []) as VideoJob[]);
  }

  function persistLocalJob(job: VideoJob) {
    setHistory((current) => {
      const next = [job, ...current.filter((item) => item.id !== job.id)].slice(
        0,
        12
      );
      setLocalHistory(next);
      return next;
    });
  }

  useEffect(() => {
    setHistory(getLocalHistory());

    fetch("/api/health")
      .then((response) => response.json())
      .then((data: ConfigState) => setConfig(data))
      .catch(() => setConfig(null));

    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      loadHistory(sessionUser);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user ?? null;
      setUser(sessionUser);
      loadHistory(sessionUser);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    void refreshBalance();
  }, [user]);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      runRef.current += 1;
    };
  }, []);

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      showToast("首帧仅支持 JPG、PNG 或 WebP。");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      showToast("首帧图片不能超过 30 MB。");
      return;
    }

    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function chooseImage() {
    if (!supabase || !user) {
      setAuthOpen(true);
      setAuthNotice("登录后即可上传首帧图片。");
      return;
    }
    imageInputRef.current?.click();
  }

  function removeImage() {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
  }

  async function uploadFirstFrame(file: File) {
    if (!supabase || !user) {
      throw new Error("上传首帧需要先登录。");
    }

    const extension =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("video-inputs")
      .upload(path, file, {
        cacheControl: "31536000",
        contentType: file.type,
        upsert: false
      });

    if (uploadError) {
      throw new Error(`首帧上传失败：${uploadError.message}`);
    }

    return supabase.storage.from("video-inputs").getPublicUrl(path).data
      .publicUrl;
  }

  async function startGeneration() {
    if (prompt.trim().length < 4) {
      promptRef.current?.focus();
      showToast("先写下你想看到的画面。");
      return;
    }

    runRef.current += 1;
    const thisRun = runRef.current;
    setError("");
    setToast("");
    setResult(null);
    setElapsed(0);
    setIsGenerating(true);
    setGenerationStatus("queued");
    setActiveTaskId(null);

    if (timerRef.current) clearInterval(timerRef.current);
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    try {
      const firstFrameUrl = imageFile
        ? await uploadFirstFrame(imageFile)
        : undefined;

      if (runRef.current !== thisRun) return;

      const payload: GenerationRequest = {
        prompt: prompt.trim(),
        ratio,
        duration,
        resolution,
        generateAudio,
        firstFrameUrl
      };
      const headers = await requestHeaders();
      const response = await fetch("/api/video/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(payload)
      });
      const data = await response.json();

      if (response.status === 401) {
        setAuthOpen(true);
        setAuthNotice("登录后即可继续生成。");
      }
      if (!response.ok) {
        throw new Error(data.detail || data.error || "创建视频任务失败。");
      }

      const providerTaskId = String(data.providerTaskId);
      setActiveTaskId(providerTaskId);
      setGenerationStatus("running");

      while (
        Date.now() - startedAt < 30 * 60 * 1000 &&
        runRef.current === thisRun
      ) {
        await wait(7000);
        if (runRef.current !== thisRun) return;

        const pollHeaders = await requestHeaders();
        const pollResponse = await fetch(`/api/video/${providerTaskId}`, {
          headers: pollHeaders,
          cache: "no-store"
        });
        const pollData = await pollResponse.json();

        if (!pollResponse.ok) {
          throw new Error(
            pollData.detail || pollData.error || "查询视频任务失败。"
          );
        }

        setGenerationStatus(pollData.status as VideoStatus);
        if (pollData.status === "succeeded") {
          const videoUrl = pollData.storedVideoUrl || pollData.videoUrl;
          if (!videoUrl) throw new Error("任务成功，但没有返回视频地址。");
          const actualTokens = Number(
            pollData.usage?.completion_tokens ??
              pollData.usage?.total_tokens ??
              0
          );
          const actualCost =
            actualTokens > 0
              ? (actualTokens * (resolution === "1080p" ? 77 : 70)) /
                1_000_000
              : undefined;

          setResult({
            videoUrl,
            prompt: prompt.trim(),
            duration,
            resolution,
            stored: Boolean(pollData.storedVideoUrl),
            actualCost,
            actualTokens: actualTokens || undefined
          });
          setIsGenerating(false);
          if (timerRef.current) clearInterval(timerRef.current);
          showToast("成片已就绪，可以播放或下载。");
          void refreshBalance();

          if (!data.persisted) {
            const job: VideoJob = {
              id: String(data.jobId || providerTaskId),
              provider_task_id: providerTaskId,
              prompt: prompt.trim(),
              status: "succeeded",
              ratio: firstFrameUrl ? "adaptive" : ratio,
              duration,
              resolution,
              provider_video_url: pollData.videoUrl ?? videoUrl,
              stored_video_url: pollData.storedVideoUrl ?? null,
              error_message: null,
              created_at: new Date().toISOString()
            };
            persistLocalJob(job);
          } else {
            await loadHistory(user);
          }
          return;
        }

        if (pollData.status === "failed") {
          throw new Error(pollData.error || "Seedance 任务执行失败。");
        }
        if (pollData.status === "cancelled") {
          return;
        }
      }

      if (runRef.current === thisRun) {
        throw new Error("生成等待超过 30 分钟，请稍后在历史记录中查看。");
      }
    } catch (generationError) {
      if (runRef.current === thisRun) {
        const message =
          generationError instanceof Error
            ? generationError.message
            : "生成失败，请稍后重试。";
        setError(message);
        setGenerationStatus("failed");
        setIsGenerating(false);
      }
    } finally {
      if (runRef.current === thisRun && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }

  async function cancelGeneration() {
    if (!activeTaskId) return;
    runRef.current += 1;
    const taskToCancel = activeTaskId;

    try {
      const headers = await requestHeaders();
      await fetch(`/api/video/${taskToCancel}`, {
        method: "DELETE",
        headers
      });
    } catch {
      // The UI still stops polling if the remote cancel request fails.
    }

    setGenerationStatus("cancelled");
    setActiveTaskId(null);
    setIsGenerating(false);
    setError("");
    if (timerRef.current) clearInterval(timerRef.current);
    showToast("已停止等待这个镜头。");
  }

  async function signIn() {
    if (!supabase) {
      setAuthNotice("请先按照 README 配置 Supabase 环境变量。");
      return;
    }
    if (!authEmail.trim()) {
      setAuthNotice("请输入邮箱地址。");
      return;
    }

    setAuthLoading(true);
    setAuthNotice("");
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: authEmail.trim(),
      options: {
        emailRedirectTo: window.location.origin
      }
    });
    setAuthLoading(false);

    if (signInError) {
      setAuthNotice(signInError.message);
      return;
    }
    setAuthNotice("登录链接已发送，请检查邮箱。");
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setUser(null);
    setAuthOpen(false);
    setHistory(getLocalHistory());
  }

  function openHistoryItem(job: VideoJob) {
    const videoUrl = job.stored_video_url || job.provider_video_url;
    setPrompt(job.prompt);
    setDuration(job.duration);
    setResolution(job.resolution as Resolution);
    setGenerationStatus(job.status);
    setError(job.error_message || "");
    setResult(
      videoUrl
        ? {
            videoUrl,
            prompt: job.prompt,
            duration: job.duration,
            resolution: job.resolution as Resolution,
            stored: Boolean(job.stored_video_url)
          }
        : null
    );
    document.getElementById("studio")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  return (
    <div className="site-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="ambient-glow glow-one" aria-hidden="true" />
      <div className="ambient-glow glow-two" aria-hidden="true" />

      <header className="topbar container">
        <a className="brand" href="#" aria-label="流光片场首页">
          <span className="brand-mark">
            <Icon name="sparkle" size={16} />
          </span>
          <span>
            流光片场
            <small>SEEDANCE VIDEO STUDIO</small>
          </span>
        </a>

        <nav className="main-nav" aria-label="主导航">
          <a href="#studio">AI 生成</a>
          <a href="#creations">历史记录</a>
        </nav>

        <div className="topbar-actions">
          <span className="mode-pill">
            <span className="status-dot" />
            {config === null
              ? "检测中"
              : config.seedanceConfigured
                ? "引擎在线"
                : "待配置"}
          </span>
          <button
            className="account-button"
            type="button"
            aria-label={user ? "账户设置" : "登录"}
            onClick={() => setAuthOpen(true)}
          >
            <Icon name={user ? "user" : "arrow"} size={17} />
            <span>{user ? user.email?.split("@")[0] || "账户" : "登录"}</span>
          </button>
        </div>
      </header>

      <main>
        <section className="simple-intro container">
          <div>
            <span className="eyebrow">AI VIDEO GENERATION</span>
            <h1>AI 视频生成</h1>
          </div>
          <p>输入画面描述，选择比例和清晰度，即可创建 Seedance 视频任务。</p>
        </section>

        {!config?.seedanceConfigured && config !== null && (
          <div className="config-banner container" role="status">
            <Icon name="sparkle" size={18} />
            <span>
              创作台已经就绪。接入 Seedance 前，请在服务端配置
              <code>ARK_API_KEY</code>。
            </span>
          </div>
        )}

        <section className="studio-section container" id="studio">
          <div className="studio-frame">
            <div className="creator-panel">
              <div className="panel-heading">
                <div>
                  <span className="step-label">生成设置</span>
                  <h2>描述你的镜头</h2>
                </div>
                <span className="model-badge">
                  <Icon name="film" size={15} />
                  Seedance 2.5
                </span>
              </div>

              <div className="account-summary">
                <div className="account-balance">
                  <span>{accountBalanceView.label}</span>
                  <strong>{accountBalanceView.amount}</strong>
                  <small>{accountBalanceView.detail}</small>
                </div>
                <div className="estimated-cost">
                  <span>本次预计费用</span>
                  <strong>{formatCny(estimatedCost)}</strong>
                  <small>
                    {resolution} · {ratio} · {duration} 秒
                  </small>
                </div>
                {user && (
                  <button
                    className="balance-refresh"
                    type="button"
                    onClick={() => void refreshBalance()}
                    disabled={balanceLoading}
                    title="刷新余额"
                  >
                    <Icon name="refresh" size={16} />
                  </button>
                )}
              </div>

              <label className="field-label" htmlFor="prompt">
                画面描述
                <span>{prompt.length} / 2500</span>
              </label>
              <div className="prompt-wrap">
                <textarea
                  ref={promptRef}
                  id="prompt"
                  value={prompt}
                  maxLength={2500}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="例如：清晨的薄雾里，一辆复古列车穿过金色草原，镜头从高空缓慢下降，风吹动草地，电影感光影……"
                />
              </div>

              <div className="settings-grid">
                <div className="setting-block">
                  <span className="field-label">画面比例</span>
                  <div className="segment-group ratio-group">
                    {(
                      [
                        ["16:9", "横屏"],
                        ["9:16", "竖屏"],
                        ["1:1", "方形"],
                        ["4:3", "复古"],
                        ["3:4", "人像"]
                      ] as Array<[AspectRatio, string]>
                    ).map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        className={ratio === value ? "active" : ""}
                        onClick={() => setRatio(value)}
                      >
                        <span className={`ratio-icon ratio-${value.replace(":", "-")}`} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-block duration-block">
                  <label className="field-label" htmlFor="duration">
                    视频时长
                    <span>{duration} 秒</span>
                  </label>
                  <input
                    id="duration"
                    type="range"
                    min="4"
                    max="30"
                    value={duration}
                    onChange={(event) => setDuration(Number(event.target.value))}
                    style={
                      {
                        "--range-progress": `${((duration - 4) / 26) * 100}%`
                      } as React.CSSProperties
                    }
                  />
                  <div className="range-labels">
                    <span>4s</span>
                    <span>30s</span>
                  </div>
                </div>

                <div className="setting-block resolution-block">
                  <span className="field-label">清晰度</span>
                  <div className="segment-group compact">
                    {(["480p", "720p", "1080p"] as Resolution[]).map(
                      (value) => (
                        <button
                          type="button"
                          key={value}
                          className={resolution === value ? "active" : ""}
                          onClick={() => setResolution(value)}
                        >
                          {value}
                        </button>
                      )
                    )}
                  </div>
                </div>

                <button
                  className={`sound-toggle ${generateAudio ? "on" : ""}`}
                  type="button"
                  onClick={() => setGenerateAudio((current) => !current)}
                  aria-pressed={generateAudio}
                >
                  <span className="toggle-icon">
                    <Icon name="audio" size={17} />
                  </span>
                  <span>
                    原生声音
                    <small>{generateAudio ? "开启环境声与对白" : "仅生成画面"}</small>
                  </span>
                  <span className="switch-track">
                    <span />
                  </span>
                </button>
              </div>

              <p className="cost-disclaimer">
                价格按 Seedance 2.5 官方 token 公式和 24fps
                估算，实际费用以成功任务返回的 token
                用量为准；审核失败不收费。
              </p>

              <div className="upload-row">
                <input
                  ref={imageInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageChange}
                />
                {imagePreview ? (
                  <div className="upload-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imagePreview} alt="首帧预览" />
                    <div>
                      <strong>{imageFile?.name}</strong>
                      <span>作为视频首帧</span>
                    </div>
                    <button type="button" onClick={removeImage} title="移除图片">
                      <Icon name="close" size={17} />
                    </button>
                  </div>
                ) : (
                  <button
                    className="upload-button"
                    type="button"
                    onClick={chooseImage}
                  >
                    <span className="upload-icon">
                      <Icon name="upload" size={18} />
                    </span>
                    <span>
                      添加首帧
                      <small>
                        {user ? "可选 · JPG / PNG / WebP" : "登录后可上传"}
                      </small>
                    </span>
                    <Icon name="arrow" size={17} />
                  </button>
                )}
              </div>

              {error && (
                <div className="inline-error" role="alert">
                  <span>{error}</span>
                  <button type="button" onClick={() => setError("")}>
                    <Icon name="close" size={16} />
                  </button>
                </div>
              )}

              {isGenerating ? (
                <button
                  className="generate-button cancel-button"
                  type="button"
                  onClick={cancelGeneration}
                >
                  <span>停止等待</span>
                  <Icon name="close" size={18} />
                </button>
              ) : (
                <button
                  className="generate-button"
                  type="button"
                  onClick={startGeneration}
                >
                  <span>
                    开始生成
                    <small>
                      预计 {formatCny(estimatedCost)} · 约 1–5 分钟
                    </small>
                  </span>
                  <span className="generate-icon">
                    <Icon name="arrow" size={19} />
                  </span>
                </button>
              )}
            </div>

            <div className="preview-panel">
              <div className="preview-header">
                <div>
                  <span className="step-label">生成结果</span>
                  <span className={`preview-status status-${generationStatus}`}>
                    <span />
                    {statusCopy(generationStatus)}
                  </span>
                </div>
                <span className="preview-time">
                  {isGenerating
                    ? formatElapsed(elapsed)
                    : `${resolution} · ${duration}s`}
                </span>
              </div>

              <div
                className={`preview-stage ${result ? "has-video" : ""}`}
                style={{ aspectRatio: previewRatio }}
              >
                {result ? (
                  <video
                    key={result.videoUrl}
                    src={result.videoUrl}
                    controls
                    playsInline
                    poster={imagePreview ?? undefined}
                  />
                ) : isGenerating ? (
                  <div className="generating-state">
                    <div className="generation-orb">
                      <span className="orb-core" />
                      <span className="orb-ring ring-one" />
                      <span className="orb-ring ring-two" />
                      <span className="orb-point" />
                    </div>
                    <div className="generating-copy">
                      <span>FRAME IN PROGRESS</span>
                      <h3>{statusCopy(generationStatus)}</h3>
                      <p>
                        正在组织光线、动作与镜头语言。可以先离开页面，作品会保存在历史记录中。
                      </p>
                    </div>
                    <div className="progress-track">
                      <span style={{ width: `${progress}%` }} />
                    </div>
                    <div className="progress-meta">
                      <span>{Math.round(progress)}%</span>
                      <span>
                        {generationStatus === "queued"
                          ? "正在分配计算资源"
                          : "Seedance 正在渲染"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state simple-empty-state">
                    <span className="simple-empty-icon">
                      <Icon name="play" size={22} />
                    </span>
                    <h3>视频将在这里显示</h3>
                    <p>填写描述并点击“开始生成”。</p>
                  </div>
                )}
              </div>

              <div className="preview-footer">
                <div className="frame-specs">
                  <span>
                    <Icon name="film" size={15} />
                    {result ? result.resolution : resolution}
                  </span>
                  <span>
                    <Icon name="clock" size={15} />
                    {result ? result.duration : duration} 秒
                  </span>
                  <span>
                    <Icon name="audio" size={15} />
                    {generateAudio ? "有声音" : "无声音"}
                  </span>
                  {typeof result?.actualCost === "number" && (
                    <span>
                      本次 {formatCny(result.actualCost)}
                    </span>
                  )}
                </div>
                {result && (
                  <a
                    className="download-button"
                    href={result.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    download
                  >
                    <Icon name="download" size={16} />
                    下载成片
                  </a>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="creations container" id="creations">
          <div className="section-heading">
            <div>
              <span className="step-label">历史记录</span>
              <h2>我的作品</h2>
            </div>
            {user && (
              <span className="archive-note">
                <Icon name="check" size={15} />
                与 {user.email} 云端同步
              </span>
            )}
          </div>

          {history.length > 0 ? (
            <div className="history-grid">
              {history.slice(0, 6).map((job, index) => {
                const videoUrl = job.stored_video_url || job.provider_video_url;
                return (
                  <button
                    type="button"
                    className="history-card"
                    key={job.id}
                    onClick={() => openHistoryItem(job)}
                  >
                    <div className={`history-thumb tone-${index % 3}`}>
                      {videoUrl ? (
                        <video src={videoUrl} muted playsInline preload="metadata" />
                      ) : (
                        <>
                          <span className="history-orb" />
                          <span className="history-line" />
                        </>
                      )}
                      <span className="history-play">
                        <Icon name="play" size={17} />
                      </span>
                    </div>
                    <div className="history-info">
                      <span className={`history-status ${job.status}`}>
                        {statusCopy(job.status)}
                      </span>
                      <p>{job.prompt}</p>
                      <div className="history-meta">
                        <span>{job.ratio}</span>
                        <span>{job.duration}s</span>
                        <span>{job.resolution}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty-history">
              <span className="empty-history-icon">
                <Icon name="film" size={26} />
              </span>
              <div>
                <h3>这里还很安静</h3>
                <p>完成第一个镜头后，它会出现在这里。</p>
              </div>
              <button type="button" onClick={() => promptRef.current?.focus()}>
                开始创作
                <Icon name="arrow" size={16} />
              </button>
            </div>
          )}
        </section>
      </main>

      {authOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAuthOpen(false);
          }}
        >
          <div className="auth-modal" role="dialog" aria-modal="true">
            <button
              className="modal-close"
              type="button"
              onClick={() => setAuthOpen(false)}
              aria-label="关闭登录窗口"
            >
              <Icon name="close" size={20} />
            </button>
            <span className="modal-mark">
              <Icon name="sparkle" size={20} />
            </span>
            {user ? (
              <>
                <span className="step-label">YOUR STUDIO</span>
                <h2>欢迎回来</h2>
                <p className="modal-copy">当前已登录为 {user.email}</p>
                <button className="modal-primary" type="button" onClick={signOut}>
                  退出登录
                </button>
              </>
            ) : (
              <>
                <span className="step-label">SAVE YOUR STORIES</span>
                <h2>登录后保存作品</h2>
                <p className="modal-copy">
                  使用邮箱一次性登录，作品和生成进度会自动同步。
                </p>
                <label className="field-label" htmlFor="auth-email">
                  邮箱
                </label>
                <input
                  id="auth-email"
                  className="auth-input"
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="you@example.com"
                />
                <button
                  className="modal-primary"
                  type="button"
                  onClick={signIn}
                  disabled={authLoading || !supabase}
                >
                  {authLoading ? "正在发送…" : "发送登录链接"}
                  <Icon name="arrow" size={17} />
                </button>
                {!supabase && (
                  <p className="modal-hint">
                    先在环境变量中配置 Supabase URL 和 anon key。
                  </p>
                )}
                {authNotice && <p className="modal-notice">{authNotice}</p>}
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <Icon name="sparkle" size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
