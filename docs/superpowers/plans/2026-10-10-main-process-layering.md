# 主进程职责分层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有主进程重构为 IPC、业务服务、基础设施适配器三层，明确状态归属且不改变现有产品行为。

**Architecture:** `IPC -> Service -> Adapter`，共同依赖主进程 contracts；bootstrap 负责组装共享实例，index 负责应用生命周期。先建立契约和适配器，再迁移业务、存储与模型，最后切换入口并删除旧实现，不增加转发壳或 DI 容器。

**Tech Stack:** TypeScript、Electron、Zod、现有 LangChain、electron-store、lowdb；node:test、tsx、TypeScript Compiler API。沿用锁文件，不新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-10-main-process-layering-design.md`

## Global Constraints

- 前端、preload、IPC 通道、AppSnapshot 字段及现有 11 个工具名称不变；不新增任意 shell 入口。
- 保留 think、原生 reasoning、完整工具协议历史、单次审批、串行变更、取消及持久化时机。
- 视频扩展名、按源子目录修改时间筛选、指纹、实际路径、冲突命名、原预览 MovePlan、不覆盖和 partial 结果不变。
- 保留设备回退、选定设备校验、端口精确匹配和 WebView 顺序；真实设备和云端验证不得由替身测试代替。
- 保留 `agent-data.json`、`agent-settings.json`、version 1、迁移备份及 safeStorage；不升级数据格式。
- 保留最多 20 个扫描记录、最多 20 个完整历史轮次、约 1 秒合并保存；配置写入仍为同步 void。
- 目录为 `ipc`、`services`、`adapters`、`utils`，辅以 `contracts`、`bootstrap`；不创建空占位文件、BaseService、BaseRepository 或全局业务实例。
- 保留基线 60 项测试的行为断言；不恢复崩溃监控，旧 `tasks` 字段继续忽略。
- 不修改或提交未跟踪的 `docs/agent-state-data-design.md`；不提交用户配置、密钥或构建产物。
- 每个任务独立 RED/GREEN 和提交；迁移期间旧入口可暂时存在，最终不能有旧路径转发壳或双份活跃业务实现。
- 完整验证与独立审查后合并、推送 `main`，删除本次已合并功能分支；不删除无关分支。

## Review Focus

1. 目标在预览后或检查后被抢占：拒绝覆盖，保留源文件和真实失败记录；任务 3 覆盖预览抢占及复制瞬间抢占。
2. 旧能力探测刚完成就保存新配置：不能混用旧地址与新 Key，写入失败不能发布成功；任务 5、6 覆盖修订保护与请求快照。
3. 设备在步骤间断开、查询在回退前取消：不继续变更或启动回退命令，保留已完成探测结果；任务 2、4 覆盖。
4. 手动工具与聊天工具共享扫描 ID，不同应用相互隔离：只有一个 VideoService 缓存且淘汰上限为 20；任务 3、7 覆盖。
5. 退出期间有审批、部分移动或最终落盘失败：取消并等待，保存真实事实，不重放副作用，不吞掉错误；任务 5、7 覆盖。

## 文件与接口约定

目标文件树以 Spec 第 4 节为准，另增加 `adapters/electron/externalLinkAdapter.ts`，封装默认浏览器打开能力。
现有 `agent` 的运行协调迁往 `services/agent`，现有 `tools` 迁往 `services/tools`，现有存储和 infrastructure 迁往 `adapters`。
`shared` 仍拥有公开 DTO；contracts 不 import services 或 adapters。

以下签名是任务间约定，按所属文件分别定义，不建统一大接口。`Conversation`、`ToolCall`、`ToolResult`、`ModelConfig`、`DateRange` 来自 shared。

```typescript
// contracts/agent.ts: 沿用现有 WireMessage/ModelEvent/ToolDefinition/PreparedTool。
type ModelFactory = (config: ModelConfig, key: string) => ModelAdapter
type ModelProbe = (config: ModelConfig, key: string) => Promise<NonNullable<ModelConfig['capabilities']>>
// 任务 6 将 ModelAdapter.stream 的第四参设为必填。
// stream(messages: WireMessage[], definitions: ToolDefinition[], signal: AbortSignal,
//        systemPrompt: string): AsyncIterable<ModelEvent>
type StoredConfig = Omit<ModelConfig, 'hasKey' | 'keyPersistent'>
interface AgentRecords {
  conversations: Conversation[]
  history: Record<string, HistoryTurns>
  calls: ToolCall[]
}
// contracts/ports.ts
interface SessionRepositoryPort {
  list(): Conversation[]
  get(id: string): Conversation | undefined
  insert(session: Conversation): void
  update(id: string, change: (session: Conversation) => void): void
  delete(id: string): void
  history(id: string): HistoryTurns
  setHistory(id: string, turns: HistoryTurns): void
}
interface ExecutionRepositoryPort {
  calls(): ToolCall[]
  upsert(call: ToolCall): void
  deleteCall(id: string): void
  deleteScope(scope: string): void
}
interface ConfigRepositoryPort {
  readConfig(): { config: StoredConfig; encryptedKey?: string }
  saveConfig(config: StoredConfig, encryptedKey?: string): void
}
interface PersistencePort { schedule(): void; commit(): Promise<void> }
interface FolderDialogPort { selectFolder(): Promise<string | null> }
interface ChromePort { open(url: string): Promise<void> }
interface ExternalLinkPort { open(url: string): Promise<void> }
type FileKind = 'file' | 'directory' | 'symlink' | 'other'
interface FileInfo { kind: FileKind; size: number; mtimeMs: number; dev: number; ino: number }
interface FileSystemPort {
  readDirectory(path: string): Promise<{ name: string; kind: FileKind }[]>
  info(path: string, followLinks: boolean): Promise<FileInfo>
  realPath(path: string): Promise<string>
  makeDirectory(path: string): Promise<void>
  copyExclusive(source: string, destination: string): Promise<void>
  removeFile(path: string): Promise<void>
}
```

`SecretVault` 保留 encrypt/decrypt 契约，放 contracts，不导入 Electron。`AgentData` 在存储 schema 中以 `AgentRecords & { version: 1 }` 定义；迁移标记不进入业务接口。
`contracts/video.ts` 保存现有 Fingerprint、ScannedVideo、Scan、MoveItem、MovePlan；增加 `PublicScan`（Scan 的 files 去掉 fingerprint）及 `ScanPage`（id、files、total、offset、nextOffset）。

## 验证命令约定

当前 PowerShell 的 npm 不在 PATH，直接使用已验证 Node，不依赖全局 npm。任务中的 `TEST <files>`、`CHECK` 是本文缩写，执行时替换为下列命令，不创建包装脚本。

```powershell
# TEST <files>，用实际测试文件名替换 <files>
D:/nodejs/node.exe --import tsx --test <files>
# CHECK：两条都必须 exit 0
D:/nodejs/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json
D:/nodejs/node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json
```

每个提交只 `git add` 该任务列出的文件和确实迁移 import 的文件，审阅 staged diff 后提交；不要 `git add .`。执行前记录 `git status`，读取设计与本计划并复跑全套测试确认基线。

### Task 1: 契约与可验证的依赖规则

**Files:** 创建 `src/main/contracts/{agent,video,ports,application}.ts`、`tests/helpers/architectureRules.ts`、`tests/architecture-rules.test.ts`；修改现有 `agent/contracts.ts`、`tools/executor.ts` 及引用这些类型的主进程和测试文件，完成类型迁移后删除旧 contracts 文件。

**Interfaces:** 消费 shared DTO；产出上述小接口。`ApplicationServices` 用结构化方法类型定义 IPC 需要的 sessions.create、chat.send/deleteSession/cancel、tools.execute/confirm、config.save/testConnection、snapshots.snapshot、workspace.selectFolder，不引用具体 Service。bootstrap 返回完整具体服务对象以保留内部测试能力，同时满足该入口契约。

入口方法的签名沿用当前服务：create(): Promise<string>、send(id: string, text: string): Promise<void>、deleteSession(id: string): Promise<void>、cancel(): void、execute(name: string, input: Record<string, unknown>): Promise<ToolResult>、confirm(id: string, approved: boolean): void、save(input: { baseURL: string; model: string; key?: string }): Promise<ModelConfig>、testConnection(): Promise<ModelConfig>、snapshot(): AppSnapshot、selectFolder(): Promise<string|null>。不要将 preload 的异步 IPC 包装返回类型误用为内部服务返回类型。

- [ ] **Step 1: 写依赖规则负例测试。** `violations(path: string, source: string): string[]` 用 TypeScript AST 分析 import、export-from、动态 import、require 和直接网络调用；断言：

```typescript
assert.notEqual(violations('src/main/services/bad.ts', "import { readFile } from 'node:fs/promises'").length, 0)
assert.notEqual(violations('src/main/services/bad.ts', "await import('electron-store')").length, 0)
assert.notEqual(violations('src/main/services/bad.ts', 'globalThis.fetch(url)').length, 0)
assert.notEqual(violations('src/main/adapters/bad.ts', "import type { ChatService } from '../services/agent/chatService'").length, 0)
assert.notEqual(violations('src/main/ipc/bad.ts', "import { dialog, ipcMain } from 'electron'").length, 0)
assert.deepEqual(violations('src/main/services/good.ts', "import { join } from 'node:path'"), [])
```

- [ ] **Step 2: 运行 `TEST tests/architecture-rules.test.ts`，确认缺少 checker 的 RED。** 再实现 checker；对非相对第三方模块按具体库及子路径校验，对内部路径解析归属，区分 Electron 允许的 ipcMain/IPC 类型与 dialog/shell。补 require、裸 fetch、utils I/O、反向 bootstrap 和允许 type import 的对照用例。
- [ ] **Step 3: 迁移类型。** ToolDefinition/PreparedTool 不再定义于 executor；ModelAdapter 暂保留三参 stream，任务 6 再切换四参。现有导入改为 contracts，不留下 re-export 壳；应用入口契约先定义，任务 7 再接入 workspace。
- [ ] **Step 4: 运行 `TEST tests/architecture-rules.test.ts tests/executor.test.ts tests/runner.test.ts` 和 CHECK，预期全部 PASS。** 本任务只验证 checker 本身，最终仓库零违规门禁在任务 7 开启，不能为旧代码加永久白名单。
- [ ] **Step 5: 审阅并提交 `refactor: define main process contracts and boundary rules`。**

### Task 2: 外部能力适配器

**Files:** 创建 `src/main/adapters/filesystem/fileSystemAdapter.ts`、`src/main/adapters/device/hdcAdapter.ts`、`src/main/adapters/browser/chromeAdapter.ts`、`src/main/adapters/electron/{dialogAdapter,externalLinkAdapter}.ts`、`src/main/utils/{paths,deviceOutput}.ts`、`tests/adapters.test.ts`；修改 `src/main/contracts/ports.ts`。旧 hdc/chrome 实现暂由旧 Registry 使用，任务 4 切换后删除；新实现只抽取原生能力，不能复制应用查询业务。

**Interfaces:** `FileSystemAdapter implements FileSystemPort`；`DialogAdapter implements FolderDialogPort`；`ChromeAdapter implements ChromePort`；`ExternalLinkAdapter implements ExternalLinkPort`。
在 contracts/ports 定义 `HdcPort`，返回现有 `HdcExecResult`：`listTargets(signal: AbortSignal)`；其余方法首参 deviceId、末参 signal，包括 `queryBundles(deviceId, variant: 'bm'|'pm'|'bm-user', signal)`、`queryForeground(deviceId, variant: 'aa'|'window', signal)`、`queryProcesses`、`querySockets`、`listForwards`、`enableDebugging`、`createForward(deviceId, port: number, socketName: string, signal)`、`removeForward(deviceId, port: number, signal)`，全部 `Promise<HdcExecResult>`。HdcPort 不暴露 run(args)。
HdcAdapter 构造参数为可选 options，其中 run?: (args: string[], options: { signal?: AbortSignal; timeout?: number }) => Promise<HdcExecResult> 用于协议测试，spawn?: typeof spawn 与 toolchainsBase?: () => string 用于私有进程生命周期测试；这些技术类型只出现在 Adapter，不进入 HdcPort。其他 Adapter 构造时接受所封装原生方法的测试替身，默认值为现有原生实现。

- [ ] **Step 1: 写适配器测试。** 实际临时文件先写 destination='other' 后执行独占复制：`await assert.rejects(files.copyExclusive(source, destination)); assert.equal(await readFile(destination, 'utf8'), 'other')`。在 HdcAdapter 构造时注入仅测试用 run 替身，记录 args/signal：`assert.deepEqual(args, ['-t', 'chosen', 'fport', 'tcp:9222', 'localabstract:test']); assert.equal(receivedSignal, signal)`。
- [ ] **Step 2: 运行 `TEST tests/adapters.test.ts`，确认缺少新适配器的 RED。**
- [ ] **Step 3: 实现上述 Adapter 签名。** 文件元信息映射为 FileInfo，不返回 Stats/Dirent；copyExclusive 使用 COPYFILE_EXCL。HDC raw process 方法为 Adapter 私有能力，保留默认 30000ms、每流 1048576 字符上限、无 shell、windowsHide、监听与定时器清理；AbortSignal 已取消不得启动进程。新增超时/取消/输出上限测试，进程替身不运行真实 HDC。
- [ ] **Step 4: 抽取纯解析。** `hasForwardPort(output: string, port: number): boolean`、`parseTargets(output: string): string[]`、`parseBundles(output: string, variant: 'bm'|'pm'|'bm-user'): string[]`、`parseForeground(output: string, variant: 'aa'|'window'): string|null` 放 deviceOutput；paths 仅承载纯绝对路径与路径比较辅助函数。保留当前解析、去重和排序规则。原生路径发现懒执行，测试注入不能访问真实 Electron app。
- [ ] **Step 5: 测 Dialog 取消返回 null、默认浏览器只收到指定 URL、Chrome 独立 profile 与原启动参数。** 原生 API 通过 Adapter 内测试构造参数替换，不建立公共业务端口的大平台对象；不得在测试中启动浏览器。
- [ ] **Step 6: 运行 `TEST tests/adapters.test.ts tests/device-query.test.ts tests/registry.test.ts` 和 CHECK，预期 PASS；提交 `refactor: isolate native filesystem device and browser adapters`。**

### Task 3: VideoService 拥有视频规则与缓存

**Files:** 重构 `src/main/services/videoService.ts`；修改 `src/main/tools/registry.ts` 让视频工具绑定同一 VideoService，删除 Registry 扫描 Map；修改 `src/main/bootstrap/createApplication.ts`、`tests/video.test.ts`、`tests/registry.test.ts`；创建 `tests/video-service.test.ts`。

**Interfaces:** `new VideoService(files: FileSystemPort)`；`scan(source: string, range: DateRange|null, signal: AbortSignal): Promise<PublicScan>`；`results(scanId: string, offset: number, limit: number, query: string): ScanPage`；`prepareMove(scanId: string, fileIds: string[], target: string): Promise<MovePlan>`；`executeMove(plan: MovePlan, signal: AbortSignal): Promise<ToolResult>`。Registry 的过渡签名为 `createRegistry(video: VideoService): ToolDefinition[]`，bootstrap 显式创建该实例，任务 4 改为依赖对象。

- [ ] **Step 1: 写缓存隔离 RED。** 两个 VideoService 使用同一个实际临时目录：`const found = await first.scan(source, null, signal); assert.equal(first.results(found.id, 0, 10, '').total, 1); assert.throws(() => second.results(found.id, 0, 10, ''))`。完成 21 次扫描后断言第 1 个 ID 过期、第 21 个仍可读；PublicScan 和 ScanPage 不包含 fingerprint。
- [ ] **Step 2: 运行 `TEST tests/video-service.test.ts`，确认旧函数模块不提供 VideoService 的 RED。**
- [ ] **Step 3: 用 FileSystemPort 实现业务。** 保留当前扫描、命名、指纹和 MovePlan 算法，Map 最多 20 项；业务校验保留在服务，results 内部调用同样校验分页参数，不能仅依赖 Registry 的 Zod。Registry 只构造标题/ToolResult，不再保管扫描状态。
- [ ] **Step 4: 保留原 video.test 的五个场景并改用类接口。** 增加复制瞬间抢占测试：包装 copyExclusive，在调用真实独占复制前写入 destination='other'；`assert.equal(result.status, 'failed'); assert.equal(await readFile(destination, 'utf8'), 'other'); assert.equal(await readFile(sourceFile, 'utf8'), 'video')`。断言失败项 copied=false，审批后的路径没有被自动换名。
- [ ] **Step 5: 增加两个文件的部分完成/取消、日期按文件夹 mtime、仅子目录、重名、重复/未知 ID、路径变化场景。** 第一个文件删除后触发取消：`assert.equal(result.status, 'partial'); assert.equal(data.moved.length, 1); assert.equal(data.cancelled, 1)`；用实际临时目录检验源/目标内容。Windows 符号链接不可用时明确 skip 原因，使用可注入 FileSystemPort 补充确定性的路径变化断言，不宣称系统符号链接验证成功。
- [ ] **Step 6: 运行 `TEST tests/video.test.ts tests/video-service.test.ts tests/registry.test.ts tests/executor.test.ts` 和 CHECK，预期 PASS；提交 `refactor: move video policies and scan cache into service`。**

### Task 4: Device/WebView 业务与纯工具注册

**Files:** 创建 `src/main/services/{deviceService,webviewService}.ts`、`tests/{device-service,webview-service}.test.ts`；将 `src/main/tools/{registry,executor}.ts` 移至 `src/main/services/tools`；修改 bootstrap、引用工具的主进程与测试文件；删除 `services/{hdcService,chromeService}.ts`；迁移 `tests/device-query.test.ts` 的断言到新服务接口。

**Interfaces:** `new DeviceService(hdc: HdcPort)`：`list(signal): Promise<string[]>`、`assertOnline(deviceId: string, signal): Promise<void>`、`listApps(deviceId: string, signal): Promise<string[]>`、`foregroundApp(deviceId: string, signal): Promise<string|null>`，signal 均为 AbortSignal。
`new WebviewService(devices: DeviceService, hdc: HdcPort, chrome: ChromePort, external: ExternalLinkPort)`：`probe(deviceId, signal)`、`enableDebugging(deviceId, signal)`、`forwardPort(deviceId, port, socketName, signal)`、`removeForward(deviceId, port, signal)`、`openEndpoint(deviceId, port, browser: 'default'|'chrome', signal)`，全部 `Promise<ToolResult>`，deviceId/socketName 为 string，port 为 number。
`createRegistry(deps: { video: VideoService; devices: DeviceService; webview: WebviewService }): ToolDefinition[]`，不构造依赖。

- [ ] **Step 1: 写具名 HdcPort 替身，不给服务注入任意命令函数。** listTargets 返回 chosen；queryBundles 的 bm 查询触发 controller.abort 后返回失败：`await assert.rejects(devices.listApps('chosen', signal)); assert.deepEqual(queries, ['bm'])`。前台查询同理只调用 aa；保留旧测试的目标设备断言，在 Adapter 测试验证 '-t'。
- [ ] **Step 2: 写探测部分失败 RED。** 进程查询成功，随后 listTargets 返回空：`await assert.rejects(webview.probe('chosen', signal), /设备已断开/)`，断言 querySockets 未执行，保持旧断开错误语义。另外 socket 查询返回 code=-1：`assert.equal(result.status, 'failed'); assert.equal(data.failedStep, 'sockets'); assert.deepEqual(Object.keys(data.completed), ['processes'])`。
- [ ] **Step 3: 运行 `TEST tests/device-service.test.ts tests/webview-service.test.ts`，确认 RED；实现两个服务。** DeviceService 负责 bm -> pm -> bm-user、aa -> window 回退及 30000ms 总查询期限；每次 await 后检查取消。WebviewService 在每个具名设备操作前验证在线，按原顺序返回结果。服务自身校验 deviceId、port、socket，内部调用不能绕过安全规则。
- [ ] **Step 4: 测端口和打开前置条件。** 仅 tcp:92221 时 forwardPort(9222) 可执行，tcp:9222 时拒绝；不存在 9222 转发时 `assert.equal(browserOpens, 0)`。默认/Chrome 收到的 URL 均为 `http://127.0.0.1:9222/json/list`。取消后浏览器与下一设备步骤不得执行。
- [ ] **Step 5: 切换 Registry 与 bootstrap，删除旧设备/浏览器业务实现。** 11 个名称、schema 默认值、描述及 confirm 标记原样保留；转发审批仍在 ToolExecutor。Registry 不 import Electron/Adapter，不含扫描 Map、设备查询回退或探测循环；hasForwardPort 的测试改为 utils 导入。
- [ ] **Step 6: 运行 `TEST tests/device-query.test.ts tests/device-service.test.ts tests/webview-service.test.ts tests/registry.test.ts tests/executor.test.ts tests/runtime-cancel.test.ts` 和 CHECK，预期 PASS；提交 `refactor: extract device and webview workflows from registry`。**

