# Agent 主进程分层重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除集中式 AgentRuntime 和手写 JsonStore，建立可以按职责独立理解、测试和替换的 IPC、服务、执行引擎和存储层。

**Architecture:** IPC 仅调用业务服务，ChatService 协调 SessionService、ModelConfigService 和 AgentRunner。Repository 共用一个业务数据库，配置与业务记录分别使用 electron-store 和 lowdb；bootstrap 管理组装、迁移、恢复及退出。

**Tech Stack:** TypeScript、Electron 39、LangChain、Zod、electron-store、lowdb、node:test、Playwright。保持现有 React/Ant Design X 前端。

**Spec:** `docs/superpowers/specs/2026-10-09-agent-layering-design.md`

## Global Constraints

- 保留现有前端 API、快照结构、工具名称、操作确认和手动页面。
- 不做前端视觉改版，不增加并行 Agent、自动重放、会话分页或新的工具。
- 不建立通用 BaseService、BaseRepository、依赖注入容器或全局事件总线。
- 主进程使用 `agent-settings.json` 保存配置，`agent-data.json` 保存业务记录；保留旧 `agent-state.json` 和迁移备份。
- 业务数据库只建立一个实例，共享它的各 Repository 不持有各自的全量文件副本。
- 高频变化沿用约 1 秒合并保存，快照沿用约 80ms 合并发布。
- 明文密钥不进入快照、日志、业务数据库；继续使用 safeStorage，不恢复审批回调或真实运行中的进程。
- smoke 保持临时目录和本地假模型，不调用真实 provider 或设备，不修改用户配置。
- 保留当前构建格式，实际验证 ESM 库在 Electron 开发版和打包版中的加载。
- 在 `codex/agent-layering` 分支工作；不暂存或修改用户的 `docs/agent-state-data-design.md`。完成后提交推送功能分支，未经授权不合并 main。

## Review Focus

1. 删除正在等待确认的会话：等待取消结束，原确认不可再用，独立监控仍保留。归属任务 6。
2. 合并保存等待期间发生配置或手动工具更新：字段不能互相覆盖，失败不能被后续 flush 隐藏。归属任务 2、4。
3. 迁移完成标记存在但目标缺失，以及半途失败后源文件变化：不悄悄覆盖有效数据。归属任务 2。
4. Provider 在 abort 后正常结束迭代，或先有工具效果再保存失败：不报告完整成功、不重新执行工具。归属任务 5、6。
5. 真实 Electron 中 ESM 加载或退出保存失败：不能用纯 Node 的测试结果代替打包验证，退出错误要可诊断。归属任务 7。

## 文件与类型约定

保留 `shared/agent.ts` 中的 UI/IPC DTO。模型协议类型移到 `agent/contracts.ts`，磁盘结构放 `storage/schema.ts`；这两类类型不能再定义于 Runtime。

新增文件按已批准设计目录布局；额外的 `storage/persistenceCoordinator.ts` 只负责合并保存、提交顺序与等待，不实现文件原子写入。`tests/helpers/agentFixture.ts` 组装测试服务，不能成为生产代码的另一个 Runtime。

新增接口使用以下确切类型：

```ts
type HistoryTurns = WireMessage[][]
type StoredConfig = Omit<ModelConfig, 'hasKey' | 'keyPersistent'>
interface AgentData {
  version: 1
  conversations: Conversation[]
  history: Record<string, HistoryTurns>
  calls: ToolCall[]
  tasks: MonitorTask[]
}
interface MigrationRecord {
  kind: 'fresh' | 'legacy'
  sourceHash?: string
  backupPath?: string
}
interface SettingsData {
  version: 1
  config: StoredConfig
  encryptedKey?: string
  migration?: MigrationRecord
}
interface SecretVault {
  encrypt(key: string): string | null
  decrypt(value: string): string
}
type NotifyChanged = () => void
```

`HistoryTurns` 导出于 `agent/contracts.ts`，AgentData/SettingsData/StoredConfig/MigrationRecord 导出于 `storage/schema.ts`，SecretVault 导出于 `agent/contracts.ts`。UI 结构与模型结构保留区别。所有公开读取返回副本；内部更新通过具名方法或数据库拥有的更新回调完成，不向服务泄漏 lowdb 实例。

## 执行前基线

