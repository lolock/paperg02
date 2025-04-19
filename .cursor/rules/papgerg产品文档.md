# 论文写作助手 "paperg" 文档

## 产品需求文档 (PRD)

### 1. 项目目标

开发一个基于 Web 的 AI 论文写作助手 "paperg"。用户可以通过唯一的 10 位数字登录码进行访问，与 AI 进行对话，获取论文写作方面的帮助（如生成大纲、草拟内容等），并能随时重置对话、开启新的写作任务。

### 2. 核心功能

*   **用户认证:**
    *   使用唯一的 10 位数字登录码作为身份标识。
    *   后端验证登录码格式。
*   **AI 对话交互:**
    *   用户在聊天界面输入文本消息。
    *   前端将消息连同登录码发送至后端 `/api/chat` 接口。
    *   后端结合系统提示词（来自环境变量/Secrets）和历史对话，调用配置的大语言模型 (LLM) API。
    *   后端将 LLM 的回复返回给前端。
    *   前端在聊天界面展示 AI 的回复。
*   **对话历史管理:**
    *   后端使用 Cloudflare KV 存储每个登录码对应的对话历史（用户消息和 AI 回复）。
    *   对话历史在每次 `/api/chat` 调用时加载和更新。
*   **Markdown 渲染:**
    *   AI 的回复预期为 Markdown 格式。
    *   前端使用 Marked.js 将 Markdown 解析为 HTML。
    *   前端使用 DOMPurify 对渲染后的 HTML 进行清理，防止 XSS 攻击。
*   **新建/重置对话:**
    *   用户可通过“新建对话”按钮触发。
    *   前端调用后端 `/api/reset` 接口，传递当前登录码。
    *   后端清空该登录码在 KV 中存储的对话历史。
    *   前端清空聊天窗口，允许用户开始新的对话。

### 3. 用户界面 (UI)

*   **布局:** 采用左右两栏布局。
    *   **左侧边栏:** “新建对话”按钮、(未来可能的)历史对话列表区域、登录码输入框、登录按钮、登录状态显示。
    *   **右侧主区域:** 聊天消息显示窗口、底部消息输入框和发送按钮。
*   **样式:** 使用 Tailwind CSS（通过 CDN 加载）提供基础样式。
*   **交互:**
    *   初始状态下，聊天输入框和发送按钮禁用。
    *   登录成功后启用聊天输入和发送按钮。
    *   用户输入或粘贴文字到输入框时，发送按钮根据内容是否为空自动启用/禁用。
    *   发送消息后，前端立即显示用户消息，并显示 AI “正在输入”的提示。
    *   收到 AI 回复后，更新“正在输入”提示为实际回复内容。
    *   支持按 Enter 发送消息，Shift+Enter 换行。
    *   登录成功后，登录输入框和按钮禁用。

### 4. 非功能性需求

*   **安全性:**
    *   LLM API 密钥及可能的 `PAPER_SYSTEM_PROMPT` 应配置为 Cloudflare Secrets，不暴露于代码或前端。
    *   通过登录码隔离不同用户的会话数据（存储在 KV 中）。
    *   前端使用 DOMPurify 清理 AI 返回内容，防范 XSS。
*   **状态管理:** 会话状态（主要是对话历史）完全由后端 Cloudflare KV 管理。
*   **配置性:** LLM API 端点、模型名称和基础系统提示通过 `wrangler.toml` 或 Cloudflare 环境变量配置。

## 使用流程

1.  **访问:** 用户浏览器打开 `index.html`。
2.  **登录:**
    *   在左侧边栏底部找到“登录码”输入框，输入 10 位数字。
    *   点击“登录”按钮。
3.  **验证:**
    *   前端 (`script.js`) 进行基本格式校验（10位数字）。
    *   调用后端 `POST /api/login`。
    *   后端再次校验格式，并检查 KV 中是否存在该 `code`。
        *   如果不存在，创建包含空 `conversation_history` 的初始状态存入 KV。
        *   如果存在且 KV 中数据格式有效（包含 `conversation_history` 数组），则认为有效。
        *   如果存在但数据无效/损坏，重置为初始状态存入 KV。
    *   后端返回成功信息。
    *   **前端反馈:** 显示“登录成功！”，启用底部聊天输入框和发送按钮，禁用登录框和按钮。
    *   **失败反馈:** 显示错误信息（如“无效格式”、“服务器错误”），登录按钮恢复可用。
4.  **发送消息:**
    *   在底部输入框输入文本。
    *   点击发送按钮或按 Enter。
