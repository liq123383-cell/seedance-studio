import { spawn } from "node:child_process";

const appPort = 3100;
const appBase = `http://127.0.0.1:${appPort}`;
const children = [];

function start(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitFor(url, timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const nextBin = "node_modules/next/dist/bin/next";
  start(["scripts/mock-ark.mjs"]);
  start(
    [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(appPort)],
    {
      ARK_API_KEY: "smoke-test-key",
      ARK_BASE_URL: "http://127.0.0.1:8787/api/v3",
      SEEDANCE_MODEL: "doubao-seedance-smoke",
      ARCHIVE_VIDEO: "false",
      REQUIRE_AUTH: "false",
      ALLOW_ANONYMOUS_GENERATION: "true"
    }
  );

  await waitFor(`${appBase}/api/health`);

  const createResponse = await fetch(`${appBase}/api/video/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "清晨的森林中，光线穿过树叶，镜头缓慢向前推进",
      ratio: "16:9",
      duration: 5,
      resolution: "720p",
      generateAudio: false
    })
  });
  const created = await createResponse.json();

  if (!createResponse.ok || !created.providerTaskId) {
    throw new Error(`Create failed: ${JSON.stringify(created)}`);
  }

  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pollResponse = await fetch(
      `${appBase}/api/video/${created.providerTaskId}`
    );
    result = await pollResponse.json();
    if (!pollResponse.ok) {
      throw new Error(`Poll failed: ${JSON.stringify(result)}`);
    }
    if (result.status === "succeeded") break;
  }

  if (
    result?.status !== "succeeded" ||
    !result?.videoUrl?.includes("seedance-smoke-test.mp4")
  ) {
    throw new Error(`Unexpected final result: ${JSON.stringify(result)}`);
  }

  console.log(
    `SMOKE_OK task=${created.providerTaskId} status=${result.status}`
  );
}

try {
  await main();
} finally {
  for (const child of children) child.kill("SIGTERM");
}
