# 主进程职责分层设计

日期：2026-10-10

状态：设计已实施，独立审查修复及全部验证已完成，main 集成正在收尾。设计源码基线为 `main` 的 `f6deff0`，崩溃监控已删除。实际分层说明见 `docs/agent-layering-guide.md`，执行与审查记录见对应实施计划。

## 1. 目标与范围

用户希望从 IPC 调用开始，清楚区分接口适配、核心业务和基础设施，并使用 `ipc`、`services`、`adapters`、`utils` 目录。允许增加确有必要的辅助目录，不要求机械套用固定层数。

本次覆盖主进程的 Agent、视频、设备查询、WebView 调试、原生窗口能力及数据访问。目标是让代码位置、依赖方向和状态归属一致，不是给现有函数增加一层转发类。

保留以下行为：

- 前端和 preload 的 API、IPC 通道、快照字段以及现有 11 个工具名称不变。
- 对话流式输出、think 拆分、原生 reasoning、历史裁剪、取消和保存时机不变。
- 文件移动和设备配置变更仍需一次性审批，执行原预览参数；拒绝、取消和失败不自动重放。
- 视频按源子目录修改时间筛选；源文件变化检查、目标不覆盖和部分完成结果不变。
- 设备查询的回退策略、设备选择、端口精确匹配和 WebView 操作顺序不变。
- 配置与业务数据继续使用 electron-store 和 lowdb；文件名、存储版本、迁移备份和密钥保护不变。
- 崩溃监控不恢复。用户未跟踪的 `docs/agent-state-data-design.md` 不修改或提交。

不增加新工具、通用命令执行入口、前端改版、依赖注入框架、全局事件总线、BaseService 或 BaseRepository。

## 2. 当前问题

当前源码已经拆出了聊天、会话、配置、执行记录及快照，但仍有职责交叉：

| 当前位置 | 问题 | 目标归属 |
| --- | --- | --- |
| `ipc/agentIpc.ts` | 内置原生目录对话框，类型依赖 bootstrap | IPC 只负责来源、参数和路由；原生调用移至 Adapter |
| `services/hdcService.ts` | Electron 路径、进程启动、设备协议和应用查询混合 | HDC 技术封装归 Adapter；业务编排归 DeviceService |
| `services/chromeService.ts` | 浏览器发现、profile 目录和进程启动 | Browser Adapter |
| `services/videoService.ts` | 视频规则与文件系统操作混合 | VideoService 保留规则；FileSystem Adapter 提供文件操作 |
| `tools/registry.ts` | 工具注册中持有扫描缓存并执行设备、WebView 流程 | 注册绑定服务；状态和业务移至相应 Service |
| `agent/model.ts` | SDK、请求、协议转换和系统提示词放在一起 | SDK 与协议归 Model Adapter；提示词归 Agent 业务 |
| `infrastructure`、`storage`、`repositories` | 基础设施分散，服务依赖具体存储实现 | 统一到 `adapters`；服务依赖小接口 |

## 3. 方案选择

1. 只迁移文件和修改 import：改动小，但不能解决职责交叉，不采用。
2. 轻量三层加少量依赖接口：让业务、外部访问和组装边界明确，保持现有实现规模，采用。
3. 完整 DDD、统一 Repository 基类和 DI 容器：当前没有对应复杂度，不采用。

接口只用于有真实外部依赖、需要替换或测试隔离的位置。纯计算函数和业务服务之间不强行增加接口。

## 4. 目标目录

```text
src/main/
  ipc/
    agentIpc.ts
    schemas.ts
  services/
    agent/
      chatService.ts
      sessionService.ts
      modelConfigService.ts
      snapshotService.ts
      runner.ts
      history.ts
      toolSummary.ts
      systemPrompt.ts
      recovery.ts
    tools/
      registry.ts
      executor.ts
      toolService.ts
    videoService.ts
    deviceService.ts
    webviewService.ts
    workspaceService.ts
  adapters/
    electron/
      dialogAdapter.ts
      secretVault.ts
      snapshotPublisher.ts
      windowAdapter.ts
    device/
      hdcAdapter.ts
    browser/
      chromeAdapter.ts
    model/
      langchainAdapter.ts
    storage/
      repositories/
        sessionRepository.ts
        executionRepository.ts
        configRepository.ts
      agentDatabase.ts
      settingsStore.ts
      persistenceCoordinator.ts
      schema.ts
      migration.ts
    filesystem/
      fileSystemAdapter.ts
  contracts/
    application.ts
    agent.ts
    video.ts
    ports.ts
  utils/
    paths.ts
    deviceOutput.ts
  bootstrap/
    createApplication.ts
  index.ts
```

目录是职责约定，不要求为空目录创建占位文件。`ports.ts` 初期集中小接口，过大时再按领域拆分；不同时保留旧路径转发壳和新实现。

