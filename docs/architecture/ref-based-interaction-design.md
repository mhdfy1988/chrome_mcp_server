# 稳定元素引用（ref）交互机制设计稿

## 1. 背景

当前 `chrome_mcp_server` 的主路已经逐步收成：

1. `page_snapshot`
2. `find_elements`
3. `click`
4. `type_text`
5. `click_and_wait`
6. `screenshot`

但现阶段大多数动作仍主要依赖选择器（selector）。这会带来几个问题：

- 同一轮里反复重新猜元素，容易漂移
- 页面局部变化后，模型可能重新选到另一个“长得像”的元素
- 调试时只能看到 selector，不容易确认“到底点的是哪个快照元素”
- 很难把“先看快照，再点快照里的那个元素”固化成稳定主路

在 Playwright MCP 的实践里，更稳的主机制不是继续堆启发式（heuristics），而是：

- 先生成结构化快照
- 给快照中的元素分配稳定引用（`ref`）
- 后续动作优先消费 `ref`

因此需要为本项目设计一套适合当前代码结构的 `ref` 机制。

## 2. 目标

本设计的目标是：

1. 让后续交互更多基于“快照里的明确元素”，而不是每次重新猜 selector。
2. 让 `click`、`type_text`、`click_and_wait` 等主路工具优先支持 `ref`。
3. 让页面动作的“输入对象”更稳定、更可解释、更便于调试。
4. 为后续更强的动作日志、状态机、守卫和高级工具打基础。

## 3. 非目标

第一版不追求：

- 完整复刻 Playwright MCP 的内部实现
- 跨页面、跨会话、跨重载长期保持同一 `ref`
- 完全抛弃 selector
- 一次性解决 iframe、shadow DOM、虚拟列表等全部复杂场景

第一版只需要做到：

- 在**当前页面快照周期内**，生成可消费的稳定 `ref`
- 让主路动作可以直接吃 `ref`

## 4. 核心原则

### 4.1 先快照，后动作

`ref` 不应凭空产生，而应来自最近一次结构化快照。

也就是说，主路应变成：

1. 先执行 `page_snapshot`
2. 从快照中读取候选元素和 `ref`
3. 后续动作直接使用 `ref`

### 4.2 `ref` 优先，selector 兜底

主路工具应优先支持：

- `ref`

在以下情况下再退回 selector：

- 当前没有可用快照
- `ref` 已失效
- 调用方明确只提供 selector

### 4.3 `ref` 作用域有限

第一版 `ref` 应只保证在这几个边界内稳定：

- 同一页面实例
- 同一轮快照结果
- 页面未发生彻底重建或导航切换

不要求跨导航、跨新页、跨重启仍保持同一个 `ref`。

### 4.4 `ref` 是面向动作的，不是面向展示的

`ref` 的主要作用不是给人看“编号好不好看”，而是：

- 让动作明确落到某个快照元素
- 让日志能对应到“就是这个元素”
- 让后续状态机更容易判断“上一步操作的是谁”

## 5. 整体流程

## 5.1 第 1 轮：生成快照

调用：

- `page_snapshot`

输出：

- 页面标题
- 页面摘要
- 可交互元素列表
- 每个元素的：
  - `ref`
  - `selector`
  - `role`
  - `accessibleName`
  - 文本
  - 输入类属性

此时 `ref` 由快照生成器分配，并记录到当前页面会话缓存中。

## 5.2 第 2 轮：选择目标元素

调用方依据快照结果选择目标。

推荐优先级：

1. `ref`
2. 必要时才看 `selector`

例如：

- 输入框：`ref = input-3`
- 提交按钮：`ref = button-5`

## 5.3 第 3 轮：执行动作

例如：

- `click(ref="input-3")`
- `type_text(ref="input-3", text="AI Agent")`
- `click_and_wait(ref="button-5")`

工具内部先尝试按 `ref` 解析真实 DOM 节点。

若解析成功：

- 直接对该节点执行动作

若解析失败：

- 再决定是否退回 selector
- 或返回“ref 已失效，请重新获取快照”

## 5.4 第 4 轮：动作后观察

动作完成后，继续沿用现有观察机制：

- 当前页变化
- `popup`
- 新 `target`
- 活动页切换
- 页面数量变化

最终返回：

- 真正发生变化的页面
- 与动作 `ref` 对应的元素摘要

## 6. 关键输入输出

### 6.1 快照输入

- 当前页面
- `maxElements`
- 页面上下文

### 6.2 快照输出

```json
{
  "title": "页面标题",
  "elements": [
    {
      "ref": "input-3",
      "selector": "input.nav-search-input",
      "role": "textbox",
      "accessibleName": "",
      "text": "",
      "placeholder": "-超级小能猫-"
    }
  ]
}
```

### 6.3 动作输入

主路动作建议支持：

- `ref`
- `selector`（兜底）

例如：

```json
{
  "ref": "button-5"
}
```

