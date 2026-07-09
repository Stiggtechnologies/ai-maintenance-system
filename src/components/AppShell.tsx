import { useState, useEffect } from "react";
import {
  Zap,
  ChevronLeft,
  ChevronRight,
  LogOut,
  MapPin,
  ChevronDown,
  Shield,
  Wifi,
  Activity,
  Target,
  Bot,
  Factory,
  Wrench,
  ChartBar as BarChart3,
  TriangleAlert as AlertTriangle,
  Cpu,
  Plug,
  Settings,
  BookOpen,
  TrendingUp,
  FlaskConical,
  Layers,
  SquareCheck as CheckSquare,
  Users,
  Bell,
  Command,
} from "lucide-react";
import { platformService, UserContext } from "../services/platform";
import { supabase } from "../lib/supabase";
import {
  getNotifications,
  markNotificationRead,
  type NotificationRow,
} from "../services/operatingLoopService";
import { motion, AnimatePresence } from "framer-motion";
import { CommandSearch } from "./CommandSearch";

interface AppShellProps {
  children: React.ReactNode;
  currentPath: string;
  onNavigate: (path: string) => void;
}

interface Site {
  id: string;
  name: string;
  code: string;
}

interface NavGroup {
  id: string;
  label: string;
  icon: React.ElementType;
  items: NavItem[];
}

interface NavItem {
  id: string;
  label: string;
  path: string;
  badge?: number;
  accent?: string;
}

const AUTONOMY_MODE = "Human-in-the-Loop";
const AUTONOMY_COLOR = "text-amber-400";

