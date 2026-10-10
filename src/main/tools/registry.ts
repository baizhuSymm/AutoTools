import { z } from 'zod'
import { isAbsolute } from 'node:path'
import { shell } from 'electron'
import { execHdc, getForegroundBundle, listInstalledBundles } from '../services/hdcService'
import { detectChromePath, launchChrome } from '../services/chromeService'
import { scan, prepareMove, executeMove, type Scan, type MovePlan } from '../services/videoService'
import type { ToolResult } from '../../shared/agent'
import type { PreparedTool, ToolDefinition } from '../contracts/agent'

const pathSchema = z.string().trim().min(1).refine(isAbsolute, '需要绝对目录路径')
const deviceSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9_.:-]+$/)
const bundleSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9_.]+$/)
const portSchema = z.number().int().min(1).max(65535)
const deviceInput = z.object({ deviceId: deviceSchema })

export function hasForwardPort(output: string, port: number): boolean {
  return new RegExp(`\\btcp:${port}(?!\\d)`).test(output)
}

function define<S extends z.ZodType<Record<string, unknown>>, P>(
  name: string,
  description: string,
  schema: S,
  confirm: boolean,
  prepare: (input: z.output<S>) => Promise<{ title: string; details: unknown; data: P }>,
  execute: (data: P, signal: AbortSignal) => Promise<ToolResult>
): ToolDefinition {
  return {
    name,
    description,
    schema,
    confirm,
    prepare: (input) => prepare(input as z.output<S>),
    execute: (data, signal) => execute(data as P, signal)
  }
}
const success = (summary: string, data?: unknown): ToolResult => ({
  status: 'succeeded',
  summary,
  data
})

export async function listDevices(signal?: AbortSignal): Promise<string[]> {
  const result = await execHdc(['list', 'targets'], { signal })
  if (result.code !== 0) throw new Error(result.stderr || '设备查询失败')
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/empty|no devices|\[Fail\]/i.test(line))
}
async function verifyDevice(deviceId: string, signal?: AbortSignal): Promise<void> {
  if (!(await listDevices(signal)).includes(deviceId)) throw new Error('设备已断开，请重新选择设备')
}
async function command(deviceId: string, args: string[], signal: AbortSignal): Promise<ToolResult> {
  await verifyDevice(deviceId, signal)
  const result = await execHdc(['-t', deviceId, ...args], { signal })
  return {
    status: result.code === 0 ? 'succeeded' : signal.aborted ? 'cancelled' : 'failed',
    summary: result.code === 0 ? '设备操作已完成' : result.stderr || `退出码 ${result.code}`,
    data: result
  }
}

