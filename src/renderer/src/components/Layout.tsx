import { NavLink, Outlet } from 'react-router-dom'

export interface NavItem {
  id: string
  name: string
  path: string
}

const navItems: NavItem[] = [
  { id: 'wallpaper', name: '视频提取', path: '/wallpaper' },
  { id: 'hdc-devtools', name: 'HDC DevTools', path: '/hdc-devtools' },
  { id: 'crash-monitor', name: '闪退监控', path: '/crash-monitor' }
]

export default function Layout() {
  return (
    <div className="d-flex h-100">
      {/* 侧边栏 */}
      <aside
        className="d-flex flex-column border-end border-secondary bg-body-tertiary"
        style={{ width: 'var(--sidebar-width)', flexShrink: 0 }}
      >
        <div className="px-3 py-3 border-bottom border-secondary">
          <span className="fw-semibold">Auto Tools</span>
        </div>
        <nav className="flex-grow-1 overflow-auto py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.id}
              to={item.path}
              className={({ isActive }) =>
                `d-block px-3 py-2 text-decoration-none small ${
                  isActive ? 'bg-primary text-white' : 'text-body-secondary hover-bg'
                }`
              }
            >
              {item.name}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-2 border-top border-secondary text-secondary small">
          v1.0.0
        </div>
      </aside>

      {/* 内容区 */}
      <main className="flex-grow-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}