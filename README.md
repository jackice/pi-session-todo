# @jackice/pi-session-todo

Pi 的 Session 级 TODO 工具与常驻 HUD。项目级 `todo`（`.pi/todos`、`/todos`）保持不变，两者互不迁移、互不同步。

- 基线：Pi `1.6.0`、`@jackice/pi-ui` `0.3.0`、`@earendil-works/pi-tui` `1.6.0`
- 状态：P3 store/tool/HUD 主路径已实现并通过真实 Pi TUI 探针
- 不修改原生 Pi，不接管项目级 TODO，不执行子代理或 Workflow 调度

## 安装

```bash
pi install npm:@jackice/pi-session-todo
```

扩展入口为 `./index.ts`，`@jackice/pi-ui` 与 `@earendil-works/pi-tui` 为 peer dependency。

## 工具

`session_todo` 每次调用只执行一个操作，失败不提交。

| 操作 | 参数 | 行为 |
|---|---|---|
| `init` | `phases`, `mode`, `replace?` | 创建任务树；已有任务时必须显式 `replace=true` |
| `view` | — | 返回当前树与稳定 ID，不改状态 |
| `start` | `taskId` | 设为 `in_progress`；串行模式只允许一个活跃任务 |
| `done` | `taskId` | 显式完成；串行模式自动提升下个 `pending` |
| `drop` | `taskId` | 标记 `abandoned`；当前任务被放弃时自动提升 |
| `rm` | `taskId` | 删除任务；当前任务被删除时自动提升 |
| `append` | `content`, `phaseId?` | 追加 `pending` 任务；无 `phaseId` 时选活跃阶段或最后阶段 |

- `expectedRevision` 可选，用于 compare-and-set。
- `done` 只表示任务显式完成，不代表 Reviewer 通过。
- 串行模式最多一个 `in_progress`；并行模式必须显式 `start`，完成不自动推进。

## 持久化

每次实际状态变化通过 `pi.appendEntry("session-todo", snapshot)` 追加 version 1 快照：

- 先落盘，再发布内存状态；`appendEntry` 抛错时保留原状态并返回工具错误
- 无实际变化（重复 `done`、重复 `start`）不追加、不递增 revision
- `--no-session` 下仅内存可用；首条消息前不会写 session 文件
- `reload`/`new`/`fork`/`switch` 后从当前 branch 反向查找最新合法快照
- `session_tree` 后追加轻量 `session-todo-branch` 标记，固定回退点，避免 switch/reload 后回到旧叶节点
- 最新快照损坏时进入只读降级：仍展示最后可识别快照，拒绝写操作
- 子代理（`PI_SUBAGENT_CHILD=1`）仅允许 `view`，写入返回错误，结果由父 Session 记录
- 上限：50 阶段、200 任务、单任务 500 字、快照 64 KiB

## HUD

- `setWidget("jackice:session-todo", factory, { placement: "aboveEditor" })`
- 高度预算：`total = clamp(rows - 19, 3, 8)`，Panel 边框占 2 行，内容 `total - 2`
- 全部任务完成后默认 60s 隐藏；新任务立即恢复显示
- 命令只改变显示，不改变任务状态：

```text
/session-todo expand
/session-todo collapse
/session-todo show
/session-todo hide
/session-todo status
```

配置：

```bash
# 毫秒；-1 禁用，0 立即隐藏
PI_SESSION_TODO_HIDE_MS=60000
# 或扩展 flag
--session-todo-hide-ms 60000
```

负值 flag 可能被 CLI 当作选项解析，推荐用环境变量禁用。

## 已验证行为

真实 Pi 1.6.0 Tmux PTY：

| 检查项 | 结果 |
|---|---|
| 空状态 HUD | `Session TODO · empty` 固定于编辑器上方 |
| init → start → done | HUD 从 `0/3` 更新到 `1/3`，串行自动提升下个任务 |
| 全部完成 | `3/3`，4s 后 HUD 自动隐藏 |
| Session 重载 | 从 custom entry 恢复 `3/3` HUD |
| `-1` 禁用隐藏 | 12s 后 HUD 仍显示 |
| 写入失败 | `appendEntry` 抛错时工具报错且内存状态不变 |
| 快照损坏 | 只读降级，拒绝写入 |
| parallel | 两个任务同时 `in_progress`，不自动推进；append/rm 后 HUD 正确 |
| 项目级 todo 共存 | 同一进程内 `todo` 列表/claim 与 `session_todo` HUD 同时工作 |
| 分支回退 | navigateTree 后 HUD 回退；标记 entry 使 switch/reload 后仍保持回退状态 |
| 新/切换 Session | 新 Session HUD 为空，切回恢复；同屏仅一个 HUD |
| 取消切换 | `session_before_switch` 取消后 HUD 与 Session 不变 |
| 子代理只读 | `PI_SUBAGENT_CHILD=1` 下写入被拒绝，`view` 可用 |

单元/集成测试：

```bash
pnpm install
pnpm typecheck
pnpm test
```

## 限制

- 子代理通过 `PI_SUBAGENT_CHILD=1` 识别并只读；其他自定义执行器若未设置该变量仍可写
- `/tree` UI 本身的取消路径、切换/回收期间的排队写入尚未补测
- 项目级 `todo` 已真机验证列表、claim 与 status update；仍不迁移、不同步
- 未实现持久授权、Workflow 调度或子代理自动启动
