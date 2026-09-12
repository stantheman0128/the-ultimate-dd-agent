"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const chat = require("../project-chat");
const { spawnSync } = require("node:child_process");
function fixture(t) {
  const dp = fs.mkdtempSync(path.join(os.tmpdir(), "dd-chat-"));
  t.after(() => fs.rmSync(dp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dp, "_analysis", "index"), { recursive: true });
  return dp;
}
function index(dp, file, pages) {
  fs.writeFileSync(path.join(dp, file), "original");
  const st = fs.statSync(path.join(dp, file));
  fs.writeFileSync(
    path.join(dp, "_analysis", "index", file + ".index.json"),
    JSON.stringify({
      file,
      kind: "pdf",
      round: "R1",
      mtime: st.mtimeMs / 1000,
      size: st.size,
      pages,
    }),
  );
}
test("incremental disk retrieval handles large corpus, Chinese queries, exact pages and archived sources", async (t) => {
  const dp = fixture(t);
  index(
    dp,
    "annual.pdf",
    Array.from({ length: 1000 }, (_, i) => ({
      n: i + 1,
      text:
        i === 485
          ? "Note 41 銀行同意 threshold US$5M; Series A US$8M"
          : "ordinary boilerplate ".repeat(150),
    })),
  );
  let result = await chat.retrieval(dp, {
    op: "search",
    query: "第486頁 銀行同意",
  });
  assert.equal(result.matches[0].page, 486);
  assert.ok(JSON.stringify(result).length < 15000);
  const id = result.matches[0].id;
  assert.match(
    (await chat.retrieval(dp, { op: "read", id })).evidence.text,
    /US\$8M/,
  );
  fs.appendFileSync(path.join(dp, "annual.pdf"), "modified");
  result = await chat.retrieval(dp, { op: "search", query: "US$8M" });
  assert.equal(result.matches.length, 0);
  const c = await chat.retrieval(dp, { op: "catalog" });
  assert.match(c.documents[0].warning, /重建索引/);
  fs.unlinkSync(path.join(dp, "annual.pdf"));
  assert.equal((await chat.retrieval(dp, { op: "catalog" })).totalDocuments, 0);
});
test("conversation storage isolates deals, rejects path traversal and bounds history", (t) => {
  const a = fixture(t),
    b = fixture(t),
    c = chat.create(a);
  c.messages = [
    { role: "user", content: "first question", status: "completed" },
  ];
  chat.save(a, c);
  assert.equal(chat.read(a, c.id).messages[0].content, "first question");
  assert.throws(() => chat.read(b, c.id), /不存在/);
  assert.throws(() => chat.read(a, "../../token"), /不存在/);
  const messages = Array.from({ length: 500 }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: "中文".repeat(5000),
    status: "completed",
  }));
  assert.ok(
    Buffer.byteLength(JSON.stringify(chat.boundedHistory(messages))) < 6500,
  );
});
test("tool loop reuses history, enforces request budget and records only actual read evidence", async (t) => {
  const dp = fixture(t);
  index(dp, "report.pdf", [{ n: 1, text: "Revenue 100. Evidence for test." }]);
  const match = (await chat.retrieval(dp, { op: "search", query: "Revenue" }))
    .matches[0];
  const c = chat.create(dp);
  const requests = [];
  let n = 0;
  const client = {
    responses: {
      create: async (args) => {
        requests.push(args);
        return (async function* () {
          let output;
          if (n++ === 0)
            output = [
              {
                type: "function_call",
                call_id: "call1",
                name: "read_chunk",
                arguments: JSON.stringify({ id: match.id }),
              },
            ];
          else {
            yield {
              type: "response.output_text.delta",
              delta: "Revenue 100 [report.pdf p.1]",
            };
            output = [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "Revenue 100" }],
              },
            ];
          }
          yield {
            type: "response.completed",
            response: {
              output,
              usage: { input_tokens: 100, output_tokens: 10 },
            },
          };
        })();
      },
    },
  };
  const sent = [];
  await chat.run({
    dp,
    conversation: c,
    question: "Revenue?",
    client,
    model: "test",
    effort: "low",
    send: (e) => sent.push(e),
  });
  assert.equal(c.messages.at(-1).status, "completed");
  assert.equal(c.messages.at(-1).sources[0].file, "report.pdf");
  assert.equal(c.messages.at(-1).usage.input_tokens, 200);
  assert.ok(c.messages.at(-1).budget.maxInputBytes < chat.MAX_INPUT_BYTES);
  assert.equal(requests[0].tool_choice, "required");
  assert.equal(requests[0].store, false);
  n = 1;
  await chat.run({
    dp,
    conversation: chat.read(dp, c.id),
    question: "What about it?",
    client,
    model: "test",
    effort: "low",
    send: () => {},
  });
  assert.ok(JSON.stringify(requests.at(-1).input).includes("Revenue?"));
});
test("model failure and cancellation never persist a successful answer", async (t) => {
  const dp = fixture(t),
    c = chat.create(dp);
  const client = {
    responses: {
      create: async () => {
        throw new Error("rate limited");
      },
    },
  };
  await chat.run({
    dp,
    conversation: c,
    question: "test",
    client,
    send: () => {},
  });
  assert.equal(chat.read(dp, c.id).messages.at(-1).status, "failed");
  assert.equal(chat.locks.size, 0);
});

