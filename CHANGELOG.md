# Changelog

## 0.1.0

- 新增 `session_todo` 工具：`init` / `view` / `start` / `done` / `drop` / `rm` / `append`
- 新增 version 1 Session 快照持久化、revision、compare-and-set 与损坏快照只读降级
- 新增串行自动推进、并行显式启动与稳定任务/阶段 ID
- 新增 `aboveEditor` HUD：阶段进度、当前任务高亮、完成/放弃标记、后续阶段折叠
- 新增高度预算 `clamp(rows-19, 3, 8)` 与全部完成后的可配置自动隐藏
- 新增 `/session-todo expand|collapse|show|hide|status`
- 35 个单元/集成测试；真实 Pi 1.6.0 TUI 验证 init/start/done、HUD 更新、自动隐藏、重载恢复
- 新增 `session-todo-branch` 标记，持久化 navigateTree 回退点；switch/new 隔离与取消路径通过
- 子代理（`PI_SUBAGENT_CHILD=1`）写入只读，`view` 可用
- 真机验证 parallel/append/rm、项目级 `todo` 列表与 claim 共存