- [ ] 读取 spec、确认 git 状态、按 using-git-worktrees 技能判断是否需要隔离；已有功能分支不自动创建第二份目录，用户的未提交文档保持原样。
- [ ] 运行 `node --import tsx --test tests/*.test.ts`，保存当前 41 项测试的结果；记录开发服务与 Electron PID，不随意终止用户进程。
- [ ] 执行时先通过 Context7 查询库文档；不可用则查官方文档。用 `npm view electron-store version engines`、`npm view lowdb version engines` 验证选定版本；安装时固定兼容版本并提交 lockfile，不顺便升级其他依赖。

### 任务 1：协议、存储结构和恢复规则脱离 Runtime

**Files:** 新增 `src/main/agent/contracts.ts`、`history.ts`、`toolSummary.ts`、`src/main/storage/recovery.ts`、`tests/recovery.test.ts`；修改 `agent/runtime.ts`、`agent/model.ts`、`storage/schema.ts`、`tests/runtime.test.ts`、`runtime-recovery.test.ts`、`model-reasoning.test.ts`。

**Interfaces:**
- `contracts.ts` 导出原 `ModelCall`、`WireMessage`、`ModelEvent`、`ModelAdapter`，不改变协议字段。
- `history.ts` 导出 `boundedHistory(turns: HistoryTurns, current: string): WireMessage[]`。
- `toolSummary.ts` 导出 `summarizeResult(result: ToolResult): string`。
- `schema.ts` 导出上述 AgentData/SettingsData/StoredConfig/MigrationRecord、`LegacyState` 及 `parseLegacy(input: unknown): LegacyState`、`parseAgentData(input: unknown): AgentData`、`parseSettings(input: unknown): SettingsData`。
- `recoverAgentData(input: AgentData): AgentData` 是纯函数；LegacyState 保留旧 v1 文件的 config 和 encryptedKey。

- [ ] 写失败测试 `recovery does not mutate source or restore approval authority`：断言源消息仍为 streaming，恢复消息为 cancelled，reasoningStatus 为 interrupted，历史 confirmationId 消失，任务 canStop=false；记录未知版本校验失败。

```ts
assert.equal(source.conversations[0].messages[0].status, 'streaming')
assert.equal(recovered.conversations[0].messages[0].status, 'cancelled')
assert.equal(recovered.calls[0].confirmationId, undefined)
assert.equal(recovered.tasks[0].canStop, false)
```
- [ ] 运行 `node --import tsx --test tests/recovery.test.ts`，确认失败是新导出未实现。
- [ ] 搬移现有协议、裁剪和摘要逻辑；实现 schemas 和恢复函数，修正导入。旧 Runtime 暂时调用这些模块，不增加旧类型的重复定义。
- [ ] 运行恢复测试和全套测试，要求均通过；确认 `storage/schema.ts` 不再 import runtime。
- [ ] 仅暂存此任务文件并提交 `refactor: separate agent contracts and recovery rules`。

### 任务 2：成熟存储库、Repository 和可重试迁移

**Files:** 新增 `storage/agentDatabase.ts`、`settingsStore.ts`、`persistenceCoordinator.ts`、`migration.ts`，`repositories/sessionRepository.ts`、`configRepository.ts`、`executionRepository.ts`；新增 `tests/repositories.test.ts`、`migration.test.ts`、`persistence.test.ts`；修改 package/lock。旧存储尚不删除。

**Interfaces:**
- `AgentDatabase.open(directory: string): Promise<AgentDatabase>`；`read(): AgentData`、`update(change: (data: AgentData) => void): void`、`commit(): Promise<void>`、`flush(): Promise<void>`。调用 commit 时捕获副本，顺序提交；结构错误不自动清空文件。
- `SettingsStore.open(directory: string): Promise<SettingsStore>`；`read(): SettingsData`、`replace(data: SettingsData): Promise<void>`。生产加载 electron-store，测试可注入符合相同 read/replace 契约的替身；真实加载另由 Electron 测试验证。
- `PersistenceCoordinator(database, reportError)` 提供 `schedule(): void`、`commit(): Promise<void>`、`flush(): Promise<void>`、`dispose(): void`；reportError 参数类型为 `(error: unknown) => void`。
- `SessionRepository(database)` 提供 `list(): Conversation[]`、`get(id: string): Conversation | undefined`、`insert(session: Conversation): void`、`update(id: string, change: (session: Conversation) => void): void`、`delete(id: string): void`、`history(id: string): HistoryTurns`、`appendTurn(id: string, turn: WireMessage[]): void`。
- `ExecutionRepository(database)` 提供 `calls(): ToolCall[]`、`upsert(call: ToolCall): void`、`deleteScope(scope: string): void`、`tasks(): MonitorTask[]`、`replaceTasks(tasks: MonitorTask[]): void`。
- `ConfigRepository(settings)` 提供 `read(): SettingsData`、`saveConfig(config: StoredConfig, encryptedKey?: string): Promise<void>`，必须保留 version 和 migration。
- `prepareStorage(directory: string): Promise<{ database: AgentDatabase; settings: SettingsStore; warnings: string[] }>` 完成迁移后返回；测试可注入存储工厂以模拟写失败。

