/* Conversation state stays on the local server; only selected conversation IDs are stored in the browser. */
let CHAT = {
  deal: null,
  conversation: null,
  controller: null,
  epoch: 0,
  busy: false,
};
async function initChat(deal) {
  if (CHAT.deal === deal) return;
  CHAT.controller?.abort();
  CHAT = {
    deal,
    conversation: null,
    controller: null,
    epoch: CHAT.epoch + 1,
    busy: false,
  };
  memoryProjects = [];
  if ($("memoryLearning")) $("memoryLearning").textContent = "";
  $("aiQ").value = "";
  renderChat();
  await loadChats();
}
async function loadChats() {
  const deal = CHAT.deal,
    epoch = CHAT.epoch;
  if (!deal) return;
  try {
    const { conversations } = await api("/api/conversations?" + enc({ deal }));
    if (CHAT.epoch !== epoch) return;
    $("chatHistory").innerHTML =
      '<div class="history-heading"><h3>本案討論</h3><span>' +
      conversations.length +
      "</span></div>" +
      (conversations.length
        ? ""
        : '<div class="history-empty"><span class="ui-icon" style="--icon:url(/icons/message-square.svg)" aria-hidden="true"></span><p>尚無討論紀錄</p><small>送出第一個問題後，<br>討論會自動保存在這裡。</small></div>') +
      conversations
        .map(
          (c) =>
            `<button data-id="${esc(c.id)}" title="${esc(c.title)}" class="${CHAT.conversation?.id === c.id ? "on" : ""}" onclick="selectChat(this.dataset.id)">${esc(c.title)}<time>${Number.isNaN(Date.parse(c.updatedAt)) ? "" : new Date(c.updatedAt).toLocaleDateString("zh-TW", { month: "short", day: "numeric" })}</time></button>`,
        )
        .join("");
    if (!CHAT.conversation) {
      const id = localStorage.getItem("dd-chat:" + deal);
      if (id && conversations.some((c) => c.id === id)) await selectChat(id);
    }
  } catch (e) {
    $("chatLive").textContent = "無法載入對話：" + e.message;
  }
}
async function selectChat(id) {
  CHAT.controller?.abort();
  const epoch = ++CHAT.epoch,
    deal = CHAT.deal;
  CHAT.busy = false;
  try {
    const c = await api("/api/conversation?" + enc({ deal, id }));
    if (epoch !== CHAT.epoch) return;
    CHAT.conversation = c;
    localStorage.setItem("dd-chat:" + deal, c.id);
    memoryProjects = [];
    if ($("memoryLearning")) $("memoryLearning").textContent = "";
    $("aiQ").value = "";
    renderChat();
    await loadChats();
  } catch (e) {
    toast(e.message);
  }
}
async function newChat() {
  CHAT.controller?.abort();
  CHAT.busy = false;
  CHAT.epoch++;
  CHAT.conversation = null;
  localStorage.removeItem("dd-chat:" + CHAT.deal);
  memoryProjects = [];
  if ($("memoryLearning")) $("memoryLearning").textContent = "";
  $("aiQ").value = "";
  renderChat();
  await loadChats();
  $("aiQ").focus();
}
function sourceButtons(sources) {
  return (sources || [])
    .map(
      (s) =>
        `<button class="chat-source" data-id="${esc(s.id)}" onclick="chatEvidence(this.dataset.id)">↗ ${esc(s.file)} · ${esc(s.location)}</button>`,
    )
    .join("");
}
function messageHTML(m) {
  const source = sourceButtons(m.sources);
  return `<article class="chat-message ${m.role === "user" ? "user" : "assistant"}"><div class="chat-who"><span class="message-avatar" aria-hidden="true">${m.role === "user" ? "你" : '<span class="ui-icon" style="--icon:url(/icons/file-text.svg)"></span>'}</span>${m.role === "user" ? "你" : "研究助理"}${m.status === "running" ? " · 回覆中" : ""}</div><div class="mdr">${m.role === "user" ? esc(m.content).replace(/\n/g, "<br>") : citeLinks(mdToHtml(m.content || (m.status === "running" ? "正在查找相關資料…" : "（沒有完成回覆）")))}</div>${m.activity?.length ? `<details><summary>資料查找紀錄 · ${m.activity.length} 個步驟</summary>${m.activity.map((a) => `<div>${esc(a)}</div>`).join("")}</details>` : ""}${source ? `<details><summary>參考來源 · ${m.sources.length}</summary>${source}</details>` : ""}${m.memories?.length ? `<details><summary>參考記憶 · ${m.memories.length}</summary>${m.memories.map((x) => `<div>${esc(x.scope === "global" ? "團隊通則" : x.scope)} · ${esc(x.title)}（第 ${x.revision} 版）</div>`).join("")}<small>背景記憶，並非原始文件證據</small></details>` : ""}${m.error || ["cancelled", "interrupted"].includes(m.status) ? `<div class="chat-error">${esc(m.error || "此回覆已中斷")} <button data-id="${esc(m.id)}" onclick="retryChat(this.dataset.id)">再次提問</button></div>` : ""}${m.usage ? `<details class="chat-usage"><summary>用量詳情</summary><div>本輪合計輸入 ${(m.usage.input_tokens || 0).toLocaleString()} tokens · 輸出 ${(m.usage.output_tokens || 0).toLocaleString()} · ${m.budget?.toolCalls || 0} 次按需讀取</div></details>` : ""}${m.role === "assistant" && m.content ? `<button class="chat-copy" data-id="${esc(m.id)}" onclick="copyChat(this.dataset.id)">複製回答</button>` : ""}</article>`;
}
function renderChat() {
  renderMemoryBar();
  const log = $("chatLog");
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  $("chatTitle").textContent = CHAT.conversation?.title || "尚未開始討論";
  const expanded = Array.from(log.querySelectorAll("details"))
    .map((d, i) => (d.open ? i : -1))
    .filter((i) => i >= 0);
  const msgs = CHAT.conversation?.messages || [];
  log.innerHTML = msgs.length
    ? msgs.map(messageHTML).join("")
    : `<div class="chat-empty"><div class="conversation-emblem" aria-hidden="true"><span class="ui-icon" style="--icon:url(/icons/message-square.svg)"></span></div><span class="conversation-kicker">案件研究助理</span><h3>從你關心的問題開始。</h3><p>查閱財務與營運資訊、比較文件差異，<br>或接續討論需要向公司確認的事項。</p><div class="chat-starters"><button onclick="startQuestion('本案有哪些優先查核事項？')"><span class="starter-icon ui-icon" style="--icon:url(/icons/list-checks.svg)" aria-hidden="true"></span><strong>掌握查核重點</strong><span>哪些事項值得優先確認？</span></button><button onclick="startQuestion('股權表與股東名簿是否一致？')"><span class="starter-icon ui-icon" style="--icon:url(/icons/git-compare-arrows.svg)" aria-hidden="true"></span><strong>比較文件差異</strong><span>核對股權、營收與關鍵數字</span></button><button onclick="startQuestion('有哪些重要資料還沒提供？')"><span class="starter-icon ui-icon" style="--icon:url(/icons/folder-open.svg)" aria-hidden="true"></span><strong>整理待補資料</strong><span>找出缺件與需要追問的內容</span></button></div><div class="conversation-scope"><span class="ui-icon" style="--icon:url(/icons/file-text.svg)" aria-hidden="true"></span>以本案資料為範圍 · 回答可展開來源核對</div></div>`;
  expanded.forEach((i) => {
    const detail = log.querySelectorAll("details")[i];
    if (detail) detail.open = true;
  });
  updateComposer();
  $("chatStop").hidden = !CHAT.busy;
  $("aiQ").disabled = CHAT.busy;
  $("chatLive").textContent = CHAT.busy
    ? msgs.at(-1)?.activity?.at(-1) || "正在準備文件導覽…"
    : "";
  if (nearBottom || msgs.length <= 2) log.scrollTop = log.scrollHeight;
}
function startQuestion(q) {
  $("aiQ").value = q;
  updateComposer();
  $("aiQ").focus();
}
function retryChat(id) {
  const msgs = CHAT.conversation?.messages || [];
  const i = msgs.findIndex((m) => m.id === id);
  if (i > 0) startQuestion(msgs[i - 1].content);
}
async function copyChat(id) {
  try {
    await navigator.clipboard.writeText(
      CHAT.conversation.messages.find((m) => m.id === id).content,
    );
    toast("已複製回答");
  } catch {
    toast("瀏覽器無法複製，請選取文字複製");
  }
}
function stopChat() {
  CHAT.controller?.abort();
}
async function chatEvidence(id) {
  const snapshot = CHAT.conversation?.messages
    .flatMap((m) => m.sources || [])
    .find((s) => s.id === id);
  try {
    let result;
    try {
      result = await api("/api/evidence?" + enc({ deal: CHAT.deal, id }));
    } catch (e) {
      if (!snapshot?.text) throw e;
      result = { evidence: snapshot, historical: true };
    }
    const e = result.evidence;
    if (result.error) throw new Error(result.error);
    if (!result.historical && ["pdf", "xlsx", "pptx"].includes(e.kind))
      return openEvidence(e.file, e.round, e.location);
    $("evTitle").textContent = e.file + " · " + e.location;
    $("evSub").textContent = result.historical
      ? "歷史引用快照：原索引已更新或文件已移除"
      : e.kind === "derived"
        ? "分析產物，請與原件核對"
        : e.kind === "metadata"
          ? "AI 產生的索引描述，請核對原件"
          : "辨識／分段文字，請核對原件";
    $("evLeft").textContent =
      e.kind === "metadata" ? "文件導覽（AI 產生）" : "辨識／原文片段";
    $("evText").textContent = e.text;
    if (!result.historical && /\.(png|jpe?g|webp|gif|bmp)$/i.test(e.file)) {
      const img = document.createElement("img");
      img.src =
        "/api/download?" +
        enc({ deal: CHAT.deal, from: "doc", file: e.file, round: e.round });
      img.alt = e.file;
      img.style.maxWidth = "100%";
      $("evLeft").replaceChildren(img);
    }
    $("evNav").textContent = "";
    $("evDl").style.display = "none";
    if (!result.historical && e.kind !== "derived") {
      $("evDl").style.display = "";
      $("evDl").onclick = () =>
        window.open(
          "/api/download?" +
            enc({ deal: CHAT.deal, from: "doc", file: e.file, round: e.round }),
          "_blank",
        );
    }
    show("evOverlay");
  } catch (e) {
    toast(e.message);
  }
}
async function askAI() {
  const question = $("aiQ").value.trim();
  if (!question || CHAT.busy) return;
  if (new TextEncoder().encode(question).length > 6000)
    return toast("問題太長，請縮短後送出");
  const epoch = CHAT.epoch,
    deal = CHAT.deal;
  CHAT.busy = true;
  const controller = new AbortController();
  CHAT.controller = controller;
  let assistant;
  try {
    if (!CHAT.conversation) {
      const c = await api("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ deal, memoryProjects }),
      });
      if (epoch !== CHAT.epoch) return;
      CHAT.conversation = c;
      localStorage.setItem("dd-chat:" + deal, c.id);
    }
    const c = CHAT.conversation;
    assistant = {
      id: "pending",
      role: "assistant",
      content: "",
      status: "running",
      sources: [],
      activity: [],
    };
    c.messages.push(
      { role: "user", content: question, status: "completed" },
      assistant,
    );
    if (c.messages.length === 2) c.title = question.slice(0, 44);
    $("aiQ").value = "";
    renderChat();
    const r = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        deal,
        conversationId: c.id,
        question,
        model: curModel(),
      }),
    });
    if (!r.ok) throw new Error((await r.json()).error || "請求失敗");
    const reader = r.body.getReader(),
      decoder = new TextDecoder();
    let buf = "",
      finished = false;
    const handle = (e) => {
      if (e.messageId) assistant.id = e.messageId;
      if (e.delta) assistant.content += e.delta;
      if (e.activity) assistant.activity.push(e.activity);
      if (e.sources) assistant.sources = e.sources;
      if (e.memories) assistant.memories = e.memories;
      if (e.usage) assistant.usage = e.usage;
      if (e.budget) assistant.budget = e.budget;
      if (e.error) {
        assistant.error = e.error;
        assistant.status = "failed";
      }
      if (e.done) {
        finished = true;
        assistant.status = e.status || assistant.status;
      }
      if (CHAT.epoch === epoch) renderChat();
    };
    while (true) {
      const { value, done } = await reader.read();
      buf += decoder.decode(value || new Uint8Array(), { stream: !done });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const event = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const line of event.split("\n"))
          if (line.startsWith("data: ")) handle(JSON.parse(line.slice(6)));
      }
      if (done) break;
    }
    if (!finished) throw new Error("連線中斷，回答未完成");
  } catch (e) {
    if (assistant) {
      assistant.status = e.name === "AbortError" ? "cancelled" : "failed";
      assistant.error =
        e.name === "AbortError" ? "已停止生成，可再次提問" : e.message;
    } else if (epoch === CHAT.epoch) toast(e.message);
  } finally {
    if (epoch === CHAT.epoch) {
      CHAT.busy = false;
      CHAT.controller = null;
      renderChat();
      loadChats();
      if (assistant?.status === "completed") watchMemoryLearning();
    }
  }
}

function updateComposer() {
  const input = $("aiQ");
  $("aiBtn").disabled = CHAT.busy || !input.value.trim();
  input.style.height = "0px";
  input.style.height = Math.min(120, Math.max(32, input.scrollHeight)) + "px";
}
function toggleChatHistory(button) {
  const hidden = $("tab-chat").classList.toggle("history-hidden");
  button.setAttribute("aria-expanded", String(!hidden));
}
