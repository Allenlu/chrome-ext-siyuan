// 思源划词收藏 · 设置页（思源连接 / AI 服务 / 模板）
// P0 只做配置：不采集页面、不执行模板、不落库。

const $ = (id) => document.getElementById(id);
const TABS = ["siyuan", "services", "templates"];
const state = { services: [], templates: [] };
const editing = { serviceId: null, templateId: null };

const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
};

const btn = (text, fn, cls) => {
    const b = el("button", cls, text);
    b.addEventListener("click", fn);
    return b;
};

function msg(id, text, tone = "") {
    const box = $(id);
    if (!box) return;
    box.textContent = text;
    box.className = "msg" + (tone === "ok" ? " ok" : tone === "err" ? " err" : "");
}

const persist = () => chrome.storage.local.set({ aiServices: state.services, aiTemplates: state.templates });

/* ================= 标签页 ================= */

function activate(name) {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll("section[data-panel]").forEach((s) => { s.hidden = s.dataset.panel !== name; });
}

function syncTab() {
    const name = location.hash.replace("#", "");
    activate(TABS.indexOf(name) >= 0 ? name : "siyuan");
}

document.querySelectorAll(".tabs button").forEach((b) => {
    b.addEventListener("click", () => {
        location.hash = b.dataset.tab;
        activate(b.dataset.tab);
    });
});
addEventListener("hashchange", syncTab);

/* ================= 思源连接 ================= */

function fillNotebooks(list, selectId) {
    const sel = $("notebook");
    sel.textContent = "";
    if (!list.length) {
        const o = el("option", null, "没有打开的笔记本");
        o.value = "";
        sel.appendChild(o);
        return;
    }
    list.forEach((n) => {
        const o = el("option", null, n.name);
        o.value = n.id;
        sel.appendChild(o);
    });
    if (selectId) sel.value = selectId;
}

async function loadNotebooks(selectId = "") {
    const server = $("server").value.trim().replace(/\/+$/, "");
    const token = $("token").value.trim();
    if (!server || !token) {
        msg("status-siyuan", "先填服务地址和 token", "err");
        return;
    }
    $("load").textContent = "加载中…";
    try {
        const res = await fetch(server + "/api/notebook/lsNotebooks", {
            method: "POST",
            headers: { Authorization: "Token " + token, "Content-Type": "application/json; charset=UTF-8" },
            body: "{}",
        });
        const json = await res.json();
        fillNotebooks((json.data?.notebooks || []).filter((n) => !n.closed), selectId);
        if (!selectId) msg("status-siyuan", "笔记本已加载，选一个后点保存", "ok");
    } catch (e) {
        msg("status-siyuan", "加载失败：" + e.message + "（检查地址与 token）", "err");
    } finally {
        $("load").textContent = "加载笔记本";
    }
}

$("load").addEventListener("click", () => loadNotebooks(""));

$("save-siyuan").addEventListener("click", async () => {
    const cfg = {
        server: $("server").value.trim(),
        token: $("token").value.trim(),
        notebookId: $("notebook").value,
        notebookName: $("notebook").selectedOptions[0]?.textContent || "",
    };
    if (!cfg.server || !cfg.token || !cfg.notebookId) {
        msg("status-siyuan", "地址、token、笔记本 三项都要填", "err");
        return;
    }
    await chrome.storage.sync.set(cfg);
    msg("status-siyuan", "设置已保存 ✓", "ok");
});

/* ================= AI 服务 ================= */

function renderServices() {
    const box = $("service-list");
    box.textContent = "";
    if (!state.services.length) {
        box.appendChild(el("div", "empty", "还没有 AI 服务，先新建一个"));
        return;
    }
    state.services.forEach((s) => {
        const item = el("div", "item");
        const main = el("div", "item-main");
        main.appendChild(el("b", null, s.name || "未命名服务"));
        main.appendChild(el("div", "item-sub", (s.baseUrl || "") + " · " + (s.model || "")));
        main.classList.add("clickable");
        main.addEventListener("click", () => openService(s.id));
        const acts = el("div", "item-actions");
        acts.appendChild(btn("编辑", () => openService(s.id), "tiny"));
        acts.appendChild(btn("删除", () => removeService(s.id), "tiny danger"));
        item.append(main, acts);
        box.appendChild(item);
    });
}