### Task 5: 存储边界与 Agent 状态职责

**Files:** 将 `storage/{agentDatabase,settingsStore,schema,migration,persistenceCoordinator}.ts` 和 `repositories/{sessionRepository,executionRepository,configRepository}.ts` 移至 `adapters/storage` 及其 repositories；将 `infrastructure/{secretVault,snapshotPublisher}.ts` 移至 `adapters/electron`；将 `services/{chatService,sessionService,modelConfigService,snapshotService}.ts` 与 `agent/{runner,history,toolSummary}.ts` 移至 `services/agent`，toolService 移至 `services/tools`，storage/recovery 移至 `services/agent/recovery.ts`；更新 bootstrap 和相关测试/夹具导入。

**Interfaces:** Agent 服务构造参数改用任务 1 的 Repository/Persistence/SecretVault/ModelProbe 小接口，业务服务之间沿用具体类。`recoverAgentData(data: AgentRecords): AgentRecords` 不感知磁盘 version/migration；bootstrap 保留磁盘 version。ConfigRepository.readConfig 不返回 migration。SessionRepository.setHistory 明确写入传入轮次，不隐式截断；ExecutionRepository.deleteCall 用于服务明确清理。

- [ ] **Step 1: 在 `tests/repositories.test.ts` 写策略归属 RED。** 直接 setHistory 写入 21 个完整轮次后 `assert.equal(repository.history(id).length, 21)`，修改读取副本后再次读取内容未变；ConfigRepository：`assert.deepEqual(Object.keys(repository.readConfig()).sort(), ['config', 'encryptedKey'])`（夹具包含密文）。持久化迁移标记仍存在于 SettingsStore。
- [ ] **Step 2: 在 `tests/session-service.test.ts` 用内存 RepositoryPort 写入 21 轮。** `assert.equal(repository.history(id).length, 20); assert.deepEqual(repository.history(id)[0], turns[1]); assert.deepEqual(repository.history(id).at(-1), turns[20])`，每轮 tool_calls 和 tool_call_id 成对保留。运行这两个测试，确认缺少新方法或策略位置错误的 RED。
- [ ] **Step 3: 迁移存储并改服务依赖。** SessionService.appendHistory 使用 setHistory 及业务侧 slice(-20)。ToolService.update 在 upsert 后检查长度>200，仅删除最早可丢弃终态一项，保留旧策略：200 不是强制删除正在执行记录的硬上限；Repository.upsert 不再做策略裁剪。新增 201 条均活跃/包含终态的对照测试。
- [ ] **Step 4: 保留同步写入与恢复规则。** SettingsStore.replace、ConfigRepository.saveConfig 仍返回 void；saveConfig 保留 migration，只更新配置/密文。不在配置保存与内存发布之间增加 await。恢复中断消息/reasoning、清除旧确认能力，不恢复工具执行；Coordinator flush/dispose 仅 bootstrap 使用。
- [ ] **Step 5: 原样保留配置竞态与落盘错误断言。** 运行旧 `a resolved old probe cannot pair an old endpoint with a newly saved key`，仍断言旧 probe rejected、新 URL/密文一致且 capabilities 未被覆盖；写入失败 publications=0；最终落盘失败 effects=1，shutdown 报错且恢复后的消息 status='failed'。原迁移备份 hash、损坏禁止写入、忽略 tasks 的测试不能删。
- [ ] **Step 6: 运行 `TEST tests/repositories.test.ts tests/session-service.test.ts tests/tool-service.test.ts tests/model-config-service.test.ts tests/persistence.test.ts tests/migration.test.ts tests/recovery.test.ts tests/runtime-recovery.test.ts tests/application.test.ts tests/removed-monitor.test.ts` 和 CHECK，预期 PASS；提交 `refactor: separate agent business state from storage adapters`。**

