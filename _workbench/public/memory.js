/* Memory selection is persisted on each conversation, never in a global browser preference. */
let memoryProjects = [],
  memoryView = { epoch: 0, scope: null, entries: [], deal: null };
function renderMemoryBar() {
  const el = $("memoryBar");
  if (!el) return;
  const selected = CHAT.conversation?.memoryProjects || memoryProjects;
  el.querySelector("button").textContent =
    "使用記憶：團隊通則 · 本案" +
    (selected.length ? " · 另 " + selected.length + " 案" : "") +
    "　調整";
  el.querySelector("button").disabled = CHAT.busy;
}
async function openMemory() {
  if (CHAT.busy) return;
  const epoch = ++memoryView.epoch;
  memoryView.deal = CHAT.deal;
  $("memoryDialog").showModal();
  $("memoryList").textContent = "正在載入…";
  try {
    const { deals } = await api("/api/deals");
    if (epoch !== memoryView.epoch) return;
    const selected = CHAT.conversation?.memoryProjects || memoryProjects;
    $("memoryProjects").innerHTML =
      deals
        .filter((d) => d.name !== CHAT.deal)
        .map(
          (d) =>
            `<label class="memory-project"><input type="checkbox" value="${esc(d.name)}" ${selected.includes(d.name) ? "checked" : ""}>${esc(d.name)}</label>`,
        )
        .join("") || '<p class="memory-muted">目前沒有其他專案</p>';
    $("memoryScope").innerHTML =
      '<option value="global">團隊通則</option>' +
      deals
        .map(
          (d) =>
            `<option value="${esc(d.name)}">${esc(d.name)}${d.name === CHAT.deal ? "（本案）" : ""}</option>`,
        )
        .join("");
    $("memoryScope").value = CHAT.deal;
    await loadMemory();
  } catch (e) {
    $("memoryList").textContent = e.message;
  }
}
function closeMemory() {
  memoryView.epoch++;
  $("memoryDialog").close();
}
async function saveMemorySelection() {
  const deal = memoryView.deal,
    epoch = CHAT.epoch;
  try {
    const projects = [
      ...$("memoryProjects").querySelectorAll("input:checked"),
    ].map((x) => x.value);
    if (CHAT.conversation) {
      const c = await api("/api/conversation/memory", {
        method: "POST",
        body: JSON.stringify({ deal, id: CHAT.conversation.id, projects }),
      });
      if (CHAT.epoch !== epoch) return;
      CHAT.conversation = c;
    } else memoryProjects = projects;
    renderMemoryBar();
    toast("已更新本次對話的記憶範圍");
  } catch (e) {
    toast(e.message);
  }
}
async function loadMemory() {
  const scope = $("memoryScope").value,
    epoch = ++memoryView.epoch;
  memoryView.scope = scope;
  $("memoryEditor").hidden = true;
  $("memoryList").textContent = "正在載入…";
  try {
    const { entries, jobs } = await api("/api/memory?" + enc({ scope }));
    if (epoch !== memoryView.epoch) return;
    memoryView.entries = entries;
    const labels = {
      active: "使用中",
      candidate: "待確認",
      disabled: "已停用",
    };
    $("memoryList").innerHTML =
      entries
        .map(
          (x) =>
            `<button class="memory-entry" data-id="${esc(x.id)}" onclick="editMemory(this.dataset.id)"><span><strong>${esc(x.title)}</strong><small>${esc(labels[x.status])} · ${esc(x.certainty)} · 第 ${x.revision} 版</small></span><span aria-hidden="true">›</span></button>`,
        )
        .join("") ||
      '<div class="memory-empty">尚無記憶<br><small>對話完成後會在背景整理，也可以直接新增。</small></div>';
    const failed = jobs.filter((j) => j.status === "failed").length,
      pending = jobs.filter((j) =>
        ["pending", "running"].includes(j.status),
      ).length;
    $("memoryJob").textContent = failed
      ? `${failed} 筆整理未完成，可重試；既有記憶不受影響。`
      : pending
        ? `${pending} 筆正在背景整理，稍後重新整理查看。`
        : "記憶會在每次成功回答後增量整理。";
    $("memoryRetry").hidden = !failed || scope === "global";
  } catch (e) {
    $("memoryList").textContent = e.message;
  }
}
function editMemory(id) {
  const entry = id ? memoryView.entries.find((x) => x.id === id) : null;
  memoryView.editing = entry;
  $("memoryEditor").hidden = false;
  $("memoryTitle").value = entry?.title || "";
  $("memoryContent").value = entry?.content || "";
  $("memoryStatus").value = entry?.status || "active";
  $("memoryRemove").hidden = !entry;
  $("memoryDeleteConfirm").hidden = true;
  $("memorySource").textContent = entry?.source?.messageId
    ? "來源：" +
      entry.source.deal +
      " · " +
      new Date(entry.createdAt).toLocaleDateString("zh-TW") +
      (entry.source.documents?.length
        ? "\n文件：" +
          entry.source.documents
            .map((d) => d.file + " " + d.location)
            .join("、")
        : "")
    : "來源：手動新增";
  $("memoryOpenSource").hidden = !entry?.source?.conversationId;
  $("memoryVersions").innerHTML = entry?.history?.length
    ? "<summary>過去版本 · " +
      entry.history.length +
      "</summary>" +
      entry.history
        .slice()
        .reverse()
        .map(
          (h) =>
            `<p>第 ${h.revision} 版 · ${esc(h.updatedAt)}<br>${esc(h.content)}</p>`,
        )
        .join("")
    : "";
  $("memoryTitle").focus();
}
async function saveMemoryEntry() {
  const x = memoryView.editing;
  try {
    await api("/api/memory", {
      method: "POST",
      body: JSON.stringify({
        scope: memoryView.scope,
        id: x?.id,
        revision: x?.revision,
        title: $("memoryTitle").value,
        content: $("memoryContent").value,
        status: $("memoryStatus").value,
      }),
    });
    await loadMemory();
    toast("記憶已保存，下一輪回答起生效");
  } catch (e) {
    toast(e.message);
  }
}
async function removeMemoryEntry() {
  const x = memoryView.editing;
  if (!x) return;
  try {
    await api("/api/memory", {
      method: "DELETE",
      body: JSON.stringify({
        scope: memoryView.scope,
        id: x.id,
        revision: x.revision,
      }),
    });
    await loadMemory();
    toast("記憶與搜尋索引已移除");
  } catch (e) {
    toast(e.message);
  }
}
async function retryMemoryJobs() {
  try {
    await api("/api/memory/retry", {
      method: "POST",
      body: JSON.stringify({ deal: memoryView.scope }),
    });
    await loadMemory();
  } catch (e) {
    toast(e.message);
  }
}
async function watchMemoryLearning(attempt = 0, epoch = CHAT.epoch) {
  if (!CHAT.conversation || epoch !== CHAT.epoch) return;
  try {
    const r = await api(
      "/api/memory/status?" +
        enc({ deal: CHAT.deal, conversation: CHAT.conversation.id }),
    );
    if (epoch !== CHAT.epoch) return;
    const labels = {
      none: "",
      pending: "正在整理記憶…",
      running: "正在整理記憶…",
      completed: "記憶整理完成",
      failed: "整理未完成，可在記憶管理重試",
      superseded: "已略過過期的整理工作",
    };
    $("memoryLearning").textContent = labels[r.status] || "";
    if (["none", "pending", "running"].includes(r.status) && attempt < 12)
      setTimeout(() => watchMemoryLearning(attempt + 1, epoch), 5000);
  } catch {
    if (epoch === CHAT.epoch)
      $("memoryLearning").textContent = "無法取得記憶整理狀態";
  }
}
function filterMemoryProjects(value) {
  const q = value.trim().toLowerCase();
  for (const label of $("memoryProjects").querySelectorAll("label"))
    label.hidden = !label.textContent.toLowerCase().includes(q);
}

async function openMemorySource() {
  const source = memoryView.editing?.source;
  if (!source?.conversationId) return;
  closeMemory();
  try {
    await pickDeal(source.deal);
    pickTab("chat");
    await selectChat(source.conversationId);
  } catch (e) {
    toast("無法開啟來源對話：" + e.message);
  }
}
