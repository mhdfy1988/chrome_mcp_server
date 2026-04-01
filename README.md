# Chrome Browser MCP Server

这是一个面向 `Codex` 和 `OpenClaw` 的 `Chrome 浏览器 MCP Server`。它基于 `Model Context Protocol (MCP)` 和 `Puppeteer`，提供浏览器启动/连接、页面导航、页面理解、元素查找、点击输入、截图、日志采集等能力。

这版不是只做“能开浏览器”的最小壳，而是已经补到了更适合模型实际使用的工作流：

- 先用 `page_snapshot` 看懂页面
- 再用 `find_elements` 锁定明确元素
- 然后按“点击输入框 -> 输入 -> 点击按钮”的顺序执行
- 只有主路径不够时，才使用兜底工具

## 适用场景

- 给 `Codex` 提供一个可直接接入的 Chrome 浏览器 MCP 工具层
- 给 `OpenClaw` 提供标准的 `stdio` / `streamable-http` 浏览器工具
- 需要“真实打开 Chrome”，而不是只在无头环境里跑脚本
- 需要连接已经手工打开的 Chrome 调试端口
- 需要整页长截图、页面快照、元素建议选择器

## 为什么做这个服务

- `Codex` 官方支持 `stdio` 和 `streamable-http` 两种 MCP 方式
- `OpenClaw` 也支持把 stdio / HTTP MCP 服务接进自己的配置
- 做成标准 MCP Server 后，同一套浏览器能力可以被多个客户端复用
- 相比只暴露“原始选择器点击”，这个服务额外提供了页面快照和元素查找，对模型更友好

## 工作方式

1. MCP 客户端启动本服务
2. 服务按配置决定“自己启动 Chrome”还是“连接已有 Chrome”
3. 首次调用页面相关工具时，才真正创建浏览器会话
4. 一个服务进程只维护一个浏览器会话
5. 工具默认作用在“当前页面”，也可以显式传 `pageId`

## 核心能力

- 浏览器管理：`browser_status`、`list_pages`、`open_page`、`select_page`、`close_page`、`close_browser`
- 页面导航：`navigate`、`go_back`、`reload_page`
- 页面理解：`page_snapshot`、`extract_text`（高级模式可额外启用 `evaluate`）
- 元素定位：`find_elements`
- 同步等待：`wait_for`
- 页面操作：`click`、`type_text`、`press_key`（高级模式可额外启用 `submit_input`）
- 结果留证：`screenshot`
- 调试辅助：`console_logs`、`network_logs`

## 工具分层

为了让使用者更自然地走“像人一样”的浏览器操作，这套工具默认分成 3 层：

- 主路工具：`page_snapshot`、`find_elements`、`click`、`type_text`、`click_and_wait`、`screenshot`
- 辅助工具：`open_page`、`navigate`、`wait_for`、`list_pages`
- 兜底工具：`find_primary_inputs`、`submit_input`、`evaluate`

建议优先把主路工具走通，再考虑辅助或兜底工具。不要一开始就直接使用 `submit_input` 这类技术型工具。

## 工具模式

当前服务支持两种工具模式：

- `human-first`
  说明：默认模式。只暴露主路工具和必要辅助工具，不主动暴露 `find_primary_inputs`、`submit_input`、`evaluate` 这些高级兜底工具。

- `advanced`
  说明：高级模式。额外暴露 `find_primary_inputs`、`submit_input`、`evaluate`，适合排障、复杂页面和高级接入。

如果你的目标是模拟正常人的页面操作，建议保持默认的 `human-first`。

## 默认操作原则

如果目标是模拟正常人的页面操作，默认按下面几条来：

1. 先看页面，再找明确元素。
2. 有明确输入框时，先 `click` 再 `type_text`。
3. 有明确按钮或链接时，优先 `click` / `click_and_wait`，不要先用 `submit_input`。
4. 一次只做一个关键动作，动作后立刻回读页面状态。
5. 只有主路径失败，才进入 `find_primary_inputs`、`submit_input`、`evaluate` 这些兜底工具。

## 推荐工作流

相比“先猜一个 CSS 选择器再硬点”，更推荐这样走：