test("scoped retrieval works beyond global top results and stale evidence IDs are invalidated", async (t) => {
  const dp = fixture(t);
  for (let i = 0; i < 70; i++)
    index(dp, `report-${i}.pdf`, [
      { n: 1, text: "Vertex shares capital table" },
    ]);
  const r = await chat.retrieval(dp, {
    op: "search",
    query: "Vertex",
    document: "report-69.pdf",
  });
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].file, "report-69.pdf");
  const id = r.matches[0].id;
  index(dp, "report-69.pdf", [{ n: 1, text: "Vertex shares REVISED 1500" }]);
  assert.ok((await chat.retrieval(dp, { op: "read", id })).error);
});
test("spreadsheet chunks retain cell references, formulas and incomplete coverage warnings", async (t) => {
  const dp = fixture(t),
    file = "finance.xlsx";
  fs.writeFileSync(path.join(dp, file), "placeholder");
  const st = fs.statSync(path.join(dp, file));
  fs.writeFileSync(
    path.join(dp, "_analysis", "index", file + ".index.json"),
    JSON.stringify({
      file,
      kind: "xlsx",
      mtime: st.mtimeMs / 1000,
      size: st.size,
      sheets: [
        {
          name: "模型",
          truncated: true,
          cells: Array.from({ length: 110 }, (_, i) => ({
            ref: "B" + (i + 1),
            value: i === 99 ? "股權異常" : i,
            formula: i === 99 ? "=SUM(B1:B99)" : null,
          })),
        },
      ],
    }),
  );
  const r = await chat.retrieval(dp, { op: "search", query: "股權異常" });
  assert.ok(r.matches.length);
  const e = (await chat.retrieval(dp, { op: "read", id: r.matches[0].id }))
    .evidence;
  assert.match(e.text, /B100/);
  assert.match(e.text, /SUM/);
  assert.match(r.warnings.join(" "), /不完整/);
  assert.ok(e.text.length < 3000);
});
test("run enforces tool count and bounded requests under adversarial repeated reads", async (t) => {
  const dp = fixture(t);
  index(dp, "big.pdf", [{ n: 1, text: "長".repeat(20000) }]);
  const id = (await chat.retrieval(dp, { op: "search", query: "第1頁" }))
    .matches[0].id;
  const c = chat.create(dp);
  let i = 0;
  const requests = [];
  const client = {
    responses: {
      create: async (args) => {
        requests.push(args);
        return (async function* () {
          const final = args.tool_choice === "none";
          if (final)
            yield {
              type: "response.output_text.delta",
              delta: "已達讀取上限，無法確認全貌。",
            };
          yield {
            type: "response.completed",
            response: {
              usage: { input_tokens: 100, output_tokens: 20 },
              output: final
                ? []
                : [
                    {
                      type: "function_call",
                      name: "read_chunk",
                      call_id: "c" + i++,
                      arguments: JSON.stringify({ id }),
                    },
                  ],
            },
          };
        })();
      },
    },
  };
  await chat.run({
    dp,
    conversation: c,
    question: "請讀完整案子",
    client,
    send: () => {},
  });
  assert.equal(c.messages.at(-1).status, "completed");
  assert.equal(c.messages.at(-1).budget.toolCalls, 6);
  assert.equal(requests.length, 7);
  assert.ok(c.messages.at(-1).budget.maxInputBytes <= chat.MAX_INPUT_BYTES);
});

