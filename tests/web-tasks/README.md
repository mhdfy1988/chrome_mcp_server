# 网页测试任务样例清单

当前目录存放的是“任务样例”和“规格沉淀”，不是已经接好的通用执行器入口。

也就是说：

- 这些 `.json` 适合拿来做真实站点测试说明、任务模板和后续执行器输入
- 目前仓库里真正稳定的自动回归入口仍然是：
  - [../../scripts/verify-plan-smoke.mjs](../../scripts/verify-plan-smoke.mjs)

如果你要看任务文件结构规范，先看：

- [../../docs/testing/web-task-spec.md](../../docs/testing/web-task-spec.md)

如果你要看真实站点进度，先看：

- [../../docs/testing/实战检验清单.md](../../docs/testing/实战检验清单.md)

## 公开网站样例

- [wikipedia-search-smoke.json](wikipedia-search-smoke.json)
  说明：百科站搜索、结果页跳转、词条阅读。

- [github-repo-navigation-smoke.json](github-repo-navigation-smoke.json)
  说明：GitHub 仓库页内导航、文件打开、同页变化。

- [bilibili-search-smoke.json](bilibili-search-smoke.json)
  说明：真实内容站点搜索、结果页、新页或新 target 场景。

- [unsplash-image-search-browse.json](unsplash-image-search-browse.json)
  说明：图片搜索、结果网格、图片详情打开。

- [vimeo-video-search-browse.json](vimeo-video-search-browse.json)
  说明：公开视频搜索、详情页、播放验证。

- [mdn-doc-search-read.json](mdn-doc-search-read.json)
  说明：文档搜索、正文提取和阅读。

- [python-docs-read.json](python-docs-read.json)
  说明：技术文档正文页读取和摘要输出。

- [hackernews-toplist-scrape-report.json](hackernews-toplist-scrape-report.json)
  说明：榜单页抓取和 Markdown 汇总。

- [wikipedia-table-extract-report.json](wikipedia-table-extract-report.json)
  说明：表格提取和 Markdown 汇总。

## 通用模板样例

- [generic-login-logout-smoke.json](generic-login-logout-smoke.json)
  说明：适合改成内部系统登录/登出流程。

- [generic-list-filter-refresh.json](generic-list-filter-refresh.json)
  说明：适合验证筛选、Tab 切换、同页局部刷新。

- [generic-new-tab-link-smoke.json](generic-new-tab-link-smoke.json)
  说明：适合验证“点击后打开新页/新标签”的场景。

- [smoke-task.example.json](smoke-task.example.json)
  说明：最基础的搜索冒烟模板。

- [generic-scrape-and-summary-report.json](generic-scrape-and-summary-report.json)
  说明：适合改造成公告页、榜单页、资料目录页的数据提取与汇总模板。

## 使用建议

1. 先选一个公开网站样例，用人工或半自动方式跑通，验证任务描述是否足够表达页面事实。
2. 再复制一个通用模板，改成你自己的入口、目标提示和成功信号。
3. 对真实业务系统，优先补 `forbiddenActions`，不要让任务文件里出现高风险动作。
4. 如果后面要做统一执行器，建议把它单独落在新的 `src/testing/` 或 `scripts/run-web-task.*` 主线，不要把任务执行逻辑塞回浏览器主链。

## 相关文档

- [../../docs/testing/public-web-test-scenario-matrix.md](../../docs/testing/public-web-test-scenario-matrix.md)
- [../../docs/testing/web-task-spec.md](../../docs/testing/web-task-spec.md)
- [../../docs/testing/实战检验清单.md](../../docs/testing/实战检验清单.md)