1. `open_page` 或 `navigate` 打开页面
2. `page_snapshot` 查看页面标题、正文摘要、可交互元素和 `ref`
3. `find_elements` 找出明确的输入框、按钮或链接，并拿到对应 `ref`
4. `click` 点击输入框或目标元素，优先传 `ref`
5. `type_text` 输入文本，优先传 `ref`
6. `click_and_wait` 点击明确按钮或链接，并等待页面变化，优先传 `ref`
7. `page_snapshot` 或 `list_pages` 回读当前页面状态
8. `screenshot` 留证，必要时再看 `console_logs` / `network_logs`

如果你显式开启了 `advanced` 模式，而第 3 到第 6 步仍然不够，再按这个顺序补兜底：

1. `wait_for`
2. `find_primary_inputs`
3. `submit_input`
4. `evaluate`

这套方式比“全文文本匹配 + 手写选择器”更稳，也更接近成熟浏览器自动化工具的推荐实践。

## 当前工具

下面默认先介绍 `human-first` 模式下可见的工具；标注“高级模式”的，只有在 `advanced` 模式下才会暴露。

### 浏览器与页面

- `browser_status`
  说明：查看当前浏览器连接状态、运行模式和页面列表。

- `list_pages`
  说明：列出当前浏览器里已打开的页面。

- `open_page`
  说明：新开一个页面，可选直接导航到指定 URL。

- `select_page`
  说明：切换当前活动页面。

- `close_page`
  说明：关闭当前页面或指定页面。

- `close_browser`
  说明：关闭整个浏览器进程并清空当前会话状态。

### 导航与等待

- `navigate`
  说明：在当前页面或指定页面里导航到 URL。

- `go_back`
  说明：后退一页。

- `reload_page`
  说明：刷新页面。

- `wait_for`
  说明：等待页面元素、文本、标题或 URL 满足条件。
  常用参数：
  - `selector`：等待某个 CSS 选择器出现并可见
  - `text`：等待文本出现
  - `textSelector`：只在某个元素范围内等待文本
  - `title`：等待页面标题
  - `url`：等待页面 URL
  - `matchMode`：`contains` 或 `exact`
  - `timeoutMs`：超时时间

### 页面理解与元素查找

- `page_snapshot`
  说明：返回页面标题、正文摘要、可见标题、可交互元素列表、稳定 `ref`、可访问名称、推断 role 和建议选择器。
  适合先“看懂页面”，是推荐工作流的起点。

- `find_elements`
  说明：按可访问名称、标签、文本、值、placeholder、href 或 selector 模糊查找页面中的可交互元素，并按更接近语义定位的结果优先排序，同时返回可直接用于后续动作的 `ref`。
  适合在 `page_snapshot` 之后锁定明确的输入框、按钮或链接。

- `find_primary_inputs`
  说明：高级模式。仅在 `page_snapshot` 和 `find_elements` 仍然不够时使用，扫描整页可见输入控件，按“主输入框”的概率排序。
  适合作为兜底或诊断工具，定位页面没有明确“搜索”字样时的导航区或顶部主输入框。

- `extract_text`
  说明：提取整个页面或某个元素的文本内容。优先传 `ref`；也支持 `selector`。

- `evaluate`
  说明：高级模式。在页面上下文里执行一段 JavaScript 表达式并返回结果。

### 页面操作

- `click`
  说明：模拟用户点击页面中的明确元素。优先传 `page_snapshot` 或 `find_elements` 返回的 `ref`；也支持 Puppeteer locator 风格的 selector。

- `click_and_wait`
  说明：先注册等待条件再点击，适合点击明确按钮、链接或标签后，会发生同页跳转、弹出新页、改标题、改 URL 或刷新局部内容的场景。优先传 `ref`。
  常用参数：
  - `selector`
  - `waitForNavigation`
  - `waitUntil`
  - `waitForSelector`
  - `waitForTitle`
  - `waitForUrl`
  - `matchMode`

- `type_text`
  说明：模拟用户向输入框或可编辑元素输入文本。优先传 `ref`；也支持 Puppeteer locator 风格的 selector。
  常用参数：
  - `selector`
  - `text`
  - `clear`
  - `submit`

- `press_key`
  说明：发送一个键盘按键，例如 `Enter`、`Tab`、`Escape`。

- `submit_input`
  说明：高级模式下的兜底工具。对指定输入框按多种策略尝试提交，适合页面没有明确提交按钮，或需要排查表单提交流程时做验证。

