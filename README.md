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
- 页面理解：`page_snapshot`、`find_primary_results`、`extract_text`、`read_media_state`（高级模式可额外启用 `evaluate`）
- 元素定位：`find_elements`
- 同步等待：`wait_for`
- 页面操作：`dismiss_blocking_overlays`、`click`、`type_text`、`press_key`、`press_key_and_wait`（高级模式可额外启用 `submit_with_plan`、`submit_input`）
- 结果留证：`screenshot`
- 调试辅助：`console_logs`、`network_logs`

## 工具分层

为了让使用者更自然地走“像人一样”的浏览器操作，这套工具默认分成 3 层：

- 主路工具：`page_snapshot`、`find_elements`、`click`、`type_text`、`click_and_wait`、`screenshot`
- 辅助工具：`open_page`、`navigate`、`wait_for`、`list_pages`
- 兜底工具：`find_primary_inputs`、`submit_with_plan`、`submit_input`、`evaluate`

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
3. 搜索框、查询框这类输入提交时，优先考虑 `Enter` 或明确提交按钮；高级模式下可先看 `submitPlan`，再决定是否用 `submit_with_plan`，不要一开始就直接用 `submit_input`。
4. 一次只做一个关键动作，动作后立刻回读页面状态。
5. 只有主路径失败，才进入 `find_primary_inputs`、`submit_input`、`evaluate` 这些兜底工具。

## 验证页识别

这版 MCP 会在页面摘要里额外标记当前页面状态：

- `pageState=normal`
  说明：当前页面没有命中明显的人机验证/挑战页特征。

- `pageState=blocked_by_verification`
  说明：当前页面命中了明显的验证页或挑战页特征，例如 `Just a moment`、`Checking your browser`、`Client Challenge`、`Pardon Our Interruption`、`/challenge`、`/captcha`。

- `pageState=auth_required`
  说明：当前页面命中了明显的登录门槛或登录拦截层，例如整页登录墙、登录后查看更多、带密码输入框的登录浮层。这类页面不是普通可关闭弹窗，不应继续调用 `dismiss_blocking_overlays`。

- `pageState=overlay_blocking`
  说明：当前页面存在普通遮挡弹窗或浮层，例如 Cookie 横幅、下载引导、活动弹窗或可关闭的整页蒙层。这类页面默认优先尝试自动关闭，而不是直接归因到验证页。

命中验证页时，返回结果里的 `page.verification` 会附带：

- `providerHint`：例如 `cloudflare`、`generic`
- `evidence`：命中的标题、URL、正文证据
- `recommendedAction`：例如 `wait_then_resume`、`manual_resume`

建议动作：

1. 先保留当前浏览器会话，不要误判成输入框或点击链路失败。
2. 如果是 `wait_then_resume`，先等待几秒，看站点是否自动放行。
3. 如果等待后仍停留在验证页，再由人工在当前可见浏览器里完成验证。
4. 验证通过后，继续用同一个 `pageId` / 当前会话往下执行，不需要重开浏览器。

命中登录门槛时，返回结果里的 `page.authRequired` 会附带：

- `kind`：例如 `login_gate`、`auth_page`
- `evidence`：命中的标题、正文、可见输入框等证据
- `recommendedAction`：例如 `manual_login`、`use_existing_browser_session`

建议动作：

1. 不要把它当成普通可关闭弹窗。
2. 如果是 `use_existing_browser_session`，优先复用已登录浏览器会话，或人工完成登录后继续当前页面。
3. 如果是 `manual_login`，先使用测试账号登录，再继续当前会话。

命中普通遮挡层时，返回结果里的 `page.overlay` 会附带：

- `kind`：例如 `modal`、`banner`、`drawer`、`cookie_banner`
- `evidence`：命中的遮挡层证据
- `closeHints`：当前更像关闭控件的提示
- `recommendedAction=auto_close_then_resume`

## 推荐工作流

相比“先猜一个 CSS 选择器再硬点”，更推荐这样走：

1. `open_page` 或 `navigate` 打开页面
2. `page_snapshot` 查看页面标题、正文摘要、可交互元素和 `ref`
3. `find_elements` 找出明确的输入框、按钮或链接，并拿到对应 `ref`
4. `click` 点击输入框或目标元素，优先传 `ref`
5. `type_text` 输入文本，优先传 `ref`
6. 搜索框、查询框场景下，可先用 `find_submit_targets` 查看 `submitPlan`
7. `submitPlan[0]` 是当前推荐的首选提交动作；如果是 `enter`，优先用 `press_key_and_wait(key=Enter)`
8. 如果 `submitPlan[0]` 是 `click`，或首选动作失败，就按计划里的下一个动作继续尝试，通常是 `click_and_wait`
9. `preferredSubmitMethod` 仍然保留作兼容字段，但后续建议优先看 `submitPlan`
10. 如果页面是“URL 先变、内容后到”，在第 7 或第 8 步同时传 `waitForUrl` 和 `contentReadySelector` / `contentReadyText`
11. `page_snapshot` 或 `list_pages` 回读当前页面状态
12. `screenshot` 留证，必要时再看 `console_logs` / `network_logs`

