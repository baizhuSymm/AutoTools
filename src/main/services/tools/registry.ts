import { z } from 'zod'
import { isAbsolute } from 'node:path'
import type { VideoService } from '../videoService'
import type { DeviceService } from '../deviceService'
import type { WebviewService } from '../webviewService'
import type { MovePlan } from '../../contracts/video'
import type { ToolResult } from '../../../shared/agent'
import type { ToolDefinition } from '../../contracts/agent'

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

export function createRegistry({
  video,
  devices,
  webview
}: {
  video: VideoService
  devices: DeviceService
  webview: WebviewService
}): ToolDefinition[] {
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
        const found = await video.scan(input.sourceDir, input.dateRange ?? null, signal)
        return success(`找到 ${found.files.length} 个视频；日期按子目录修改时间筛选`, found)
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
        const page = video.results(input.scanId, input.offset, input.limit, input.query)
        return success(`匹配 ${page.total} 个文件，本页 ${page.files.length} 个`, page)
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
        const plan = await video.prepareMove(input.scanId, input.fileIds, input.targetDir)
        return { title: `移动 ${plan.items.length} 个视频`, details: plan, data: plan }
      },
      (plan: MovePlan, signal) => video.executeMove(plan, signal)
    ),
    deviceOperation(
      'device.list',
      '列出已连接设备；多台设备需要用户指定设备 ID。',
      z.object({}),
      false,
      async (_, signal) => success('设备列表', await devices.list(signal))
    ),
    deviceOperation(
      'device.list_apps',
      '查询指定设备已安装应用。',
      deviceInput,
      false,
      async (input, signal) => {
        const bundles = await devices.listApps(String(input.deviceId), signal)
        return success(`已安装 ${bundles.length} 个应用`, bundles)
      }
    ),
    deviceOperation(
      'device.foreground_app',
      '查询指定设备前台应用，无法识别时返回空。',
      deviceInput,
      false,
      async (input, signal) => {
        const bundleName = await devices.foregroundApp(String(input.deviceId), signal)
        return success(bundleName ? '已识别前台应用' : '无法识别前台应用', { bundleName })
      }
    ),
    deviceOperation(
      'webview.probe',
      '探测设备 WebView 进程、调试 socket 和现有端口转发。',
      deviceInput,
      false,
      (input, signal) => webview.probe(String(input.deviceId), signal)
    ),
    deviceOperation(
      'webview.enable_debugging',
      '修改设备 WebView 调试属性，必须确认。',
      deviceInput,
      true,
      (input, signal) => webview.enableDebugging(String(input.deviceId), signal)
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
      (input, signal) =>
        webview.forwardPort(
          String(input.deviceId),
          Number(input.port),
          String(input.socketName),
          signal
        )
    ),
    deviceOperation(
      'webview.remove_forward',
      '移除指定设备的端口转发，必须确认。',
      z.object({ deviceId: deviceSchema, port: portSchema }),
      true,
      (input, signal) => webview.removeForward(String(input.deviceId), Number(input.port), signal)
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
      (input, signal) =>
        webview.openEndpoint(
          String(input.deviceId),
          Number(input.port),
          input.browser as 'default' | 'chrome',
          signal
        )
    )
  ]
}
