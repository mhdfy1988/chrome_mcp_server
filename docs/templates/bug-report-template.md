# 网页测试偏差 / BUG 记录模板

用于记录“代理按任务操作后，实际结果和预期不一致”的情况。

## 基本信息

- 任务名称：
- 任务文件：
- 执行时间：
- 测试环境：
- 页面入口 URL：
- 是否登录：

## 步骤信息

- 步骤 ID：
- 步骤名称：
- 本步目标：

## 预期结果

- 预期页面行为：
- 预期成功信号：
- 预期页面位置：

## 实际结果

- 实际发生了什么：
- 当前标题：
- 当前 URL：
- 页面是否切换：

## MCP 观察结果

- `changeType`：
- `successSignal`：
- `pageSource`：

### `observed`

- `navigation`：
- `selector`：
- `title`：
- `url`：
- `dom`：
- `stateChanged`：
- `popup`：
- `target`：
- `pageCountChanged`：

### `domObservation`

- `changed`：
- `mutationCount`：
- `addedNodes`：
- `removedNodes`：
- `textChanges`：
- `attributeChanges`：
- `topSelectors`：

## 证据

- 截图路径：
- 页面快照：
- 控制台日志：
- 网络日志：

## 初步判断

- 问题类型：
  - 页面变更
  - 选择器失效
  - 预期写错
  - 工具行为异常
  - 疑似产品 BUG
- 风险等级：
  - 低
  - 中
  - 高

## 复现说明

1. 
2. 
3. 

## 备注

- 

## 简版示例

```md
- 任务名称：站内搜索冒烟测试
- 步骤 ID：search-submit
- 预期结果：点击“搜索”后，同页出现结果列表
- 实际结果：页面没有出现结果列表，只更新了标题
- changeType：same_page_update
- successSignal：title
- domObservation.changed：false
- 初步判断：页面成功信号定义不足，不能判为通过
```
