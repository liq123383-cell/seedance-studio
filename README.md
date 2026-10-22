# Seedance Motion Studio

一个可直接部署的 Seedance AI 视频生成网站。包含响应式创作界面、首帧上传、异步任务轮询、视频结果展示、Supabase 登录与云端历史记录。

## 技术栈

- Next.js App Router + React + TypeScript
- 火山方舟 Seedance 2.5 API
- Supabase Auth / Postgres / Storage
- Vercel 部署

## 本地启动

```bash
cd seedance-studio
npm install
cp .env.example .env.local
npm run dev
```

打开 `http://localhost:3000`。

至少需要在 `.env.local` 中填写：

```env
ARK_API_KEY=你的火山方舟APIKey
SEEDANCE_MODEL=doubao-seedance-2-5-260628
VOLC_ACCESSKEY=你的只读AccessKey
VOLC_SECRETKEY=你的只读SecretKey
VOLC_SAVINGS_PLAN_NAME=AI 统一节省计划
VOLC_SAVINGS_PLAN_TOTAL=200
VOLC_SAVINGS_PLAN_BALANCE=192.377
VOLC_SAVINGS_PLAN_EXPIRES_AT=2026-11-22T16:59:59+08:00
VOLC_SAVINGS_PLAN_UPDATED_AT=2026-10-22T18:05:00+08:00
```

没有 Supabase 时，仍可在本地测试文生视频；历史记录暂存在浏览器中。

不需要真实密钥即可验证完整任务流程：

```bash
npm run smoke
```

该命令会启动本地模拟 Seedance 服务，执行创建任务、轮询状态并验证成功返回。

## 配置 Supabase

1. 在 Supabase 创建项目。
2. 打开 SQL Editor，执行 `supabase/schema.sql`。
3. 在 Authentication 中启用 Email OTP 或你需要的登录方式。
4. 把 URL 和 anon key 写入 `.env.local`。
5. 把 service role key 只写入服务端环境变量。

```env
NEXT_PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的anon_key
SUPABASE_SERVICE_ROLE_KEY=你的service_role_key
REQUIRE_AUTH=true
ALLOW_ANONYMOUS_GENERATION=false
DAILY_VIDEO_LIMIT=10
MAX_ACTIVE_JOBS=2
```

`SUPABASE_SERVICE_ROLE_KEY` 和 `ARK_API_KEY` 不能使用 `NEXT_PUBLIC_` 前缀。

账户余额通过火山引擎费用中心的 `QueryBalanceAcct` 接口读取，Seedance Tokens 资源包通过 `ListResourcePackages` 读取。建议使用仅授予余额和资源包查询权限的 IAM 子用户 AccessKey，并把密钥只放在服务端环境变量中。

AI 统一节省计划目前没有开放公开的余额查询 OpenAPI，因此页面中的节省计划余额使用最近从费用中心同步的配置值，并显示同步时间。生成后应回到费用中心节省计划页面核对最新余量。

## Seedance 配置

1. 登录火山引擎并完成实名认证。
2. 在火山方舟创建 API Key。
3. 开通 Seedance 2.5 模型并确认账号余额或资源包满足要求。
4. 确认 API 域名是 `https://ark.cn-beijing.volces.com/api/v3`。

Seedance 2.5 是异步任务接口。创建成功后网站会轮询任务状态，成功后播放并下载视频。服务端会在配置了 Supabase 时尝试把小于 80 MB 的结果转存到 `video-results` 存储桶。

页面会按 Seedance 2.5 官方 token 估算公式实时显示预计费用。生成按钮上的金额是预估值，最终费用以任务成功后的 `usage` 和实际账单为准。

## 部署到 Vercel

```bash
git remote add origin 你的仓库地址
git push -u origin main
```

项目已经初始化为 Git 仓库。推送前先创建 GitHub 仓库，然后执行上面的 `git remote add` 和 `git push`。

在 Vercel 导入仓库，把 `.env.local` 中的变量填写到 Vercel Project Settings → Environment Variables，再点击 Deploy。仓库中的 GitHub Actions 会分别在推送和 Pull Request 时执行类型检查与生产构建。

## 部署到 Netlify

项目已包含 `netlify.toml` 和 Next.js Runtime 插件。也可以在项目目录执行：

```bash
npx netlify-cli login
npx netlify-cli init
npx netlify-cli deploy --build --prod
```

首次部署后，在 Netlify 的 Site configuration → Environment variables 中配置 `.env.local` 的全部变量，并重新部署。

Supabase Authentication → URL Configuration 中需要加入：

```text
https://你的域名
```

## 上线注意

- 生产环境启用 `REQUIRE_AUTH=true`。
- 默认限制每个用户每天 10 个任务、同时最多 2 个任务；可通过 `DAILY_VIDEO_LIMIT` 和 `MAX_ACTIVE_JOBS` 调整。
- Seedance 结果链接只保留 24 小时，正式环境建议使用 TOS 或独立转存 Worker。
- Seedance 2.5 不支持直接上传含真人人脸的参考素材。
- 默认保留 `watermark: true`，满足 AI 生成内容标识要求。
- Supabase 免费项目连续 7 天无活动会暂停，正式运营前升级并配置备份。
