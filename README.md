# Chrome Browser MCP Server

面向 `Codex` 和 `OpenClaw` 的 `Chrome` 浏览器 `MCP Server`。

它不是只会“打开浏览器 + 执行 selector 点击”的最小壳，而是已经补到一套更适合模型实际使用的浏览器工作流：

- 先看懂页面：`page_snapshot`
- 再锁定明确目标：`find_elements`
- 再执行动作：`click` / `type_text` / `press_key`
- 动作后做变化观察和结果判定：`click_and_wait` / `press_key_and_wait`
- 遇到普通遮挡层时，优先走 `dismiss_blocking_overlays`

## 当前状态

当前仓库已经完成浏览器主链重构，代码主结构稳定，核心能力已落地：

- `stdio` 和 `http` 两种传输方式都可用
- `http` 模式已按“单浏览器会话串行执行”收口，避免多请求互相踩状态
- `human-first` / `advanced` 两种工具模式已打通
- 页面状态识别已支持：
  - `normal`
  - `overlay_blocking`
  - `auth_required`
  - `blocked_by_verification`
- `ref` 主链、稳定重绑定、动作预检、结果观察、成功判定已接上同一条执行链
- 连接外部浏览器时已补安全保护：
  - `close_browser` 只断开 MCP 连接，不关闭用户浏览器进程
  - `close_page` 默认阻止，避免误关用户现有标签页
- 非幂等动作默认不自动重放：
  - `click_and_wait`
  - `press_key_and_wait`
  - `type_text`
- MCP 工具失败结果已统一成结构化错误输出，至少会区分：
  - `action_verification_failed`
  - `blocked_by_verification`
  - `auth_required`
  - `external_page_close_blocked`
  - `invalid_operation`
- 回归夹具与冒烟验证已覆盖：
  - 遮挡层关闭
  - 空白区关闭弹窗
  - 结果卡片打开顺序
  - 媒体播放验证
  - `ref` 重绑定
  - 容器自动下探到主链接
  - 安全坐标点击
  - 命中被遮挡时的明确失败
  - 输入/按键后的值与焦点验证

当前自动化回归主入口：

```powershell
npm.cmd run build
npm.cmd run verify:plan-smoke
```

## 项目目标

这套服务主要解决 3 件事：

1. 给 `Codex` / `OpenClaw` 提供一套可复用的真实浏览器 MCP 能力。
2. 把“页面理解 -> 目标定位 -> 动作执行 -> 结果验证”串成统一主链，而不是每个工具各做各的。
3. 尽量让模型按“像人一样”的方式操作页面，而不是动不动退回 `submit_input` 或大段 `evaluate`。

## 工具概览

默认 `human-first` 模式下可用的工具：

- 浏览器与页面：
  - `browser_status`
  - `list_pages`
  - `open_page`
  - `select_page`
  - `close_page`
  - `close_browser`
- 导航与等待：
  - `navigate`
  - `go_back`
  - `reload_page`
  - `wait_for`
- 页面理解与查找：
  - `page_snapshot`
  - `find_elements`
  - `find_submit_targets`
  - `find_primary_results`
  - `extract_text`
  - `read_media_state`
- 页面动作：
  - `dismiss_blocking_overlays`
  - `click`
  - `click_and_wait`
  - `type_text`
  - `press_key`
  - `press_key_and_wait`
- 留证与排障：
  - `screenshot`
  - `console_logs`
  - `network_logs`

`advanced` 模式额外开放：

- `find_primary_inputs`
- `evaluate`
- `submit_with_plan`
- `submit_input`

说明：

- `openResultWithPlan` 和 `playMediaWithPlan` 已在内部用例层落地，目前主要由回归脚本和内部编排使用，尚未作为公共 MCP 工具暴露。
- `human-first` 是默认模式，推荐作为实际接入模式。
- 如果连接的是外部浏览器，会话安全策略会优先保护用户现有浏览器实例，而不是强行执行关闭动作。

## 推荐工作流

默认推荐按这条主线使用：

1. `open_page` / `navigate`
2. `page_snapshot`
3. `find_elements`
4. `click`
5. `type_text`
6. `click_and_wait` 或 `press_key_and_wait`
7. `extract_text` / `screenshot` / `read_media_state`

如果是搜索或筛选场景，先补一轮：

1. `find_submit_targets`
2. 判断 `submitPlan`
3. 优先 `Enter` 或明确提交按钮

只有主链仍然不够时，再进入：

1. `find_primary_inputs`
2. `submit_with_plan`
3. `submit_input`
4. `evaluate`

## 当前实现重点

相比旧版“只执行动作，不知道成功没成功”，当前主链多了这些关键机制：