function openService(id) {
    const s = id ? state.services.find((x) => x.id === id) : null;
    editing.serviceId = s ? s.id : null;
    $("service-title").textContent = s ? "编辑 AI 服务" : "新建 AI 服务";
    $("svc-name").value = s ? s.name : "";
    $("svc-base").value = s ? s.baseUrl : "";
    $("svc-key").value = s ? s.apiKey : "";
    $("svc-model").value = s ? s.model : "";
    $("svc-temp").value = s ? s.temperature : 0.3;
    $("svc-max").value = s ? s.maxTokens : 1500;
    msg("status-service", "");
    $("service-editor").hidden = false;
    $("service-editor").scrollIntoView({ block: "nearest", behavior: "smooth" });
    $("svc-name").focus();
}

function closeService() {
    editing.serviceId = null;
    $("service-editor").hidden = true;
    msg("status-service", "");
}

const gatherService = () => ({
    name: $("svc-name").value.trim(),
    baseUrl: $("svc-base").value.trim(),
    apiKey: $("svc-key").value.trim(),
    model: $("svc-model").value.trim(),
    temperature: Number($("svc-temp").value || 0.3),
    maxTokens: Number($("svc-max").value || 1500),
});

$("service-new").addEventListener("click", () => openService(null));
$("svc-cancel").addEventListener("click", closeService);

$("svc-save").addEventListener("click", async () => {
    const s = gatherService();
    if (!s.name || !s.baseUrl || !s.apiKey || !s.model) {
        msg("status-service", "名称、Base URL、API Key、模型 都要填", "err");
        return;
    }
    if (editing.serviceId) {
        const target = state.services.find((x) => x.id === editing.serviceId);
        if (target) Object.assign(target, s);
    } else {
        state.services.push({ id: uid("svc_"), ...s });
    }
    await persist();
    renderServices();
    closeService();
});

async function removeService(id) {
    const target = state.services.find((x) => x.id === id);
    if (!target) return;
    const refs = state.templates.filter((t) => t.serviceId === id).map((t) => t.name || "未命名模板");
    if (refs.length) {
        msg("status-services", "该服务正被模板引用：" + refs.join("、") + "，请先改这些模板", "err");
        return;
    }
    if (!confirm("删除服务「" + (target.name || "未命名服务") + "」？")) return;
    state.services = state.services.filter((x) => x.id !== id);
    await persist();
    if (editing.serviceId === id) closeService();
    renderServices();
}

$("svc-test").addEventListener("click", () => {
    const s = gatherService();
    if (!s.baseUrl || !s.apiKey || !s.model) {
        msg("status-service", "Base URL、API Key、模型 都要填", "err");
        return;
    }
    $("svc-test").disabled = true;
    msg("status-service", "连接中…");
    chrome.runtime.sendMessage({ func: "test-ai", ai: { ...s, systemPrompt: "" } }, (res) => {
        $("svc-test").disabled = false;
        if (chrome.runtime.lastError) {
            msg("status-service", "发送失败：" + chrome.runtime.lastError.message, "err");
            return;
        }
        if (!res || !res.ok) {
            msg("status-service", "连接失败：" + (res?.msg || "未知错误"), "err");
            return;
        }
        msg("status-service", "连接正常（" + res.ms + " ms）：" + res.content.slice(0, 40), "ok");
    });
});

/* ================= 模板 ================= */

