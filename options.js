// 思源划词收藏 · 设置页 / 弹窗
// 页面运行在扩展上下文：fetch 带 host_permissions 直连内核，免 CORS。

const $ = (id) => document.getElementById(id);

function status(msg, color = "#888") {
    const el = $("status");
    el.textContent = msg;
    el.style.color = color;
    if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 3200);
}

function fillNotebooks(list, selectId) {
    const sel = $("notebook");
    sel.innerHTML = "";
    if (!list.length) {
        const o = document.createElement("option");
        o.value = "";
        o.textContent = "没有打开的笔记本";
        sel.appendChild(o);
        return;
    }
    list.forEach((n) => {
        const o = document.createElement("option");
        o.value = n.id;
        o.textContent = n.name;
        sel.appendChild(o);
    });
    if (selectId) sel.value = selectId;
}

async function loadNotebooks(selectId = "") {
    const server = $("server").value.trim().replace(/\/+$/, "");
    const token = $("token").value.trim();
    if (!server || !token) {
        status("先填服务地址和 token", "#d9483b");
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
        if (!selectId) status("笔记本已加载，选一个后点保存", "#22a05c");
    } catch (e) {
        status("加载失败：" + e.message + "（检查地址与 token）", "#d9483b");
    } finally {
        $("load").textContent = "加载笔记本";
    }
}

$("load").addEventListener("click", () => loadNotebooks(""));

$("save").addEventListener("click", async () => {
    const sel = $("notebook");
    await chrome.storage.sync.set({
        server: $("server").value.trim(),
        token: $("token").value.trim(),
        notebookId: sel.value,
        notebookName: sel.selectedOptions[0]?.textContent || "",
    });
    status("设置已保存 ✓", "#22a05c");
});

// 弹窗里的整页发送按钮（options.html 同时作为 action 弹窗与选项页）
$("send-article").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
        await chrome.tabs.sendMessage(tab.id, { func: "collect", type: "article" });
        window.close(); // 关掉弹窗，让页面上的 toast 可见
    } catch {
        status("当前页面不支持（浏览器内置页面无法注入）", "#d9483b");
    }
});

// 初始化：读配置（不预填任何默认值）；已配好则顺手刷新笔记本列表
chrome.storage.sync.get(
    { server: "", token: "", notebookId: "", notebookName: "" },
    (cfg) => {
        $("server").value = cfg.server;
        $("token").value = cfg.token;
        if (cfg.server && cfg.token) loadNotebooks(cfg.notebookId);
    },
);
