"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net"),
  { spawn } = require("node:child_process");
test("memory HTTP contract persists selection, revisions and deletion and rejects foreign origins", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dd-memory-api-")),
    work = path.join(root, "_workbench");
  fs.mkdirSync(work);
  for (const file of [
    "server.js", "claude-provider.js", "settings.js", "questions.js", "review.js", "rules.js",
    "codex-provider.js",
    "project-chat.js",
    "retrieval.py",
    "memory-store.js",
    "document-tree.js",
    "memory-search.py",
  ])
    fs.copyFileSync(path.join(__dirname, "..", file), path.join(work, file));
  fs.symlinkSync(
    path.join(__dirname, "..", "node_modules"),
    path.join(work, "node_modules"),
    "dir",
  );
  for (const d of ["A", "B"]) fs.mkdirSync(path.join(root, d));
  const socket = net.createServer();
  await new Promise((r) => socket.listen(0, "127.0.0.1", r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const proc = spawn(process.execPath, [path.join(work, "server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      QLIST_MOCK: "1",
      OPENAI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  proc.stderr.on("data", (d) => (errors += d));
  t.after(async () => {
    proc.kill();
    if (proc.exitCode === null) await new Promise((r) => proc.once("close", r));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    proc.stdout.once("data", resolve);
    proc.once("error", reject);
    proc.once("exit", (code) => reject(Error("server " + code + " " + errors)));
  });
  const base = `http://127.0.0.1:${port}`;
  const request = async (url, body, method = "POST", headers = {}) =>
    fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await request(
        "/api/memory",
        { scope: "global", content: "untrusted", status: "active" },
        "POST",
        { Origin: "https://foreign.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    await new Promise((resolve, reject) =>
      require("node:http")
        .get(
          base + "/api/memory?scope=global",
          { headers: { Host: "foreign.example:" + port } },
          (r) => {
            r.resume();
            resolve(r.statusCode);
          },
        )
        .on("error", reject),
    ),
    403,
  );
  const c = await (await request("/api/conversations", { deal: "A" })).json();
  const selected = await (
    await request("/api/conversation/memory", {
      deal: "A",
      id: c.id,
      projects: ["B"],
    })
  ).json();
  assert.deepEqual(selected.memoryProjects, ["B"]);
  assert.equal(selected.memoryVersion, 1);
  const stored = await (
    await fetch(base + "/api/conversation?deal=A&id=" + c.id)
  ).json();
  assert.deepEqual(stored.memoryProjects, ["B"]);
  assert.equal(
    (
      await request("/api/conversation/memory", {
        deal: "A",
        id: c.id,
        projects: ["../B"],
      })
    ).status,
    400,
  );
  const entry = await (
    await request(
      "/api/memory",
      { scope: "A", content: "訪談安排", status: "active" },
      "POST",
      { Origin: base },
    )
  ).json();
  assert.equal(entry.revision, 1);
  const next = await (
    await request("/api/memory", {
      scope: "A",
      id: entry.id,
      revision: 1,
      content: "新的訪談安排",
      status: "active",
    })
  ).json();
  assert.equal(next.revision, 2);
  assert.equal(
    (
      await request("/api/memory", {
        scope: "A",
        id: entry.id,
        revision: 1,
        content: "stale",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        "/api/memory",
        { scope: "A", id: entry.id, revision: 2 },
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await (await fetch(base + "/api/memory?scope=A")).json()).entries.length,
    0,
  );
  const cleared = await (
    await request("/api/conversation/memory", {
      deal: "A",
      id: c.id,
      projects: [],
    })
  ).json();
  assert.equal(cleared.memoryVersion, 2);
});