如果你显式开启了 `advanced` 模式，而第 3 到第 6 步仍然不够，再按这个顺序补兜底：

1. `wait_for`
2. `find_primary_inputs`
3. `submit_with_plan`
4. `submit_input`
5. `evaluate`

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
  - `timeoutMs`：可选；不传时默认跟随全局 `stepTimeoutMs`
  - 遮挡层说明：若页面处于 `overlay_blocking`，`wait_for` 不再直接抛错阻断，只会记录告警并继续等待；是否先调用 `dismiss_blocking_overlays` 由调用方自行决定。

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

- `find_submit_targets`
  说明：围绕指定输入框扫描附近可能承担提交动作的控件，并返回 `submitPlan`。`submitPlan` 是按顺序排好的提交方案，第一项是首选动作，后续项是失败后的后备动作；同时仍保留 `preferredSubmitMethod` 作为兼容字段。

- `find_primary_results`
  说明：在主内容区域里提取更像“结果卡片/主结果列表”的链接，适合商品列表、视频列表、搜索结果页这类噪音较多的页面。可选传 `query`，把更相关的结果排到前面。
  适用场景：
  - 电商结果页里先拿主商品卡片，再决定点哪一条
  - 视频/文章结果列表里，优先锁定真正结果，而不是页头、筛选器、推荐链接
  - `page_snapshot` 返回的交互元素被导航或筛选控件噪音挤占时，单独补一轮主结果提取

- `extract_text`
  说明：提取整个页面或某个元素的文本内容。优先传 `ref`；也支持 `selector`。
  常用参数：
  - `ref`
  - `selector`
  - `mode`：未传 `ref/selector` 时的提取范围。`auto` 默认优先正文，`main` 优先主内容区，`article` 优先文章正文，`body` 为整页
  - `maxLength`

- `read_media_state`
  说明：读取页面里的 `video/audio` 元素状态，适合验证“真的开始播放了”，而不是只看按钮文案。
  常用返回：
  - `currentTime`：当前播放时间
  - `paused`：是否暂停
  - `duration`：总时长
  - `visible`：媒体元素是否可见
  - `isPrimary`：当前最像主媒体的元素
  适用场景：
  - 视频详情页验证是否真正进入播放态
  - 页面上有多个媒体元素时，优先看主媒体状态
  - 排查“按钮看起来点了，但视频其实没开始”这类问题

- `evaluate`
  说明：高级模式。在页面上下文里执行一段 JavaScript 表达式并返回结果。
  返回重点：
  - `value`：字符串化结果（兼容旧行为）
  - `jsonValue`：可结构化时返回 JSON 结果，方便直接消费
  - `jsonValueError`：无法结构化时的原因说明

### 页面操作

- `dismiss_blocking_overlays`
  说明：尝试关闭当前页面上的普通遮挡弹窗或遮罩层，只处理高置信的“关闭/跳过/稍后/取消/知道了”这类控件，不默认点击“同意/允许”按钮。
  适用场景：
  - 登录提示挡住了主内容
  - Cookie 横幅挡住了按钮或输入框
  - 下载客户端、App 引导、活动弹窗挡住了页面

- `click`
  说明：模拟用户点击页面中的明确元素。优先传 `page_snapshot` 或 `find_elements` 返回的 `ref`；也支持 Puppeteer locator 风格的 selector。

- `click_and_wait`
  说明：先注册等待条件再点击，适合点击明确按钮、链接或标签后，会发生同页跳转、弹出新页、改标题、改 URL 或刷新局部内容的场景。优先传 `ref`。
  判定规则：默认要求命中“强信号”（例如 `waitForSelector` 命中、显式 URL/标题条件命中、popup/new_target）；仅有弱变化不会判成功，避免误判。默认不强等导航，只有明确会跳页时再传 `waitForNavigation=true`。
  两阶段等待：如果是“路由先变化、内容区稍后才就绪”的页面，可额外传 `contentReadySelector` 或 `contentReadyText`。这时工具会先确认跳转/变化，再继续等待内容区真正可见。
  可恢复等待：如果点击后正好遇到结果列表重排、页面执行上下文切换这类瞬时错误（例如 `detached frame`），会先继续观察页面真实变化，再决定是否判失败，而不是立刻把动作记成失败。
  返回重点：
  - `changeType`：本次变化类型，例如 `same_page_update`、`navigation`、`popup`、`new_target`
  - `successSignal`：本次到底是靠什么信号判成功，例如 `selector`、`url`、`title`、`popup`
  - `domObservation`：仅在动作期间短时观察 DOM 变更后生成的摘要，包含是否变更、节点增删数量、文本/属性变化次数、命中最多的选择器摘要；不返回原始 mutation 明细
  - `contentReady`：是否命中了内容就绪条件
  - `contentReadySignal`：内容就绪靠什么命中，例如 `selector`、`text`
  常用参数：
  - `selector`
  - `waitForNavigation`
  - `waitUntil`
  - `waitForSelector`
  - `waitForTitle`
  - `waitForUrl`
  - `contentReadySelector`
  - `contentReadyText`
  - `contentReadyTextSelector`
  - `contentReadyTimeoutMs`
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

