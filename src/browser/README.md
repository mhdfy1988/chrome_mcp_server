# `src/browser` 分层说明

这份文档只描述“当前代码已经落成什么样”，不再按历史迁移日志写。

如果你要看设计背景，去看：

- [../../docs/architecture/浏览器动作架构重构方案.md](../../docs/architecture/浏览器动作架构重构方案.md)
- [../../docs/architecture/项目结构与整体架构对应关系.md](../../docs/architecture/项目结构与整体架构对应关系.md)

## 当前目标

`src/browser` 现在的目标不是提供一堆零散工具函数，而是把浏览器主链统一成下面这条流程：

1. 页面事实采集
2. 页面理解与候选发现
3. 目标绑定与稳定重定位
4. 动作预检与执行
5. 动作后变化观察
6. 成功/失败判定
7. 用例编排

## 当前目录

### `session/`

负责会话、页面对象、当前活动页和依赖装配。

关键文件：

- `browser-session.ts`
- `runtime-deps.ts`
- `inspection-deps.ts`
- `deps-factory.ts`

### `state/`

负责统一页面事实和页面状态。

关键文件：

- `dom-primitives.ts`
- `page-snapshot.ts`
- `inspection-text.ts`
- `page-summary.ts`
- `page-state.ts`
- `types.ts`

当前已承接：

- 页面结构化快照
- 页面正文提取底座
- `normal / overlay_blocking / auth_required / blocked_by_verification`

### `discovery/`

负责页面理解、候选元素发现和计划生成。

关键文件：

- `find-elements.ts`
- `find-primary-inputs.ts`
- `find-submit-targets.ts`
- `find-primary-results.ts`
- `media-state.ts`
- `interactive-candidates.ts`
- `dom-accessibility.ts`
- `blocking-overlays.ts`
- `types.ts`

当前已承接：

- 可交互元素发现与排序
- `ref` 生成
- `submitPlan`
- `openResultPlan`
- `playMediaPlan`
- `dismissPlan`
- 容器节点自动下探到主动作元素

### `binding/`

负责稳定目标身份信息。

关键文件：

- `binding-record.ts`
- `binding-registry.ts`
- `dom-selector.ts`
- `dom-metadata.ts`

当前已承接：

- `runtimeNodeKey`
- `fingerprint`
- `contextAnchor`
- `fallbackAnchors`
- 会话内 `ref -> bindingRecord` 映射

### `execution/`

负责动作前预检和底层执行。

关键文件：

- `target-preflight.ts`
- `rebind-target.ts`
- `safe-click.ts`
- `types.ts`

当前已承接：

- `ref` 主路径重绑定
- 点击前命中测试
- 安全坐标点击降级
- 命中栈存在目标时的语义点击软放行
- `ActionAttempt` 的基础动作证据

### `observation/`

负责动作后观察。

关键文件：

- `action-observation.ts`
- `types.ts`

当前已承接：

- URL / 标题 / DOM / popup / new_target / pageCount 变化观察
- 内容就绪等待
- DOM 短时观察摘要

### `judgement/`

负责把观察结果转成成功或失败结论。

关键文件：

- `action-judgement.ts`

当前已承接：

- `changeType`
- `successSignal`
- 失败归因
- 动作验证与重试条件

### `usecases/`

负责对外能力编排。

关键文件：

- `inspection-usecases.ts`
- `interaction-usecases.ts`
- `navigation-usecases.ts`
- `overlay-usecases.ts`
- `submit-usecases.ts`
- `result-usecases.ts`
- `media-usecases.ts`
- `artifact-usecases.ts`
- `action-execution-usecases.ts`
- `usecase-guards.ts`
- `plan-target-ref.ts`
- `plan-target-resolution.ts`
- `types.ts`

当前已承接：

- 对外工具主链
- 执行前守卫
- 通用“执行 + 观察 + 判定”流程
- `PlanTargetRef` 的消费和回退

### `core/`

当前只剩一个基础文件：

- `dom-helpers.ts`

它现在是页面内辅助能力和 `evaluateWithDomHelpers(...)` 的承载点，不再承担业务主链。

