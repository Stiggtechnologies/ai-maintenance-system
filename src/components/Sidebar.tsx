import { motion } from 'framer-motion';
import { useUIStore } from '../store/uiStore';
import {
  Home,
  Factory,
  ClipboardList,
  TrendingUp,
  Package,
  AlertTriangle,
  BarChart3,
  Bot,
  Settings,
  LayoutDashboard,
  LineChart,
  Cpu,
  Zap,
  Brain,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';

interface NavItem {
  icon: React.ElementType;
  label: string;
  id: string;
  children?: { label: string; id: string }[];
}

const menuItems: NavItem[] = [
  { icon: Home, label: 'Command', id: 'command' },
  { icon: Factory, label: 'Assets', id: 'assets' },
  { icon: ClipboardList, label: 'Work Orders', id: 'work-orders' },
  {
    icon: LayoutDashboard,
    label: 'Dashboards',
    id: 'dashboards',
    children: [
      { label: 'Executive', id: 'executive' },
      { label: 'Strategic', id: 'strategic' },
      { label: 'Tactical', id: 'tactical' },
      { label: 'Operational', id: 'operational' },
      { label: 'Autonomous', id: 'autonomous' },
    ],
  },
  { icon: TrendingUp, label: 'Reliability', id: 'reliability' },
  { icon: Package, label: 'Inventory', id: 'inventory' },
  { icon: AlertTriangle, label: 'Risk', id: 'risk' },
  { icon: LineChart, label: 'AI Analytics', id: 'analytics' },
  { icon: BarChart3, label: 'Reports', id: 'reports' },
  { icon: Bot, label: 'Agents', id: 'agents' },
  {
    icon: Brain,
    label: 'OpenClaw',
    id: 'openclaw-group',
    children: [
      { label: 'Control Panel', id: 'openclaw' },
      { label: 'Enterprise', id: 'openclaw-enterprise' },
    ],
  },
  { icon: Settings, label: 'Settings', id: 'settings' },
];

interface SidebarProps {
  activeView: string;
  onNavigate: (id: string) => void;
}

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  const { sidebarExpanded } = useUIStore();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['dashboards']));

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isGroupActive = (item: NavItem) =>
    item.children?.some((c) => c.id === activeView) ?? false;

  return (
    <motion.div
      initial={false}
      animate={{ width: sidebarExpanded ? 220 : 68 }}
      transition={{ duration: 0.15, ease: 'easeInOut' }}
      className="bg-[#11161D] border-r border-[#232A33] flex flex-col overflow-hidden flex-shrink-0"
    >
      {/* Logo */}
      <div className="h-14 px-4 border-b border-[#232A33] flex items-center gap-3 flex-shrink-0">
        <div className="w-8 h-8 bg-[#3A8DFF] rounded-lg flex items-center justify-center flex-shrink-0">
          <Zap className="w-5 h-5 text-white" />
        </div>
        {sidebarExpanded && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-base font-semibold text-[#E6EDF3] whitespace-nowrap"
          >
            SyncAI
          </motion.span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {menuItems.map((item) => {
          const isActive = activeView === item.id || isGroupActive(item);
          const isExpanded = expandedGroups.has(item.id);
          const hasChildren = !!item.children;

          return (
            <div key={item.id}>
              <motion.button
                onClick={() => {
                  if (hasChildren) {
                    toggleGroup(item.id);
                  } else {
                    onNavigate(item.id);
                  }
                }}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group relative ${
                  isActive && !hasChildren
                    ? 'bg-[#3A8DFF]/10 text-[#3A8DFF]'
                    : isActive && hasChildren
                    ? 'text-[#E6EDF3]'
                    : 'text-[#9BA7B4] hover:bg-[#161C24] hover:text-[#E6EDF3]'
                }`}
              >
                {isActive && !hasChildren && (
                  <motion.div
                    layoutId="activeIndicator"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-[#3A8DFF] rounded-r"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <item.icon className="w-4 h-4 flex-shrink-0" />
                {sidebarExpanded && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-sm flex-1 text-left whitespace-nowrap"
                  >
                    {item.label}
                  </motion.span>
                )}
                {sidebarExpanded && hasChildren && (
                  <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
                    <ChevronDown className="w-3.5 h-3.5 text-[#9BA7B4]" />
                  </motion.div>
                )}

                {/* Tooltip when collapsed */}
                {!sidebarExpanded && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-[#232A33] text-[#E6EDF3] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity">
                    {item.label}
                  </div>
                )}
              </motion.button>

              {/* Children */}
              {hasChildren && sidebarExpanded && (
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden pl-7 mt-0.5 space-y-0.5"
                    >
                      {item.children!.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => onNavigate(child.id)}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
                            activeView === child.id
                              ? 'bg-[#3A8DFF]/10 text-[#3A8DFF]'
                              : 'text-[#9BA7B4] hover:bg-[#161C24] hover:text-[#E6EDF3]'
                          }`}
                        >
                          <ChevronRight className="w-3 h-3 flex-shrink-0" />
                          {child.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      {sidebarExpanded && (
        <div className="p-3 border-t border-[#232A33]">
          <div className="flex items-center gap-2 px-2 py-2">
            <div className="w-6 h-6 bg-[#3A8DFF]/20 rounded-full flex items-center justify-center flex-shrink-0">
              <Cpu className="w-3.5 h-3.5 text-[#3A8DFF]" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-[#E6EDF3] font-medium truncate">SyncAI Platform</p>
              <p className="text-xs text-[#9BA7B4]">v2.0 · 15 Agents</p>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// Need AnimatePresence for child groups
import { AnimatePresence } from 'framer-motion';