### Task 6: 模型 SDK 与提示词分离

**Files:** 将 `src/main/agent/model.ts` 移至 `src/main/adapters/model/langchainAdapter.ts`；创建 `src/main/services/agent/systemPrompt.ts`；修改 `contracts/agent.ts`、`services/agent/runner.ts`、index 的模型导入、`tests/{runner,model-reasoning}.test.ts`；创建 `tests/system-prompt.test.ts`，更新其余模型夹具签名并删除空的旧 agent 目录。

**Interfaces:** `buildSystemPrompt(now: Date): string` 沿用现有中文规则和本机时间表示。ModelAdapter.stream 第四参 `systemPrompt: string` 必填；Runner 每次模型请求生成并传入。Adapter 保留 `createModel(config: ModelConfig, key: string): ModelAdapter` 与 `testModel(config: ModelConfig, key: string): Promise<NonNullable<ModelConfig['capabilities']>>`；仅协议转换，不生成业务提示词。

- [ ] **Step 1: 写提示词与传参 RED。** `const now = new Date('2026-10-10T00:00:00Z'); assert.ok(buildSystemPrompt(now).endsWith(now.toString()))`；断言旧规则全文一致。Runner 的模型替身记录第四参：`assert.match(prompt, /用户拒绝后停止相关操作/); assert.match(prompt, /当前本机时间/)`，工具后再次请求仍收到提示词。
- [ ] **Step 2: 运行 `TEST tests/system-prompt.test.ts tests/runner.test.ts`，确认 RED；实现上述签名与移动。** LangChain 消息转换中的 SystemMessage 使用传入 prompt；工具名点号/下划线映射、reasoning_content 请求注入、chunk 合并和无效工具参数拒绝保留在 Adapter。
- [ ] **Step 3: 使用本地假 provider 扩展 model-reasoning.test。** 捕获真实 HTTP 请求，断言 SystemMessage 为传入字符串、assistant reasoning 保留、工具名恢复为 video.scan；构造两个不同 config/key 的模型实例，`assert.equal(requestA.authorization, 'Bearer key-a'); assert.equal(requestB.authorization, 'Bearer key-b')`，endpoint 也分别对应，不使用真实密钥或云端。createModel 持有传入配置的副本，调用方后续修改原对象不能更改该请求的地址与密钥组合。
- [ ] **Step 4: 运行 `TEST tests/system-prompt.test.ts tests/runner.test.ts tests/model-reasoning.test.ts tests/reasoning.test.ts tests/chat-service.test.ts tests/runtime-cancel.test.ts` 和 CHECK，预期 PASS；提交 `refactor: isolate langchain transport from agent policy`。**

