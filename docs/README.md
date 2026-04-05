# docs 目录说明

这份索引只负责告诉你“现在该先看哪份文档”，不重复讲实现细节。

## 推荐阅读顺序

如果你要快速理解项目现状，建议按这个顺序看：

1. 顶层说明：
   - [../README.md](../README.md)
2. 浏览器代码分层现状：
   - [../src/browser/README.md](../src/browser/README.md)
3. 架构主方案：
   - [architecture/浏览器动作架构重构方案.md](architecture/浏览器动作架构重构方案.md)
4. 实施与落地收口：
   - [architecture/浏览器动作重构实施方案.md](architecture/浏览器动作重构实施方案.md)
5. 实战回归清单：
   - [testing/实战检验清单.md](testing/实战检验清单.md)

## 目录结构

### `architecture/`

放架构设计、分层重构、配套图和代码结构映射文档。

重点文档：

- [architecture/浏览器动作架构重构方案.md](architecture/浏览器动作架构重构方案.md)
- [architecture/浏览器动作重构实施方案.md](architecture/浏览器动作重构实施方案.md)
- [architecture/项目结构与整体架构对应关系.md](architecture/项目结构与整体架构对应关系.md)
- [architecture/浏览器动作重构整体架构图.svg](architecture/浏览器动作重构整体架构图.svg)
- [architecture/项目结构与整体架构对应图.svg](architecture/项目结构与整体架构对应图.svg)

说明：

- 这部分更多是“为什么这样设计”和“代码应该落在哪一层”。
- 文中保留一些“第一版 / 下一步 / 后续增强”的措辞，是设计演进语境，不等于代码当前不可用。

### `testing/`

放真实站点回归清单、公开网站测试矩阵和任务规格说明。

重点文档：

- [testing/实战检验清单.md](testing/实战检验清单.md)
- [testing/public-web-test-scenario-matrix.md](testing/public-web-test-scenario-matrix.md)
- [testing/web-task-spec.md](testing/web-task-spec.md)

说明：

- `实战检验清单` 是当前最接近“项目真实进度”的测试状态文档。
- `tests/web-tasks/*.json` 目前是任务样例和规格沉淀，不是已经接好的通用执行器入口。

### `templates/`

放模板类文档，例如缺陷记录模板。

- [templates/bug-report-template.md](templates/bug-report-template.md)

### `archive/`

放已经退出主线、但仍保留参考价值的历史整理文档。

- [archive/mcp-incremental-improvements.md](archive/mcp-incremental-improvements.md)

## 当前主线口径

当前项目已经从“重构提案阶段”进入“代码落地 + 回归验证阶段”。

因此建议把文档按下面这层理解：

1. `README.md`
   - 看项目对外能力、启动方式、接入方式、当前边界。
2. `src/browser/README.md`
   - 看当前代码分层和主链落地情况。
3. `architecture/*.md`
   - 看设计背景、层次职责和为什么这样拆。
4. `testing/*.md`
   - 看回归范围、真实站点进度和任务规格。

## 如果你现在要改代码

建议优先看：

1. [../src/browser/README.md](../src/browser/README.md)
2. [architecture/项目结构与整体架构对应关系.md](architecture/项目结构与整体架构对应关系.md)
3. [testing/实战检验清单.md](testing/实战检验清单.md)

这样能先知道：

- 代码现在怎么分层
- 哪些能力已经做完
- 哪些问题已经被真实站点暴露过
- 哪些点已经有夹具或 smoke 保护
