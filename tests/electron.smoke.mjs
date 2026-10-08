import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, access, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import electronPath from 'electron'

const directory = await mkdtemp(join(tmpdir(), 'autotools-smoke-'))
const profile = join(directory, 'profile')
const source = join(directory, 'source')
const target = join(directory, 'target')
await mkdir(profile)
await mkdir(join(source, 'wallpaper'), { recursive: true })
await writeFile(join(source, 'wallpaper', 'sample.mp4'), 'test-video')
await mkdir('test-results', { recursive: true })
const errors = []
const richAnswer =
  '<think>先核对目录，再整理结果。</think>\n\n## 处理结果\n\n已完成 **扫描**，可以继续操作。\n\n| 文件 | 状态 |\n| --- | --- |\n| 示例.mp4 | 已发现 |\n\n> 文件操作仍需确认。\n\n```typescript\nconst value = "<think>literal</think>";\nconsole.log(value);\n```\n\n[安全链接](https://example.com)\n\n[危险链接](javascript:alert(1))\n\n![远程图片](https://example.com/private-image.png)\n\n<script>window.__unsafe = true</script>'
const server = createServer(async (request, response) => {
  try {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    const messages = body.messages ?? []
    const latestText = messages.findLast((message) => message.role === 'user')?.content ?? ''
    let toolCall
    if (body.tools?.some((tool) => tool.function.name === 'connection_probe')) {
      toolCall = {
        id: 'probe',
        type: 'function',
        function: { name: 'connection_probe', arguments: '{"value":"ok"}' }
      }
    } else {
      const userIndex = messages.findLastIndex((message) => message.role === 'user')
      const latestUser = messages[userIndex]?.content ?? ''
      if (latestUser.includes('移动测试视频')) {
        const toolResults = messages.slice(userIndex).filter((message) => message.role === 'tool')
        if (!toolResults.length)
          toolCall = {
            id: 'scan',
            type: 'function',
            function: {
              name: 'video_scan',
              arguments: JSON.stringify({ sourceDir: source, dateRange: null })
            }
          }
        else if (toolResults.length === 1) {
          const result = JSON.parse(toolResults[0].content)
          toolCall = {
            id: 'move',
            type: 'function',
            function: {
              name: 'video_move',
              arguments: JSON.stringify({ scanId: result.data.id, fileIds: [], targetDir: target })
            }
          }
        }
      }
    }
    if (!body.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 'reply',
          object: 'chat.completion',
          created: 1,
          model: 'test-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: toolCall ? null : 'OK',
                ...(toolCall ? { tool_calls: [toolCall] } : {})
              },
              finish_reason: toolCall ? 'tool_calls' : 'stop'
            }
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        })
      )
    } else {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const delta = toolCall
        ? { role: 'assistant', tool_calls: [{ index: 0, ...toolCall }] }
        : { role: 'assistant', content: '测试回复完成' }
      const event = (value) =>
        response.write(
          `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, ...value }] })}\n\n`
        )
      if (latestText === '富文本测试') {
        for (const text of [
          richAnswer.slice(0, 4),
          richAnswer.slice(4, 28),
          richAnswer.slice(28)
        ]) {
          event({ delta: { role: 'assistant', content: text }, finish_reason: null })
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      } else if (latestText === '独立思考测试' || latestText === '中止思考测试') {
        event({
          delta: { role: 'assistant', reasoning_content: '接口独立返回的思考内容' },
          finish_reason: null
        })
        await new Promise((resolve) =>
          setTimeout(resolve, latestText === '中止思考测试' ? 2500 : 200)
        )
        event({ delta: { content: '## 最终答复\n\n独立字段已接通。' }, finish_reason: null })
      } else event({ delta, finish_reason: null })
      event({ delta: {}, finish_reason: toolCall ? 'tool_calls' : 'stop' })
      response.end('data: [DONE]\n\n')
    }
  } catch (error) {
    errors.push(String(error))
    response.writeHead(500)
    response.end('test server error')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
let app
try {
  const address = server.address()
  app = await electron.launch({
    executablePath: process.env.AUTOTOOLS_SMOKE_EXECUTABLE || electronPath,
    args: process.env.AUTOTOOLS_SMOKE_EXECUTABLE ? [] : [resolve('.')],
    env: {
      ...process.env,
      AUTOTOOLS_USER_DATA: profile,
      ELECTRON_RUN_AS_NODE: undefined,
      ELECTRON_RENDERER_URL: process.env.AUTOTOOLS_SMOKE_RENDERER_URL
    }
  })
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.getByRole('heading', { name: '新会话', exact: true }).waitFor()
  await page.screenshot({ path: 'test-results/chat-desktop.png' })
  await page.getByRole('link', { name: '模型设置', exact: true }).click()
  await page.getByLabel('API 地址', { exact: true }).fill(`http://127.0.0.1:${address.port}/v1`)
  await page.getByLabel('模型名称', { exact: true }).fill('test-model')
  await page.getByLabel('API Key', { exact: true }).fill('smoke-secret')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('模型设置已保存').waitFor()
  await page.getByRole('button', { name: '测试已保存的连接' }).click()
  await page.getByText('工具调用：可用', { exact: true }).waitFor({ timeout: 30000 })
  await page.screenshot({ path: 'test-results/settings-desktop.png' })
  await page.getByRole('link', { name: '对话', exact: true }).click()
  const send = async (text) => {
    await page.locator('.ant-sender-loading-button').waitFor({ state: 'hidden' })
    await page.getByPlaceholder('输入请求…').fill(text)
    await page.getByPlaceholder('输入请求…').press('Enter')
  }
  await send('富文本测试')
  await page.getByRole('heading', { name: '处理结果', exact: true }).waitFor()
  await page.waitForFunction(
    async () => (await window.api.agent.snapshot()).activeSessionId === null
  )
  const richMessage = page.locator('.message-row.assistant').last()
  await richMessage.getByText('思考完成', { exact: true }).waitFor()
  assert.equal(
    await richMessage.getByText('先核对目录，再整理结果。', { exact: true }).isVisible(),
    false
  )
  await richMessage.getByText('思考完成', { exact: true }).click()
  await richMessage.getByText('先核对目录，再整理结果。', { exact: true }).waitFor()
  await richMessage.getByText('思考完成', { exact: true }).click()
  assert.equal(await richMessage.locator('table').count(), 1)
  assert.equal(await richMessage.locator('.ant-codeHighlighter').count(), 1)
  assert.equal(await richMessage.locator('a[href^="javascript:"]').count(), 0)
  assert.equal(await richMessage.locator('img').count(), 0)
  assert.equal(await page.evaluate(() => window.__unsafe), undefined)
  await richMessage.locator('.message-actions').getByRole('button', { name: '复制', exact: true }).click()
  await richMessage.locator('.message-actions button[class*="copy-success"]').waitFor()
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
  assert.ok(copied.includes('## 处理结果'))
  assert.ok(!copied.includes('先核对目录'))
  await page.screenshot({ path: 'test-results/chat-rich-desktop.png', animations: 'disabled' })
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(760, 640) })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: 'test-results/chat-rich-narrow.png', animations: 'disabled' })
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 820) })
  await send('独立思考测试')
  await page.getByRole('heading', { name: '最终答复', exact: true }).waitFor()
  await page.waitForFunction(
    async () => (await window.api.agent.snapshot()).activeSessionId === null
  )
  assert.equal(
    await page.evaluate(
      async () => (await window.api.agent.snapshot()).conversations[0].messages.at(-1).reasoning
    ),
    '接口独立返回的思考内容'
  )
  await send('中止思考测试')
  await page.locator('.message-row.assistant').last().getByText('思考中', { exact: true }).waitFor()
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await page
    .locator('.message-row.assistant')
    .last()
    .getByText('思考已中止', { exact: true })
    .waitFor()
  await page.waitForFunction(
    async () => (await window.api.agent.snapshot()).activeSessionId === null
  )
  await page.reload()
  await page
    .locator('.message-row.assistant')
    .last()
    .getByText('思考已中止', { exact: true })
    .waitFor()
  await page.getByPlaceholder('输入请求…').fill('移动测试视频')
  await page.getByPlaceholder('输入请求…').press('Enter')
  await page.getByRole('button', { name: '确认执行', exact: true }).waitFor({ timeout: 30000 })
  await access(join(source, 'wallpaper', 'sample.mp4'))
  await assert.rejects(access(join(target, 'sample.mp4')))
  await page.screenshot({ path: 'test-results/approval-desktop.png', animations: 'disabled' })
  await page.getByRole('button', { name: /拒\s*绝/ }).click()
  await page.waitForFunction(
    async () => (await window.api.agent.snapshot()).activeSessionId === null
  )
  await page.waitForFunction(() => !document.querySelector('.cancel-text'))
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => !document.querySelector('.cancel-text'))
  await access(join(source, 'wallpaper', 'sample.mp4'))
  await page.locator('.ant-sender-loading-button').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => !document.querySelector('.ant-sender button[disabled]'))
  await page.getByPlaceholder('输入请求…').fill('移动测试视频')
  await page.getByPlaceholder('输入请求…').press('Enter')
  await page.getByRole('button', { name: '确认执行', exact: true }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: '确认执行', exact: true }).click()
  await page.waitForFunction(
    async () => (await window.api.agent.snapshot()).activeSessionId === null
  )
  await page.waitForFunction(() => !document.querySelector('.cancel-text'))
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(await readFile(join(target, 'sample.mp4'), 'utf8'), 'test-video')
  await assert.rejects(access(join(source, 'wallpaper', 'sample.mp4')))
  await page.screenshot({ path: 'test-results/chat-result.png', animations: 'disabled' })
  await page.reload()
  await page.getByText('移动成功 1，失败 0，未执行 0', { exact: true }).waitFor()
  for (const name of ['视频提取', 'WebView 调试', '闪退监控']) {
    await page.getByRole('link', { name, exact: true }).click()
    await page.getByRole('heading', { name: name === '视频提取' ? /视频提取/ : name }).waitFor()
    await page.screenshot({
      path: `test-results/manual-${name === '视频提取' ? 'video' : name === '闪退监控' ? 'monitor' : 'webview'}.png`
    })
  }
  await page.getByRole('link', { name: '对话', exact: true }).click()
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(760, 640)
  })
  await page.screenshot({ path: 'test-results/chat-narrow.png' })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  const saved = await readFile(join(profile, 'agent-state.json'), 'utf8')
  assert.ok(!saved.includes('smoke-secret'))
  console.log(
    'Electron smoke passed: approval, actual move, Markdown, code, Think tags, native reasoning, cancellation, copying, safe rendering, reload, manual routes, narrow layout.'
  )
} catch (error) {
  if (app) {
    const page = await app.firstWindow()
    await page.screenshot({ path: 'test-results/failure.png' })
    console.error(JSON.stringify(await page.evaluate(() => window.api.agent.snapshot())))
  }
  throw error
} finally {
  if (app) await app.close()
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
