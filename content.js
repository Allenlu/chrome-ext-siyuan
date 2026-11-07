// 思源划词收藏 · content script
// 只做三件事：划词浮按钮、toast、内容采集；所有内核请求由 background 完成。

(function () {
    "use strict";

    const Z = 2147483647;

    /* ================= toast ================= */

    function toast(msg, type = "info") {
        document.getElementById("sy-clip-toast")?.remove();
        const t = document.createElement("div");
        t.id = "sy-clip-toast";
        t.textContent = msg;
        t.style.cssText = `position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:${Z};max-width:70vw;padding:9px 16px;border-radius:6px;color:#fff;font-size:13px;line-height:1.5;box-shadow:0 4px 12px rgba(0,0,0,.25);background:${type === "ok" ? "#22a05c" : type === "err" ? "#d9483b" : "#4285f4"};transition:opacity .2s;`;
        document.documentElement.appendChild(t);
        setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 250); }, 3200);
    }

    /* ================= 内容采集 ================= */

    function absolutize(root) {
        const base = document.baseURI;
        root.querySelectorAll("img").forEach((img) => {
            const raw = img.getAttribute("src") || img.getAttribute("data-src") || "";
            if (!raw) return;
            try { img.setAttribute("src", new URL(raw, base).href); } catch { /* 忽略非法 URL */ }
        });
        root.querySelectorAll("a").forEach((a) => {
            const raw = a.getAttribute("href") || "";
            if (!raw || /^(#|mailto:|javascript:)/i.test(raw)) return;
            try { a.setAttribute("href", new URL(raw, base).href); } catch { /* 忽略 */ }
        });
    }

    function selectionHTML() {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) return "";
        const box = document.createElement("div");
        box.appendChild(sel.getRangeAt(0).cloneContents());
        absolutize(box);
        return box.innerHTML;
    }

    // 整页：克隆 DOM → 清杂 → 选 p 文本量最大的容器（article/main/#content 等优先，启发式兜底）
    function articleHTML() {
        const doc = document.cloneNode(true);
        doc.querySelectorAll("script,style,noscript,link,meta,nav,aside,footer,header,form,iframe,svg,button,dialog").forEach((el) => el.remove());
        const score = (el) => Array.from(el.querySelectorAll("p")).reduce((n, p) => n + (p.textContent || "").trim().length, 0);
        let best = doc.body, bestScore = 0;
        doc.querySelectorAll("article, main, [role='main'], #content, .content, .article, .post, .post-content, .article-content, .markdown-body").forEach((el) => {
            const s = score(el);
            if (s > bestScore) { bestScore = s; best = el; }
        });
        if (bestScore === 0) {
            doc.querySelectorAll("div, section").forEach((el) => {
                if (el === doc.body) return;
                const s = score(el);
                if (s > bestScore) { bestScore = s; best = el; }
            });
        }
        absolutize(best);
        return best.innerHTML;
    }

    function sendClip(type, html) {
        toast("⏳ 正在保存到思源…", "info");
        chrome.runtime.sendMessage({
            func: "upload-clip",
            data: { html, type, title: document.title, href: location.href },
        });
    }

    /* ================= 配置守卫：未配置时弹窗引导设置 ================= */

    const getSyncCfg = (keys) => new Promise((resolve) => chrome.storage.sync.get(keys, resolve));

    async function ensureConfig() {
        const cfg = await getSyncCfg(["server", "token", "notebookId"]);
        if (cfg.server && cfg.token && cfg.notebookId) return true;
        showConfigModal();
        return false;
    }

    function showConfigModal() {
        document.getElementById("sy-clip-modal")?.remove();
        const wrap = document.createElement("div");
        wrap.id = "sy-clip-modal";
        wrap.style.cssText = `position:fixed;inset:0;z-index:${Z};background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;`;
        const card = document.createElement("div");
        card.style.cssText = "width:320px;max-width:90vw;background:#fff;border-radius:10px;padding:18px 20px;font-size:13px;color:#333;box-shadow:0 12px 40px rgba(0,0,0,.35);";
        const close = () => {
            wrap.remove();
            document.removeEventListener("keydown", esc);
        };
        const esc = (e) => { if (e.key === "Escape") close(); };
        card.innerHTML = `<div style="font-size:15px;font-weight:600;margin-bottom:8px;">尚未完成设置</div>
            <div style="margin-bottom:14px;">还没有配置<b>服务地址</b>、<b>API token</b> 或选择<b>笔记本</b>，无法保存到思源。</div>`;
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
        const cancel = document.createElement("button");
        cancel.textContent = "取消";
        cancel.style.cssText = "padding:7px 14px;border:1px solid #ccc;border-radius:6px;background:#f5f5f5;cursor:pointer;";
        cancel.addEventListener("click", close);
        const go = document.createElement("button");
        go.textContent = "去设置";
        go.style.cssText = "padding:7px 14px;border:0;border-radius:6px;background:#4285f4;color:#fff;cursor:pointer;";
        go.addEventListener("click", () => {
            close();
            chrome.runtime.sendMessage({ func: "open-settings" });
        });
        row.append(cancel, go);
        card.appendChild(row);
        wrap.appendChild(card);
        document.documentElement.appendChild(wrap);
        wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
        document.addEventListener("keydown", esc);
    }

    /* ================= 右键菜单 / 快捷键 / 弹窗按钮触发的采集 ================= */

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.func === "tip") {
            toast(msg.msg, msg.ok ? "ok" : "err");
            return;
        }
        if (msg?.func === "collect") {
            void (async () => {
                if (!(await ensureConfig())) return;
                const html = msg.type === "article" ? articleHTML() : selectionHTML();
                if (!html) {
                    toast(msg.type === "article" ? "本页没有可提取的正文" : "没有选中的内容", "err");
                    return;
                }
                sendClip(msg.type, html);
            })();
        }
    });

    /* ================= 划词浮按钮 ================= */

    const btn = document.createElement("div");
    btn.id = "sy-clip-btn";
    btn.textContent = "💠 发送到思源";
    btn.style.cssText = `position:fixed;z-index:${Z};display:none;padding:7px 14px;border-radius:16px;background:rgba(35,38,44,.94);color:#fff;font-size:13px;cursor:pointer;user-select:none;box-shadow:0 6px 18px rgba(0,0,0,.3);`;
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        hideBtn();
        if (!(await ensureConfig())) return;
        const html = selectionHTML();
        if (!html) { toast("没有选中的内容", "err"); return; }
        sendClip("part", html);
    });
    document.documentElement.appendChild(btn);

    function hideBtn() { btn.style.display = "none"; }

    document.addEventListener("mouseup", (e) => {
        if (btn.contains(e.target)) return;
        setTimeout(() => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed || !sel.toString().trim()) { hideBtn(); return; }
            const active = document.activeElement;
            if (active && (["INPUT", "TEXTAREA"].includes(active.tagName) || active.isContentEditable)) { hideBtn(); return; }
            let rect;
            try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch { hideBtn(); return; }
            if (!rect || (rect.width === 0 && rect.height === 0)) { hideBtn(); return; }
            btn.style.left = Math.min(rect.right + 10, innerWidth - 132) + "px";
            btn.style.top = Math.max(10, rect.top - 42) + "px";
            btn.style.display = "block";
        }, 10);
    });
    document.addEventListener("mousedown", (e) => { if (!btn.contains(e.target)) hideBtn(); });
    addEventListener("scroll", hideBtn, true);
})();