- [ ] 编写失败测试：多个 Repository 更新不同字段后重开文件，断言会话和 calls 同时存在；原读取副本修改不影响库；第一次提交失败后 flush 必须报告未解决失败，成功重新提交后方可清除。
- [ ] 编写迁移测试：完整 v1 转换、原始备份字节一致、密文原样复制、第二次启动不覆盖新会话、数据写完而设置写失败后重试、完成标记存在但目标缺失/损坏、旧文件 null/非法嵌套/未知版本、备份 hash 与源变化不一致。

```ts
assert.deepEqual(await readFile(backupPath), originalBytes)
assert.equal(settings.read().encryptedKey, legacy.encryptedKey)
assert.equal(reopened.read().conversations.at(-1)?.id, newlyCreatedId)
assert.equal(JSON.stringify(reopened.read()).includes('fake-secret'), false)
```
- [ ] 运行 `node --import tsx --test tests/repositories.test.ts tests/migration.test.ts tests/persistence.test.ts`，确认新接口缺失导致失败，再安装已验证兼容的 electron-store/lowdb 版本。
- [ ] 使用显式 Low/JSONFile adapter 实现数据库，动态加载 ESM；配置使用 electron-store 且禁用点路径。用库处理通用原子写入；提交调度仅保留应用协调，不再写临时文件和 rename。
- [ ] 实现迁移屏障：备份后写业务、写配置、读回校验，最后写 migration；重试使用记录 hash 的同一原始备份。损坏输入保留原件、提供空的内存可读状态与告警；未恢复前持久化命令拒绝并提示，不能覆盖损坏目标或把失败标为 fresh。无源但存在不完整目标时同样拒绝覆盖。
- [ ] 实现 Repository 更新与保存协调，流式 schedule 的约 1 秒窗口不因持续 token 一直延期；低层错误完整传递，业务层再做密钥脱敏。
- [ ] 运行上述测试和全套测试，要求 PASS；真实文件测试不能用 Memory adapter 代替。此阶段旧入口仍保持可用。
- [ ] 提交 `refactor: add library-backed repositories and legacy migration`。

### 任务 3：SessionService 和 ModelConfigService

**Files:** 新增 `services/sessionService.ts`、`modelConfigService.ts`、`infrastructure/secretVault.ts`，`tests/session-service.test.ts`、`model-config-service.test.ts`。

**Interfaces:**
- `SessionService(repository: SessionRepository, executions: ExecutionRepository, persistence: PersistenceCoordinator, changed: NotifyChanged)` 提供 `list(): Conversation[]`、`get(id: string): Conversation | undefined`、`create(): Promise<string>`、`delete(id: string): Promise<void>`、`beginTurn(id: string, text: string): { messageId: string; messages: WireMessage[] }`、`updateMessage(id: string, messageId: string, change: (message: ChatMessage) => void): void`、`appendHistory(id: string, turn: WireMessage[]): void`。
- `ModelConfigService(repository: ConfigRepository, vault: SecretVault, probe: typeof testModel, isBusy: () => boolean, changed: NotifyChanged)` 提供 `initialize(): void`、`snapshot(): ModelConfig`、`credentials(): { config: ModelConfig; key: string }`、`save(input: { baseURL: string; model: string; key?: string }): Promise<ModelConfig>`、`testConnection(): Promise<ModelConfig>`、`sanitize(error: unknown): string`。SecretVault 类型放 agent/contracts.ts，Electron 实现放 infrastructure 文件。

