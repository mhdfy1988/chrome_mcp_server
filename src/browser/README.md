# 浏览器分层目录说明

当前 `src/browser` 已基本完成主干迁移。

当前目录分成两部分：

1. 保留中的基础目录
   - `core/`
2. 新分层目录
   - `state/`
   - `session/`
   - `discovery/`
   - `binding/`
   - `execution/`
   - `observation/`
   - `judgement/`
   - `usecases/`

当前原则：

1. 新功能与主实现优先放在新分层目录。
2. `core/` 只保留仍有真实职责的基础装配能力。
3. 当前阶段重点是回归验证与行为收口，不再继续为了迁移而迁移。

## 新目录职责

### `state/`

统一状态快照基础层。

负责：

1. DOM、DOM snapshot、AX、必要样式、几何与交互证据采集
2. 为 `discovery/`、`binding/`、`observation/` 提供统一事实源
3. 页面状态事实与页面摘要拼装

### `session/`

会话与运行时事实层。

负责：

1. `session / target / page` 三层对象管理
2. 目标切换、活动页切换、页面列表、运行时缓存

## 当前已落地到新目录的文件

### 已迁入 `session/`

1. `browser-session.ts`
2. `runtime-deps.ts`
3. `inspection-deps.ts`
4. `deps-factory.ts`

### 已迁入 `state/`

1. `page-snapshot.ts`
2. `page-state.ts`
3. `page-summary.ts`
4. `inspection-text.ts`
5. `dom-primitives.ts`
6. `types.ts`

### 已迁入 `binding/`

1. `binding-registry.ts`
2. `binding-record.ts`
3. `dom-metadata.ts`
4. `dom-selector.ts`

### 已迁入 `discovery/`

1. `interactive-candidates.ts`
2. `find-primary-results.ts`
3. `find-primary-inputs.ts`
4. `media-state.ts`
5. `find-submit-targets.ts`
6. `find-elements.ts`
7. `dom-accessibility.ts`
8. `blocking-overlays.ts`
9. `types.ts`

### 已迁入 `execution/`

1. `target-preflight.ts`
2. `safe-click.ts`
3. `types.ts`

当前已落地：

1. 点击前 `preflight`
2. 安全坐标点击降级
3. `click_and_wait` 第一版 `ActionAttempt` 回执
4. 提交链中点击型提交的第一版 `ActionAttempt` 回执
5. `type_text / press_key / press_key_and_wait` 的第一版动作回执
6. 当前动作回执已开始补充：
   - `topElementAtPoint`
   - `blockedBy`
   - `activeElementMatched`
   - `valueVerified`
   - `submittedBy`
   - `focusChanged`
7. `submitInput` 中的 `form_request_submit / form_submit` 也已补入动作回执
8. 提交类动作回执已开始补充 `formSelector`，覆盖：
   - `enter`
   - `form_request_submit`
   - `form_submit`
   - `nearby_click`
   - `submitPlan` 中的点击步骤
9. 提交类动作回执已开始补充 `submitTargetSelector`，区分：
   - 由输入框本身触发提交
   - 由邻近按钮触发提交
   - 由 `submitPlan` 的点击目标触发提交

### 已迁入 `observation/`

1. `action-observation.ts`
2. `types.ts`

### 已迁入 `judgement/`

1. `action-judgement.ts`

### 已迁入 `usecases/`

1. `action-execution-usecases.ts`
2. `interaction-usecases.ts`
3. `submit-usecases.ts`
4. `overlay-usecases.ts`
5. `navigation-usecases.ts`
6. `inspection-usecases.ts`
7. `artifact-usecases.ts`
8. `usecase-guards.ts`
9. `result-usecases.ts`
10. `media-usecases.ts`
11. `types.ts`

说明：

1. 旧的 `ops/`、`inspect/`、`flow/` 兼容层已经删除，当前代码已直接走新目录。
2. `runActionWithVerification(...)` 已迁入 `usecases/action-execution-usecases.ts`，不再通过历史 `flow/` 入口暴露。
3. `core/dom-helpers.ts` 当前仍保留在 `core/`，但职责已缩到“基础装配层 + evaluate 入口”，不再承载大块发现/绑定逻辑。