### 截图与排错

- `screenshot`
  说明：截图当前页面，或截图指定元素。
  常用参数：
  - `ref`：截取 `page_snapshot` 或 `find_elements` 返回的某个元素
  - `selector`：截指定元素
  - `fullPage`：是否整页截图
  - `format`：`png` 或 `jpeg`
  - `savePath`：额外保存到本地文件

- `console_logs`
  说明：查看页面最近的 console 日志。

- `network_logs`
  说明：查看页面最近的网络响应日志。

## 环境要求

- Node.js `>= 20`
- 本机已安装 Chrome
- Windows 环境下建议使用 `npm.cmd`

## 安装与构建

```powershell
npm.cmd install
npm.cmd run build
```

## 启动方式

### 1. 走 STDIO

适合直接接 `Codex`，也适合让 `OpenClaw` 以子进程方式拉起。

```powershell
npm.cmd run start:stdio
```

显式开启高级模式：

```powershell
npm.cmd run start:stdio -- --tool-mode advanced
```

### 2. 走 HTTP

适合常驻服务，然后让客户端通过 `http://127.0.0.1:3000/mcp` 连接。

```powershell
npm.cmd run start:http
```

显式开启高级模式：

```powershell
npm.cmd run start:http -- --tool-mode advanced
```

健康检查：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3000/health
```

## Chrome 连接方式

默认情况下，服务会自己启动 Chrome。

### 模式 A：自己启动 Chrome

```powershell
$env:CHROME_HEADLESS = "false"
$env:CHROME_CHANNEL = "chrome"
$env:CHROME_USER_DATA_DIR = "D:\C_Project\chrome_mcp_server\.profiles\active\default"
npm.cmd run start:stdio
```

### 模式 B：连接已有 Chrome 远程调试端口

先手工启动 Chrome：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="D:\C_Project\chrome_mcp_server\.profiles\active\default"
```

再启动 MCP Server：

```powershell
$env:CHROME_BROWSER_URL = "http://127.0.0.1:9222"
npm.cmd run start:stdio
```

### 模式 C：连接已有 Chrome WebSocket 端点

如果你已经拿到了 `browserWSEndpoint`，也可以直接连接：

```powershell
$env:CHROME_WS_ENDPOINT = "ws://127.0.0.1:9222/devtools/browser/xxxxx"
npm.cmd run start:stdio
```

## CLI 参数与环境变量

可执行参数见 [config.ts](/d:/C_Project/chrome_mcp_server/src/config.ts)：

- `--transport <stdio|http>`
- `--tool-mode <human-first|advanced>`
- `--host <host>`
- `--port <port>`
- `--browser-url <url>`
- `--ws-endpoint <url>`
- `--executable-path <path>`
- `--channel <chrome|chrome-beta|chrome-dev|chrome-canary>`
- `--headless <true|false>`
- `--user-data-dir <path>`
- `--default-timeout-ms <ms>`
- `--navigation-timeout-ms <ms>`

对应环境变量：

- `CHROME_MCP_TRANSPORT`
- `CHROME_MCP_TOOL_MODE`
- `CHROME_MCP_HOST`
- `CHROME_MCP_PORT`
- `CHROME_BROWSER_URL`
- `CHROME_WS_ENDPOINT`
- `CHROME_EXECUTABLE_PATH`
- `CHROME_CHANNEL`
- `CHROME_HEADLESS`
- `CHROME_USER_DATA_DIR`
- `CHROME_DEFAULT_TIMEOUT_MS`
- `CHROME_NAVIGATION_TIMEOUT_MS`

目录约定（默认）：

- Chrome 用户数据目录：`.profiles/active/default`
- 临时脚本与测试工作目录：`.tmp/scripts`、`.tmp/workspaces`
- 临时日志：`.tmp/logs`

说明：

- 默认工具模式是 `human-first`
- 只有显式传 `--tool-mode advanced` 或设置 `CHROME_MCP_TOOL_MODE=advanced` 时，才会暴露 `find_primary_inputs`、`submit_input`、`evaluate`

## 接入 Codex

最简单的是 `stdio`。把下面内容放到 `~/.codex/config.toml` 或项目级 `.codex/config.toml`：

