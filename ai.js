// AI 接入层：目前只支持 OpenAI 兼容的 /chat/completions
// 供 background（importScripts）和设置页（<script>）共用，无依赖。

const DEFAULT_PROMPT = `你是一个中文知识管理助手。请把下面这篇网页内容整理成个人笔记：

1. 先用 3 句话概括核心内容；
2. 再按逻辑分点列出关键信息（保留数字、结论、方法）；
3. 最后附一行「关键词」。

只输出 Markdown 正文，不要任何解释、不要重复原文全文。

<article>
{{content}}
</article>`;

// 单趟替换：正文里即使出现 {{title}} 之类也不会被二次展开
function renderPrompt(tpl, vars) {
    return String(tpl || "").replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

// 允许直接粘完整地址，也允许只填 baseUrl
function endpointOf(baseUrl) {
    const b = String(baseUrl || "").trim().replace(/\/+$/, "");
    return /\/chat\/completions$/i.test(b) ? b : b + "/chat/completions";
}

function httpHint(status) {
    if (status === 401 || status === 403) return "API key 无效或无权限";
    if (status === 404) return "接口地址不对，检查 baseUrl 是否包含 /v1";
    if (status === 429) return "限流或额度用尽";
    if (status >= 500) return `服务端错误 HTTP ${status}`;
    return `HTTP ${status}`;
}

async function chatCompletion(ai, userPrompt, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 60000);
    const messages = [];
    if (String(ai.systemPrompt || "").trim()) messages.push({ role: "system", content: String(ai.systemPrompt).trim() });
    messages.push({ role: "user", content: userPrompt });

    try {
        const res = await fetch(endpointOf(ai.baseUrl), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + String(ai.apiKey || "").trim(),
            },
            body: JSON.stringify({
                model: String(ai.model || "").trim(),
                messages,
                temperature: Number(ai.temperature ?? 0.3),
                max_tokens: Number(opts.maxTokens ?? ai.maxTokens ?? 1500),
                stream: false,
            }),
            signal: ctrl.signal,
        });

        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* 可能不是 JSON */ }

        if (!res.ok) {
            const detail = json?.error?.message || json?.message || text.slice(0, 200) || "";
            throw new Error(httpHint(res.status) + (detail ? `：${detail}` : ""));
        }
        const content = json?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) throw new Error("模型没有返回内容");
        return { content: content.trim(), usage: json.usage || null };
    } catch (e) {
        if (e.name === "AbortError") throw new Error(`请求超时（${Math.round((opts.timeout || 60000) / 1000)}s）`);
        throw e;
    } finally {
        clearTimeout(timer);
    }
}
