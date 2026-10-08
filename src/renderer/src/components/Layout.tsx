import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button, Popconfirm, Tooltip } from 'antd'
import { Bot, Bug, Film, MessageSquare, Plus, Settings, Terminal, Trash2 } from 'lucide-react'
import { useAgent } from '../features/agent/context'

const navItems = [
  { name: '对话', path: '/chat', icon: MessageSquare },
  { name: '视频提取', path: '/wallpaper', icon: Film },
  { name: 'WebView 调试', path: '/hdc-devtools', icon: Terminal },
  { name: '闪退监控', path: '/crash-monitor', icon: Bug }
]

export default function Layout() {
  const { snapshot, selectedId, select, report } = useAgent()
  const navigate = useNavigate()
  return (
    <div className="agent-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <Bot size={24} />
          <span>AutoTools</span>
          <span className="brand-label">Agent</span>
        </div>
        <nav className="primary-nav">
          {navItems.map(({ name, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => (isActive ? 'nav-entry active' : 'nav-entry')}
            >
              <Icon size={17} />
              <span>{name}</span>
            </NavLink>
          ))}
        </nav>
        <div className="session-heading">
          <span>会话</span>
          <Tooltip title="新建会话">
            <Button
              type="text"
              size="small"
              aria-label="新建会话"
              icon={<Plus size={17} />}
              onClick={() => {
                void window.api.agent
                  .createSession()
                  .then((id) => {
                    select(id)
                    navigate('/chat')
                  })
                  .catch(report)
              }}
            />
          </Tooltip>
        </div>
        <div className="session-list">
          {snapshot.conversations.map((session) => (
            <div
              key={session.id}
              className={`session-entry ${selectedId === session.id ? 'selected' : ''}`}
            >
              <button
                className="session-select"
                title={session.title}
                onClick={() => {
                  select(session.id)
                  navigate('/chat')
                }}
              >
                {snapshot.activeSessionId === session.id && <span className="run-indicator" />}
                {session.title}
              </button>
              <Popconfirm
                title="删除这段会话？"
                description="运行中的监控任务会保留。"
                onConfirm={() => window.api.agent.deleteSession(session.id).catch(report)}
              >
                <Button
                  type="text"
                  size="small"
                  aria-label="删除会话"
                  icon={<Trash2 size={13} />}
                />
              </Popconfirm>
            </div>
          ))}
        </div>
        <NavLink
          to="/settings"
          className={({ isActive }) => `nav-entry settings-entry ${isActive ? 'active' : ''}`}
        >
          <Settings size={17} />
          <span>模型设置</span>
        </NavLink>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