- 稳定目标引用：
  - `page_snapshot` / `find_elements` 会产出 `ref`
  - 动作前会尝试按 `runtimeNodeKey / fingerprint / fallbackAnchors` 重绑定目标
- 动作预检：
  - 点击前会做命中测试（hit-test）
  - 容器节点会自动下探到内部最强语义动作元素
  - 中心被遮挡但边缘仍可点时，会降级到安全坐标点击
  - 仅命中栈轻微遮挡时，会尝试语义点击软放行
- 结果观察：
  - 会观察 URL、标题、DOM、popup、新 target、页面数量变化
  - 支持“路由先变，内容后到”的二阶段等待
- 结果判定：
  - 返回 `changeType`、`successSignal`、`contentReady`
  - 不再只靠 URL 变化判断成功
- 页面状态识别：
  - 普通遮挡层、登录墙、人机验证页分开处理

## 目录结构

当前主代码结构：

- `src/browser-manager.ts`
  - 顶层门面，暴露浏览器能力
- `src/mcp/`
  - MCP 工具注册层
- `src/browser/`
  - 浏览器主逻辑
  - 目录见 [src/browser/README.md](src/browser/README.md)
- `tests/fixtures/`
  - 回归夹具
- `tests/web-tasks/`
  - 公开站点和业务模板任务样例
- `docs/`
  - 架构、测试、模板、归档文档

## 安装与启动

安装与构建：

```powershell
npm.cmd install
npm.cmd run build
```

启动 `stdio`：

```powershell
npm.cmd run start:stdio
```

启动 `http`：

```powershell
npm.cmd run start:http
```

健康检查：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3000/health
```

说明：

- `http` 模式底层使用 `Streamable HTTP` 传输。
- `http` 模式当前是“共享单浏览器会话 + 串行执行请求”，适合作为单操作者或单代理入口，不是多租户并发浏览器池。
- Windows PowerShell 5.1 下，建议统一使用 `npm.cmd` / `openclaw.cmd`。

## 配置项

命令行参数和环境变量来源见 [src/config.ts](src/config.ts)。

最常用配置：

- 传输方式：
  - `--transport stdio|http`
  - `CHROME_MCP_TRANSPORT`
- 工具模式：
  - `--tool-mode human-first|advanced`
  - `CHROME_MCP_TOOL_MODE`
- 浏览器连接：
  - `CHROME_BROWSER_URL`
  - `CHROME_WS_ENDPOINT`
  - `CHROME_EXECUTABLE_PATH`
  - `CHROME_CHANNEL`
  - `CHROME_HEADLESS`
  - `CHROME_USER_DATA_DIR`
- 动作与等待：
  - `CHROME_DEFAULT_TIMEOUT_MS`
  - `CHROME_NAVIGATION_TIMEOUT_MS`
  - `CHROME_STEP_TIMEOUT_MS`
  - `CHROME_MAX_RETRIES`
  - `CHROME_RETRY_BACKOFF_MS`
  - `CHROME_ACTION_SETTLE_DELAY_MS`
  - `CHROME_FOLLOWUP_WATCH_TIMEOUT_MS`

默认用户数据目录：

- `.profiles/active/default`

重试说明：

- `CHROME_MAX_RETRIES` 默认值已经调整为 `0`。
- 这表示默认不会自动重放非幂等动作。
- 如果后续确实要对某些安全动作启用自动重试，建议显式评估该动作是否可重复执行。

## 连接 Chrome 的方式

### 1. 由服务自己启动 Chrome

```powershell
$env:CHROME_HEADLESS = "false"
$env:CHROME_CHANNEL = "chrome"
$env:CHROME_USER_DATA_DIR = "D:\C_Project\chrome_mcp_server\.profiles\active\default"
npm.cmd run start:stdio
```

### 2. 连接已有远程调试 Chrome

先手工启动浏览器：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="D:\C_Project\chrome_mcp_server\.profiles\active\default"
```

再启动服务：

```powershell
$env:CHROME_BROWSER_URL = "http://127.0.0.1:9222"
npm.cmd run start:stdio
```

安全说明：

- 这种模式下，`close_browser` 只会断开服务连接，不会关闭你手工打开的浏览器。
- 这种模式下，`close_page` 默认会被阻止，避免误关你当前会话中的真实标签页。

### 3. 连接已有 WebSocket 端点

```powershell
$env:CHROME_WS_ENDPOINT = "ws://127.0.0.1:9222/devtools/browser/xxxxx"
npm.cmd run start:stdio
```

## 接入 Codex

示例配置见 [examples/codex.config.toml](examples/codex.config.toml)。

