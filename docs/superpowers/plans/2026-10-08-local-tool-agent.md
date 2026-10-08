# Local Tool Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a desktop chat Agent that invokes existing local tools with explicit confirmation for mutations and shared monitor tasks.

**Architecture:** Keep business services independent of LangChain. One validated tool executor serves chat and manual pages. Main owns conversations, credentials, approvals, and monitor tasks; renderer consumes snapshots through preload.

**Tech Stack:** Electron, TypeScript, LangChain JS, ChatOpenAI, Zod, React, Ant Design, Ant Design X, Node test runner with tsx.

**Spec:** `docs/superpowers/specs/2026-10-08-local-tool-agent-design.md`

## Global Constraints

- Preserve existing uncommitted title, icon, and monitor button changes.
- OpenAI-compatible configurable endpoint only; no arbitrary shell Agent tool.
- 12 tool calls per turn; 120-second model timeout; 30-second device query timeout.
- Last 20 complete turns and 64 KiB input text; each tool summary at most 8 KiB.
- Monitor retains 500 matching events; 16 KiB line and 64 KiB fragment limits.
- Approvals bind immutable parameters and one invocation; manual routes use the same policy.
- Page navigation does not stop tasks; app exit does. Restart does not replay approvals or start monitors.

## Review Focus

- Target file collision after approval must never overwrite an unrelated file (Task 2).
- Duplicate approval, cancellation, and parallel manual calls must never execute an operation twice (Task 1).
- Multibyte logs split across chunks and process close during stop must preserve state (Task 3).
- Unsupported or malformed tool-call responses must not mutate resources (Task 4).
- Long paths, empty configuration, rejected approval, and reloading during a turn must remain operable (Task 5).

## Task 1: Shared contracts and confirmation executor

**Files:** `src/shared/agent.ts`, `src/main/tools/executor.ts`, `tests/executor.test.ts`.

**Interfaces:** `ToolExecutor.execute(name, input, context): Promise<ToolResult>`; `confirm(id, approved): void`; context contains scope, AbortSignal and an update callback. Tool definitions have input schema, prepare, execute and confirmation policy. Prepared parameters remain server-owned.

- [x] Write tests asserting zero side effects before approval, single-use approval, unchanged approved parameters, and cancellation before approval.
- [x] Run `node --import tsx --test tests/executor.test.ts` and observe missing-feature failure.
- [x] Implement runtime validation, serialized execution, pending approvals, immutable prepared plans and abort handling.
- [x] Run tests; review confirmation IDs and manual caller boundary.

## Task 2: File plans and domain tool registry

**Files:** `src/main/services/videoService.ts`, `src/main/tools/registry.ts`, `tests/video.test.ts`.

**Interfaces:** `scan(source, range): Promise<Scan>`; `prepareMove(scan, fileIds, target): Promise<MovePlan>`; `executeMove(plan, signal): Promise<ToolResult>`; registry produces validated business tool definitions.

- [x] Test copy/delete movement, same-source rejection, stale source, target collision, and partial failure using temporary directories.
- [x] Verify failures, implement async scan and exclusive copy with concrete preview destinations.
- [x] Register video, device, WebView and monitor tools; snake_case provider names map to internal business names.
- [x] Run file tests and executor tests together.

## Task 3: Main-owned monitor tasks and persistence

**Files:** `src/main/tasks/monitor.ts`, `src/main/storage/store.ts`, `tests/monitor.test.ts`, `tests/store.test.ts`; modify `src/main/services/hdcService.ts`.

**Interfaces:** `MonitorManager.start(deviceId, bundleName)`, `stop(taskId)`, `list()`, `snapshot(taskId)`; injected stream factory. Store loads and atomically saves versioned snapshots, protecting secrets separately.

- [x] Test chunk classification, bounded logs, idempotent start/stop, final fragment and early exit with an injected process fixture.
- [x] Test history round-trip and interrupted state repair; watch missing-feature failures.
- [x] Move parser and report generation into task services; add explicit device targets, bounded process output and timeouts.
- [x] Implement serialized atomic JSON, encrypted credential persistence and session-only fallback.
- [x] Run full unit suite.

## Task 4: Model runtime and trusted IPC

**Files:** `src/main/agent/runtime.ts`, `src/main/agent/model.ts`, `src/main/ipc/agentIpc.ts`, `tests/runtime.test.ts`; modify `src/preload/index.ts`, `src/main/index.ts`.

**Interfaces:** runtime owns create/delete/send/cancel session operations and broadcasts `AppSnapshot`; model adapter consumes bounded complete message groups and streams model chunks. Agent tools call Task 1 executor. IPC exposes typed `AgentAPI`.