### Task 7: IPC、窗口、组装切换与完整交付

**Files:** 创建 `src/main/services/workspaceService.ts`、`src/main/ipc/schemas.ts`、`src/main/adapters/electron/windowAdapter.ts`、`tests/architecture.test.ts`；修改 `ipc/agentIpc.ts`、`contracts/application.ts`、`bootstrap/createApplication.ts`、`index.ts`、`tests/{ipc,application}.test.ts`、`tests/helpers/agentFixture.ts`、`tests/electron.smoke.mjs`、`README.md`。删除已无引用的旧目录/文件，更新本文完成标记与验证记录。

**Interfaces:** `new WorkspaceService(dialog: FolderDialogPort)`，`selectFolder(): Promise<string|null>`。`registerAgentIpc(services: ApplicationServices, trusted: (event: IpcMainInvokeEvent)=>boolean, platform: { ipcMain: Pick<IpcMain, 'handle'|'removeHandler'> } = { ipcMain }): ()=>void`。
`WindowAdapter.create(): void`、`isTrusted(event: IpcMainInvokeEvent): boolean`、`hasWindow(): boolean` 持有原窗口及安全事件；构造参数包含当前 preload/renderer/icon 配置。bootstrap 的 ApplicationOptions 增加必填 `files: FileSystemPort`、`hdc: HdcPort`、`chrome: ChromePort`、`external: ExternalLinkPort`、`dialog: FolderDialogPort`；index 提供真实实例，Node 夹具提供替身，保留现有 vault/modelFactory/probe/publish/settingsFactory/executor/diagnose 参数。

