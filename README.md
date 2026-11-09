# chrome-ext-siyuan · 思源划词收藏（Chrome 扩展）

> 划词 / 整页一键保存到思源笔记：**直接在内核建文档**，不经过剪贴板，图片自动转存 assets，全程 toast 反馈。

## 1. 背景与动机

官方剪藏扩展（siyuan-chrome 1.15.x）的能力边界是写死的：

| 官方扩展 | 行为 | 痛点 |
|---|---|---|
| Copy to SiYuan（划词） | 只转 Markdown 进**系统剪贴板**，需手动去思源粘贴 | 多一步 |
| Send to SiYuan（整页） | Readability 提取正文后直接建文档 | 只支持整页，**没有"选中内容直接建文档"** |
| 右键菜单 | Send 只在页面空白处出现（contexts: page），选中文字时隐藏 | 入口不直觉 |

本插件补上缺口：**划词 → 直接落库**；同时整页剪藏、右键菜单、快捷键、toast 一并做齐。

## 2. 功能清单

### 2.1 摘录（选中内容）

- 划词后出现「💠 发送到思源」浮按钮，点击即在所选笔记本下新建文档
- 文档标题：`页面标题 · 摘录`；开头自动附来源链接 + 摘录时间
- 触发入口：**浮按钮** / 页面右键菜单"发送选中内容到思源" / 快捷键 `Alt+S`

### 2.2 整页剪藏

- 启发式正文提取（克隆 DOM → 清杂 → 选 p 文本量最大的容器，article/main/#content 优先）
- 文档标题：`页面标题`；开头附"来源"小节（标题链接 + 收藏时间）
- 触发入口：**扩展弹窗大按钮"发送整页到思源"** / 页面右键（空白处）菜单 / 快捷键 `Alt+Y`

### 2.3 通用

- **HTML → Markdown 由内核完成**：借 `/api/extension/copy`（官方扩展同一 lute 转换器），表格/代码块/粗体/链接转换质量与官方一致（已 curl 实测）
- **图片转存**：建档后后台调用 `/api/format/netImg2LocalAssets`，把文档内网络图片拉到思源 assets（不阻塞主流程，失败静默）
- **toast 反馈**：进行中（蓝）/ 成功（绿，含落库路径）/ 失败（红，含原因），3.2s 自动消失
- **配置**：服务地址、API token、笔记本（**从内核拉列表下拉选择**，不手填 ID），存 `chrome.storage.sync`（跨设备同步）
- **配置守卫**：未配置服务地址 / token / 笔记本时，任何剪藏入口都会弹出引导框，一键"去设置"

### 2.4 AI 模板（P0：配置）

> 当前阶段只做**配置**：模板可以建、可以调，但剪藏仍走原文直存。执行在 P1（调试页试跑）、P2（全链路落库）。

- **AI 服务**：可建多个，每个是 Base URL + API Key + 模型（仅 OpenAI 兼容的 `/chat/completions`，DeepSeek / Ollama / one-api / vLLM 等同构）；带「测试连接」，401 / 404 / 429 分别给提示
- **模板**：可建多个，每个绑定一组 **host 规则** 和一种接入方式
  - host 写 `zhihu.com` 匹配该域及所有子域，写 `*.medium.com` 仅匹配子域；**没有兜底模板**，未命中任何模板就直存原文
  - **列表顺序即优先级**，第一条命中的生效（行内 ↑↓ 调整）
  - 接入方式一：**智能体** → 选 AI 服务 + 提示词（变量 `{{content}}` `{{title}}` `{{url}}` `{{date}}`，单趟替换）
  - 接入方式二：**脚本** → 本地 JS，P0 只保存不执行，接口为 `function clip(ctx)`，`ctx = { html, md, title, url, host }`
- **弹窗**：显示当前站点命中的模板（未命中显示"将直接保存原文"），点击直达该模板的编辑区
- 模板与脚本存 `chrome.storage.local`；API Key 不进 `sync`（8KB 单条上限，且不应同步到云端账号）

## 3. 架构

MV3（manifest v3），与官方剪藏扩展同款架构：**所有内核请求在 background service worker 发出**。

```
┌─ content.js（页面上下文，只做采集与 UI）─────────────┐
│  划词浮按钮 / toast / 选区采集 / 整页正文启发式提取      │
└──────────────┬────────────────────────────────┘
               │ chrome.runtime.sendMessage("upload-clip")
               ▼
┌─ background.js（service worker，特权上下文）──────────┐
│  内核 HTTP（host_permissions 免 CORS，避开页面层 LNA） │
│  extension/copy → createDocWithMd → netImg2Local     │
└──────────────┬────────────────────────────────┘
               │ chrome.tabs.sendMessage("tip")
               ▼
        content.js 弹 toast
```