- [x] Test fake-model tool request through real executor, malformed arguments, rejection and cancellation, bounded context and single active turn.
- [x] Implement LangChain model/tool adapter with sequential tool calls and explicit 12-call budget, stream text and persist conversation groups.
- [x] Add separate text, stream and harmless-tool connection tests; mask credentials in errors.
- [x] Verify sender frame and URL before every IPC request; disable bypass mutation IPC and enforce app shutdown.
- [x] Run unit suite and both TypeScript checks.

## Task 5: Chat, settings and shared manual pages

**Files:** `src/renderer/src/features/agent/*`, `src/renderer/src/pages/ChatPage.tsx`, `SettingsPage.tsx`, existing tool pages, `Layout.tsx`, `App.tsx`, `styles/agent.css`.

**Interfaces:** renderer uses `window.api.agent` commands and snapshots; shared provider owns subscription; Ant Design X Sender and Bubble render product messages; global approval surface covers chat and manual calls.

- [x] Implement settings with masked Key, explicit endpoint and capability results.
- [x] Add chat default route, conversation create/delete, streaming and cancellation, structured tool results and task actions.
- [x] Migrate manual pages to registry calls; monitor page attaches to shared tasks with device selection.
- [x] Verify missing config, long paths, rejection, reload recovery and navigation during monitoring with Electron/Playwright.

## Task 6: Verification and delivery

**Files:** `package.json`, lockfile, `.gitignore`, `README.md`, this plan and execution ledger.

- [x] Run all tests, lint, both typechecks and production build; resolve failures from their cause.
- [x] Inspect runtime dependencies, renderer warnings and packaging paths.
- [x] Start a local dev server on a free port, verify desktop and narrow-window screenshots and report actual limitations of real-device/cloud checks.
- [x] Record delivered behavior and commands; leave a reviewable implementation diff without including pre-existing user edits in implementation commits.

## Execution Ledger

Ruling: User requested direct continuation, which authorizes plan creation and inline execution without another approval handoff.

Ruling: Execute in the existing checkout on `codex/local-tool-agent`, preserving user edits and installed dependencies; a second checkout would omit those edits. No product commits will absorb pre-existing user changes.

Ruling: Use LangChain model and tool abstractions with an explicit sequential Agent loop rather than exposing graph internals through IPC. This enforces single-call approval and cancellation semantics without retaining provider-specific event shapes.

Ruling: Internal dotted tool names use snake_case names at the model boundary because provider documentation warns against special characters.

Progress: Tasks 1-6 implemented on `codex/local-tool-agent`. Product changes remain uncommitted for review; original title, icon and monitor-button intent is retained.

Delivered: chat-first Ant Design X UI; model configuration and capability probes; 15 validated built-in tools; per-operation concrete approval; main-owned monitoring and shared manual pages; encrypted/session-only Key storage and recoverable local history.

Review: an independent backend review reported 8 issues. Each was reproduced with regression tests before repair: manual shutdown awaiting, structural corruption backups, scan pagination references, device-query cancellation, uncertain monitor-exit retry, deleted-session calls, manual execution persistence, and configuration-test revision binding. Additional tests enforce multibyte summary limits and exact forward-port matching.

Verification:
- 30/30 Node tests passed.
- Both TypeScript checks, full-repository ESLint and production build passed.
- Production and development Electron smoke covered saved model settings, harmless capability probe, streamed calls, rejection without a file mutation, actual approved temporary-file movement, reload recovery, all manual routes, narrow-window layout and non-plaintext stored credentials.
- Development smoke passed twice after normalizing trusted URLs, explicitly binding IPv4 and isolating approval modal instances.
- Final Windows unpacked packaging and the refreshed packaged executable smoke both passed after the UI-only modal changes.
- Development renderer available at http://127.0.0.1:5173/; local tools require the Electron window.
- Runtime screenshots are in ignored `test-results/`.

Limitations:
- Smoke uses a local fake provider and temporary files. Real cloud compatibility and real-device mutation/monitor navigation are not claimed verified; main-owned monitor behavior is covered by injected process fixtures.
- npm audit still reports 23 findings (3 low, 9 moderate, 11 high). Two transitive issues were resolved with compatible updates; remaining Electron/build/markdown dependencies need separately scoped upgrades.
- The Windows unpacked build is verified, not an NSIS installer or macOS/Linux package. No signing identity or release publisher was configured.
- Renderer bundle remains about 2.7 MB unminified; bundle splitting can be handled separately.

Environment: this PowerShell environment has no npm on PATH. Verification uses `D:/nodejs/node.exe`; packaging adds the cached npm CLI directory to the process-local PATH only. No system configuration was changed.