- [ ] **Step 1: 写 IPC 与最终依赖门禁 RED。** IPC 测试注入 workspace.selectFolder 返回 null：`assert.equal(await handlers.get(IpcChannels.DialogSelectFolder)!(trustedEvent), null)`；非法来源/参数仍断言服务调用为 0，注销删除全部 handlers。architecture.test 遍历 src/main 的实际 TS 文件，`assert.deepEqual(allViolations, [])`；规则同样涵盖 index 窗口职责、contracts 的反向依赖、utils I/O、静态与动态 import。运行 `TEST tests/ipc.test.ts tests/architecture.test.ts`，记录当前真实违规作为 RED。
- [ ] **Step 2: 切换 IPC 与 WorkspaceService。** schemas 保留 UUID、消息 max65536、工具名 max80 和现有配置输入；IPC 只做验证/转发，不执行 native API，不 import bootstrap。trusted 检查保持主窗口、主 frame、预期 URL 条件；取消选目录仍为 null。
- [ ] **Step 3: 组装共享实例与窗口生命周期。** 同一 bootstrap 创建一份 VideoService 给 Registry，ChatService/手动 ToolService 使用同一 ToolExecutor。WindowAdapter 接收原窗口配置、popup/navigation/key 安全策略；index 保留 whenReady、activate、退出钩子和 assembly，不能放视频/设备业务。窗口在原时机创建，不降低 sandbox/导航防护，不因 Node 服务测试启动 Electron。
- [ ] **Step 4: 写真实应用组合与退出回归。** 在独立 userData 创建 appA/appB；appA 手动 video.scan 后，模型调用 video.results 使用同一 ID 返回清单，appB 用该 ID 返回过期错误。用 ToolCall.status='awaiting_confirmation' 的发布事件等待状态，再调用 shutdown，断言未执行副作用、call 为 cancelled、重启后不能确认旧权限。保留 partial、final disk failure、重复 shutdown 返回同一清理结果的现有/新增断言。
- [ ] **Step 5: 删旧路径并跑完整检查。** `rg` 查找旧 agent/tools/storage/repositories/infrastructure imports，除文档迁移说明外应无残留；运行 `TEST tests/*.test.ts`、CHECK，以及下面 lint/build 命令，预期全部 PASS、exit 0。README 用一条 IPC -> Service -> Adapter 调用链解释目录和状态归属，不新增抽象架构层。