const navGroups: NavGroup[] = [
  {
    id: "mission",
    label: "Mission",
    icon: Target,
    items: [
      {
        id: "mission-control",
        label: "Mission Control",
        path: "/mission-control",
        accent: "teal",
      },
      {
        id: "command-centers",
        label: "Command Centers",
        path: "/command-centers",
      },
      { id: "readiness", label: "Readiness", path: "/readiness" },
      { id: "cowork", label: "Cowork Studio", path: "/cowork" },
    ],
  },
  {
    id: "ai",
    label: "AI Workforce",
    icon: Bot,
    items: [
      { id: "ai-workforce", label: "AI Agents", path: "/ai-workforce" },
      { id: "autonomy", label: "Autonomy Control", path: "/autonomy" },
      {
        id: "autonomy-maturity",
        label: "Autonomy Maturity",
        path: "/autonomy-maturity",
      },
      { id: "approvals", label: "Approvals", path: "/approvals" },
      {
        id: "decision-governance",
        label: "Decision Governance",
        path: "/governance",
      },
    ],
  },
  {
    id: "assets",
    label: "Asset Intelligence",
    icon: Factory,
    items: [
      { id: "assets", label: "Assets", path: "/assets" },
      { id: "onboarding", label: "Asset Onboarding", path: "/onboarding" },
      { id: "reliability", label: "Reliability", path: "/reliability" },
      { id: "risk", label: "Risk & Consequence", path: "/risk" },
    ],
  },
  {
    id: "work",
    label: "Work & Execution",
    icon: Wrench,
    items: [
      { id: "work", label: "Work Action Board", path: "/work" },
      {
        id: "scenario-simulator",
        label: "Scenario Simulator",
        path: "/scenarios",
      },
      { id: "briefing", label: "Operational Briefing", path: "/briefing" },
      { id: "playbooks", label: "Playbooks", path: "/playbooks" },
      { id: "emergency", label: "Emergency Mode", path: "/emergency" },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    icon: BarChart3,
    items: [
      {
        id: "executive",
        label: "Executive Intelligence",
        path: "/executive",
      },
      { id: "performance", label: "Performance", path: "/performance" },
      { id: "oee", label: "OEE Dashboard", path: "/oee" },
      { id: "learning-loop", label: "Learning Loop", path: "/learning-loop" },
      { id: "value", label: "Value Realization", path: "/value" },
      { id: "benchmarking", label: "Benchmarking", path: "/benchmarking" },
      { id: "trust", label: "Trust & Explainability", path: "/trust" },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Settings,
    items: [
      { id: "integrations", label: "Integrations", path: "/integrations" },
      {
        id: "integration-health",
        label: "Integration Health",
        path: "/integration-health",
      },
      { id: "artifacts", label: "Artifacts", path: "/artifacts" },
      { id: "setup", label: "Setup Wizard", path: "/setup" },
      { id: "settings", label: "Settings", path: "/settings" },
    ],
  },
];

export function AppShell({ children, currentPath, onNavigate }: AppShellProps) {
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [sitePickerOpen, setSitePickerOpen] = useState(false);
  const [badges, setBadges] = useState({ work: 0, approvals: 0 });
  const [commandSearchOpen, setCommandSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<NotificationRow[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["mission", "ai", "assets", "work", "performance", "system"]),
  );
  const [systemHealth] = useState({
    intelligence: "active",
    integration: "stable",
    governance: "enforced",
  });

  useEffect(() => {
    loadUserContext();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (userContext) {
      loadSites();
      loadBadges();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userContext]);

  const loadUserContext = async () => {
    const context = await platformService.getCurrentUserContext();
    setUserContext(context);
    if (context?.default_site_id) setSelectedSiteId(context.default_site_id);
  };

  const loadSites = async () => {
    if (!userContext) return;
    const { data } = await supabase
      .from("sites")
      .select("id, name, code")
      .eq("organization_id", userContext.organization_id)
      .order("name");
    if (data) setSites(data);
  };

  const loadBadges = async () => {
    if (!userContext) return;
    const [woRes, approvalRes] = await Promise.all([
      supabase
        .from("work_orders")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "in_progress"]),
      supabase
        .from("approvals")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
    ]);
    setBadges({ work: woRes.count || 0, approvals: approvalRes.count || 0 });
  };

  const handleSiteChange = async (siteId: string | null) => {
    setSelectedSiteId(siteId);
    setSitePickerOpen(false);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("user_profiles")
        .update({ default_site_id: siteId })
        .eq("id", user.id);
    }
  };

  const handleSignOut = async () => {
    await platformService.signOut();
  };

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isActive = (path: string) =>
    currentPath === path ||
    (path !== "/" &&
      path !== "/mission-control" &&
      currentPath.startsWith(path));

  const selectedSite = sites.find((s) => s.id === selectedSiteId);

  const getBadge = (item: NavItem) => {
    if (item.id === "work") return badges.work || undefined;
    if (item.id === "approvals") return badges.approvals || undefined;
    return item.badge;
  };

  const getPageTitle = () => {
    for (const group of navGroups) {
      const found = group.items.find(
        (item) =>
          currentPath === item.path ||
          (item.path !== "/" && currentPath.startsWith(item.path)),
      );
      if (found) return found.label;
    }
    return "Mission Control";
  };

  return (
    <div className="flex h-screen bg-[#080C10] overflow-hidden">
      {/* Sidebar */}
      <motion.aside
        animate={{ width: isCollapsed ? 64 : 240 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="bg-[#080C10] border-r border-white/[0.05] flex-shrink-0 overflow-hidden flex flex-col z-20"
      >
        {/* Logo */}
        <div className="h-14 px-4 flex items-center gap-3 border-b border-white/[0.05] flex-shrink-0">
          <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-cyan-400 rounded-lg flex items-center justify-center flex-shrink-0 shadow-[0_0_20px_rgba(20,184,166,0.4)]">
            <Zap className="w-4 h-4 text-white" />
          </div>
          {!isCollapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="text-sm font-bold text-white tracking-wide">
                SyncAI
              </div>
              <div className="text-xs text-slate-400 font-medium tracking-widest uppercase">
                Mission Assurance
              </div>
            </motion.div>
          )}
        </div>

        {/* Autonomy Mode Indicator */}
        {!isCollapsed && (
          <div className="px-3 py-2 border-b border-white/[0.05]">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs font-semibold text-amber-400 tracking-wide uppercase">
                {AUTONOMY_MODE}
              </span>
            </div>
          </div>
        )}

        {/* Org + Site */}
        {!isCollapsed && userContext && (
          <div className="px-3 py-2.5 border-b border-white/[0.05]">
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">
              Organization
            </div>
            <div className="text-xs font-semibold text-slate-200 truncate">
              {userContext.organization_name}
            </div>
            {userContext.roles && userContext.roles.length > 0 && (
              <div className="text-xs text-teal-400 mt-0.5">
                {userContext.roles[0].name}
              </div>
            )}
            {sites.length > 0 && (
              <div className="relative mt-2">
                <button
                  onClick={() => setSitePickerOpen(!sitePickerOpen)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 bg-white/[0.03] border border-white/[0.06] rounded-md text-xs text-slate-400 hover:bg-white/[0.06] transition-colors"
                >
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="flex-1 text-left truncate">
                    {selectedSite?.name || "All Sites"}
                  </span>
                  <ChevronDown
                    className={`w-3 h-3 transition-transform ${sitePickerOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {sitePickerOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[#0E1520] border border-white/[0.08] rounded-lg shadow-2xl z-50 max-h-48 overflow-y-auto">
                    <button
                      onClick={() => handleSiteChange(null)}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-white/[0.05] ${!selectedSiteId ? "text-teal-400" : "text-slate-300"}`}
                    >
                      All Sites
                    </button>
                    {sites.map((site) => (
                      <button
                        key={site.id}
                        onClick={() => handleSiteChange(site.id)}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-white/[0.05] ${selectedSiteId === site.id ? "text-teal-400" : "text-slate-300"}`}
                      >
                        {site.name}{" "}
                        <span className="text-slate-400">({site.code})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">
          {navGroups.map((group) => {
            const GroupIcon = group.icon;
            const isGroupExpanded = expandedGroups.has(group.id);
            return (
              <div key={group.id} className="mb-1">
                <button
                  onClick={() => toggleGroup(group.id)}
                  className={`w-full flex items-center px-4 py-2 transition-colors ${
                    isCollapsed ? "justify-center" : "gap-2"
                  } text-slate-400 hover:text-slate-400`}
                >
                  <GroupIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 text-left text-xs font-semibold uppercase tracking-widest">
                        {group.label}
                      </span>
                      <ChevronDown
                        className={`w-3 h-3 transition-transform ${isGroupExpanded ? "" : "-rotate-90"}`}
                      />
                    </>
                  )}
                </button>

                <AnimatePresence>
                  {(isGroupExpanded || isCollapsed) && (
                    <motion.div
                      initial={isCollapsed ? false : { height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      {group.items.map((item) => {
                        const active = isActive(item.path);
                        const badge = getBadge(item);
                        return (
                          <button
                            key={item.id}
                            onClick={() => onNavigate(item.path)}
                            title={isCollapsed ? item.label : undefined}
                            className={`w-full flex items-center gap-3 transition-all relative group ${
                              isCollapsed
                                ? "justify-center px-2 py-2.5"
                                : "px-4 py-2"
                            } ${
                              active
                                ? "text-teal-400 bg-teal-500/10"
                                : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]"
                            }`}
                          >
                            {active && (
                              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-teal-400 rounded-r" />
                            )}
                            {!isCollapsed && (
                              <span className="text-sm font-medium">
                                {item.label}
                              </span>
                            )}
                            {!isCollapsed && badge ? (
                              <span className="ml-auto text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded-full">
                                {badge}
                              </span>
                            ) : null}
                            {isCollapsed && (
                              <div className="absolute left-full ml-2 px-2 py-1 bg-[#1A2332] border border-white/[0.08] text-white text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity shadow-xl">
                                {item.label}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/[0.05] p-2">
          <button
            onClick={handleSignOut}
            aria-label="Sign out"
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 ${
              isCollapsed ? "justify-center" : ""
            }`}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!isCollapsed && <span className="text-sm">Sign Out</span>}
          </button>
          {!isCollapsed && (
            <div className="mt-2 px-2 py-1">
              <div className="text-xs text-slate-400">
                SyncAI Platform v3.0 · 15 Agents
              </div>
            </div>
          )}
        </div>
      </motion.aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top Bar */}
        <header className="h-14 bg-[#080C10] border-b border-white/[0.05] px-4 flex items-center justify-between flex-shrink-0 z-10">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!isCollapsed}
              className="p-1.5 rounded-md text-slate-400 hover:text-teal-400 hover:bg-teal-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
            >
              {isCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-200">
                {getPageTitle()}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* System Health Pills */}
            <div className="hidden md:flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.05]">
                <div className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                <span className="text-slate-400">Intelligence</span>
                <span className="text-teal-400 font-medium capitalize">
                  {systemHealth.intelligence}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.05]">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                <span className="text-slate-400">Integration</span>
                <span className="text-green-400 font-medium capitalize">
                  {systemHealth.integration}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.05]">
                <Shield className="w-3 h-3 text-blue-400" />
                <span className="text-slate-400">Governance</span>
                <span className="text-blue-400 font-medium capitalize">
                  {systemHealth.governance}
                </span>
              </div>
            </div>

            <div className="w-px h-5 bg-white/[0.06]" />

            {/* Autonomy Badge */}
            <div
              className={`flex items-center gap-1.5 text-xs font-semibold ${AUTONOMY_COLOR}`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span className="hidden sm:block">{AUTONOMY_MODE}</span>
            </div>

            <div className="w-px h-5 bg-white/[0.06]" />

            {/* Alerts */}
            <div className="relative">
              <button
                aria-label="Notifications"
                onClick={async () => {
                  const next = !notifOpen;
                  setNotifOpen(next);
                  if (next) {
                    try {
                      setNotifs(await getNotifications());
                    } catch {
                      setNotifs([]);
                    }
                  }
                }}
                className="relative p-1.5 text-slate-400 hover:text-slate-200 transition-colors"
              >
                <Bell className="w-4 h-4" />
                {(badges.approvals > 0 || notifs.some((n) => !n.read)) && (
                  <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-9 z-50 w-80 bg-[#0D1520] border border-white/[0.1] rounded-xl shadow-xl shadow-black/40 p-2">
                  <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Notifications
                  </div>
                  {notifs.length === 0 && (
                    <div className="px-2 py-3 text-xs text-slate-400">
                      No notifications.
                    </div>
                  )}
                  {notifs.map((n) => (
                    <button
                      key={n.id}
                      onClick={async () => {
                        await markNotificationRead(n.id);
                        setNotifs((cur) =>
                          cur.map((x) =>
                            x.id === n.id ? { ...x, read: true } : x,
                          ),
                        );
                      }}
                      className={`w-full text-left px-2 py-2 rounded-lg hover:bg-white/[0.04] ${n.read ? "opacity-60" : ""}`}
                    >
                      <div className="text-xs font-medium text-slate-200">
                        {n.title}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {n.message}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {new Date(n.created_at).toLocaleString()}
                        {!n.read && " · click to mark read"}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Command */}
            <button
              onClick={() => setCommandSearchOpen(true)}
              className="p-1.5 text-slate-400 hover:text-teal-400 transition-colors"
              title="Command Search (Cmd+K)"
            >
              <Command className="w-4 h-4" />
            </button>

            {/* User */}
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal-500 to-cyan-400 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
              {userContext?.organization_name?.[0] || "U"}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto bg-[#080C10] min-w-0">
          {children}
        </main>
      </div>

      {/* Command Search */}
      <CommandSearch
        open={commandSearchOpen}
        onClose={() => setCommandSearchOpen(false)}
        onNavigate={onNavigate}
      />
    </div>
  );
}

// Suppress unused import warnings — kept for potential future use
void Activity;
void Wifi;
void AlertTriangle;
void BookOpen;
void TrendingUp;
void FlaskConical;
void Layers;
void CheckSquare;
void Users;
void Plug;