`src/shared` 继续保存前端、preload、主进程共用的 API/DTO。`contracts` 只保存主进程内部协议、业务类型和外部依赖接口，不复制 shared 类型。

ModelAdapter、WireMessage、ModelEvent、ToolDefinition 和 PreparedTool 等跨层类型放 `contracts/agent.ts`。Model Adapter 不从 Service 文件导入工具类型；Service 和 Adapter 共同依赖 contracts。

## 5. 依赖方向

运行调用链：

```text
renderer -> preload -> IPC -> Service -> Adapter -> 原生 API / SDK / 存储库
```

编译依赖规则：

- IPC 可以依赖 `ipcMain`、IPC 类型、参数 schemas、shared DTO 和服务入口契约；不依赖具体 Adapter、数据库、Runner 或 bootstrap。
- Service 可以依赖其他 Service、contracts、shared DTO、纯 utils 和纯标准库功能；不能 import Electron、文件系统 I/O、child_process、LangChain、lowdb、electron-store，也不能直接使用 fetch。
- Adapter 实现 contracts 中的接口，可以依赖原生 API 或第三方库；不依赖 Service 的具体类、IPC 或 bootstrap。
- utils 只包含无 I/O、无全局业务状态的纯函数；不创建客户端、数据库或服务实例。
- bootstrap 是具体实现的组装点，可以依赖各层；任何其他层不得反向依赖 bootstrap。
- index 仅保留 Electron 应用生命周期、启动组装和退出连接；窗口创建与窗口安全事件移入 Window Adapter。

路径、Buffer、URL、AbortSignal、计时器和 ID 生成等纯或运行控制能力不为分层而包装。需要统一的安全规则留在所属业务模块，不统一塞进 utils。

用测试或现有 lint 能力检查实际 import 和外部 I/O 边界，包含动态 import；验证规则本身应有负例，避免只检查目录名。

## 6. 各模块职责

### 6.1 IPC

保留来源检查、参数校验、必要的类型转换和路由转发。IPC 参数 schemas 校验的是输入形状；业务规则仍由 Service 校验，不能因内部调用绕过 IPC 而绕过规则。

目录选择调用 WorkspaceService，再调用 Dialog Adapter。取消目录选择继续返回 null。授权来源由启动入口注入，检查逻辑不能弱化。注册函数继续返回注销函数，退出前停止新命令进入。

服务入口类型放 `contracts/application.ts`，消除 IPC 对组装文件的类型依赖。这里是业务入口契约，不建立通用控制器层。

### 6.2 Agent 与工具协调

ChatService 保留当前执行、并发保护、取消、消息 ID 定向更新及持久化边界。SessionService 保留会话 CRUD 和模型历史。ModelConfigService 保留配置合法性、能力修订、运行中保护、密钥使用与错误脱敏。SnapshotService 只汇总可公开状态并合并发布。

Runner 保留单轮模型与工具循环，不了解 Electron、存储路径或具体 SDK。LangChain Adapter 将 SDK 消息转换为内部协议事件。系统提示词由 Agent 业务生成并交给模型接口；协议级的工具名称映射和 reasoning 字段兼容处理仍属于 Model Adapter。

ToolExecutor 保留参数校验、预览、审批回调、一次性确认和变更执行串行控制。ToolService 保留调用记录、手动执行生命周期和保存可用性检查。

工具 Registry 只声明工具名称、参数 schema、描述、审批类别，绑定业务方法并适配 ToolResult；不创建服务、持有扫描缓存、直接访问设备或启动浏览器。工具的 schema 校验仍有必要：模型工具输入不是 IPC Send 的输入，不能只在 IPC 校验。

### 6.3 视频

VideoService 是扫描缓存的唯一所有者，保留最多 20 个扫描记录、文件 ID、分页和筛选规则。手动页面与 Agent 使用同一个实例，不分别建立缓存。

保留在业务层的规则包括：视频扩展名、日期语义、只扫描源子目录、禁止符号链接目标、只能移动已扫描文件、指纹校验、实际路径校验、冲突命名、不覆盖已有目标、预览后重新检查，以及部分成功与取消结果。

FileSystem Adapter 提供实际路径解析、目录条目、文件元信息、独占复制、目录创建和删除等必要操作。元信息使用内部业务数据，不向服务泄漏 Node Stats/Dirent。复制实现继续使用排他模式，不能将“先检查不存在”当作防覆盖保证。

不把整个旧 videoService 改名为 Adapter：业务决定怎样扫描和移动，Adapter 仅提供可靠文件操作。批准后执行保留原 MovePlan，不重新计算出用户没看到的目标。

### 6.4 设备与 WebView

Hdc Adapter 负责工具路径、选定设备的命令构造、进程生命周期、超时、输出限制和 HDC/系统输出兼容。对服务暴露有限的具名设备能力，不向 IPC 或模型暴露任意 shell 命令。

DeviceService 负责设备查询、选定设备在线校验以及应用查询流程。设备协议的解析可以使用纯 utils；回退调用必须沿用 AbortSignal，取消后不得启动下一条查询。