### `discovery/`

页面发现层。

负责：

1. 候选元素发现
2. 交互语义归类
3. 候选排序
4. 为 `submitPlan` 生成第一版 `PlanTargetRef`
5. 为 `openResultPlan` 生成第一版 `PlanTargetRef`
6. 为 `playMediaPlan` 中可直接指向主媒体元素的步骤生成第一版 `PlanTargetRef`
7. 为 `dismissPlan` 中的关闭候选和主遮挡根节点生成第一版 `PlanTargetRef`

当前已落地：

1. `findSubmitTargets` 的点击步骤已开始携带稳定目标引用：
   - `ref`
   - `fingerprint`
   - `runtimeNodeKey`
   - `contextAnchor`
   - `fallbackAnchors`
2. `findPrimaryResults` 的 `openResultPlan` 已开始携带同一套稳定目标引用
3. `readMediaState` 的 `playMediaPlan` 已开始给主媒体步骤和明确播放按钮步骤携带同一套稳定目标引用
4. `dismissBlockingOverlays` 的 `dismissPlan` 已开始给关闭候选和 `backdrop_click` 主目标携带同一套稳定目标引用
5. `target-preflight` 已开始在 `ref` 主路径上先做第一版稳定重绑定：
   - 原 selector
   - `runtimeNodeKey`
   - `fingerprint`
   - `fallbackAnchors`

### `binding/`

目标绑定层。

负责：

1. `runtimeNodeKey`
2. `fingerprint`
3. `contextAnchor`
4. `fallbackAnchors`

### `execution/`

动作执行层。

负责：

1. preflight
2. hit-test
3. 动作分发
4. `ActionAttempt` 回执

### `observation/`

结果观察层。

负责：

1. `page / target / session` 变化采集
2. DOM、URL、标题、内容就绪信号收集
3. `OutcomeEvidence` 生成

### `judgement/`

结果判定层。

负责：

1. 成功/失败归因
2. `ActionDecision`
3. 重试条件判断

### `usecases/`

用例编排层。

负责：

1. `click`
2. `click_and_wait`
3. `type_text`
4. `submit`
5. `dismiss_overlay`
6. `page_snapshot / find_elements / extract_text / evaluate`
7. `screenshot` 与调用前守卫
8. `submitWithPlan` 已开始优先消费 `PlanTargetRef`，失败时再回退到 `selector/ref`
9. `dismissBlockingOverlays` 的点击和遮罩点击步骤已开始优先消费 `PlanTargetRef`，不再直接依赖旧 selector
10. `openResultWithPlan` 已开始优先消费 `PlanTargetRef`，把“返回结果计划”推进到“按计划执行结果打开”
11. `playMediaWithPlan` 已开始优先消费 `PlanTargetRef`，把“返回播放计划”推进到“按计划执行播放动作并回读媒体状态”

这层只管动作编排，不直接承载底层页面事实。

## 当前剩余的基础目录

### `core/`

当前只保留仍然有真实职责的基础装配能力，后续优先继续评估是否还能往这些层收口：

1. `state/`
2. `session/`
3. `binding/`

## 当前迁移阶段

1. `state / session / binding / discovery / execution / observation / judgement / usecases` 第一版骨架都已落地。
2. 当前主入口 `browser-manager.ts` 已直接引用 `usecases/`，不再走 `ops/` 主路径。
3. `browser-manager.ts` 底部的 deps 组装也已迁入 `session/deps-factory.ts`，继续朝“纯门面”收口。
4. 当前阶段重点应转向回归夹具与行为验证，而不是继续搬目录。

## 下一步建议

1. 开始做新架构下的真实站点总回归，重点验证 `target-first + stable rebind` 在实战场景里的稳定性。
2. 继续瘦身 `browser-manager.ts`，减少它直接串接过多层的职责。
3. 评估 `core/` 中剩余公共能力是否要继续往 `state / session / binding` 收口。