function renderTemplates() {
    const box = $("tpl-list");
    box.textContent = "";
    if (!state.templates.length) {
        box.appendChild(el("div", "empty", "还没有模板。未命中的页面会直接保存原文"));
        return;
    }
    state.templates.forEach((tpl, index) => {
        const item = el("div", "item");
        const main = el("div", "item-main");

        const head = el("div");
        head.appendChild(el("b", null, tpl.name || "未命名模板"));
        head.appendChild(el("span", "badge" + (tpl.mode === "script" ? " script" : ""), MODE_LABEL[tpl.mode] || tpl.mode));
        if (!tpl.enabled) head.appendChild(el("span", "badge off", "已停用"));
        main.appendChild(head);

        const hosts = (tpl.hosts || []).join(" · ") || "未设置 host";
        const svc = (state.services.find((x) => x.id === tpl.serviceId) || {}).name;
        const tail = tpl.mode === "script" ? "本地脚本" : (svc || "未选择服务");
        main.appendChild(el("div", "item-sub", hosts + " · " + tail));
        main.classList.add("clickable");
        main.addEventListener("click", () => openTemplate(tpl.id));

        const conflicts = findHostConflicts(state.templates, tpl.id, tpl.hosts || []);
        if (conflicts.length) {
            main.appendChild(el("div", "warn", "host 与「" + conflicts.map((c) => c.name || "未命名模板").join("、") + "」重复，按靠前者生效"));
        }

        const acts = el("div", "item-actions");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!tpl.enabled;
        cb.title = "启用";
        cb.addEventListener("change", async () => {
            tpl.enabled = cb.checked;
            await persist();
            renderTemplates();
        });
        acts.appendChild(cb);
        acts.appendChild(btn("编辑", () => openTemplate(tpl.id), "tiny"));
        acts.appendChild(btn("↑", () => moveTemplate(index, -1), "tiny"));
        acts.appendChild(btn("↓", () => moveTemplate(index, 1), "tiny"));
        acts.appendChild(btn("删除", () => removeTemplate(tpl.id), "tiny danger"));
        item.append(main, acts);
        box.appendChild(item);
    });
}

async function moveTemplate(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= state.templates.length) return;
    const arr = state.templates;
    const tmp = arr[index];
    arr[index] = arr[to];
    arr[to] = tmp;
    await persist();
    renderTemplates();
}

async function removeTemplate(id) {
    const target = state.templates.find((x) => x.id === id);
    if (!target) return;
    if (!confirm("删除模板「" + (target.name || "未命名模板") + "」？")) return;
    state.templates = state.templates.filter((x) => x.id !== id);
    await persist();
    if (editing.templateId === id) closeTemplate();
    renderTemplates();
}

function fillServiceSelect(selectedId) {
    const sel = $("tpl-service");
    sel.textContent = "";
    if (!state.services.length) {
        const o = el("option", null, "— 先到「AI 服务」新建 —");
        o.value = "";
        sel.appendChild(o);
        return;
    }
    state.services.forEach((s) => {
        const o = el("option", null, s.name || "未命名服务");
        o.value = s.id;
        sel.appendChild(o);
    });
    sel.value = selectedId || state.services[0].id;
}

function currentMode() {
    const picked = document.querySelector('input[name="tpl-mode"]:checked');
    return picked ? picked.value : "agent";
}

function applyMode(mode) {
    document.querySelectorAll('input[name="tpl-mode"]').forEach((r) => { r.checked = r.value === mode; });
    $("agent-fields").hidden = mode !== "agent";
    $("script-fields").hidden = mode !== "script";
}

function updateConflictWarning(id) {
    const hosts = parseHosts($("tpl-hosts").value);
    const conflicts = findHostConflicts(state.templates, id, hosts);
    const box = $("tpl-conflict");
    if (conflicts.length) {
        box.textContent = "host 与「" + conflicts.map((c) => c.name || "未命名模板").join("、") + "」重复，保存后按列表靠前者生效";
        box.hidden = false;
    } else {
        box.hidden = true;
    }
}

