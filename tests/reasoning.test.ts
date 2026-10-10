import { createTestAgent, testFiles } from './helpers/agentFixture'
import type { ModelAdapter } from '../src/main/contracts/agent'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { ToolExecutor } from '../src/main/services/tools/executor'

import { splitReasoning } from '../src/shared/reasoning'

test('a backslash inside inline code does not escape its closing backtick', () => {
  const result = splitReasoning('`x\\` <think>private</think>answer')
  assert.equal(result.reasoning, 'private')
  assert.equal(result.content, '`x\\` answer')
})

test('an unmatched backtick does not swallow a closing think tag', () => {
  const result = splitReasoning('<think>consider `unclosed\n</think>final answer')
  assert.equal(result.content, 'final answer')
  assert.equal(result.reasoning, 'consider `unclosed\n')
  assert.equal(result.open, false)
})

test('a fence with trailing text is not a closing fence, including split chunks', async () => {
  const content = '```xml\n```not-a-close\n<think>literal</think>\n```'
  assert.equal(splitReasoning(content).content, content)
  await fixture(tagged([...content]), async (runtime) => {
    await runtime.services.chat.send(await runtime.services.sessions.create(), 'test')
    const message = runtime.services.snapshots.snapshot().conversations[0].messages.at(-1)!
    assert.equal(message.content, content)
    assert.equal(message.reasoning, undefined)
  })
})

async function fixture(
  model: ModelAdapter,
  check: (runtime: Awaited<ReturnType<typeof createTestAgent>>, path: string) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-reasoning-'))
  const path = join(directory, 'agent-state.json')
  const runtime = await createTestAgent(
    testFiles(path),
    new ToolExecutor([]),
    () => model,
    { encrypt: () => null, decrypt: () => '' },
    () => {}
  )
  try {
    await runtime.services.config.save({
      baseURL: 'https://example.com/v1',
      model: 'test',
      key: 'key'
    })
    await check(runtime, path)
  } finally {
    await runtime.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
}

function tagged(chunks: string[]): ModelAdapter {
  return {
    async *stream() {
      for (const text of chunks) yield { type: 'text', text }
    }
  }
}

test('split think tags are separated from the answer and survive profile reload', async () =>
  fixture(tagged(['<thi', 'nk>先检查', '目录</th', 'ink>## 结果\n完成']), async (runtime, path) => {
    await runtime.services.chat.send(await runtime.services.sessions.create(), 'test')
    const message = runtime.services.snapshots.snapshot().conversations[0].messages.at(-1)!
    assert.equal(message.content, '## 结果\n完成')
    assert.equal(message.reasoning, '先检查目录')
    assert.equal(message.reasoningStatus, 'done')
    assert.equal(message.status, 'completed')
    const restored = await createTestAgent(
      testFiles(path),
      new ToolExecutor([]),
      () => tagged([]),
      { encrypt: () => null, decrypt: () => '' },
      () => {}
    )

    assert.equal(
      restored.services.snapshots.snapshot().conversations[0].messages.at(-1)?.reasoning,
      '先检查目录'
    )
    await restored.shutdown()
  }))

test('an unclosed think block stays out of the answer and is marked interrupted', async () =>
  fixture(tagged(['<think>没有结束']), async (runtime) => {
    await runtime.services.chat.send(await runtime.services.sessions.create(), 'test')
    const message = runtime.services.snapshots.snapshot().conversations[0].messages.at(-1)!
    assert.equal(message.content, '')
    assert.equal(message.reasoning, '没有结束')
    assert.equal(message.reasoningStatus, 'interrupted')
  }))

test('think tags inside fenced and inline code remain literal answer content', async () => {
  const content = '示例 `<think>literal</think>`\n\n```xml\n<think>example</think>\n```'
  await fixture(tagged([...content]), async (runtime) => {
    await runtime.services.chat.send(await runtime.services.sessions.create(), 'test')
    const message = runtime.services.snapshots.snapshot().conversations[0].messages.at(-1)!
    assert.equal(message.content, content)
    assert.equal(message.reasoning, undefined)
  })
})

test('provider reasoning events are displayed separately and bounded', async () => {
  const model: ModelAdapter = {
    async *stream() {
      yield { type: 'reasoning', text: '接口返回的说明' }
      yield { type: 'text', text: '最终答复' }
    }
  }
  await fixture(model, async (runtime) => {
    await runtime.services.chat.send(await runtime.services.sessions.create(), 'test')
    const message = runtime.services.snapshots.snapshot().conversations[0].messages.at(-1)!
    assert.equal(message.reasoning, '接口返回的说明')
    assert.equal(message.content, '最终答复')
    assert.equal(message.reasoningStatus, 'done')
  })
})

test('cancellation preserves partial reasoning without marking it completed', async () => {
  let observed!: () => void
  const started = new Promise<void>((resolve) => {
    observed = resolve
  })
  const model: ModelAdapter = {
    async *stream(_messages, _definitions, signal) {
      yield { type: 'reasoning', text: '尚未完成' }
      observed()
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true })
      )
      signal.throwIfAborted()
    }
  }
  await fixture(model, async (runtime) => {
    const running = runtime.services.chat.send(await runtime.services.sessions.create(), 'test')
    await started
    runtime.services.chat.cancel()
    await running
    const message = runtime.services.snapshots.snapshot().conversations[0].messages.at(-1)!
    assert.equal(message.reasoning, '尚未完成')
    assert.equal(message.reasoningStatus, 'interrupted')
    assert.equal(message.status, 'cancelled')
  })
})

test('oversized provider reasoning stops the response instead of growing without bound', async () =>
  fixture(
    {
      async *stream() {
        yield { type: 'reasoning', text: 'x'.repeat(140000) }
      }
    },
    async (runtime) => {
      await runtime.services.chat.send(await runtime.services.sessions.create(), 'test')
      const message = runtime.services.snapshots.snapshot().conversations[0].messages.at(-1)!
      assert.equal(message.status, 'failed')
      assert.ok(Buffer.byteLength(message.reasoning ?? '') <= 131072)
    }
  ))

test('a profile interrupted during thinking restores a non-running message', async () =>
  fixture(tagged([]), async (runtime, path) => {
    const state = {
      version: 1,
      config: { baseURL: '', model: '' },
      history: {},
      tasks: [],
      conversations: [
        {
          id: 'old',
          title: 'old',
          updatedAt: 1,
          messages: [
            {
              id: 'a',
              role: 'assistant',
              content: '',
              reasoning: 'partial',
              reasoningStatus: 'streaming',
              status: 'streaming',
              calls: [],
              createdAt: 1
            }
          ]
        }
      ]
    }
    await writeFile(path.replace('agent-state.json', 'agent-data.json'), JSON.stringify(state))
    const restored = await createTestAgent(
      testFiles(path),
      new ToolExecutor([]),
      () => tagged([]),
      { encrypt: () => null, decrypt: () => '' },
      () => {}
    )

    const message = restored.services.snapshots.snapshot().conversations[0].messages[0]
    assert.equal(message.reasoning, 'partial')
    assert.equal(message.reasoningStatus, 'interrupted')
    assert.equal(message.status, 'cancelled')
    await restored.shutdown()
    assert.equal(runtime.services.snapshots.snapshot().activeSessionId, null)
  }))
