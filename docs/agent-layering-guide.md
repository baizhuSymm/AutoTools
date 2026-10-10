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
  -> ToolService.executeForTurn：交给原 ToolExecutor 校验、确认、执行
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
| 新增或校验 IPC 参数 | `src/main/ipc/agentIpc.ts` |
| 创建、删除会话，记录消息 | `src/main/services/sessionService.ts` |
| 发送、取消，删除正在执行的会话 | `src/main/services/chatService.ts` |
| 模型配置、连接测试、密钥 | `src/main/services/modelConfigService.ts` |
| 手动工具与会话工具执行记录 | `src/main/services/toolService.ts` |
| 给前端哪些状态、多久发布 | `src/main/services/snapshotService.ts` |
| 模型与工具的执行循环 | `src/main/agent/runner.ts` |
| 模型 SDK 接入 | `src/main/agent/model.ts` |
| 数据集合的读写 | `src/main/repositories/` |
| 文件保存、迁移、恢复 | `src/main/storage/` |
| 实例组装、启动、退出顺序 | `src/main/bootstrap/createApplication.ts` |
| Electron 加密与窗口事件 | `src/main/infrastructure/` |

IPC 不创建 Runtime 或存储。Runner 不知道 BrowserWindow、会话 CRUD 或磁盘。SnapshotService 不保存数据。Repository 不调用工具，也不执行审批。

## 状态怎么修改

服务是业务修改入口；Repository 持有数据访问权限。读取返回副本，修改副本不会修改真实状态。SessionService 用明确的会话 ID 和消息 ID 更新，不假定最后一条消息就是当前目标。

ChatService 持有当前对话的 AbortController；ToolService 持有手动调用的控制器；ToolExecutor 持有一次性确认。它们不属于存储，也不会在重启后复活。

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