```toml
[mcp_servers.chrome_browser]
command = "node"
args = ["D:/C_Project/chrome_mcp_server/dist/index.js", "--transport", "stdio"]
cwd = "D:/C_Project/chrome_mcp_server"
startup_timeout_sec = 20
tool_timeout_sec = 120

[mcp_servers.chrome_browser.env]
CHROME_HEADLESS = "false"
CHROME_CHANNEL = "chrome"
CHROME_USER_DATA_DIR = "D:/C_Project/chrome_mcp_server/.profiles/active/default"
```

如果你想让 Codex 走 HTTP：

```toml
[mcp_servers.chrome_browser]
url = "http://127.0.0.1:3000/mcp"
startup_timeout_sec = 20
tool_timeout_sec = 120
```

现成示例：

- [examples/codex.config.toml](/d:/C_Project/chrome_mcp_server/examples/codex.config.toml)

## 接入 OpenClaw

OpenClaw 官方推荐用 `openclaw mcp` 子命令管理 MCP 服务，不需要额外装插件桥接。

在这台 Windows PowerShell 5.1 机器上，直接把 JSON 内联传给 `openclaw.cmd mcp set` 很容易丢掉双引号。  
仓库里附带了一个很薄的辅助脚本 [scripts/openclaw-mcp-set.mjs](/d:/C_Project/chrome_mcp_server/scripts/openclaw-mcp-set.mjs)，内部仍然调用官方 `openclaw mcp set`，只是专门绕开这个传参问题。

先看当前已配置的 MCP 服务：

```powershell
openclaw.cmd mcp list
```

### OpenClaw 走 STDIO

推荐直接执行仓库里的辅助脚本：

```powershell
npm.cmd run openclaw:set:stdio
openclaw.cmd mcp show chrome-browser --json
```

对应的 JSON 结构就是一个“单个 server 对象”，不是整段 `openclaw.json`：

```json
{
  "command": "node",
  "args": [
    "D:/C_Project/chrome_mcp_server/dist/index.js",
    "--transport",
    "stdio"
  ],
  "cwd": "D:/C_Project/chrome_mcp_server",
  "env": {
    "CHROME_HEADLESS": "false",
    "CHROME_CHANNEL": "chrome",
    "CHROME_USER_DATA_DIR": "D:/C_Project/chrome_mcp_server/.profiles/active/openclaw"
  },
  "connectionTimeoutMs": 30000
}
```

### OpenClaw 走 HTTP

如果你已经把本服务常驻在 `http://127.0.0.1:3000/mcp`，可以这样写：

```powershell
npm.cmd run openclaw:set:http
openclaw.cmd mcp show chrome-browser --json
```

对应的 server 对象：

```json
{
  "url": "http://127.0.0.1:3000/mcp",
  "connectionTimeoutMs": 30000
}
```

如果后面要删掉这条配置：

```powershell
openclaw.cmd mcp unset chrome-browser
```

现成示例：

- [examples/openclaw-stdio.json](/d:/C_Project/chrome_mcp_server/examples/openclaw-stdio.json)
- [examples/openclaw-http.json](/d:/C_Project/chrome_mcp_server/examples/openclaw-http.json)

## 常见用法示例

### 示例 1：先看懂页面，再找元素

先用 `page_snapshot`：

```json
{
  "name": "page_snapshot",
  "arguments": {
    "maxTextLength": 3000,
    "maxElements": 40
  }
}
```

再用 `find_elements` 找按钮：

```json
{
  "name": "find_elements",
  "arguments": {
    "query": "百度一下",
    "tag": "button",
    "maxResults": 5
  }
}
```

### 示例 2：打开百度并搜索“黄金价格”

```json
{
  "name": "open_page",
  "arguments": {
    "url": "https://www.baidu.com/"
  }
}
```

```json
{
  "name": "wait_for",
  "arguments": {
    "title": "百度",
    "matchMode": "contains",
    "timeoutMs": 15000
  }
}
```

```json
{
  "name": "click",
  "arguments": {
    "selector": "#chat-textarea"
  }
}
```

```json
{
  "name": "type_text",
  "arguments": {
    "selector": "#chat-textarea",
    "text": "黄金价格",
    "clear": true
  }
}
```

```json
{
  "name": "click_and_wait",
  "arguments": {
    "selector": "#chat-submit-button",
    "waitForNavigation": true,
    "waitForTitle": "黄金价格",
    "matchMode": "contains",
    "timeoutMs": 20000
  }
}
```