## 当前主链是怎么串起来的

以 `click_and_wait` 为例，当前代码路径大致是：

1. `mcp/register-interaction-tools.ts`
2. `browser-manager.ts`
3. `usecases/interaction-usecases.ts`
4. `execution/target-preflight.ts`
5. `execution/safe-click.ts`
6. `usecases/action-execution-usecases.ts`
7. `observation/action-observation.ts`
8. `judgement/action-judgement.ts`

也就是说：

- 目标是谁：`execution`
- 动作怎么点：`execution`
- 点完看到了什么：`observation`
- 到底算不算成功：`judgement`
- 什么时候该重试：`usecases + judgement`

## 当前已经做完的关键能力

### 1. 页面状态分流

不是所有“页面被挡住了”都归到同一种情况。

当前已经分开：

- `overlay_blocking`
- `auth_required`
- `blocked_by_verification`
- `normal`

这让 `dismiss_blocking_overlays`、真实站点验证页和登录墙不再混在一条逻辑里。

### 2. `ref` 主链和稳定重绑定

当前 `page_snapshot` / `find_elements` 返回的 `ref`，后续动作不是简单拿旧 selector 直接点，而是会先尝试：

1. 原 selector
2. `runtimeNodeKey`
3. `fingerprint`
4. `fallbackAnchors`

这样页面轻微刷新后，目标还能尽量绑回去。

### 3. 容器自动下探

当前不会再把 `tr`、`td`、列表项、卡片容器直接当成最终点击目标。

预检里会优先下探到内部更强语义的动作元素，例如：

- 文件名链接
- 标题链接
- 明确按钮

### 4. 点击预检与软放行

点击前会做 hit-test。

当前分成几种情况：

1. 直接命中目标
2. 中心被挡，但边缘仍可点
3. 命中栈里包含目标，只是顶层有轻微遮挡
4. 目标被完全挡住

对应行为：

1. 正常语义点击
2. 安全坐标点击
3. 尝试语义点击软放行
4. 明确报错并返回 `blockedBySelector`

### 5. 动作回执更完整

当前 `ActionAttempt` 已经不只是“执行过 click”。

常见回执字段包括：

- `selector`
- `strategy`
- `fallbackUsed`
- `topElementAtPoint`
- `blockedBy`
- `clickedPoint`
- `submittedBy`
- `formSelector`
- `submitTargetSelector`
- `activeElementMatched`
- `valueVerified`
- `focusChanged`

### 6. 结果判定不再只看 URL

当前 `click_and_wait` / `press_key_and_wait` 返回：

- `changeType`
- `successSignal`
- `contentReady`
- `contentReadySignal`
- `domObservation`

也就是说，系统能区分：

- 同页刷新
- 导航
- popup
- new_target
- 只是内容区晚一点出现

## 当前代码边界

目前这层已经具备稳定主链，但还有 3 条边界要明确：

1. `openResultWithPlan` 和 `playMediaWithPlan` 已在用例层落地，但还没有作为公共 MCP 工具暴露。
2. `tests/web-tasks/*.json` 目前是任务样例，不是已经接好的统一任务执行器。
3. `core/dom-helpers.ts` 仍然存在，说明基础 helper 还没有彻底进一步收口。

## 如果你现在要继续改

建议优先按这个顺序看代码：

1. `src/browser-manager.ts`
2. `src/mcp/*.ts`
3. `src/browser/usecases/`
4. `src/browser/execution/`
5. `src/browser/observation/`
6. `src/browser/judgement/`

如果你是排查“为什么动作没成功”，建议按这个顺序看：

1. `execution/target-preflight.ts`
2. `execution/safe-click.ts`
3. `observation/action-observation.ts`
4. `judgement/action-judgement.ts`

如果你是继续做真实站点回归，建议先看：

- [../../docs/testing/实战检验清单.md](../../docs/testing/实战检验清单.md)
- [../../tests/web-tasks/README.md](../../tests/web-tasks/README.md)
- [../../scripts/verify-plan-smoke.mjs](../../scripts/verify-plan-smoke.mjs)
