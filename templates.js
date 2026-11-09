// 模板共享层：host 归一化 / 匹配 / 选取，options 与 popup 共用。

// 从页面 URL 取 host；非 http(s) 返回空串（不参与匹配）
function hostOfUrl(url) {
    try {
        const u = new URL(String(url || ""));
        if (u.protocol !== "http:" && u.protocol !== "https:") return "";
        return u.hostname.toLowerCase().replace(/\.$/, "");
    } catch {
        return "";
    }
}

// 把用户输入的一条规则归一成 host
// 支持粘整条 URL（取 hostname）、去端口、去尾部点、去路径
function normalizeHostRule(raw) {
    let s = String(raw || "").trim().toLowerCase();
    if (!s) return "";
    if (s.indexOf("://") >= 0) {
        try { s = new URL(s).hostname; } catch { /* 保持原样 */ }
    }
    s = s.replace(/\/.*$/, "");   // 去掉误粘的路径
    s = s.replace(/:\d+$/, "");   // 去端口
    s = s.replace(/^\.+|\.+$/g, "");
    return s;
}

// 多行文本框 → 规则数组（去空、去重、保序）
function parseHosts(text) {
    const out = [];
    String(text || "").split(/[\s,，]+/).forEach((part) => {
        const rule = normalizeHostRule(part);
        if (rule && out.indexOf(rule) < 0) out.push(rule);
    });
    return out;
}

// example.com        → 自身及所有子域
// *.example.com      → 仅子域
function hostMatches(rule, host) {
    if (!rule || !host) return false;
    if (rule === "*") return false; // 不支持兜底模板：未命中即直存原文
    if (rule.indexOf("*.") === 0) {
        const suffix = rule.slice(2);
        return !!suffix && host.length > suffix.length && host.endsWith("." + suffix);
    }
    return host === rule || host.endsWith("." + rule);
}

// 数组顺序即优先级，取第一个启用且命中的模板
function matchTemplate(templates, host) {
    if (!host) return null;
    for (const tpl of templates || []) {
        if (!tpl || !tpl.enabled) continue;
        for (const rule of tpl.hosts || []) {
            if (hostMatches(rule, host)) return tpl;
        }
    }
    return null;
}

// 跨模板重复的 host（保存时给警告，不阻止）
function findHostConflicts(templates, id, hosts) {
    const hits = [];
    (templates || []).forEach((tpl) => {
        if (!tpl || tpl.id === id) return;
        const shared = hosts.filter((r) => (tpl.hosts || []).indexOf(r) >= 0);
        if (shared.length) hits.push({ name: tpl.name, hosts: shared });
    });
    return hits;
}

function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const DEFAULT_SCRIPT = [
    "// ctx = { html, md, title, url, host }",
    "// 返回 Markdown 字符串，或 { title?, markdown, tags? }",
    "// 脚本在 sandbox 页本地执行，不得联网。",
    "function clip(ctx) {",
    "  return ctx.md;",
    "}",
].join("\n");

const MODE_LABEL = { agent: "智能体", script: "脚本" };
