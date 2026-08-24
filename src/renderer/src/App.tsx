import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import CrashMonitorPage from './pages/CrashMonitorPage'
import HdcDevToolsPage from './pages/HdcDevToolsPage'
import WallpaperVideoTool from './pages/WallpaperVideoTool'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/wallpaper" replace />} />
          <Route path="wallpaper" element={<WallpaperVideoTool />} />
          <Route path="hdc-devtools" element={<HdcDevToolsPage />} />
          <Route path="crash-monitor" element={<CrashMonitorPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}