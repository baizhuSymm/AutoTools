# Agent 主进程分层重构设计

日期：2026-10-09

状态：用户已于 2026-10-09 确认设计，待实施计划审阅。本文描述目标架构，不代表已经实施。

## 1. 目标与范围

让维护者能按功能找到代码，明确每份状态由谁修改、业务在哪里执行、数据在哪里保存。重构应减少理解成本，而不是增加只转发方法的类。

本次范围是主进程 Agent、IPC、存储及相关测试。保留现有前端 API、快照结构、工具名称、操作确认和手动页面；不做前端视觉改版，不增加并行 Agent、自动重放、会话分页或新的工具。

成功标准：

- IPC 不创建业务对象、不访问存储、不调用执行引擎。
- AgentRunner 只负责一轮模型与工具循环，不管理会话 CRUD、配置、磁盘或快照。
- 会话、配置、执行状态与快照有明确且唯一的修改入口。
- 通用 JSON 原子写入交给现成库；应用仍负责业务校验、迁移和恢复规则。
- 原有数据可迁移，未完成操作不在重启后自动执行。
- 保留现有行为测试，并新增分层、迁移和存储失败测试。

## 2. 现状问题

`agent/runtime.ts` 集中了会话和模型历史、配置与密钥、恢复、状态发布、保存调度、工具记录及执行控制。`ipc/agentIpc.ts` 同时承担接口注册和应用组装。`storage/schema.ts` 反向依赖 Runtime 中的存储类型。`JsonStore` 自行实现通用文件写入和排队逻辑。

现有 `docs/agent-state-data-design.md` 是当前数据流说明，保留为现状参考，不将目标架构误写成已实现的事实。

## 3. 方案比较与选择

| 方案 | 优点 | 局限 |
| --- | --- | --- |
| 只增加 AgentService 转发 Runtime | 改动少 | 状态所有权和集中职责不变，不采用 |
| 按职责拆服务和 Repository，使用成熟 JSON 库 | 容易阅读、迁移成本可控，匹配当前本地应用 | 大量历史仍有整文件读写成本，本次采用 |
| 分层同时引入 SQLite 和增量查询 | 适合增长的历史和事务查询 | 增加数据映射、打包验证和前端查询改造，本次不采用 |

本次先解决结构和库复用，不声称解决无限增长的数据量问题。Repository 隔离具体存储实现，以后可以单独迁移 SQLite。

## 4. 依赖方向与目录

```text
main/index.ts -> bootstrap/createApplication.ts
IPC -> Service -> AgentRunner / Repository
AgentRunner -> ModelAdapter / ToolExecutor
Repository -> electron-store / lowdb
```

建议目录：

```text
src/main/
  bootstrap/createApplication.ts
  ipc/agentIpc.ts
  services/
    sessionService.ts
    chatService.ts
    modelConfigService.ts
    toolService.ts
    snapshotService.ts
  agent/
    runner.ts
    contracts.ts
    history.ts
    model.ts
    toolSummary.ts
  repositories/
    sessionRepository.ts
    configRepository.ts
    executionRepository.ts
  storage/
    agentDatabase.ts
    settingsStore.ts
    schema.ts
    migration.ts
    recovery.ts
  infrastructure/
    secretVault.ts
    snapshotPublisher.ts
```

保留已有 `tools/`、`tasks/` 和设备/文件服务；不建立通用 BaseService、BaseRepository、依赖注入容器或全局事件总线。使用显式构造参数和少量有实际测试替身需求的接口。

## 5. 职责与状态所有权

