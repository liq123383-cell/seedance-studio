import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.env.MOCK_ARK_PORT ?? 8787);
const tasks = new Map();

function send(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (
    request.method === "POST" &&
    url.pathname === "/api/v3/contents/generations/tasks"
  ) {
    let rawBody = "";
    for await (const chunk of request) rawBody += chunk;
    const payload = JSON.parse(rawBody || "{}");
    const id = `cgt-smoke-${randomUUID()}`;
    tasks.set(id, {
      payload,
      polls: 0,
      createdAt: Math.floor(Date.now() / 1000)
    });
    send(response, 200, { id });
    return;
  }

  const taskMatch = url.pathname.match(
    /^\/api\/v3\/contents\/generations\/tasks\/([^/]+)$/
  );
  if (taskMatch && request.method === "GET") {
    const id = decodeURIComponent(taskMatch[1]);
    const task = tasks.get(id);
    if (!task) {
      send(response, 404, { error: { message: "Task not found" } });
      return;
    }

    task.polls += 1;
    if (task.polls === 1) {
      send(response, 200, {
        id,
        model: "doubao-seedance-smoke",
        status: "running",
        content: {},
        usage: { total_tokens: 0 }
      });
      return;
    }

    send(response, 200, {
      id,
      model: "doubao-seedance-smoke",
      status: "succeeded",
      content: {
        video_url: "https://example.com/seedance-smoke-test.mp4"
      },
      usage: { total_tokens: 1200 },
      duration: task.payload.duration ?? 5,
      ratio: task.payload.ratio ?? "16:9",
      resolution: task.payload.resolution ?? "720p",
      created_at: task.createdAt
    });
    return;
  }

  if (taskMatch && request.method === "DELETE") {
    const id = decodeURIComponent(taskMatch[1]);
    tasks.delete(id);
    send(response, 200, { id, status: "cancelled" });
    return;
  }

  send(response, 404, { error: { message: "Not found" } });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock Ark listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
