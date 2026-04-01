# 自主网页测试任务规范

这份文档用来约定“让代理自主打开真实网站、执行操作、发现偏差并留证”的任务写法。

目标有 3 个：

1. 让测试步骤足够清楚，减少代理自行脑补。
2. 让每一步都有明确成功信号，避免“看起来像成功”。
3. 当预期和实际不一致时，能够稳定产出可复查的偏差记录。

## 适用场景

- 搜索流程冒烟测试
- 登录后基础操作检查
- 页面跳转、弹窗、局部刷新验证
- 回归测试中的人工操作模拟

## 不适用场景

- 会真实改生产数据、删数据、停服务、下单、付款的高风险操作
- 没有明确成功标准的探索式测试
- 需要专业抓包、压测、接口 Mock 的测试

## 编写原则

1. 每一步只描述一个关键动作。
2. 每一步都写清楚“成功信号”，不要只写“看看是否正常”。
3. 每个任务都要写“禁止动作”。
4. 如果页面依赖登录、前置数据或环境开关，必须写在前置条件里。
5. 如果某一步允许多种页面结果，也要提前写明允许分支。

## 推荐任务结构

建议一个任务文件至少包含这些字段：

- `taskName`
- `baseUrl`
- `goal`
- `preconditions`
- `forbiddenActions`
- `defaults`
- `steps`
- `reporting`

### 字段说明

#### `taskName`

任务名称，建议短而明确。

#### `baseUrl`

测试入口地址。

#### `goal`

这次测试想验证什么。

#### `preconditions`

执行前提，例如：

- 已登录
- 使用测试账号
- 当前页面已有某类测试数据
- 不需要登录

#### `forbiddenActions`

明确禁止代理执行的动作。建议始终写上。

常见示例：

- `delete`
- `restart`
- `stop`
- `shutdown`
- `submit_real_order`
- `pay`

#### `defaults`

任务默认策略，例如：

- 是否优先用 `page_snapshot + find_elements`
- 是否允许直接用 selector
- 单步超时
- 是否必须截图留证

#### `steps`

测试步骤数组。每一步建议包含：

- `id`
- `name`
- `action`
- `targetHint`
- `input`
- `expect`
- `evidence`
- `notes`

#### `reporting`

约定失败时需要记录哪些内容。

## 步骤级字段建议

### `action`

建议使用面向行为的名字，而不是底层工具名，例如：

- `open_page`
- `search_flow`
- `click_button`
- `switch_tab`
- `logout`

如果要直接约束工具调用，也可以写得更细：

- `click_and_wait`
- `type_text`
- `wait_for`

### `targetHint`

给代理一个“找元素”的提示，而不是强绑定单个 selector。

好例子：

- 顶部搜索框
- 页面右上角登录按钮
- 结果区域里的“查看更多”

不推荐只写：

- `.btn-primary`

### `expect`

这里是任务最关键的部分。建议写成“主成功信号 + 补充信号”。

可用信号包括：

- `selectorVisible`
- `textContains`
- `urlContains`
- `titleContains`
- `changeType`
- `successSignal`
- `pageSource`
- `domChanged`

推荐优先级：

1. `selectorVisible`
2. `textContains`
3. `urlContains`
4. `titleContains`
5. `changeType`
6. `successSignal`

### `evidence`

建议至少支持：

- `screenshot`
- `page_snapshot`
- `console_logs`
- `network_logs`

## 偏差记录规则

如果代理操作后的结果与预期不一致，必须记录：

1. 第几步失败
2. 原始预期是什么
3. 实际发生了什么
4. 当前页面标题和 URL
5. `changeType`
6. `successSignal`
7. `domObservation`
8. 截图路径
9. 如果有价值，再附 `console_logs` / `network_logs`

不要把“勉强像成功”记成成功。

## 推荐执行策略

1. 先 `open_page` / `navigate`
2. 再 `page_snapshot`
3. 必要时 `find_elements`
4. 再执行点击、输入、等待
5. 每个关键步骤都回读一次结果
6. 失败时立刻留证，不要连续做多步再回头猜

## 推荐判断口径

### 成功

命中了任务里约定的主成功信号。

### 偏差

动作执行了，但页面行为和预期不一致。例如：

- 预期同页刷新，实际弹新页
- 预期出现结果区块，实际只改了标题
- 预期跳转结果页，实际仍停留原页

### 失败

动作没完成，或者没有任何可信成功信号。

## 示例任务文件

参考：

- [smoke-task.example.json](/d:/C_Project/chrome_mcp_server/tests/web-tasks/smoke-task.example.json)

## 后续可扩展方向

如果后面要做自动跑任务，可以在这个规范上继续加：

- `allowedBranches`
- `retryPolicy`
- `credentialsRef`
- `postChecks`
- `artifactsDir`
- `severity`