| 模块 | 职责 | 禁止承担 |
| --- | --- | --- |
| agentIpc | 注册通道、来源检查、输入结构校验、调用对应服务 | 组装对象、存储操作、Agent 循环 |
| SessionService | 会话 CRUD、消息更新、模型历史提交与裁剪 | 调模型、管理控制器、发布 Electron 事件 |
| ChatService | 单轮并发保护、发送和取消、将 Runner 输出应用到会话、删除活动会话前取消并等待 | 模型协议循环、密钥加密、文件序列化 |
| ModelConfigService | 配置业务校验、保存、能力测试、配置修订检查、请求凭据获取 | 会话或工具执行 |
| ToolService | 手动工具执行、确认入口、执行记录更新、手动任务取消与等待 | 重写 Executor 的审批规则 |
| SnapshotService | 读取服务的公开状态、生成克隆快照、维护 sequence、合并发布 | 修改会话、保存数据、持有密钥 |
| AgentRunner | 每轮上下文、文字/思考解析、工具循环、次数及大小限制 | 应用级状态、存储、Electron API |
| Repository | 对所属数据集合提供明确读写方法，协调存储提交 | 执行业务操作、决定用户审批 |
| bootstrap | 实例创建、依赖连接、恢复顺序、启动与退出 | 会话 CRUD 或模型循环 |

Repository 管理可持久化数据，服务是业务修改入口。业务数据库只建立一个实例，共享它的各 Repository 不持有各自的全量文件副本，避免互相覆盖。调用方获得只读副本，不直接操作 lowdb 的 `data`。

ChatService 拥有当前对话的控制器和 Promise。ToolService 拥有手动执行追踪；ToolExecutor 继续拥有一次性确认和已准备输入。MonitorManager 继续拥有真实监控进程。SnapshotService 的定时器只用于发布，业务保存调度属于存储协调模块。

服务间协调由 bootstrap 显式连接：IPC 删除会话调用 ChatService 的删除用例，由其先取消等待，再调用 SessionService 删除；不用 SessionService 反向依赖 ChatService。工具变化经 ToolService 更新记录，并用明确回调更新当前会话消息，避免各处重复维护工具状态。

## 6. 执行和通知边界

Runner 输入包含本轮模型上下文、已选模型适配器、工具定义、执行入口和 AbortSignal。输出为可判别的事件：正文片段、思考片段、思考状态和最终轮次结果。模型历史随结果返回；工具执行仍通过原 ToolExecutor，不能因拆分绕过确认。

ChatService 负责消费事件、更新 SessionService、请求合并保存和通知状态改变。服务通知使用普通回调；不把业务状态放入 Node EventEmitter 或 SnapshotService。Runner 中的协议类型移到 `agent/contracts.ts`，存储结构移到存储模块；存储校验不再引用 Runner 或 Runtime。

SnapshotPublisher 是唯一知道 BrowserWindow 的发布适配器。SnapshotService 仅依赖发布接口，确保服务和 Runner 可以在纯 Node 测试中使用。

## 7. 存储选型和边界

- 配置：主进程 `electron-store`，文件 `agent-settings.json`，保存配置、能力、加密后的密钥及迁移完成标记。禁用点路径解释，避免未来任意键名被误作路径。
- 业务记录：`lowdb` 的异步 `Low` 与 `JSONFile`，文件 `agent-data.json`，保存版本、会话、模型历史、工具记录和历史任务元数据。使用显式 adapter，不依赖测试环境自动切换内存的 preset。
- 结构校验：继续使用已有 Zod；配置和业务数据各有独立 schema。库负责序列化和原子文件写入，应用负责结构校验与数据迁移。
- 密钥：继续使用 Electron safeStorage。明文只在配置服务内部和模型请求期间存在，不进入快照、日志或业务数据库；系统加密不可用时只保存在内存。
- 两个库均为 ESM，当前主进程构建需验证加载兼容性；优先保持现有构建格式，通过受控的动态加载适配，不为了一个库改造全部入口。打包版加载验证是交付条件。

lowdb 仍序列化整个业务文档，不提供跨文件事务。当前行为保持全量会话加载；本次不增加分页，也不声称低成本支持大量聊天记录。高频变化沿用约 1 秒合并保存，快照沿用约 80ms 合并发布，不在每个 token 到来时立即写盘。

