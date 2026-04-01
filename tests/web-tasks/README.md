# 网页测试任务样例清单

当前目录里的任务样例分成两类：

## 公开网站样例

- [wikipedia-search-smoke.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/wikipedia-search-smoke.json)
  说明：验证公开百科站点的搜索和结果页跳转。

- [github-repo-navigation-smoke.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/github-repo-navigation-smoke.json)
  说明：验证 GitHub 仓库页内标签导航。

- [bilibili-search-smoke.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/bilibili-search-smoke.json)
  说明：验证带站内搜索的真实内容站点搜索流程。

- [unsplash-image-search-browse.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/unsplash-image-search-browse.json)
  说明：验证图片站搜索、图片网格和图片详情页打开。

- [vimeo-video-search-browse.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/vimeo-video-search-browse.json)
  说明：验证公开视频站搜索和视频详情页打开。

- [mdn-doc-search-read.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/mdn-doc-search-read.json)
  说明：验证文档搜索、文档正文提取和阅读场景。

- [python-docs-read.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/python-docs-read.json)
  说明：验证技术文档正文页读取和摘要输出场景。

- [hackernews-toplist-scrape-report.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/hackernews-toplist-scrape-report.json)
  说明：验证榜单型页面的数据抓取和 Markdown 汇总。

- [wikipedia-table-extract-report.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/wikipedia-table-extract-report.json)
  说明：验证表格页提取和 Markdown 汇总。

## 通用模板样例

- [generic-login-logout-smoke.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/generic-login-logout-smoke.json)
  说明：适合改成内部系统登录/登出流程。

- [generic-list-filter-refresh.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/generic-list-filter-refresh.json)
  说明：适合验证筛选、切换 tab、同页局部刷新。

- [generic-new-tab-link-smoke.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/generic-new-tab-link-smoke.json)
  说明：适合验证“点击后打开新页/新标签”的场景。

- [smoke-task.example.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/smoke-task.example.json)
  说明：最基础的站点搜索冒烟模板。

- [generic-scrape-and-summary-report.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/generic-scrape-and-summary-report.json)
  说明：适合改造成公告页、榜单页、资料目录页的数据抓取与汇总模板。

## 使用建议

1. 先从公开网站样例里挑一个跑通，验证任务规范和报告链路。
2. 如果要补图片 / 视频 / 文档 / 榜单这几类站型，可以先看 [public-web-test-scenario-matrix.md](/d:/C_Project/chrome_mcp_server/docs/public-web-test-scenario-matrix.md)。
3. 再从通用模板复制一份，改成你自己的页面入口、目标元素提示和成功信号。
4. 对真实业务系统，一定先补 `forbiddenActions`，避免高风险操作。