最简 `stdio` 示例：

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

`http` 示例：

```toml
[mcp_servers.chrome_browser]
url = "http://127.0.0.1:3000/mcp"
startup_timeout_sec = 20
tool_timeout_sec = 120
```

## 接入 OpenClaw

示例配置：

- [examples/openclaw-stdio.json](examples/openclaw-stdio.json)
- [examples/openclaw-http.json](examples/openclaw-http.json)

仓库提供了一个薄包装脚本，用来规避 Windows PowerShell 5.1 下 JSON 传参容易丢引号的问题：

- [scripts/openclaw-mcp-set.mjs](scripts/openclaw-mcp-set.mjs)

查看当前配置：

```powershell
openclaw.cmd mcp list
```

设置 `stdio`：

```powershell
npm.cmd run openclaw:set:stdio
openclaw.cmd mcp show chrome-browser --json
```

设置 `http`：

```powershell
npm.cmd run openclaw:set:http
openclaw.cmd mcp show chrome-browser --json
```

删除配置：

```powershell
openclaw.cmd mcp unset chrome-browser
```

## 回归与测试

当前自动化回归主入口：

- [scripts/verify-plan-smoke.mjs](scripts/verify-plan-smoke.mjs)

当前这条 smoke 已覆盖：

- 遮挡层关闭和空白区关闭
- 结果卡片打开计划
- 媒体播放计划
- `click_and_wait` 状态变化
- `ref` 精确命中与重绑定
- 容器自动下探主链接
- 命中测试与安全坐标点击
- 输入值验证、焦点变化验证

真实站点与业务模板样例见：

- [tests/web-tasks/README.md](tests/web-tasks/README.md)

说明：

- `tests/web-tasks/*.json` 当前是任务样例和规格沉淀，不是已经接好的通用执行器入口。
- 目前真正稳定的自动回归入口仍然是 `verify-plan-smoke`。
- 仓库已补基础 CI，默认会在 Windows 环境顺序执行 `build -> verify:plan-smoke`。

## 错误结果

工具执行失败时，当前返回的是结构化错误文本，而不是松散字符串。

典型形态：

```json
{
  "error": {
    "code": "action_verification_failed",
    "message": "动作验证失败（重试 1 次后仍未通过）：...",
    "details": {
      "attempts": 1
    }
  }
}
```

当前已经稳定区分的错误类别包括：

- `action_verification_failed`
- `blocked_by_verification`
- `auth_required`
- `external_page_close_blocked`
- `invalid_operation`

## 支持与发布

最小运行环境：

- Node.js `>=20`
- 本机可用的 Chrome 渠道或可连接的远程调试 Chrome
- Windows PowerShell 5.1 / PowerShell 7 均可，但建议命令统一使用 `npm.cmd`

版本口径：

- 当前仓库更适合按 `1.x` 的“工程化 Beta / 内测版”来理解，而不是完全开放的多租户浏览器平台。
- 发布前至少执行一轮 `build + verify:plan-smoke`，并核对 README、示例配置和回归说明是否同步。

变更记录：

- 见 [CHANGELOG.md](CHANGELOG.md)

## 文档索引

文档入口：

- [docs/README.md](docs/README.md)

重点文档：

- 架构主方案：
  - [docs/architecture/浏览器动作架构重构方案.md](docs/architecture/浏览器动作架构重构方案.md)
- 实施与收口：
  - [docs/architecture/浏览器动作重构实施方案.md](docs/architecture/浏览器动作重构实施方案.md)
- 代码结构与架构对应：
  - [docs/architecture/项目结构与整体架构对应关系.md](docs/architecture/项目结构与整体架构对应关系.md)
- 实战回归清单：
  - [docs/testing/实战检验清单.md](docs/testing/实战检验清单.md)

## 当前边界

目前已经做好的，是浏览器主链和主要回归夹具。

目前还没有完全做成通用产品化能力的，主要有：

- `tests/web-tasks/*.json` 的统一执行器尚未落地
- 下载管理、文件落盘、报告写回还没有形成稳定公共主链
- 真实站点上的验证页、登录门槛和反爬挑战，仍然需要保留人工接管能力
- `http` 模式当前是单会话串行，不适合作为多客户端并发浏览器池

## 开发建议

如果你要继续往下做，当前最推荐的方向是：

1. 继续用真实站点回归新主链，而不是再回到旧 selector 思路堆规则。
2. 把成功经验优先沉淀到夹具、`verify-plan-smoke` 和 `README`，不要只停留在临时对话里。
3. 如果要继续做任务驱动执行，单独补一条 `src/testing/` 主线，而不是把任务执行逻辑塞回浏览器主链。