应用只保留薄的写入协调：提交时捕获数据副本、顺序化跨 Repository 提交、合并调度和等待结束。临时文件、rename、通用原子写入不再自行实现。显式命令等待保存完成；保存失败向调用者或快照告警反馈，不吞掉错误或宣称成功。磁盘失败不保证设备操作回滚。

官方依据：

- [electron-store](https://github.com/sindresorhus/electron-store#readme)：面向小型配置，支持原子写入，不是数据库；保持在主进程使用。
- [lowdb](https://github.com/typicode/lowdb#readme)：提供异步 JSON adapter、原子写入及内存 adapter，整文档写入是其明确限制。

## 8. 旧数据迁移与恢复

源文件是现有 `agent-state.json`，版本为 1。迁移不访问真实模型、不解密或打印密钥、不触发工具。

迁移过程：

1. 在应用接收 IPC 命令前读取旧文件，使用现有 v1 schema 校验；不存在时按新安装初始化。
2. 迁移前保留原始字节备份。原文件和备份均不在迁移完成后自动删除。
3. 将配置和 encryptedKey 映射到配置存储，将会话、history、calls、tasks 映射到业务存储；新文件各有独立版本号。
4. 先写并校验业务文件，再写并校验配置文件，最后将迁移完成标记写入配置文件。标记提交前不发布可操作应用、不接受写命令。
5. 标记缺失而部分目标文件已存在时，视作未完成迁移；只允许从同一有效源备份重新执行，不能把它当成新安装。完整标记存在但目标缺失或损坏时，不自动覆盖或静默重新迁移，保留文件并给出恢复告警。
6. 旧数据损坏时保留备份，按现有可用性原则加载空业务状态并明确告警，不覆盖损坏源、不宣称迁移成功。

正常运行时配置和业务记录是独立提交，不承诺两文件事务；业务用例不依赖两者同时变更。仅迁移需要上述完成标记和启动屏障。

恢复规则抽成纯函数并覆盖测试：运行中消息取消、思考标记中止、未完成工具取消、历史 confirmationId 清除、监控标记中断且不能自动重启。历史模型数据保持完整轮次裁剪，不混用 UI 消息与模型协议消息。

正常退出由 bootstrap 排序执行：停止接收新命令，取消并等待对话及手动调用，停止监控，提交最后业务记录和配置写入，等待保存完成，释放快照定时器及通知订阅。退出失败必须有可诊断错误，不能声称数据已保存。

## 9. 可读性和验收

入口使用明确的服务方法名与参数类型。对异步取消、迁移屏障、密钥边界等非显然规则添加简短中文说明；不靠长注释掩盖复杂职责。文档附一条“发送请求”的调用路径，方便学习。

验收包括：

- 每个服务可独立测试；IPC 测试只使用服务替身；Runner 测试使用假模型和执行入口。
- 保留确认一次性、原始执行输入不变、拒绝停止后续操作、文件冲突和取消安全测试。
- 覆盖 v1 完整迁移、重复启动、半途迁移失败、非法数据、目标损坏、加密不可用及旧思考历史。
- 验证并发保存不会覆盖新数据，重启后保存结果可真实读取，不以内存 adapter 代替落盘测试。
- 全套单元测试、主进程/渲染进程类型检查、Lint、生产构建及打包版 Electron smoke 通过。
- smoke 保持临时目录和本地假模型，不调用真实 provider 或设备，不修改用户配置。

禁止通过服务仍转发给原大 Runtime 的方式验收。最终移除 AgentRuntime 和 JsonStore，原有 tests 按新职责迁移；不为保持测试文件不变而保留旧的集中实现。

## 10. 后续阶段

用户确认本文后，编写逐步实施计划，标出先补的行为测试、逐块迁移顺序和每步验证。计划确认并选择执行方式后才安装依赖和修改业务代码。完成后提交、推送功能分支；合并 main 仍需明确授权。