**为什么请求必须放 background**：Chrome 对"页面上下文 → 内网 IP"的请求有 LNA（Local Network Access）限制——这正是官方扩展 1.15 把请求从 content script 挪进 background 的原因（其源码注释原话"避免 content script 访问 localhost 触发 LNA 权限弹窗"）。本插件从第一版就采用正确姿势。

## 4. 内核 API 依赖（对 SiYuan v3.8.9 全部 curl 实测通过）

| API | 用途 | 状态 |
|---|---|---|
| `POST /api/notebook/lsNotebooks` | 设置页拉笔记本列表 | ✅ 200 |
| `POST /api/extension/copy` | HTML → Markdown（multipart：`dom`/`notebook`/`href`/`clipType`/`assets`） | ✅ 200，表格/粗体/链接转换正常 |
| `POST /api/filetree/createDocWithMd` | 建文档（`notebook`/`path`/`markdown`），返回 docId | ✅ 200（已建/删验证） |
| `POST /api/format/netImg2LocalAssets` | 网络图片转存 assets | 官方扩展同款兜底，fire-and-forget |

注意：`extension/copy` 返回的 md 是**思源内部格式**（粗体/链接为 `<span data-type=...>`），`createDocWithMd` 可直接解析，与官方扩展建文档链路完全一致。

## 5. 文件结构

```
chrome-ext-siyuan/
├── README.md          本文档
├── manifest.json      MV3 清单（无 icons，显示默认拼图图标）
├── background.js      service worker：右键菜单、快捷键分发、内核请求、测试连接
├── ai.js              OpenAI 兼容调用层（提示词渲染 + /chat/completions），SW 与设置页共用
├── templates.js       host 归一化 / 匹配 / 模板选取，设置页与弹窗共用
├── ui.css             共享样式（清爽卡片风，跟随系统暗色）
├── content.js         划词浮按钮、toast、选区/正文采集（无任何网络请求）
├── popup.html         扩展弹窗：发送整页 + 当前站点模板
├── popup.js           弹窗逻辑
├── options.html       设置页：思源连接 / AI 服务 / 模板
└── options.js         设置读写、笔记本加载、服务与模板增删改
```

## 6. 安装与配置

1. `chrome://extensions` → 右上角开**开发者模式** → **加载已解压的扩展程序** → 选本目录
2. 点扩展图标 → 「思源连接」→ 填**服务地址**（本机内核默认 `http://127.0.0.1:6806`；Docker/服务器部署填对应地址）和 **API token**（思源 `设置 → 关于`）→ **加载笔记本** → 下拉选择 → **保存**
3. 需要 AI 摘要时，切到「AI 模板」填 Base URL / API Key / 模型 / 提示词 → **测试连接** → **保存**；再到「调试」页拿一个真实页面地址验证采集与输出
3. 首次安装 Chrome 会提示"读取和更改您在所有网站上的数据"——本插件需要匹配所有页面才能划词，属预期

> 背景请求经 `host_permissions` 直接免 CORS；页面上下文不发任何内核请求，规避 Chrome LNA 内网限制。

## 7. 使用速查

| 场景 | 入口 |
|---|---|
| 摘录选中内容 | 划词 → 浮按钮；或右键 →"发送选中内容到思源"；或 `Alt+S` |
| 剪藏整页 | 扩展弹窗大按钮；或页面空白处右键 →"发送整页到思源"；或 `Alt+Y` |
| 改快捷键 | `chrome://extensions/shortcuts` |
| 改配置 | 点扩展图标 →「思源连接」/「管理模板」 |
| 管模板 | 点扩展图标 →「管理模板」→「模板」标签 |

## 8. 与其他方案对比

| | 本插件 | 官方剪藏扩展 |
|---|---|---|
| 划词直接建文档 | ✅ | ❌（只进剪贴板） |
| 整页剪藏 | ✅ | ✅（Readability，质量略优） |
| 原生右键菜单 | ✅ | ✅ |
| 依赖 | 无 | 无 |
| 图片本地化 | ✅ 内核转存 | ✅（扩展端抓取+内核兜底） |
| 整页提取质量 | 启发式 | Readability（更优） |
| 可维护性 | 自持 | 官方 |

## 9. 已知边界

- 整页提取为**启发式**（~60 行），极端排版页面不如官方的 Readability.js；如需完全对齐可后续 `@require`/打包引入 Readability（个人用暂无必要）
- 无扩展图标（默认拼图），介意可后续补 16/48/128 PNG
- 浏览器内置页（chrome://、商店页）无法注入，入口会静默或提示
- iframe 内的选区不采集（content script 仅顶层 frame）
- 未做"追加到收集箱"模式（当前每次摘录新建文档）；官方 createDocWithMd 语义下重复标题会并存，靠文档内时间戳区分

