"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { MemoryStore } = require("../memory-store"),
  chat = require("../project-chat");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dd-memory-"));
  for (const n of ["甲案", "乙案"]) fs.mkdirSync(path.join(root, n));
  const resolve = (n) => {
    if (!["甲案", "乙案"].includes(n)) throw Error("denied");
    return path.join(root, n);
  };
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, resolve, m: new MemoryStore(root, resolve) };
}
test("Chinese FTS retrieval is scoped and does not expose unselected projects", (t) => {
  const { m } = fixture(t);
  m.save("甲案", { content: "營收核對尚未完成", status: "active" });
  const b = m.save("乙案", {
    content: "營收確認需要核對季度差異",
    status: "active",
  });
  const scopes = m.scopes("甲案");
  assert.equal(m.search(scopes, "營收").length, 1);
  assert.throws(() => m.readAllowed(scopes, "乙案", b.id), /未選擇/);
  assert.equal(m.search(m.scopes("甲案", ["乙案"]), "營收").length, 2);
  assert.throws(() => m.scopes("甲案", ["../secret"]));
});
test("edits use revisions, invalidate context and deletion purges the derived index", (t) => {
  const { m } = fixture(t);
  const a = m.save("甲案", { content: "待核對資本額", status: "active" });
  m.search(["甲案"], "資本額");
  assert.ok(fs.existsSync(path.join(m.root, "memory.sqlite3")));
  const b = m.save(
    "甲案",
    { content: "已核對資本額", status: "active" },
    { id: a.id, revision: 1 },
  );
  assert.equal(m.generation(), 1);
  assert.equal(b.history.length, 1);
  assert.throws(
    () => m.save("甲案", { content: "過期修改" }, { id: a.id, revision: 1 }),
    /已更新/,
  );
  m.remove("甲案", a.id, 2);
  assert.equal(m.search(["甲案"], "資本額").length, 0);
  assert.throws(() => m.get("甲案", a.id), /移除/);
  const raw = fs.readFileSync(m.file("甲案", a.id), "utf8");
  assert.ok(!raw.includes("資本額"));
});
test("candidate and disabled rules do not enter model context; active general rules are always available", (t) => {
  const { m } = fixture(t);
  m.save("global", { content: "先核對期間", status: "active" });
  m.save("global", { content: "錯誤候選", status: "candidate" });
  m.save("甲案", { content: "停用資訊", status: "disabled" });
  const ctx = m.context(m.scopes("甲案"), "無關問題", "");
  assert.equal(ctx.matches.length, 1);
  assert.match(ctx.matches[0].excerpt, /期間/);
  assert.throws(() => m.file("甲案", "../../escape"));
});
function completed(dp) {
  const c = chat.create(dp);
  c.messages = [
    { id: "u", role: "user", content: "請比較股權文件", status: "completed" },
    {
      id: require("node:crypto").randomUUID(),
      role: "assistant",
      content: "兩份股權文件有待核對",
      status: "completed",
      sources: [],
    },
  ];
  chat.save(dp, c);
  return c;
}
const output = {
  summary: "正在核對股權，等待公司補件",
  project: [
    { title: "股權疑點", content: "股權差異尚待查證", confirmationQuote: "" },
  ],
  general: [
    {
      title: "股權比對",
      content: "核對股權時應檢查基準日",
      confirmationQuote: "",
    },
  ],
};
test("background learning persists summary and candidate rules, is idempotent across restart", async (t) => {
  const { m, root, resolve } = fixture(t),
    c = completed(resolve("甲案"));
  m.enqueue("甲案", c);
  let calls = 0;
  const client = {
    responses: {
      create: async () => {
        calls++;
        return { output_text: JSON.stringify(output) };
      },
    },
  };
  await m.drain(client, "test", chat);
  assert.equal(m.jobs()[0].status, "completed");
  assert.equal(m.list("甲案")[0].certainty, "待查證");
  assert.equal(m.list("global")[0].status, "candidate");
  assert.match(m.summary(c.id), /等待/);
  assert.equal(m.summary(c.id, 1), "");
  const restarted = new MemoryStore(root, resolve);
  restarted.enqueue("甲案", c);
  await restarted.drain(client, "test", chat);
  assert.equal(calls, 1);
});
test("failed extraction is visible and retryable; incomplete answers never enqueue", async (t) => {
  const { m, resolve } = fixture(t),
    c = completed(resolve("甲案"));
  m.enqueue("甲案", c);
  await m.drain(
    {
      responses: {
        create: async () => {
          throw Error("network");
        },
      },
    },
    "test",
    chat,
  );
  assert.equal(m.jobs()[0].status, "failed");
  m.retry("甲案");
  await m.drain(
    {
      responses: {
        create: async () => ({ output_text: JSON.stringify(output) }),
      },
    },
    "test",
    chat,
  );
  assert.equal(m.jobs()[0].status, "completed");
  c.messages.at(-1).status = "cancelled";
  c.messages.at(-1).id = require("node:crypto").randomUUID();
  m.enqueue("甲案", c);
  assert.equal(m.jobs().length, 1);
});
test("manual mutation while extraction runs blocks stale memory writes and summary reuse", async (t) => {
  const { m, resolve } = fixture(t),
    c = completed(resolve("甲案"));
  const x = m.save("甲案", { content: "舊資料", status: "active" });
  m.enqueue("甲案", c);
  await m.drain(
    {
      responses: {
        create: async () => {
          m.remove("甲案", x.id, 1);
          return { output_text: JSON.stringify(output) };
        },
      },
    },
    "test",
    chat,
  );
  assert.equal(m.jobs()[0].status, "failed");
  assert.equal(m.list("甲案").length, 0);
  assert.equal(m.summary(c.id), "");
});
test("explicit quoted global instruction can activate a rule", async (t) => {
  const { m, resolve } = fixture(t),
    c = completed(resolve("甲案"));
  c.messages[0].content = "以後所有專案都要先核對文件基準日";
  chat.save(resolve("甲案"), c);
  m.enqueue("甲案", c);
  const data = structuredClone(output);
  data.general[0].confirmationQuote = c.messages[0].content;
  await m.drain(
    {
      responses: {
        create: async () => ({ output_text: JSON.stringify(data) }),
      },
    },
    "test",
    chat,
  );
  assert.equal(m.list("global")[0].status, "active");
});
test("chat omits revoked project history and enforces scope at tool execution", async (t) => {
  const { m, resolve } = fixture(t),
    dp = resolve("甲案");
  fs.mkdirSync(path.join(dp, "_analysis", "index"), { recursive: true });
  const secret = m.save("乙案", {
    title: "機密記憶",
    content: "乙案不可讀內容",
    status: "active",
  });
  const c = chat.create(dp);
  c.memoryProjects = [];
  c.memoryVersion = 1;
  c.messages = [
    {
      role: "user",
      content: "舊對話含有乙案不可讀內容",
      status: "completed",
      memoryVersion: 0,
    },
  ];
  let n = 0;
  const requests = [];
  const client = {
    responses: {
      create: async (args) => {
        requests.push(structuredClone(args));
        return (async function* () {
          if (n++ === 0)
            yield {
              type: "response.completed",
              response: {
                output: [
                  {
                    type: "function_call",
                    call_id: "bad",
                    name: "read_memory",
                    arguments: JSON.stringify({ scope: "乙案", id: secret.id }),
                  },
                ],
                usage: {},
              },
            };
          else {
            yield {
              type: "response.output_text.delta",
              delta: "未選擇此案記憶。",
            };
            yield {
              type: "response.completed",
              response: { output: [], usage: {} },
            };
          }
        })();
      },
    },
  };
  await chat.run({
    dp,
    conversation: c,
    question: "核對記憶",
    memory: m,
    client,
    send: () => {},
  });
  assert.equal(c.messages.at(-1).status, "completed");
  assert.ok(!JSON.stringify(requests).includes("乙案不可讀內容"));
  assert.match(JSON.stringify(requests.at(-1).input), /未選擇/);
  assert.ok(c.messages.at(-1).budget.maxInputBytes <= chat.MAX_INPUT_BYTES);
});
test("many project memories remain within a fixed model input budget", async (t) => {
  const { m, resolve } = fixture(t),
    dp = resolve("甲案");
  fs.mkdirSync(path.join(dp, "_analysis", "index"), { recursive: true });
  for (let i = 0; i < 40; i++)
    m.save(i % 2 ? "global" : "甲案", {
      title: "營收查核 " + i,
      content: "營收核對".repeat(300),
      status: "active",
    });
  const c = chat.create(dp);
  const client = {
    responses: {
      create: async () =>
        (async function* () {
          yield {
            type: "response.output_text.delta",
            delta: "已查閱記憶摘要。",
          };
          yield {
            type: "response.completed",
            response: { output: [], usage: {} },
          };
        })(),
    },
  };
  await chat.run({
    dp,
    conversation: c,
    question: "營收查核",
    memory: m,
    client,
    send: () => {},
  });
  assert.equal(c.messages.at(-1).status, "completed");
  assert.ok(c.messages.at(-1).budget.maxInputBytes <= chat.MAX_INPUT_BYTES);
  assert.ok(c.messages.at(-1).memories.length <= 8);
});
test("explicit correction supersedes old memory and preserves its revision trail", async (t) => {
  const { m, resolve } = fixture(t),
    c = completed(resolve("甲案"));
  const old = m.save("甲案", {
    title: "訪談",
    content: "週二下午",
    status: "active",
  });
  c.messages[0].content = "請記住訪談已改為週三下午";
  chat.save(resolve("甲案"), c);
  m.enqueue("甲案", c);
  const data = {
    summary: "週三下午訪談",
    general: [],
    project: [
      {
        title: "訪談新安排",
        content: "週三下午",
        supersedes: old.id,
        confirmationQuote: c.messages[0].content,
      },
    ],
  };
  await m.drain(
    {
      responses: {
        create: async () => ({ output_text: JSON.stringify(data) }),
      },
    },
    "test",
    chat,
  );
  assert.equal(m.jobs()[0].status, "completed");
  assert.equal(m.get("甲案", old.id).status, "disabled");
  assert.equal(m.get("甲案", old.id).history.length, 1);
  assert.equal(m.list("甲案").filter((x) => x.status === "active").length, 1);
  assert.match(m.summary(c.id), /週三/);
});
test("global tool reads redact originating project provenance", (t) => {
  const { m } = fixture(t);
  const x = m.save("global", {
    content: "查核期間",
    status: "active",
    source: { deal: "乙案", documents: [{ file: "private.pdf" }] },
  });
  assert.ok(
    !JSON.stringify(m.readAllowed(["global", "甲案"], "global", x.id)).includes(
      "private.pdf",
    ),
  );
  assert.ok(
    !JSON.stringify(m.readAllowed(["global", "甲案"], "global", x.id)).includes(
      "乙案",
    ),
  );
});
test("negative instructions are not treated as user confirmation by extracted quotes", async (t) => {
  const { m, resolve } = fixture(t),
    c = completed(resolve("甲案"));
  c.messages[0].content = "不要記住「以後所有專案都先看市場規模」，那只是例子";
  chat.save(resolve("甲案"), c);
  m.enqueue("甲案", c);
  const data = structuredClone(output);
  data.general[0].confirmationQuote = "以後所有專案都先看市場規模";
  await m.drain(
    {
      responses: {
        create: async () => ({ output_text: JSON.stringify(data) }),
      },
    },
    "test",
    chat,
  );
  assert.equal(m.list("global")[0].status, "candidate");
});
test("repeated non-explicit observations do not create duplicate memories", async (t) => {
  const { m, resolve } = fixture(t);
  for (let i = 0; i < 2; i++) {
    const c = completed(resolve("甲案"));
    m.enqueue("甲案", c);
    await m.drain(
      {
        responses: {
          create: async () => ({ output_text: JSON.stringify(output) }),
        },
      },
      "test",
      chat,
    );
  }
  assert.equal(m.list("甲案").length, 1);
  assert.equal(m.list("global").length, 1);
});
test("jobs queued during an active extraction are drained without waiting for restart", async (t) => {
  const { m, resolve } = fixture(t),
    c = completed(resolve("甲案"));
  m.enqueue("甲案", c);
  let count = 0;
  const client = {
    responses: {
      create: async () => {
        if (count++ === 0) {
          const next = completed(resolve("甲案"));
          m.enqueue("甲案", next);
        }
        return { output_text: JSON.stringify(output) };
      },
    },
  };
  await m.drain(client, "test", chat);
  assert.equal(count, 2);
  assert.ok(m.jobs().every((j) => j.status === "completed"));
});
test("memory search records cross-project provenance even without reading full entries", async (t) => {
  const { m, resolve } = fixture(t),
    dp = resolve("甲案");
  fs.mkdirSync(path.join(dp, "_analysis", "index"), { recursive: true });
  m.save("乙案", { title: "股權", content: "股權測試資料", status: "active" });
  const c = chat.create(dp);
  c.memoryProjects = ["乙案"];
  let n = 0;
  const client = {
    responses: {
      create: async () =>
        (async function* () {
          if (n++ === 0)
            yield {
              type: "response.completed",
              response: {
                output: [
                  {
                    type: "function_call",
                    call_id: "search",
                    name: "search_memories",
                    arguments: JSON.stringify({ query: "股權" }),
                  },
                ],
                usage: {},
              },
            };
          else {
            yield { type: "response.output_text.delta", delta: "參考乙案記憶" };
            yield {
              type: "response.completed",
              response: { output: [], usage: {} },
            };
          }
        })(),
    },
  };
  await chat.run({
    dp,
    conversation: c,
    question: "開始",
    client,
    memory: m,
    send: () => {},
  });
  assert.ok(c.messages.at(-1).memories.some((x) => x.scope === "乙案"));
});
test("incomplete extraction cannot activate memories even with parseable JSON", async (t) => {
  const { m, resolve } = fixture(t),
    c = completed(resolve("甲案"));
  m.enqueue("甲案", c);
  await m.drain(
    {
      responses: {
        create: async () => ({
          status: "incomplete",
          output_text: JSON.stringify(output),
        }),
      },
    },
    "test",
    chat,
  );
  assert.equal(m.jobs()[0].status, "failed");
  assert.equal(m.list("甲案").length, 0);
});
