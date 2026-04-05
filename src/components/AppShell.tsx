import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Activity,
  Wrench,
  Shield,
  Package,
  Plug,
  Settings,
  LogOut,
  ChevronRight,
  CheckCircle2,
  Gauge,
  AlertTriangle,
  MapPin,
  ChevronDown,
  FlaskConical,
  Rocket,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { platformService, UserContext } from "../services/platform";
import { supabase } from "../lib/supabase";

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

interface Site {
  id: string;
  name: string;
  code: string;
}

export function AppShell({ children, currentPath, onNavigate }: AppShellProps) {
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [sitePickerOpen, setSitePickerOpen] = useState(false);
  const [badges, setBadges] = useState({ work: 0, governance: 0 });
  const [systemHealth, setSystemHealth] = useState({
    intelligence: "active",
    integration: "stable",
    governance: "enforced",
    syncPercent: 0,
  });

  useEffect(() => {
    loadUserContext();
  }, []);

  useEffect(() => {
    if (userContext) {
      loadSites();
      loadBadges();
      loadSystemHealth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userContext]);

  const loadUserContext = async () => {
    const context = await platformService.getCurrentUserContext();
    setUserContext(context);
    if (context?.default_site_id) {
      setSelectedSiteId(context.default_site_id);
    }
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
    setBadges({
      work: woRes.count || 0,
      governance: approvalRes.count || 0,
    });
  };

  const loadSystemHealth = async () => {
    if (!userContext) return;
    const { data } = await supabase
      .from("environment_health")
      .select("*")
      .eq("organization_id", userContext.organization_id)
      .order("status_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setSystemHealth({
        intelligence: data.intelligence_engine_status || "active",
        integration: data.integration_health_status || "stable",
        governance: data.governance_status || "enforced",
        syncPercent: data.data_sync_percent || 0,
      });
    }
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

  const getUserLevel = (): string => {
    if (!userContext?.roles?.length) return "operational";
    const level = userContext.roles[0].level?.toLowerCase() || "";
    if (level.includes("exec")) return "executive";
    if (level.includes("strateg")) return "strategic";
    if (level.includes("tactic")) return "tactical";
    return "operational";
  };

  const userLevel = getUserLevel();

  const allNavItems: NavItem[] = [
    {
      id: "overview",
      label: "Overview",
      icon: LayoutDashboard,
      path: "/overview",
    },
    {
      id: "performance",
      label: "Performance",
      icon: Activity,
      path: "/performance",
      requiredLevel: ["executive", "strategic", "tactical"],
    },
    {
      id: "oee",
      label: "OEE",
      icon: Gauge,
      path: "/oee",
      requiredLevel: ["executive", "strategic", "tactical"],
    },
    {
      id: "work",
      label: "Work",
      icon: Wrench,
      path: "/work",
      badge: badges.work || undefined,
    },
    {
      id: "governance",
      label: "Governance",
      icon: Shield,
      path: "/governance",
      badge: badges.governance || undefined,
      requiredLevel: ["executive", "strategic", "tactical"],
    },
    { id: "assets", label: "Assets", icon: Package, path: "/assets" },
    {
      id: "integrations",
      label: "Integrations",
      icon: Plug,
      path: "/integrations",
      requiredLevel: ["executive", "strategic"],
    },
    {
      id: "research",
      label: "Research",
      icon: FlaskConical,
      path: "/research",
      requiredLevel: ["executive"],
    },
    {
      id: "deployments",
      label: "Deployments",
      icon: Rocket,
      path: "/deployments",
      requiredLevel: ["executive", "strategic"],
    },
    { id: "settings", label: "Settings", icon: Settings, path: "/settings" },
  ];

  const navItems = allNavItems.filter((item) => {
    if (!item.requiredLevel) return true;
    return item.requiredLevel.includes(userLevel);
  });

  const healthStatusIcon = (status: string) => {
    if (["healthy", "active", "enforced", "stable"].includes(status)) {
      return <CheckCircle2 size={14} className="text-green-500" />;
    }
    if (["degraded", "warning"].includes(status)) {
      return <AlertTriangle size={14} className="text-yellow-500" />;
    }
    return <AlertTriangle size={14} className="text-red-500" />;
  };

  const selectedSite = sites.find((s) => s.id === selectedSiteId);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`bg-slate-900 text-white transition-all duration-300 flex-shrink-0 ${isCollapsed ? "w-16" : "w-64"} flex flex-col`}
      >
        {/* Logo */}
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center font-bold text-sm">
              SA
            </div>
            {!isCollapsed && (
              <div>
                <div className="font-bold text-sm">SyncAI</div>
                <div className="text-xs text-slate-400">
                  Industrial Intelligence
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Organization + Site Picker */}
        {!isCollapsed && userContext && (
          <div className="px-4 py-3 border-b border-slate-700">
            <div className="text-xs text-slate-400">Organization</div>
            <div className="text-sm font-medium truncate">
              {userContext.organization_name}
            </div>
            {userContext.roles && userContext.roles.length > 0 && (
              <div className="text-xs text-slate-400 mt-1">
                {userContext.roles[0].name}
              </div>
            )}
            {sites.length > 0 && (
              <div className="relative mt-2">
                <button
                  onClick={() => setSitePickerOpen(!sitePickerOpen)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 bg-slate-800 rounded-lg text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  <MapPin size={12} />
                  <span className="flex-1 text-left truncate">
                    {selectedSite?.name || "All Sites"}
                  </span>
                  <ChevronDown
                    size={12}
                    className={`transition-transform ${sitePickerOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {sitePickerOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                    <button
                      onClick={() => handleSiteChange(null)}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-700 ${!selectedSiteId ? "text-blue-400" : "text-slate-300"}`}
                    >
                      All Sites
                    </button>
                    {sites.map((site) => (
                      <button
                        key={site.id}
                        onClick={() => handleSiteChange(site.id)}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-700 ${selectedSiteId === site.id ? "text-blue-400" : "text-slate-300"}`}
                      >
                        {site.name} ({site.code})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                currentPath === item.path ||
                (item.path !== "/overview" &&
                  currentPath.startsWith(item.path));

              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.path)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors
                    ${isActive ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}
                    ${isCollapsed ? "justify-center" : ""}
                  `}
                >
                  <Icon size={20} />
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 text-left text-sm font-medium">
                        {item.label}
                      </span>
                      {item.badge ? (
                        <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                          {item.badge}
                        </span>
                      ) : null}
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
              ${isCollapsed ? "justify-center" : ""}
            `}
          >
            <LogOut size={20} />
            {!isCollapsed && (
              <span className="text-sm font-medium">Sign Out</span>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top Bar */}
        <header className="bg-white border-b border-slate-200 px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="text-slate-400 hover:text-slate-600"
              >
                <ChevronRight
                  size={20}
                  className={`transition-transform ${isCollapsed ? "" : "rotate-180"}`}
                />
              </button>
              <div className="text-sm font-medium text-slate-900">
                {navItems.find((item) => currentPath.startsWith(item.path))
                  ?.label || "Dashboard"}
              </div>
            </div>

            {/* System Status */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  {healthStatusIcon(systemHealth.intelligence)}
                  <span className="text-slate-600">
                    Intelligence:{" "}
                    <span className="font-medium text-slate-900 capitalize">
                      {systemHealth.intelligence}
                    </span>
                  </span>
                </div>
                <div className="w-px h-4 bg-slate-300" />
                <div className="flex items-center gap-1.5">
                  {healthStatusIcon(systemHealth.integration)}
                  <span className="text-slate-600">
                    Integration:{" "}
                    <span className="font-medium text-slate-900 capitalize">
                      {systemHealth.integration}
                    </span>
                  </span>
                </div>
                <div className="w-px h-4 bg-slate-300" />
                <div className="flex items-center gap-1.5">
                  {healthStatusIcon(systemHealth.governance)}
                  <span className="text-slate-600">
                    Governance:{" "}
                    <span className="font-medium text-slate-900 capitalize">
                      {systemHealth.governance}
                    </span>
                  </span>
                </div>
                {systemHealth.syncPercent > 0 && (
                  <>
                    <div className="w-px h-4 bg-slate-300" />
                    <div className="flex items-center gap-1.5">
                      <Gauge size={14} className="text-blue-500" />
                      <span className="text-slate-600">
                        Sync:{" "}
                        <span className="font-medium text-slate-900">
                          {systemHealth.syncPercent}%
                        </span>
                      </span>
                    </div>
                  </>
                )}
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
