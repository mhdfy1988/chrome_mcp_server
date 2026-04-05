# Changelog

## 1.1.0 - 2026-04-05

### Added

- 增加 HTTP 单会话串行执行边界，并在 `/health` 输出基础队列健康信息。
- 增加 MCP 工具统一结构化错误输出。
- 增加浏览器安全策略输出，明确托管浏览器与外接浏览器的关闭行为差异。
- 增加基础 CI 工作流，在 Windows 环境顺序执行 `build -> verify:plan-smoke`。

### Changed

- 外接浏览器模式下，`close_browser` 改为只断开连接，不再关闭用户浏览器进程。
- 外接浏览器模式下，`close_page` 改为默认阻止，避免误关用户标签页。
- `CHROME_MAX_RETRIES` 默认值改为 `0`，非幂等动作默认不再自动重放。
- `verify-plan-smoke` 不再绕过封装直接读取私有运行时依赖。

### Fixed

- HTTP 模式补齐优雅停机，收到 `SIGINT` / `SIGTERM` 时会先停监听再收浏览器资源。
- `close_page` 在没有现有页面时不再隐式创建新页后再关闭。