WebviewService 负责探测顺序、部分结果、调试属性变更、端口冲突检查、移除转发和打开端点的前置条件。端口精确匹配可使用纯解析函数；端口转发变更仍由 ToolExecutor 统一审批。

Chrome Adapter 负责浏览器路径探测、独立 profile 和实际启动。默认浏览器打开使用 Electron Adapter 的能力。Service 决定打开哪个已验证端点，Adapter 不自行绕过业务校验。

### 6.5 存储与恢复

Repository 保留业务数据集合的访问语义，归入 `adapters/storage/repositories`。服务依赖具名 Repository 接口，不依赖具体 Low 实例或文件数据结构；接口返回副本，保存失败继续向上传递。

业务 record 类型放 contracts；磁盘结构、版本校验、迁移标记放存储 Adapter。ConfigRepository 对业务只暴露配置及加密 Key，不把 migration、backend 或其他存储细节交给 ModelConfigService。

完整轮次裁剪、最多 20 轮等业务策略由 SessionService 或 Agent 的 history 模块负责，Repository 只执行明确的数据读写，不在访问方法内偷偷改变业务策略。

electron-store 同步写入契约继续为 void。配置落盘到内存发布之间不能人为加入 await，也不能重新引入旧地址与新密钥混配的竞态。Service 对前端的 save 仍可返回 Promise，公共 API 不变。

AgentDatabase 继续负责捕获提交副本和顺序写入；PersistenceCoordinator 负责约 1 秒合并、显式提交和失败报告，服务通过小的保存接口调用。只有 bootstrap 管理 flush/dispose。通用原子写入继续交给存储库，不自行实现替代库。

重启后的消息取消、思考中断、旧审批权限清除属于业务恢复规则，迁至 `services/agent` 下的具名恢复模块；磁盘读取和迁移不执行业务工具。bootstrap 在暴露 IPC 前加载数据并应用恢复。

这是代码组织变更，不是数据格式升级：仍使用现有 `agent-data.json`、`agent-settings.json` 和 version 1。旧 `tasks` 字段继续忽略，不恢复已删除的监控。

## 7. 实例与生命周期

bootstrap 为一次应用生命周期创建一组共享实例：一个 AgentDatabase、一个 SettingsStore、相应 Repository、一个 VideoService、设备/WebView 服务、一个 ToolExecutor 和各 Agent 服务。

“单例”表示这些实例由同一个组装入口持有并共享，不在 Adapter 内使用静态 getInstance、不使用模块级服务缓存，也不在 IPC 每次请求时重复创建。测试可以创建互相隔离的应用实例。

SDK 实例是否复用按现有行为保留，不为追求单例缓存跨配置的客户端；每次请求使用同一份配置和密钥快照，不能共用可变全局凭据。

退出顺序保持：注销 IPC、拒绝新执行、取消并等待当前聊天/手动调用、保存并 flush、清理定时器和窗口发布。保留真实 partial/cancelled 结果；错误必须脱敏诊断，不能因目录迁移吞掉失败。

## 8. 验收与测试

当前基线有 60 项测试。只因搬迁而修改 import 或注入夹具，不能删除现有行为断言来取得通过。

必须覆盖：

- 依赖规则：IPC 不触及原生能力；服务不依赖具体 Adapter 或外部 I/O 库；Adapter 不反向 import Service。
- 服务测试不启动 Electron、HDC 或浏览器，不调用真实 provider；使用有限依赖接口替换外部能力。
- 同一应用实例的扫描、分页和移动共享缓存；不同测试实例隔离。
- 源文件变化、目标抢占、同路径、符号链接路径变化、排他复制、取消和部分完成不回归。
- WebView 流程、设备断开、完整端口匹配、查询取消及回退行为不回归。
- 非法来源与参数、一次性审批、拒绝后停止、退出取消和完整工具协议历史不回归。
- 旧 profile 可读取、备份不改变、损坏存储禁止写入、配置竞态与密钥保护不回归。
- 单元测试、两端 tsc、ESLint、生产构建、真实 Electron 开发/生产/Windows 打包 smoke 通过。

真实设备和云端 provider 兼容性仍需独立验证，不以替身测试宣称真实操作成功。文档必须明确哪些检查实际运行。

## 9. 实施组织与交付

顺序原则：先定义最少的契约和依赖检查，再实现外部 Adapter，然后抽取视频/设备/WebView 业务，迁移 Agent 和存储边界，最后切换 bootstrap/IPC 并删除旧实现。具体文件任务与 RED/GREEN 验证在用户确认本文后写入实施计划。

完整验证和独立审查后按用户已确认的流程合并推送 `main`，删除已合并功能分支，不只上传临时分支。不提交用户配置、密钥、构建产物或用户未跟踪文档。

本文只记录设计。用户审阅后才编写实施计划；用户确认计划并选择执行方式后才修改业务源码。