### 示例 3：整页长截图

```json
{
  "name": "screenshot",
  "arguments": {
    "fullPage": true,
    "savePath": "D:/C_Project/chrome_mcp_server/docs/full-page.png"
  }
}
```

说明：

- `fullPage: true` 截的是整张网页可滚动内容
- 不包含 Chrome 自己的地址栏、标签栏和系统窗口边框
- 如果传了 `selector`，就会变成“截某个元素”，而不是整页截图

### 示例 4：只在某个元素范围里等文本

```json
{
  "name": "wait_for",
  "arguments": {
    "text": "百度一下",
    "textSelector": "#chat-submit-button",
    "matchMode": "exact",
    "timeoutMs": 15000
  }
}
```

## 已验证场景

当前已经实测通过这些场景：

- `chrome_mcp_server` 通过真实 `stdio MCP` 链路被客户端拉起
- 打开可见 Chrome 浏览器窗口
- 访问百度首页
- 输入“黄金价格”并点击搜索
- `click_and_wait` 绑定等待并进入结果页状态
- `click_and_wait` 能跟踪点击后弹出的新页并切到真正变化的页面
- `page_snapshot` 返回百度首页结构化快照
- `find_elements` 找到“百度一下”按钮
- 当前视口截图
- 整页长截图

## 当前主入口与临时验证入口

- 当前主入口：
  - `stdio`：`node dist/index.js --transport stdio`
  - `http`：`http://127.0.0.1:3000/mcp`
- 临时验证入口：
  - `http://127.0.0.1:3000/health`
- 是否会影响你当前正在使用的页面或服务：
  - 如果服务自己启动 Chrome，会新开一个浏览器会话
  - 如果你把它指向已有远程调试 Chrome，它会操作那个 Chrome 的页面

## 排障建议

### 1. 服务启动了，但看不到浏览器

检查：

- `CHROME_HEADLESS` 是否被设成了 `true`
- `CHROME_CHANNEL` 是否对应本机已安装的 Chrome 渠道
- 如果找不到 Chrome，可显式传 `CHROME_EXECUTABLE_PATH`

### 2. 能打开页面，但元素老是找不到

更推荐的顺序是：

1. `page_snapshot`
2. `find_elements`
3. `click` / `type_text`
4. `click_and_wait`
5. `wait_for(selector=...)`
6. 只有前面还不够时，再用 `find_primary_inputs` 或 `submit_input`
7. 最后才退到 `evaluate`

不要一开始就硬写一个复杂的 CSS 选择器。优先用 Puppeteer locator 语法里的更短选择方式，例如：

- `::-p-text(登录)`
- `::-p-aria(搜索)`
- `button.primary`

### 3. `wait_for(text=...)` 不稳定

优先级建议：

1. 先等 `title`
2. 再等 `url`
3. 再等 `selector`
4. 最后才用全文 `text`

如果你知道文本只会出现在某个元素里，优先用 `textSelector` 缩小范围。

### 4. Windows 下中文脚本验证看起来异常

在这台 Windows 机器上，如果你用 PowerShell 直接把含中文的内联脚本 `pipe` 给 `node --input-type=module -`，中文有概率在验证链路里变成 `??`。  
更稳的方式是：

- 直接落成 `.js` 文件再执行
- 或在临时脚本里用 `\\uXXXX` 形式写中文
- 或优先用 `title` / `url` / `selector` 做等待条件

### 5. 想控制自己已经打开的 Chrome

不要直接让服务自己启动一个新的浏览器，而是：

1. 先手工启动带远程调试端口的 Chrome
2. 再配置 `CHROME_BROWSER_URL=http://127.0.0.1:9222`

这样服务才会接管你那一份 Chrome 会话。

## 后续可继续增强的方向

- 下载管理与文件落盘回传
- 更强的元素定位策略，例如按 role、label、text 直接点选
- 更多 locator-first 工具，例如按 role、text、aria 直接操作
- DOM diff / 页面状态对比
- 多标签页共享策略
- 录制与回放操作序列

## 示例命令

```powershell
npm.cmd run build
npm.cmd run start:http
Invoke-RestMethod -Uri http://127.0.0.1:3000/health
```
