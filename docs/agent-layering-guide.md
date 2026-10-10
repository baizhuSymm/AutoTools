# Agent 代码分层阅读指南

## 从一个请求开始

用户发送消息的调用路径：

```text
ChatPage
  -> preload 的 window.api.agent.send
  -> agentIpc：检查来源和参数
  -> ChatService.send：并发保护，创建本轮执行
  -> SessionService.beginTurn：添加用户消息和助手消息
  -> AgentRunner.run：调用模型、处理思考、循环调用工具
  -> ToolService.executeForTurn：交给 ToolExecutor 校验、确认、执行
  -> Registry：按工具名称绑定 VideoService / DeviceService / WebviewService
  -> Adapter：执行文件、设备、浏览器等外部操作，返回实际结果
  -> SessionService.updateMessage：根据消息 ID 更新结果
  -> Repository：修改所属数据集合
  -> PersistenceCoordinator：合并保存或显式等待保存
  -> SnapshotService：读取状态、生成副本
  -> SnapshotPublisher：发送 IPC 事件，界面更新
```

同一条消息可以经过多次模型请求和工具调用。展示用消息与模型协议历史是两份不同结构，不能直接互换。

## 各层看哪里

| 你想修改什么 | 主要文件 |
| --- | --- |
| IPC 来源、参数和路由 | `src/main/ipc/agentIpc.ts`、`schemas.ts` |
| 创建、删除会话，记录消息及裁剪完整历史 | `src/main/services/agent/sessionService.ts` |
| 发送、取消，删除正在执行的会话 | `src/main/services/agent/chatService.ts` |
| 模型配置、连接测试、密钥使用规则 | `src/main/services/agent/modelConfigService.ts` |
| 手动工具与会话工具执行记录 | `src/main/services/tools/toolService.ts` |
| 给前端哪些状态、多久发布 | `src/main/services/agent/snapshotService.ts` |
| 模型与工具的执行循环、业务提示词 | `src/main/services/agent/runner.ts`、`systemPrompt.ts` |
| 模型 SDK、reasoning 协议及工具名转换 | `src/main/adapters/model/langchainAdapter.ts` |
| 视频扫描缓存、分页、移动安全规则 | `src/main/services/videoService.ts` |
| 设备在线检查、应用查询回退 | `src/main/services/deviceService.ts` |
| WebView 探测、转发、打开端点流程 | `src/main/services/webviewService.ts` |
| 工具声明、参数 schema、审批类别和绑定 | `src/main/services/tools/registry.ts` |
| 原生文件操作、HDC 进程和 Chrome 启动 | `src/main/adapters/filesystem/`、`device/`、`browser/` |
| 数据集合的读写 | `src/main/adapters/storage/repositories/` |
| 文件保存、结构校验与迁移 | `src/main/adapters/storage/` |
| 中断消息恢复、旧审批权限清除 | `src/main/services/agent/recovery.ts` |
| 实例组装、启动、退出顺序 | `src/main/bootstrap/createApplication.ts` |
| Electron 加密、目录选择、发布与窗口事件 | `src/main/adapters/electron/` |
| 主进程内部协议和外部依赖接口 | `src/main/contracts/` |
| 无 I/O 的路径及设备输出解析 | `src/main/utils/` |

IPC 不创建 Runtime 或存储。Runner 不知道 BrowserWindow、会话 CRUD 或磁盘。SnapshotService 不保存数据。Repository 不调用工具，也不执行审批。

业务服务不能导入 Electron、fs、child_process、LangChain 或具体 Adapter，也不能直接 fetch；Adapter 不能反向导入 Service。`tests/architecture.test.ts` 检查真实源码依赖，规则本身有静态、动态、别名和反向依赖负例。

例如目录选择的链路是 `agentIpc -> WorkspaceService -> DialogAdapter -> dialog.showOpenDialog`。IPC 不处理原生弹窗结果细节，用户取消由 Adapter 映射为 null，公共 API 保持不变。

## 状态怎么修改

服务是业务修改入口；Repository 持有数据访问权限。读取返回副本，修改副本不会修改真实状态。SessionService 用明确的会话 ID 和消息 ID 更新，不假定最后一条消息就是当前目标。

ChatService 持有当前对话的 AbortController；ToolService 持有手动调用的控制器；ToolExecutor 持有一次性确认。它们不属于存储，也不会在重启后复活。

VideoService 持有最多 20 个扫描记录；工具注册表没有扫描 Map。同一 bootstrap 将一个实例绑定到聊天和手动工具，所以两边可以使用同一 scanId；另一个应用实例不能读取这些内存引用。审批执行保留原 MovePlan，不在确认后重新挑选目标文件名。

SessionService 保留最近 20 个完整模型轮次，Repository 不偷偷裁剪历史。ToolService 明确清理超过 200 条时可丢弃的终态记录，不为了达到数量上限删除活动审批。存储结构及展示快照、模型协议历史仍是不同的数据边界。

## 保存到哪里

文件位于 Electron 的 userData 目录：

- `agent-settings.json`：electron-store 保存模型配置、能力和加密后的 Key。
- `agent-data.json`：lowdb 保存会话、模型历史和工具记录。
- `agent-state.json`：旧文件，迁移后仍保留，不再更新。
- `agent-state.json.pre-layering.bak`：迁移前的原始字节备份。

业务数据的 Repository 共用一个数据库实例，不能各自读一个文件副本再覆盖保存。流式更新约每秒合并保存，开始和结束等重要边界显式等待。两个新文件没有跨文件事务；lowdb 仍然整文件序列化，不表示已经支持无限增长的历史。

配置写入使用 electron-store 的同步接口，保存到内存状态发布之间没有异步间隙；连接测试只能更新同一配置修订的能力。手动工具执行前先等待业务记录提交，存储不可用时不会准备工具或产生审批。

## 损坏与退出

迁移的完成标记最后写入。目标缺失、结构错误、源与备份不一致时，不覆盖文件，界面给出告警，持久化操作失败；检查原件和备份后再恢复，不能删除文件来假装迁移成功。

重启将未完成消息和工具标记中止，清除旧 confirmationId。退出先停止命令入口，再取消并等待执行，最后保存并等待写入；保存失败会报告错误，不保证已执行设备动作可以回滚。

## 已移除功能

2026-10-10 删除了崩溃监控页面、Agent 工具、后台进程、流式 IPC 类型和任务保存。旧文件中的 `tasks` 字段加载时忽略，下一次保存不再写入；聊天内容和工具历史继续保留，原始迁移备份及用户导出文件不删除。历史设计文档描述当时的实现，不代表当前功能。

测试使用临时 profile 和本地假模型。真实云端 provider 和真实设备兼容性需要另外验证。