- [ ] 写失败测试：会话 CRUD 和模型 history 分开读取；删除时对应 history/calls 消失但独立任务保留；beginTurn 创建固定 messageId 后其他消息不能被流式回调误改。
- [ ] 写配置失败测试：空白 key、非法 URL、系统加密不可用、解密失败、配置测试期间修订改变、运行中不允许变更；snapshot 与磁盘不包含明文 key，保存失败不返回成功。

```ts
assert.equal(config.snapshot().hasKey, true)
assert.equal(config.snapshot().keyPersistent, false)
assert.equal(JSON.stringify(config.snapshot()).includes('fake-secret'), false)
assert.deepEqual(repository.history(deletedId), [])
```
- [ ] 运行 `node --import tsx --test tests/session-service.test.ts tests/model-config-service.test.ts`，确认失败后实现服务，仅调用 Repository，不引用 BrowserWindow 或 Runtime。
- [ ] 运行上述测试与全套测试，检查配置保存保持 migration，裁剪保留完整轮次。
- [ ] 提交 `refactor: extract session and model configuration services`。

### 任务 4：ToolService 拆出执行记录与手动生命周期

**Files:** 新增 `services/toolService.ts`、`tests/tool-service.test.ts`；修改仅涉及共用类型的 executor 导入，不改审批机制。

**Interfaces:**
- `ToolService(executor: ToolExecutor, repository: ExecutionRepository, persistence: PersistenceCoordinator, changed: NotifyChanged)` 提供 `definitions(): ToolDefinition[]`、`calls(): ToolCall[]`、`confirm(id: string, approved: boolean): void`、`execute(name: string, input: Record<string, unknown>): Promise<ToolResult>`、`executeForTurn(name: string, input: Record<string, unknown>, context: { sessionId: string; signal: AbortSignal; onCall: (call: ToolCall) => void }): Promise<ToolResult>`、`close(): Promise<void>`。

- [ ] 写失败测试：approve 仅执行一次且参数来自原 prepared data；等待确认不挡查询；manual 和会话调用同时更新仍完整保存；close 必须等待 abort 清理，最终记录是真实 partial/cancelled 结果。

```ts
assert.equal(effects, 1)
assert.throws(() => service.confirm(consumedId, true))
assert.equal(repository.calls().find((call) => call.scope === 'manual')?.result?.status, 'partial')
assert.equal(cleanupCompleted, true)
```
- [ ] 运行 `node --import tsx --test tests/tool-service.test.ts tests/executor.test.ts`，新服务测试应先 FAIL。
- [ ] 实现服务；所有调用统一 upsert，已有超过 200 条时仅清理已结束记录的行为保持不变。close 先拒绝新执行再取消等待；executeForTurn 不另外创建手动控制器。
- [ ] 运行工具与全套测试，确认调用保存失败不重放设备操作，下一次显式查询可以观察真实内存结果与告警。
- [ ] 提交 `refactor: extract tool execution service`。

### 任务 5：独立 AgentRunner

**Files:** 新增 `agent/runner.ts`、`tests/runner.test.ts`；现有 `shared/reasoning.ts`、model 和 Executor 保持复用。

**Interfaces:**
- `RunnerInput` 包含 `messages: WireMessage[]`、`model: ModelAdapter`、`definitions: ToolDefinition[]`、`signal: AbortSignal`、`execute: (name: string, args: Record<string, unknown>) => Promise<ToolResult>`。
- `RunnerEvent` 为 `{ type: 'text' | 'reasoning'; text: string }`、`{ type: 'reasoning-status'; status: 'streaming' | 'done' | 'interrupted' }` 或 `{ type: 'finished'; status: 'completed' | 'cancelled' | 'failed'; turn: WireMessage[]; error?: unknown }`。
- `AgentRunner.run(input: RunnerInput): AsyncIterable<RunnerEvent>`，终结事件唯一；没有密钥、会话 ID 或存储依赖。调用方负责错误文案脱敏。