```powershell
D:/nodejs/node.exe node_modules/eslint/bin/eslint.js --cache .
D:/nodejs/node.exe node_modules/electron-vite/bin/electron-vite.js build
D:/nodejs/node.exe tests/electron.smoke.mjs
```

- [ ] **Step 6: 实际运行开发和 Windows 打包 smoke。** 开发使用已确认健康的本地 renderer URL；如现有服务器失效，在空闲端口启动 electron-vite dev，记录 URL，测试完清理自己启动的进程。环境变量仅限本次进程并恢复原值，不改用户配置。

```powershell
$oldRenderer=$env:AUTOTOOLS_SMOKE_RENDERER_URL
$oldExecutable=$env:AUTOTOOLS_SMOKE_EXECUTABLE
$oldPath=$env:PATH
try {
  $env:AUTOTOOLS_SMOKE_RENDERER_URL='http://127.0.0.1:5173'
  D:/nodejs/node.exe tests/electron.smoke.mjs
  $env:AUTOTOOLS_SMOKE_RENDERER_URL=$null
  $env:PATH='D:/nodejs;'+$env:PATH
  D:/nodejs/node.exe node_modules/electron-builder/out/cli/cli.js --win --dir
  $env:AUTOTOOLS_SMOKE_EXECUTABLE='D:/Project/electron_project/auto-tools/dist/win-unpacked/AutoTools.exe'
  D:/nodejs/node.exe tests/electron.smoke.mjs
} finally {
  $env:AUTOTOOLS_SMOKE_RENDERER_URL=$oldRenderer
  $env:AUTOTOOLS_SMOKE_EXECUTABLE=$oldExecutable
  $env:PATH=$oldPath
}
```

