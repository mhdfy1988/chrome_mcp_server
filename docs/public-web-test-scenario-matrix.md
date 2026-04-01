# 公开网站测试场景矩阵

这份清单用来补足“不同公司 / 不同页面形态 / 不同动作类型”的公开网站测试样例，方便后续持续回归。

## 已有样例

| 任务 | 站点 | 类型 | 主要覆盖点 |
| --- | --- | --- | --- |
| `wikipedia-search-smoke` | Wikipedia | 百科搜索 | 首页搜索、结果跳转、本地化词条分支 |
| `github-repo-navigation-smoke` | GitHub | 仓库导航 | 标签切换、同页导航、URL 变化 |
| `bilibili-search-smoke` | 哔哩哔哩 | 视频内容站 | 主输入框识别、邻域提交控件、新页结果 |

## 新增样例

| 任务 | 站点 | 类型 | 主要覆盖点 | 当前定位 |
| --- | --- | --- | --- | --- |
| `unsplash-image-search-browse` | Unsplash | 图片站 | 搜索框、图片网格、图片详情页 | 图片浏览 |
| `vimeo-video-search-browse` | Vimeo | 视频站 | 视频搜索、结果列表、视频详情页 | 视频浏览 |
| `mdn-doc-search-read` | MDN | 文档站 | 文档搜索、文章页、正文提取 | 阅读资料 |
| `python-docs-read` | Python Docs | 文档站 | 文档导航、章节定位、正文提取 | 阅读资料 |
| `hackernews-toplist-scrape-report` | Hacker News | 榜单 / 列表 | 列表抓取、排序文本、Markdown 汇总 | 数据抓取 |
| `wikipedia-table-extract-report` | Wikipedia | 表格页 | 表格定位、前几行抽取、Markdown 汇总 | 数据抓取 |
| `generic-scrape-and-summary-report` | 模板 | 通用列表页 | 列表抽取、字段汇总、报告输出 | 模板 |

## 为什么这几类值得测

1. 图片站和视频站容易暴露“卡片可点击但不是原生按钮/链接”的问题。
2. 文档站容易暴露“搜索结果页、文章正文、侧边导航”这类多区块页面定位问题。
3. 榜单和表格页适合测“读取结构化信息”而不是只测点击跳转。
4. 报告型任务能逼着我们把“抓到的数据”真正整理输出，而不是只停在页面截图。

## 推荐优先级

1. 先跑 `unsplash-image-search-browse`、`vimeo-video-search-browse`、`mdn-doc-search-read`
2. 再跑 `hackernews-toplist-scrape-report`、`wikipedia-table-extract-report`
3. 最后把 `generic-scrape-and-summary-report` 改成你自己的内部页面

## 当前状态说明

1. 这批任务文件已经可以作为测试定义和人工 / 半自动回归输入。
2. 其中“抓取数据 -> 输出 Markdown 报告”这类任务，任务定义已经补齐，但临时执行器还没完全自动化到“按 JSON 直接产报告”。
3. 下一步如果继续做，最值得补的是一个通用执行器：支持 `extract_text`、`extract_list`、`write_markdown_report` 这三类动作。