- [ ] 写失败测试：拆分 think、代码中的 literal think、原生 reasoning、12 次工具上限、131072 字节回复上限、120000ms 请求取消、62000 字节续轮限制、无能力时不执行模型工具调用。
- [ ] 写失败测试：第一个工具 rejected/cancelled，后续同响应调用只返回 cancelled 协议结果；provider 在 abort 后无异常完成迭代仍 cancelled；无闭合思考状态 interrupted；超限或失败不丢掉已经产生的显示片段，不自动补跑任何步骤。

```ts
assert.equal(events.filter((event) => event.type === 'finished').length, 1)
assert.equal(finalEvent.status, 'cancelled')
assert.equal(executionCount, 1)
assert.ok(Buffer.byteLength(summarizeResult(largeResult)) <= 8192)
```

计时器边界使用可控时钟或 node:test 的 mock timers，不实际等待 120000ms。
- [ ] 运行 `node --import tsx --test tests/runner.test.ts`，确认失败后迁出 Runtime 的循环；保留既有顺序、历史提交规则和错误时已完成动作的事实，不增加重试。
- [ ] 运行 Runner、reasoning、model-reasoning 及全套测试；若旧 tests 尚依赖 Runtime，先保持它们运行到任务 7 切入口，不能删除行为断言。
- [ ] 提交 `refactor: isolate agent execution runner`。

### 任务 6：ChatService 和只读 SnapshotService

**Files:** 新增 `services/chatService.ts`、`snapshotService.ts`、`tests/chat-service.test.ts`、`snapshot-service.test.ts`。

**Interfaces:**
- `ChatService(sessions: SessionService, config: ModelConfigService, tools: ToolService, runner: AgentRunner, modelFactory: (config: ModelConfig, key: string) => ModelAdapter, persistence: PersistenceCoordinator, changed: NotifyChanged)` 提供 `send(id: string, text: string): Promise<void>`、`cancel(): void`、`deleteSession(id: string): Promise<void>`、`activeSessionId(): string | null`、`close(): Promise<void>`；只有这里持有当前会话控制器和 Promise。
- `SnapshotSources` 包含 `conversations: () => Conversation[]`、`calls: () => ToolCall[]`、`tasks: () => MonitorTask[]`、`config: () => ModelConfig`、`activeSessionId: () => string | null`、`warning: () => string | undefined`。
- `SnapshotService(sources: SnapshotSources, publish: (snapshot: AppSnapshot) => void)` 提供 `snapshot(): AppSnapshot`、`changed(): void`、`dispose(): void`。无存储依赖。

- [ ] 写失败测试：一轮并发保护、activeSessionId 在每条失败路径清除、删除等待确认会话先取消等待再删、旧 confirmationId 不可用、取消对话保留监控、工具完成而最终保存失败不显示完整成功且不会再执行。
- [ ] 写快照失败测试：多次 changed 合并为约 80ms 一次，sequence 增长，读取副本修改不影响源，发布不含 key/history/控制器，dispose 后不再发布。

```ts
assert.equal(chat.activeSessionId(), null)
assert.equal(effects, 0)
assert.throws(() => tools.confirm(oldConfirmationId, true))
assert.equal(published.length, 1) // 可控时钟推进 80ms 后。
```
- [ ] 运行 `node --import tsx --test tests/chat-service.test.ts tests/snapshot-service.test.ts`，确认失败后实现两服务；错误文字统一调用 ModelConfigService.sanitize。
- [ ] 验证 send 中使用 messageId 定向更新；流式变化 schedule，开轮和结束显式 commit，异常无法吞掉持久化失败。Runner 终结事件与保存错误分别处理，不混淆工具结果和对话状态。
- [ ] 运行两服务测试与全套测试，PASS 后提交 `refactor: coordinate chat through focused services`。

### 任务 7：bootstrap、薄 IPC、移除旧实现并交付

**Files:** 新增 `bootstrap/createApplication.ts`、`infrastructure/snapshotPublisher.ts`、`tests/ipc.test.ts`、`application.test.ts`、`tests/helpers/agentFixture.ts`、`docs/agent-layering-guide.md`；修改 `main/index.ts`、`ipc/agentIpc.ts`、README、原 runtime/reasoning 集成测试、`tests/electron.smoke.mjs`；删除 `agent/runtime.ts`、`storage/store.ts`，将 `tests/store.test.ts` 的行为断言移至 persistence 测试。

