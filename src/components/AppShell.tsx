import { useState, useEffect } from 'react';
import { LayoutDashboard, Activity, Wrench, Shield, Package, Plug, Settings, LogOut, ChevronRight, CircleCheck as CheckCircle2, Gauge, Video as LucideIcon } from 'lucide-react';
import { platformService, UserContext } from '../services/platform';

interface AppShellProps {
  children: React.ReactNode;
  currentPath: string;
  onNavigate: (path: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  badge?: number;
  requiredLevel?: string[];
}

export function AppShell({ children, currentPath, onNavigate }: AppShellProps) {
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const deploymentHealth = {
    intelligence: 'active',
    integration: 'stable',
    governance: 'enforced',
    syncPercent: 92
  };

  useEffect(() => {
    loadUserContext();
  }, []);

  const loadUserContext = async () => {
    const context = await platformService.getCurrentUserContext();
    setUserContext(context);
  };

  const handleSignOut = async () => {
    await platformService.signOut();
  };

  const navItems: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, path: '/overview' },
    { id: 'performance', label: 'Performance', icon: Activity, path: '/performance' },
    { id: 'work', label: 'Work', icon: Wrench, path: '/work', badge: 12 },
    { id: 'governance', label: 'Governance', icon: Shield, path: '/governance', badge: 3 },
    { id: 'assets', label: 'Assets', icon: Package, path: '/assets' },
    { id: 'integrations', label: 'Integrations', icon: Plug, path: '/integrations' },
    { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
  ];

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className={`bg-slate-900 text-white transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-64'} flex flex-col`}>
        {/* Logo */}
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center font-bold text-sm">
              SA
            </div>
            {!isCollapsed && (
              <div>
                <div className="font-bold text-sm">SyncAI</div>
                <div className="text-xs text-slate-400">Industrial Intelligence</div>
              </div>
            )}
          </div>
        </div>

        {/* Organization */}
        {!isCollapsed && userContext && (
          <div className="px-4 py-3 border-b border-slate-700">
            <div className="text-xs text-slate-400">Organization</div>
            <div className="text-sm font-medium truncate">{userContext.organization_name}</div>
            {userContext.roles && userContext.roles.length > 0 && (
              <div className="text-xs text-slate-400 mt-1">{userContext.roles[0].name}</div>
            )}
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPath === item.path;

              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.path)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors
                    ${isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}
                    ${isCollapsed ? 'justify-center' : ''}
                  `}
                >
                  <Icon size={20} />
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 text-left text-sm font-medium">{item.label}</span>
                      {item.badge && (
                        <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Sign Out */}
        <div className="p-3 border-t border-slate-700">
          <button
            onClick={handleSignOut}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors
              text-slate-300 hover:bg-slate-800 hover:text-white
              ${isCollapsed ? 'justify-center' : ''}
            `}
          >
            <LogOut size={20} />
            {!isCollapsed && <span className="text-sm font-medium">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="bg-white border-b border-slate-200 px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="text-slate-400 hover:text-slate-600"
              >
                <ChevronRight size={20} className={`transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
              </button>
              <div className="text-sm font-medium text-slate-900">
                {navItems.find(item => item.path === currentPath)?.label || 'Dashboard'}
              </div>
            </div>

            {/* System Status */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-green-500" />
                  <span className="text-slate-600">Intelligence: <span className="font-medium text-slate-900">Active</span></span>
                </div>
                <div className="w-px h-4 bg-slate-300" />
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-green-500" />
                  <span className="text-slate-600">Integration: <span className="font-medium text-slate-900">Stable</span></span>
                </div>
                <div className="w-px h-4 bg-slate-300" />
                <div className="flex items-center gap-1.5">
                  <Shield size={14} className="text-blue-500" />
                  <span className="text-slate-600">Governance: <span className="font-medium text-slate-900">Enforced</span></span>
                </div>
                <div className="w-px h-4 bg-slate-300" />
                <div className="flex items-center gap-1.5">
                  <Gauge size={14} className="text-blue-500" />
                  <span className="text-slate-600">Sync: <span className="font-medium text-slate-900">{deploymentHealth.syncPercent}%</span></span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {children}
        </main>
      </div>
    </div>
  );
}
