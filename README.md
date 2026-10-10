# AutoTools

A local desktop Agent built with Electron, LangChain JS, React, Ant Design and Ant Design X.

The chat home invokes video scanning/moving, device and application queries, and WebView debugging.
The two manual tool pages share the same execution services.
File mutations and device configuration changes show a concrete preview and require approval.

## Chat Responses

Assistant responses use Ant Design X Bubble, Think, ThoughtChain, CodeHighlighter and Actions.Copy,
with XMarkdown for headings, lists, tables, quotes and streaming Markdown. User messages stay plain text.
Real provider `reasoning_content` and streamed `<think>` blocks appear in a separate collapsible section;
tool execution steps show only actual local execution records. No thinking content is invented.
Unfinished, cancelled or failed thinking is marked interrupted. Existing plain-text histories remain readable.

Copying a response copies its answer Markdown, not its reasoning. Raw HTML is escaped, only HTTP(S)
links are clickable, and Markdown images do not load remote resources automatically. There is no
automatic regenerate/replay action, because repeating a request could repeat a file or device mutation.

## Model Connection

Open **Model Settings** in the desktop app, enter an OpenAI-compatible API base URL (usually ending
in `/v1`), model name and API Key, then save and test the connection. The test separately checks
plain responses, streaming and a harmless tool call. Tool mode is enabled only after a successful
tool-call test. Manual tools work without a model connection.

Conversation content and limited tool-result summaries are sent to the configured provider.
Full video lists are retained locally. Keys use Electron's system
encryption; when encryption is unavailable, keys last only for the current process.
Conversations, model history and tool records live in `agent-data.json` (lowdb) under Electron's user data directory.
Model configuration and encrypted keys live in `agent-settings.json` (electron-store).
The old `agent-state.json` is migrated once and retained with an original-byte backup; damaged or
incomplete migration records are never silently overwritten. See the [layered architecture guide](docs/agent-layering-guide.md).
Set `AUTOTOOLS_USER_DATA` to an existing absolute directory to use a separate profile.

Video date filters use source subdirectory modification time, matching the original tool.
Crash monitoring has been removed. Old `tasks` fields are ignored during loading and are not saved
again; conversations, model configuration and tool history remain intact. Old profiles and backups
are not deleted, and previously exported files are not touched.

## Main Process Layers

The main process follows `IPC -> Service -> Adapter`. `ipc/` validates callers and inputs;
`services/` owns Agent, video, device and WebView workflows; `adapters/` encapsulates Electron,
HDC, Chrome, LangChain, filesystem operations and library-backed persistence. `contracts/`
defines small dependency interfaces, `utils/` holds pure helpers, and `bootstrap/` creates
the shared instances and controls shutdown.

Video scan references belong to one VideoService per application, shared by chat and manual
tools. SessionService clips complete history turns; repositories only perform explicit reads
and writes. Dependency-boundary tests reject native I/O and concrete adapters in services,
and reverse service imports in adapters. See the [reading guide](docs/agent-layering-guide.md).

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:electron
```

`test:electron` launches the built desktop app with a temporary profile and a local fake
OpenAI-compatible provider. It checks configuration, streaming tool calls, approval/rejection,
actual moves of temporary files, history reload, manual navigation and a narrow window.
Screenshots are written to the ignored `test-results/` directory. It does not call a cloud provider
or change a real device. Real-device and provider compatibility still require separate validation.
The smoke also checks rich Markdown, highlighted literal think tags in code, reasoning-field streaming,
thinking cancellation/reload, answer copying, safe links/HTML/images and narrow-window rendering.
It also migrates a legacy profile and performs a real application restart to verify library-backed persistence.
Removed monitoring tools return unknown-tool results, the old route redirects to chat, and stale
monitoring data does not appear in snapshots or the new data file.

Historical design: [Agent specification](docs/superpowers/specs/2026-10-08-local-tool-agent-design.md).
Historical implementation: [Execution plan](docs/superpowers/plans/2026-10-08-local-tool-agent.md).
These records describe the original implementation, including features subsequently removed.