function openTemplate(id) {
    const tpl = id ? state.templates.find((x) => x.id === id) : null;
    editing.templateId = tpl ? tpl.id : null;
    $("tpl-title").textContent = tpl ? "编辑模板" : "新建模板";
    $("tpl-name").value = tpl ? tpl.name : "";
    $("tpl-hosts").value = tpl ? (tpl.hosts || []).join("\n") : "";
    applyMode(tpl ? tpl.mode : "agent");
    fillServiceSelect(tpl ? tpl.serviceId : "");
    $("tpl-prompt").value = tpl ? tpl.prompt : DEFAULT_PROMPT;
    $("tpl-system").value = tpl ? tpl.systemPrompt : "";
    $("tpl-script").value = tpl ? tpl.script : DEFAULT_SCRIPT;
    $("tpl-enabled").checked = tpl ? tpl.enabled !== false : true;
    msg("status-tpl", "");
    updateConflictWarning(editing.templateId);
    $("tpl-editor").hidden = false;
    $("tpl-editor").scrollIntoView({ block: "nearest", behavior: "smooth" });
    $("tpl-name").focus();
}

function closeTemplate() {
    editing.templateId = null;
    $("tpl-editor").hidden = true;
    msg("status-tpl", "");
}

$("tpl-new").addEventListener("click", () => openTemplate(null));
$("tpl-cancel").addEventListener("click", closeTemplate);
$("tpl-hosts").addEventListener("input", () => updateConflictWarning(editing.templateId));
document.querySelectorAll('input[name="tpl-mode"]').forEach((r) => {
    r.addEventListener("change", () => applyMode(r.value));
});
$("tpl-reset").addEventListener("click", () => { $("tpl-prompt").value = DEFAULT_PROMPT; });

$("tpl-save").addEventListener("click", async () => {
    const name = $("tpl-name").value.trim();
    const hosts = parseHosts($("tpl-hosts").value);
    const mode = currentMode();

    if (!name) return msg("status-tpl", "名称不能为空", "err");
    if (!hosts.length) return msg("status-tpl", "至少填一条匹配 host（否则该模板永远不会生效）", "err");
    if (hosts.indexOf("*") >= 0) return msg("status-tpl", "不支持通配兜底：未命中模板时本来就直存原文", "err");

    if (mode === "agent") {
        if (!$("tpl-service").value) return msg("status-tpl", "先选择 AI 服务", "err");
        if (!$("tpl-prompt").value.trim()) return msg("status-tpl", "提示词不能为空", "err");
    } else if (!$("tpl-script").value.trim()) {
        return msg("status-tpl", "脚本不能为空", "err");
    }

    const next = {
        name,
        hosts,
        mode,
        enabled: $("tpl-enabled").checked,
        serviceId: mode === "agent" ? $("tpl-service").value : "",
        systemPrompt: mode === "agent" ? $("tpl-system").value.trim() : "",
        prompt: mode === "agent" ? $("tpl-prompt").value : "",
        script: mode === "script" ? $("tpl-script").value : "",
    };

    if (editing.templateId) {
        const target = state.templates.find((x) => x.id === editing.templateId);
        if (target) Object.assign(target, next);
    } else {
        state.templates.push({ id: uid("tpl_"), ...next });
    }

    await persist();
    renderTemplates();
    closeTemplate();
});

/* ================= 初始化 ================= */

(async () => {
    const stored = await chrome.storage.local.get({ aiServices: [], aiTemplates: [] });
    state.services = stored.aiServices || [];
    state.templates = stored.aiTemplates || [];

    chrome.storage.sync.get({ server: "", token: "", notebookId: "", notebookName: "" }, (cfg) => {
        $("server").value = cfg.server;
        $("token").value = cfg.token;
        if (cfg.server && cfg.token) loadNotebooks(cfg.notebookId);
    });

    renderServices();
    renderTemplates();
    syncTab();

    // popup 点某个模板 → options.html?tpl=<id>#templates
    const want = new URLSearchParams(location.search).get("tpl");
    if (want) {
        const tpl = state.templates.find((x) => x.id === want);
        if (tpl) {
            location.hash = "#templates";
            activate("templates");
            openTemplate(tpl.id);
        }
    }
})();
