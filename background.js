// 思源划词收藏 · background service worker
// 所有内核请求都在这层发：host_permissions 免 CORS，且避开页面上下文的 LNA 内网限制。

importScripts("ai.js");

const CFG_DEFAULTS = { server: "", token: "", notebookId: "", notebookName: "" };

const getCfg = () => new Promise((resolve) => chrome.storage.sync.get(CFG_DEFAULTS, resolve));
const normalizeServer = (s) => (s || "").trim().replace(/\/+$/, "");
const sanitizeTitle = (t) => String(t || "未命名").replace(/[\\/]/g, "／").trim() || "未命名";

function nowStamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function apiJSON(cfg, path, body) {
    const res = await fetch(normalizeServer(cfg.server) + path, {
        method: "POST",
        headers: { Authorization: "Token " + cfg.token, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify(body || {}),
    });
    if (res.status === 401 || res.status === 403) throw new Error("API token 无效");
    if (res.status !== 200) throw new Error("HTTP " + res.status);
    return res.json();
}

// 借内核 lute 做 HTML → Markdown（官方剪藏扩展同一转换器），assets=true 时内核负责下载网络图片
async function kernelCopy(cfg, data) {
    const fd = new FormData();
    fd.append("dom", data.html);
    fd.append("notebook", cfg.notebookId);
    fd.append("href", data.href);
    fd.append("tags", "");
    fd.append("clipType", data.type);
    fd.append("assets", "true");
    // 不能手动设 Content-Type，浏览器要带 multipart boundary
    const res = await fetch(normalizeServer(cfg.server) + "/api/extension/copy", {
        method: "POST",
        headers: { Authorization: "Token " + cfg.token },
        body: fd,
    });
    if (res.status !== 200) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (json.code < 0) throw new Error(json.msg || "内核转换失败");
    return json.data; // { md, withMath }
}

// 主流程：转换 → 建档 → （后台）图片转存。返回给 content 层做 toast。
async function handleClip(data) {
    const cfg = await getCfg();
    if (!cfg.server || !cfg.token || !cfg.notebookId) {
        return { ok: false, msg: "请先点击扩展图标完成设置（地址 / token / 笔记本）" };
    }

    let md = "";
    try {
        const converted = await kernelCopy(cfg, data);
        md = converted && typeof converted.md === "string" ? converted.md : "";
    } catch (e) {
        return { ok: false, msg: "内核不可达：" + e.message };
    }
    if (!md.trim()) return { ok: false, msg: "转换后的内容为空" };

    const title = sanitizeTitle(data.title);
    const source = data.type === "article"
        ? `## 来源\n\n- [${data.title}](${data.href})\n- 收藏于 ${nowStamp()}\n\n---\n\n`
        : `> 摘自 [${data.title}](${data.href}) · ${nowStamp()}\n\n`;

    let docId = "";
    try {
        const res = await apiJSON(cfg, "/api/filetree/createDocWithMd", {
            notebook: cfg.notebookId,
            path: "/" + title,
            markdown: source + md,
        });
        if (res.code !== 0) return { ok: false, msg: res.msg || "创建文档失败" };
        docId = typeof res.data === "string" ? res.data : "";
    } catch (e) {
        return { ok: false, msg: e.message };
    }

    // 图片转存 assets：后台执行，失败不影响主流程
    if (docId) {
        fetch(normalizeServer(cfg.server) + "/api/format/netImg2LocalAssets", {
            method: "POST",
            headers: { Authorization: "Token " + cfg.token, "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify({ id: docId, url: data.href }),
        }).catch(() => { });
    }

    return { ok: true, msg: `已保存到思源：${cfg.notebookName || "笔记本"} / ${title}` };
}

/* ================= 消息路由 ================= */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.func === "open-settings") {
        chrome.runtime.openOptionsPage(() => {
            if (chrome.runtime.lastError) chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
        });
        return;
    }
    if (msg?.func === "upload-clip" && sender.tab?.id != null) {
        handleClip(msg.data).then((result) => {
            chrome.tabs.sendMessage(sender.tab.id, { func: "tip", ok: result.ok, msg: result.msg });
        });
        return;
    }
    // 设置页的「测试连接」：只验地址 / Key / 模型，不涉及模板
    if (msg?.func === "test-ai") {
        const started = Date.now();
        chatCompletion(msg.ai || {}, "只回复两个字：正常", { maxTokens: 16, timeout: 30000 })
            .then((out) => sendResponse({ ok: true, content: out.content, ms: Date.now() - started }))
            .catch((e) => sendResponse({ ok: false, msg: e.message }));
        return true;
    }
});

/* ================= 右键菜单 ================= */

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: "send-selection", title: "发送选中内容到思源", contexts: ["selection"] });
        chrome.contextMenus.create({ id: "send-article", title: "发送整页到思源", contexts: ["page"] });
    });
});

function triggerCollect(tab, type) {
    if (!tab?.id) return;
    // Receiving end does not exist（浏览器内置页等）时静默
    chrome.tabs.sendMessage(tab.id, { func: "collect", type }).catch(() => { });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    triggerCollect(tab, info.menuItemId === "send-selection" ? "part" : "article");
});

/* ================= 快捷键 ================= */

chrome.commands.onCommand.addListener((command, tab) => {
    const type = command === "send-selection" ? "part" : "article";
    if (tab?.id) {
        triggerCollect(tab, type);
        return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => triggerCollect(tabs[0], type));
});