export function createRegistry(): ToolDefinition[] {
  const scans = new Map<string, Scan>()
  const direct = async (
    title: string,
    input: Record<string, unknown>
  ): Promise<{ title: string; details: unknown; data: Record<string, unknown> }> => ({
    title,
    details: input,
    data: input
  })
  const deviceOperation = (
    name: string,
    description: string,
    schema: z.ZodType<Record<string, unknown>>,
    confirm: boolean,
    execute: (input: Record<string, unknown>, signal: AbortSignal) => Promise<ToolResult>
  ): ToolDefinition =>
    define(name, description, schema, confirm, (input) => direct(description, input), execute)

  return [
    define(
      'video.scan',
      '扫描源目录子文件夹中的视频，日期按子目录修改时间筛选。返回扫描 ID 及文件 ID；大清单用 video.results 分页查询。',
      z.object({
        sourceDir: pathSchema,
        dateRange: z.object({ start: z.string(), end: z.string() }).nullable().optional()
      }),
      false,
      async (input) => ({ title: '扫描视频', details: input, data: input }),
      async (input, signal) => {
        signal.throwIfAborted()
        const found = await scan(input.sourceDir, input.dateRange ?? null)
        signal.throwIfAborted()
        scans.set(found.id, found)
        if (scans.size > 20) scans.delete(scans.keys().next().value!)
        return success(`找到 ${found.files.length} 个视频；日期按子目录修改时间筛选`, {
          ...found,
          files: found.files.map(({ fingerprint: _fingerprint, ...file }) => file)
        })
      }
    ),
    define(
      'video.results',
      '根据扫描 ID 分页查询文件 ID 和文件名，query 可按文件名或子目录筛选。用返回的文件 ID 移动部分视频。',
      z.object({
        scanId: z.string().uuid(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(30).default(10),
        query: z.string().max(256).default('')
      }),
      false,
      async (input) => ({ title: '查询扫描清单', details: input, data: input }),
      async (input) => {
        const found = scans.get(input.scanId)
        if (!found) throw new Error('扫描记录已过期，请重新扫描')
        const query = input.query.toLowerCase()
        const matches = found.files.filter((file) =>
          `${file.name} ${file.fromSubfolder}`.toLowerCase().includes(query)
        )
        const files = matches
          .slice(input.offset, input.offset + input.limit)
          .map(({ fingerprint: _fingerprint, ...file }) => file)
        return success(`匹配 ${matches.length} 个文件，本页 ${files.length} 个`, {
          id: found.id,
          files,
          total: matches.length,
          offset: input.offset,
          nextOffset:
            input.offset + files.length < matches.length ? input.offset + files.length : null
        })
      }
    ),
    define(
      'video.move',
      '移动之前扫描得到的视频，必须先调用 video.scan。fileIds 为空表示全部。执行需要用户确认。',
      z.object({
        scanId: z.string().uuid(),
        fileIds: z.array(z.string().uuid()).default([]),
        targetDir: pathSchema
      }),
      true,
      async (input) => {
        const found = scans.get(input.scanId)
        if (!found) throw new Error('扫描记录已过期，请重新扫描')
        const plan = await prepareMove(found, input.fileIds, input.targetDir)
        return { title: `移动 ${plan.items.length} 个视频`, details: plan, data: plan }
      },
      (plan: MovePlan, signal) => executeMove(plan, signal)
    ),
    deviceOperation(
      'device.list',
      '列出已连接设备；多台设备需要用户指定设备 ID。',
      z.object({}),
      false,
      async (_, signal) => success('设备列表', await listDevices(signal))
    ),
    deviceOperation(
      'device.list_apps',
      '查询指定设备已安装应用。',
      deviceInput,
      false,
      async (input, signal) => {
        await verifyDevice(String(input.deviceId), signal)
        const bundles = await listInstalledBundles(String(input.deviceId), signal)
        signal.throwIfAborted()
        return success(`已安装 ${bundles.length} 个应用`, bundles)
      }
    ),
    deviceOperation(
      'device.foreground_app',
      '查询指定设备前台应用，无法识别时返回空。',
      deviceInput,
      false,
      async (input, signal) => {
        await verifyDevice(String(input.deviceId), signal)
        const bundleName = await getForegroundBundle(String(input.deviceId), signal)
        signal.throwIfAborted()
        return success(bundleName ? '已识别前台应用' : '无法识别前台应用', { bundleName })
      }
    ),
    deviceOperation(
      'webview.probe',
      '探测设备 WebView 进程、调试 socket 和现有端口转发。',
      deviceInput,
      false,
      async (input, signal) => {
        const deviceId = String(input.deviceId)
        const output: Record<string, string[]> = {}
        for (const [name, args] of [
          ['processes', ['shell', 'ps', '-ef']],
          ['sockets', ['shell', 'cat', '/proc/net/unix']],
          ['forwarded', ['fport', 'ls']]
        ] as const) {
          const result = await command(deviceId, [...args], signal)
          if (result.status !== 'succeeded')
            return { ...result, data: { completed: output, failedStep: name } }
          const data = result.data as { stdout: string }
          output[name] = data.stdout
            .split(/\r?\n/)
            .filter((line) =>
              name === 'forwarded' ? line.trim() : /webview|devtools|chromium/i.test(line)
            )
        }
        return success('设备探测完成', output)
      }
    ),
    deviceOperation(
      'webview.enable_debugging',
      '修改设备 WebView 调试属性，必须确认。',
      deviceInput,
      true,
      (input, signal) =>
        command(
          String(input.deviceId),
          ['shell', 'setprop', 'debug.webview.remote_debugging', 'true'],
          signal
        )
    ),
    deviceOperation(
      'webview.forward_port',
      '为设备调试 socket 建立本机端口转发，必须确认。',
      z.object({
        deviceId: deviceSchema,
        port: portSchema,
        socketName: z
          .string()
          .min(1)
          .max(256)
          .regex(/^(?:localabstract:)?[a-zA-Z0-9_.-]+$/)
          .transform((value) =>
            value.startsWith('localabstract:') ? value : `localabstract:${value}`
          )
      }),
      true,
      async (input, signal) => {
        const deviceId = String(input.deviceId)
        const existing = await command(deviceId, ['fport', 'ls'], signal)
        if (existing.status !== 'succeeded') return existing
        if (hasForwardPort((existing.data as { stdout: string }).stdout, Number(input.port))) {
          throw new Error('该端口已有转发，请选择其他端口或确认移除现有转发')
        }
        return command(deviceId, ['fport', `tcp:${input.port}`, String(input.socketName)], signal)
      }
    ),
    deviceOperation(
      'webview.remove_forward',
      '移除指定设备的端口转发，必须确认。',
      z.object({ deviceId: deviceSchema, port: portSchema }),
      true,
      (input, signal) =>
        command(String(input.deviceId), ['fport', 'rm', `tcp:${input.port}`], signal)
    ),
    deviceOperation(
      'webview.open_endpoint',
      '打开已存在转发的本机调试端点。browser 可为 default 或 chrome。',
      z.object({
        deviceId: deviceSchema,
        port: portSchema,
        browser: z.enum(['default', 'chrome']).default('default')
      }),
      false,
      async (input, signal) => {
        const forwards = await command(String(input.deviceId), ['fport', 'ls'], signal)
        if (forwards.status !== 'succeeded') return forwards
        if (!hasForwardPort((forwards.data as { stdout: string }).stdout, Number(input.port)))
          throw new Error('未找到指定端口的转发')
        const url = `http://127.0.0.1:${input.port}/json/list`
        signal.throwIfAborted()
        if (input.browser === 'chrome') {
          const chrome = detectChromePath()
          if (!chrome) throw new Error('未检测到 Chrome')
          await launchChrome(chrome, url)
        } else await shell.openExternal(url)
        return success('已打开调试端点', { url })
      }
    )
  ]
}