test("cancellation aborts the provider, persists cancelled status and releases the conversation lock", async (t) => {
  const dp = fixture(t),
    c = chat.create(dp),
    controller = new AbortController();
  let started;
  const ready = new Promise((resolve) => (started = resolve));
  const client = {
    responses: {
      create: async (_args, { signal }) => {
        started();
        return new Promise((resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          }),
        );
      },
    },
  };
  const pending = chat.run({
    dp,
    conversation: c,
    question: "cancel this",
    client,
    signal: controller.signal,
    send: () => {},
  });
  await ready;
  await assert.rejects(
    chat.run({
      dp,
      conversation: chat.read(dp, c.id),
      question: "concurrent",
      client,
      send: () => {},
    }),
    { status: 409 },
  );
  controller.abort();
  await pending;
  assert.equal(chat.read(dp, c.id).messages.at(-1).status, "cancelled");
  assert.equal(chat.locks.size, 0);
  await assert.rejects(
    chat.retrieval(dp, { op: "catalog" }, controller.signal),
    /已停止/,
  );
});

test("notes-only projects index derived text without borrowing another document metadata", async (t) => {
  const dp = fixture(t);
  fs.writeFileSync(path.join(dp, "_notes.md"), "訪談：下週確認交付時程。");
  const r = await chat.retrieval(dp, { op: "search", query: "交付時程" });
  assert.equal(r.matches[0].file, "_notes.md");
  assert.equal(r.matches[0].kind, "derived");
  index(dp, "report.pdf", [{ n: 1, text: "Revenue 100" }]);
  const f = path.join(dp, "_analysis", "index", "report.pdf.index.json");
  const body = JSON.parse(fs.readFileSync(f));
  body.enrichment = { summary_zh: "ONLY_SOURCE_METADATA" };
  fs.writeFileSync(f, JSON.stringify(body));
  const all = await chat.retrieval(dp, {
    op: "search",
    query: "ONLY_SOURCE_METADATA",
    document: "_notes.md",
  });
  assert.equal(all.matches.length, 0);
});
test("changed originals exclude their old AI routing descriptions as well as text", async (t) => {
  const dp = fixture(t);
  index(dp, "report.pdf", [{ n: 1, text: "Old revenue" }]);
  const f = path.join(dp, "_analysis", "index", "report.pdf.index.json"),
    body = JSON.parse(fs.readFileSync(f));
  body.enrichment = { summary_zh: "STALE_SUMMARY_SENTINEL" };
  fs.writeFileSync(f, JSON.stringify(body));
  assert.ok(
    (
      await chat.retrieval(dp, {
        op: "search",
        query: "STALE_SUMMARY_SENTINEL",
      })
    ).matches.length,
  );
  fs.appendFileSync(path.join(dp, "report.pdf"), "changed");
  assert.equal(
    (
      await chat.retrieval(dp, {
        op: "search",
        query: "STALE_SUMMARY_SENTINEL",
      })
    ).matches.length,
    0,
  );
});