5.  **处理与响应:**
    *   前端 (`script.js`) 立即将用户消息显示在聊天窗口右侧。
    *   前端显示 AI “正在输入”的占位消息。
    *   前端调用后端 `POST /api/chat`，发送 `{ code, message }`。
    *   后端加载对应 `code` 的 `conversation_history`，追加用户消息。
    *   后端组合系统提示和完整 `conversation_history`，调用外部 LLM API。
    *   后端获取 LLM 回复，追加到 `conversation_history`，并将更新后的历史存回 KV。
    *   后端将 AI 回复 `{ reply }` 返回给前端。
    *   前端收到回复，使用 Marked 和 DOMPurify 处理后，更新“正在输入”占位消息为实际的 AI 回复，显示在聊天窗口左侧。
6.  **持续对话:** 重复步骤 4 和 5。
7.  **新建对话:**
    *   用户点击左侧“新建对话”按钮。
    *   前端 (`script.js`) 调用后端 `POST /api/reset`，发送 `{ code }`。
    *   后端清空该 `code` 在 KV 中的 `conversation_history`。
    *   后端返回成功信息。
    *   前端清空聊天窗口显示区域，显示“新的对话已开始”的系统消息，确保输入框可用。

## 技术栈说明

*   **前端 (Frontend):**
    *   **HTML:** `index.html`
    *   **CSS:** Tailwind CSS (v2.2.19 via CDN)
    *   **JavaScript:** Vanilla JavaScript (`script.js`)
    *   **Libraries:**
        *   Marked.js (CDN): Markdown 解析。
        *   DOMPurify (CDN): HTML 清理。
*   **后端 (Backend):**
    *   **Platform:** Cloudflare Pages Functions (运行环境为 Cloudflare Workers)
    *   **Language:** JavaScript (Node.js 语法兼容)
    *   **Runtime API:** Fetch API
*   **数据存储 (Data Storage):**
    *   Cloudflare KV: 存储用户会话状态（对话历史）。
*   **外部服务 (External Services):**
    *   遵从 OpenAI API 规范的大语言模型 (LLM) 服务。
*   **部署与配置 (Deployment & Configuration):**
    *   Cloudflare Pages: 托管静态文件和运行 Functions。
    *   `wrangler.toml`: 项目配置文件。
    *   Cloudflare Dashboard: 配置 Secrets 和环境变量。

## 前端规范（组件命名规则）

*   **HTML 元素 ID:** 使用 `kebab-case` (e.g., `login-code`, `chat-window`)。
*   **CSS 类:** 主要使用 Tailwind 原子类。自定义类使用 `kebab-case` (e.g., `.message-bubble`)。
*   **JavaScript 函数:** 使用 `camelCase` (e.g., `handleLogin`, `displayMessage`)。
*   **JavaScript 变量:** 使用 `camelCase` (e.g., `isLoggedIn`, `userLoginCode`)。

## 后端结构（API 接口设计）

后端逻辑位于 `functions/api/[[path]].js`，通过 `onRequest` 函数处理 `/api/*` 请求。

### API 接口详情：

1.  **登录验证 (`/api/login`)**
    *   **方法:** `POST`
    *   **请求体 (JSON):** `{ "code": "..." }`
    *   **成功响应 (JSON, 200):** `{ "success": true, "message": "..." }`
    *   **失败响应 (JSON, 4xx/5xx):** `{ "success": false, "error": "..." }`
    *   **逻辑:** 验证 code，检查/初始化 KV 状态。

2.  **发送聊天消息 (`/api/chat`)**
    *   **方法:** `POST`
    *   **请求体 (JSON):** `{ "code": "...", "message": "..." }`
    *   **成功响应 (JSON, 200):** `{ "reply": "AI 回复内容" }`
    *   **失败响应 (JSON, 4xx/5xx):** `{ "error": "..." }`
    *   **逻辑:** 加载历史，调用 LLM，更新历史，返回回复。

3.  **重置对话 (`/api/reset`)**
    *   **方法:** `POST`
    *   **请求体 (JSON):** `{ "code": "..." }`
    *   **成功响应 (JSON, 200):** `{ "success": true, "message": "状态已成功重置" }`
    *   **失败响应 (JSON, 4xx/5xx):** `{ "success": false, "error": "..." }`
    *   **逻辑:** 清空 KV 中对应 code 的对话历史。

### 环境变量和 Secrets:

*   `KV_NAMESPACE`: (Binding) KV 绑定。
*   `API_ENDPOINT`: (Variable/Secret) LLM API URL。
*   `LLM_MODEL`: (Variable/Secret) LLM 模型名称。
*   `SYSTEM_PROMPT`: (Variable/Secret) 通用系统提示。
*   `OPENAI_API_KEY`: (Secret) LLM API 密钥。
*   `PAPER_SYSTEM_PROMPT`: (Secret, 可能未使用) 特定任务提示。
