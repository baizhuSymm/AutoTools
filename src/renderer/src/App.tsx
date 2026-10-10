import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import AgentProvider from './features/agent/AgentProvider'
import ChatPage from './pages/ChatPage'
import SettingsPage from './pages/SettingsPage'
import HdcDevToolsPage from './pages/HdcDevToolsPage'
import WallpaperVideoTool from './pages/WallpaperVideoTool'

export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#167d68',
          borderRadius: 6,
          fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif'
        }
      }}
    >
      <AntApp style={{ height: '100%' }}>
        <AgentProvider>
          <HashRouter>
            <Routes>
              <Route path="/" element={<Layout />}>
                <Route index element={<Navigate to="/chat" replace />} />
                <Route path="chat" element={<ChatPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="wallpaper" element={<WallpaperVideoTool />} />
                <Route path="hdc-devtools" element={<HdcDevToolsPage />} />
                <Route path="*" element={<Navigate to="/chat" replace />} />
              </Route>
            </Routes>
          </HashRouter>
        </AgentProvider>
      </AntApp>
    </ConfigProvider>
  )
}
