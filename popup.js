// 思源划词收藏 · 弹窗
// 发送整页 + 展示当前站点命中的模板（P0 只展示与跳转，不执行）。

const $ = (id) => document.getElementById(id);
const openOptions = (tail) => {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html" + (tail || "#templates")) });
    window.close();
};

const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
};

$("manage-tpl").addEventListener("click", () => openOptions("#templates"));
$("open-siyuan").addEventListener("click", () => openOptions("#siyuan"));

$("send-article").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
        await chrome.tabs.sendMessage(tab.id, { func: "collect", type: "article" });
        window.close(); // 关掉弹窗，让页面上的 toast 可见
    } catch {
        const s = $("status");
        s.textContent = "当前页面不支持（浏览器内置页面无法注入脚本）";
        s.classList.add("err");
    }
});

(async () => {
    chrome.storage.sync.get({ notebookName: "" }, (cfg) => {
        $("status").textContent = "笔记本：" + (cfg.notebookName || "未设置");
    });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const host = tab && tab.url ? hostOfUrl(tab.url) : "";
    const stored = await chrome.storage.local.get({ aiTemplates: [] });
    const templates = stored.aiTemplates || [];

    const box = $("tpl-box");
    box.textContent = "";

    if (!templates.length) {
        const card = el("button", "tpl-card");
        card.appendChild(el("b", null, "还没有模板"));
        card.appendChild(el("div", "tpl-sub", "未命中的页面会直接保存原文"));
        card.addEventListener("click", () => openOptions("#templates"));
        box.appendChild(card);
        return;
    }

    const hit = matchTemplate(templates, host);
    if (!hit) {
        const card = el("div", "tpl-card static");
        card.appendChild(el("b", null, "未命中模板"));
        card.appendChild(el("div", "tpl-sub", (host || "当前页面") + " 没有匹配规则，将直接保存原文"));
        box.appendChild(card);
        return;
    }

    const card = el("button", "tpl-card");
    const head = el("div");
    head.appendChild(el("b", null, hit.name || "未命名模板"));
    head.appendChild(el("span", "badge" + (hit.mode === "script" ? " script" : ""), MODE_LABEL[hit.mode] || hit.mode));
    card.appendChild(head);
    card.appendChild(el("div", "tpl-sub", "命中 " + host));
    card.addEventListener("click", () => openOptions("?tpl=" + encodeURIComponent(hit.id) + "#templates"));
    box.appendChild(card);
})();