或：

```json
{
  "selector": "a.nav-searchBtn.js-nav-searchBtn"
}
```

### 6.4 动作输出

建议逐步增强为：

```json
{
  "ok": true,
  "usedRef": "button-5",
  "resolvedSelector": "a.nav-searchBtn.js-nav-searchBtn",
  "changedPageId": "page-4",
  "changed": true
}
```

## 7. 状态如何变化

### 第 1 轮

- 页面初始加载
- 调用 `page_snapshot`
- 状态进入：`snapshot_ready`

### 第 2 轮

- 选择某个元素 `ref`
- 状态进入：`target_resolved`

### 第 3 轮

- 执行动作
- 状态进入：`action_triggered`

### 第 4 轮

- 观察页面变化
- 若成功，进入：`page_changed`
- 若 `ref` 失效，进入：`ref_invalid`
- 若页面变化过大且节点已不存在，进入：`snapshot_stale`

### 第 5 轮

- 如果是 `ref_invalid` 或 `snapshot_stale`
- 重新执行 `page_snapshot`
- 进入新一轮快照周期

## 8. `ref` 的生成与存储

第一版建议采用“会话内映射”方案，而不是复杂的长期 ID。

### 8.1 生成方式

快照生成时，为当前快照中的可交互元素顺序分配 `ref`，例如：

- `link-1`
- `input-2`
- `button-3`

命名规则不需要追求花哨，重点是：

- 在当前快照结果内唯一
- 带一点元素类别信息
- 便于日志阅读

### 8.2 存储方式

在页面会话缓存里维护：

- `pageId`
- `snapshotId`
- `ref -> selector`
- `ref -> 元素摘要`

第一版不建议直接存活的 `ElementHandle` 作为长期主索引，因为：

- 页面变化后容易失效
- 生命周期管理更复杂

第一版更稳的是：

- 以快照时生成的稳定 selector 或节点定位信息作为解析材料
- 动作时再解析一次

### 8.3 失效条件

以下情况可直接判为 `ref` 失效：

- 页面导航到了不同文档
- 当前活动页已切换到另一个页面
- 对应 selector 已无法解析到节点
- 节点已不可见且不再可操作

## 9. 与 selector 的关系

`ref` 不是为了完全取代 selector，而是为了改变默认主路。

推荐关系是：

- 对外主路：`ref`
- 内部兜底：`selector`

也就是说：

1. 快照阶段暴露 `ref + selector`
2. 调用方优先传 `ref`
3. 工具内部再根据 `ref` 找回 selector 或节点

## 10. 与现有工具的关系

### 10.1 `page_snapshot`

应成为 `ref` 的主要来源。

### 10.2 `find_elements`

可以继续存在，但其返回结果也应补上 `ref`，避免它只给 selector。

### 10.3 `click` / `type_text` / `click_and_wait`

应逐步演进为：

- 优先吃 `ref`
- 保留 `selector` 兼容

### 10.4 `find_primary_inputs`

不应成为 `ref` 系统的主来源。  
它仍是兜底工具，不应反过来主导整个交互模型。

### 10.5 `submit_input`

同样不应成为 `ref` 主路的一部分。  
它最多只在高级模式里作为失败后的表单级兜底。

## 11. 边界与不变式

至少要守住这些不变式：

1. 没有最近一次快照时，不应凭空制造 `ref`
2. `ref` 只对所属页面和所属快照周期负责
3. 页面发生重大变化后，宁可要求重新快照，也不要静默点错元素
4. 动作返回应优先说明“真正变化的页面”，而不是只说旧页
5. `ref` 机制不能绕过现有的人类优先主路

## 12. 第一版实现建议

第一版建议只做这些：

1. 在 `page_snapshot` 和 `find_elements` 的输出里加 `ref`
2. 为当前页面维护一份会话内 `ref` 映射
3. 让 `click`、`type_text`、`click_and_wait` 支持 `ref`
4. 当 `ref` 失效时，明确返回需要重新获取快照

这样就已经能把主路从“猜 selector”推进到“先看快照，再点 ref”。

## 13. 后续增强

后续可以继续做：

1. 把 `ref` 编号在 viewport / 全页快照间尽量保持一致
2. 增加更细的动作日志，把每一步动作都关联到 `ref`
3. 引入更直接的节点定位材料，而不仅是 selector
4. 在高级模式下增加 `run_code`，作为复杂站点的逃生门
5. 再考虑更复杂的 iframe、shadow DOM、虚拟列表场景

## 14. 结论

`ref` 机制的意义，不是再造一个漂亮编号系统，而是把主路真正收成：

- 先看快照
- 再选快照里的元素
- 再对这个明确元素做动作

这样我们就能逐步减少：

- 重新猜 selector
- 误点相似元素
- 过早进入启发式兜底

第一版先做“快照产出 `ref` + 主路动作支持 `ref`”，已经足够把交互模型往更稳的方向推一大步。
