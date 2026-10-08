import { useState } from 'react'
import { Alert, App, Button, Form, Input, Space, Tag } from 'antd'
import { Check, Plug } from 'lucide-react'
import { useAgent } from '../features/agent/context'

export default function SettingsPage() {
  const { snapshot, report } = useAgent()
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const { message } = App.useApp()
  const [form] = Form.useForm<{ baseURL: string; model: string; key?: string }>()
  const save = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      setBusy(true)
      await window.api.agent.saveConfig({ ...values, key: values.key?.trim() || undefined })
      form.setFieldValue('key', '')
      void message.success('模型设置已保存')
    } catch (error) {
      report(error)
    } finally {
      setBusy(false)
    }
  }
  const test = async (): Promise<void> => {
    setTesting(true)
    try {
      await window.api.agent.testConnection()
    } catch (error) {
      report(error)
    } finally {
      setTesting(false)
    }
  }
  return (
    <div className="settings-page">
      <header className="page-header">
        <h1>模型设置</h1>
        <Tag>OpenAI 兼容协议</Tag>
      </header>
      <div className="settings-content">
        <Form
          form={form}
          layout="vertical"
          initialValues={{ baseURL: snapshot.config.baseURL, model: snapshot.config.model }}
        >
          <Form.Item
            name="baseURL"
            label="API 地址"
            rules={[{ required: true, type: 'url', message: '请输入完整 API 地址' }]}
          >
            <Input placeholder="https://api.example.com/v1" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="model"
            label="模型名称"
            rules={[{ required: true, message: '请输入模型名称' }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="key" label="API Key">
            <Input.Password
              autoComplete="new-password"
              placeholder={snapshot.config.hasKey ? '已保存；留空保持当前密钥' : '输入 API Key'}
            />
          </Form.Item>
          <Space wrap>
            <Button
              type="primary"
              icon={<Check size={16} />}
              loading={busy}
              onClick={() => void save()}
            >
              保存
            </Button>
            <Button
              icon={<Plug size={16} />}
              loading={testing}
              disabled={!snapshot.config.hasKey || busy}
              onClick={() => void test()}
            >
              测试已保存的连接
            </Button>
            {snapshot.config.hasKey && (
              <Button
                danger
                type="text"
                onClick={() =>
                  void window.api.agent
                    .saveConfig({
                      baseURL: snapshot.config.baseURL,
                      model: snapshot.config.model,
                      key: ''
                    })
                    .catch(report)
                }
              >
                删除密钥
              </Button>
            )}
          </Space>
        </Form>
        {snapshot.config.hasKey && !snapshot.config.keyPersistent && (
          <Alert type="warning" title="密钥仅保存在本次运行中，重启后需要重新填写" />
        )}
        {snapshot.config.capabilities && (
          <div className="capabilities">
            {(
              [
                ['text', '普通对话'],
                ['streaming', '流式输出'],
                ['tools', '工具调用']
              ] as const
            ).map(([key, label]) => (
              <Tag key={key} color={snapshot.config.capabilities?.[key] ? 'success' : 'error'}>
                {label}：{snapshot.config.capabilities?.[key] ? '可用' : '未通过'}
              </Tag>
            ))}
          </div>
        )}
        <p className="data-notice">
          对话和必要的工具结果摘要将发送到你配置的服务地址。连续设备日志和完整文件清单保留在本地，默认不会全量发送。
        </p>
      </div>
    </div>
  )
}