- `press_key_and_wait`
  说明：发送一个键盘按键并等待页面变化，适合搜索框按 `Enter`、表单回车提交、键盘触发跳转这类场景。
  常用参数：
  - `key`
  - `waitForNavigation`
  - `waitUntil`
  - `waitForSelector`
  - `waitForTitle`
  - `waitForUrl`
  - `contentReadySelector`
  - `contentReadyText`
  - `contentReadyTextSelector`
  - `contentReadyTimeoutMs`
  - `matchMode`

- `submit_with_plan`
  说明：高级模式。先围绕输入框生成 `submitPlan`，再按顺序执行。第 1 步通常是 `enter` 或明确提交按钮点击；如果首选动作失败，会自动切到计划里的后备动作。只使用像人一样的提交方式，不使用 `form.submit()`。
  适用场景：
  - 搜索框、查询框
  - 已经锁定输入框，但不确定当前站点应先按 `Enter` 还是先点按钮
  - 希望把“首选提交动作 + 后备动作”固定下来，而不是临时自己切换
  常用参数：
  - `ref` 或 `selector`
  - `waitForUrl`
  - `waitForSelector`
  - `contentReadySelector`
  - `contentReadyText`
  - `maxPlanSteps`
  返回重点：
  - `submitPlan`：本次执行时参考的提交计划
  - `chosenMethod`：最终成功使用的是 `enter` 还是 `click`
  - `chosenSelector`：如果成功动作是点击，这里会返回对应按钮选择器
  - `attempts`：每一步计划的尝试记录和失败原因
  - `changeType`、`successSignal`、`contentReady`：与 `click_and_wait` 保持一致的结果判定字段

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
- `--step-timeout-ms <ms>`
- `--max-retries <count>`
- `--retry-backoff-ms <ms>`
- `--action-settle-delay-ms <ms>`
- `--followup-watch-timeout-ms <ms>`

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
- `CHROME_STEP_TIMEOUT_MS`
- `CHROME_MAX_RETRIES`
- `CHROME_RETRY_BACKOFF_MS`
- `CHROME_ACTION_SETTLE_DELAY_MS`
- `CHROME_FOLLOWUP_WATCH_TIMEOUT_MS`

目录约定（默认）：

- Chrome 用户数据目录：`.profiles/active/default`
- 临时脚本与测试工作目录：`.tmp/scripts`、`.tmp/workspaces`
- 临时日志：`.tmp/logs`
- 动作执行默认使用“执行 + 验证 + 重试”通用流程（重试参数由 `stepTimeout/maxRetries/retryBackoff` 控制）
- 动作观察里有两段可配置等待：`actionSettleDelayMs`（默认 `500ms`）和 `followupWatchTimeoutMs`（默认 `2000ms`）；可按场景调小或设为 `0`

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

注意：

- [openclaw-http.json](/d:/C_Project/chrome_mcp_server/examples/openclaw-http.json) 只是客户端连接配置，只告诉 OpenClaw 去连哪个 MCP URL。
- HTTP 模式下真正的浏览器参数，例如 `CHROME_STEP_TIMEOUT_MS`、`CHROME_ACTION_SETTLE_DELAY_MS`、`CHROME_FOLLOWUP_WATCH_TIMEOUT_MS`，需要配置在服务端启动这个 `start:http` 进程时的环境变量里，而不是写进这个 JSON。

例如，你想用“快模式”启动 HTTP 服务，可以这样做：

```powershell
$env:CHROME_HEADLESS = "false"
$env:CHROME_CHANNEL = "chrome"
$env:CHROME_USER_DATA_DIR = "D:\C_Project\chrome_mcp_server\.profiles\active\http"
$env:CHROME_STEP_TIMEOUT_MS = "4000"
$env:CHROME_MAX_RETRIES = "0"
$env:CHROME_RETRY_BACKOFF_MS = "1"
$env:CHROME_ACTION_SETTLE_DELAY_MS = "0"
$env:CHROME_FOLLOWUP_WATCH_TIMEOUT_MS = "800"
npm.cmd run start:http
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
    "waitForUrl": "/search",
    "contentReadySelector": "#search-results",
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