预期三个模式都验证真实 Electron 页面、聊天 reasoning、审批后移动临时视频及重启持久化；旧监控入口不存在。HDC/云端仍注明未实机验证。任何测试失败先用 systematic-debugging 定位，不能跳过、削弱断言或只报告构建通过。

- [ ] **Step 7: 独立审查与提交。** 使用 requesting-code-review，请新审查者检查整次重构及五个 Review Focus，修复发现后复跑相关检查。提交 `refactor: wire layered main process and enforce boundaries`；只有实际证据齐全才标记任务完成，记录测试数、smoke 模式与残留限制。
- [ ] **Step 8: 集成 GitHub。** 使用 finishing-a-development-branch，遵循已选流程：合并 main、push origin main，确认本地 HEAD 与远端 main 相等，再删除本次已合并功能分支。若直接在 main 实施则仅推送，不制造分支。最终 git status 应只保留用户原未跟踪文档，不做强制推送或删除无关内容。

## 自审与执行交接

已将设计第 1-9 节映射至上述任务：契约与边界为任务 1/7，外部能力为任务 2，视频为任务 3，设备/WebView/注册为任务 4，Agent 状态与存储恢复为任务 5，模型协议为任务 6，共享实例、退出及交付为任务 7。
五项 Review Focus 均有明确测试；任务间方法名及类型以本计划接口块为准。每个阶段维持现有入口可运行，最终一次切换后清除旧实现，没有永久兼容转发层。

推荐在当前会话按顺序执行，每个任务完成后测试与提交，最后独立审查整次重构；各任务接口依赖较强，无需并行改同一组装入口。计划审阅确认前，不修改业务源码。