**Interfaces:**
- `ApplicationServices` 包含 `sessions: SessionService`、`chat: ChatService`、`config: ModelConfigService`、`tools: ToolService`、`snapshots: SnapshotService`；类型放 bootstrap 文件，不包含裸数据库或 Runner。
- `createApplication(options: { userData: string; vault: SecretVault; modelFactory: (config: ModelConfig, key: string) => ModelAdapter; probe: typeof testModel; monitorFactory: (changed: NotifyChanged) => MonitorManager; publish: (snapshot: AppSnapshot) => void }): Promise<{ services: ApplicationServices; shutdown(): Promise<void> }>`。
- `registerAgentIpc(services: ApplicationServices, trusted: (event: IpcMainInvokeEvent) => boolean, platform?: { ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>; selectFolder: () => Promise<string | null> }): () => void` 返回注销函数；测试注入平台替身，生产默认使用 Electron ipcMain/dialog。它不能创建 Application。
- `createSnapshotPublisher(): (snapshot: AppSnapshot) => void` 只封装向存活 BrowserWindow 发送 AgentChannels.Event。

- [ ] 写 IPC 失败测试：每个现有通道参数校验通过后只调用对应服务，未授权来源或非法参数不会调用任何服务；注销后 handlers 消失。删除通道调 ChatService.deleteSession，创建通道调 SessionService.create。
- [ ] 写应用失败测试：迁移完成前不注册可用命令；监控变更安排快照和合并任务保存；退出顺序为停止接收、取消等待调用、停止监控、最终提交、flush、dispose；退出保存失败被记录为脱敏诊断。

```ts
assert.equal(serviceCalls.length, 0) // 来源无效或参数非法。
assert.equal(handlers.has(AgentChannels.Send), false) // 注销后。
assert.ok(shutdownSteps.indexOf('monitor-stop') < shutdownSteps.indexOf('final-commit'))
assert.equal(diagnostics.join('').includes('fake-secret'), false)
```
- [ ] 运行 `node --import tsx --test tests/ipc.test.ts tests/application.test.ts`，确认失败后实现组装入口；固定异步退出错误处理，不能用 allSettled 结果丢弃失败。
- [ ] 将所有旧集成测试改为测试 fixture，保留全部原行为断言；移除 Runtime/JsonStore 和历史兼容转发壳。测试 fixture 只做实例组装，不管理另一份状态。
- [ ] 增加 Electron 迁移 smoke：临时 profile 预置旧 v1 配置/会话/思考与未完成工具，新程序启动后验证新文件与备份，重启后仍可读取；正式 rich-text/移动/审批 smoke 全部保留。
- [ ] 执行 `rg -n 'AgentRuntime|JsonStore|agent/runtime|storage/store' src tests`，要求无旧实现依赖；检查 IPC 不 import Runner/Repository/storage，Repository 不 import services，Runner 不 import Electron/storage/services。
- [ ] 运行全套单元测试、两端 tsc、ESLint 和 electron-vite build，全部 exit 0。执行开发版及生产构建 Electron smoke，再 `electron-builder --win --dir`，使用 AUTOTOOLS_SMOKE_EXECUTABLE 对打包版运行完整 smoke，证明 ESM 库在真实 Electron 里可加载。
- [ ] 编写中文调用路径指南：`Send IPC -> ChatService.send -> SessionService.beginTurn -> AgentRunner.run -> ToolService.executeForTurn -> Repository -> SnapshotService`，包含文件索引、读取/修改状态的边界和迁移失败说明。README 标明存储文件和真实 provider/device 未验证边界，不改现状文档冒充目标已完成。
- [ ] 独立审查整个分支，处理确认问题并复跑受影响验证；执行 `git diff --check`，确认无密钥、用户配置、签名文件或构建产物进入暂存区，提交 `refactor: wire layered agent application and retire runtime`。
- [ ] 启动或复用实际开发服务，报告 URL 和 desktop 启动情况；推送 `codex/agent-layering` 并用远程 SHA 验证。保留分支，不在此计划中自动合并 main。

## 执行方式待选择

建议本会话逐步实施，最后做一次独立整分支审查。这七个任务顺序依赖较强，存储和服务接口共享较多，本会话执行可以减少反复传递上下文。

另一种方式是每任务使用独立子代理实施与审查，检查更频繁，但上下文与审查开销更高。用户审阅计划并选择执行方式后，才安装依赖或修改业务代码。
