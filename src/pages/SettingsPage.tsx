/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import { useState, useEffect } from "react";
import {
  User,
  Building2,
  Bell,
  Save,
  Check,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { MfaManager } from "../components/MfaManager";
import { supabase } from "../lib/supabase";
import { useAuth } from "../components/AuthProvider";
import {
  announceSyncFeatureFlagsChanged,
  SYNC_FEATURE_FLAGS,
  type SyncFeatureFlag,
} from "../hooks/useFeatureFlag";

type Tab =
  | "profile"
  | "security"
  | "organization"
  | "notifications"
  | "sync";

interface Organization {
  id: string;
  name: string;
  industry: string | null;
  timezone: string | null;
}

interface NotificationPreferences {
  email_alerts: boolean;
  work_order_updates: boolean;
  health_alerts: boolean;
  governance_notifications: boolean;
}

interface SyncFlagRow {
  flag_key: SyncFeatureFlag;
  enabled: boolean;
  description: string | null;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  email_alerts: true,
  work_order_updates: true,
  health_alerts: true,
  governance_notifications: false,
};

const SYNC_FLAG_LABELS: Record<SyncFeatureFlag, string> = {
  sync_global_shell: "Sync global shell",
  sync_voice_input: "Voice input",
  sync_voice_output: "Voice output",
  sync_agent_routing: "Specialist routing",
  sync_tools: "Governed actions",
  sync_meeting_mode: "Meeting mode",
  sync_field_mode: "Field mode",
};

const SYNC_FLAG_FALLBACKS: Record<SyncFeatureFlag, string> = {
  sync_global_shell:
    "Master gate for the persistent Sync interaction layer across the authenticated application.",
  sync_voice_input:
    "Enable speech-to-text input where the browser supports it.",
  sync_voice_output:
    "Enable text-to-speech playback with user-controlled interruption.",
  sync_agent_routing:
    "Route questions through the existing governed specialist registry.",
  sync_tools:
    "Allow Sync to propose governed application actions that still require explicit user confirmation.",
  sync_meeting_mode:
    "Enable facilitation mode with explicit decisions, dissent, actions and evidence gaps.",
  sync_field_mode:
    "Enable controlled field-guidance mode with procedure and safety boundaries.",
};

function isSyncAdmin(role: unknown): boolean {
  return role === "admin" || role === "ai_admin";
}

export function SettingsPage() {
  const { user, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const canManageSync = isSyncAdmin(profile?.role);

  const tabs: { id: Tab; label: string; icon: typeof User }[] = [
    { id: "profile", label: "Profile", icon: User },
    { id: "security", label: "Security", icon: ShieldCheck },
    { id: "organization", label: "Organization", icon: Building2 },
    { id: "notifications", label: "Notifications", icon: Bell },
    ...(canManageSync
      ? [{ id: "sync" as const, label: "Sync", icon: Sparkles }]
      : []),
  ];

  useEffect(() => {
    if (activeTab === "sync" && !canManageSync) setActiveTab("profile");
  }, [activeTab, canManageSync]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-industrial-text">Settings</h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage your profile, organization, and notification preferences
        </p>
      </div>

      <div className="border-b border-industrial-border overflow-x-auto">
        <nav className="flex gap-6 min-w-max">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors
                  ${
                    isActive
                      ? "border-signal-cyan text-signal-cyan"
                      : "border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-300"
                  }
                `}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === "profile" && <ProfileTab user={user} profile={profile} />}
      {activeTab === "security" && (
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-industrial-text">
              Account security
            </h2>
            <p className="text-sm text-slate-400">
              Protect your account with multi-factor authentication.
            </p>
          </div>
          <MfaManager />
        </div>
      )}
      {activeTab === "organization" && <OrganizationTab profile={profile} />}
      {activeTab === "notifications" && (
        <NotificationsTab user={user} profile={profile} />
      )}
      {activeTab === "sync" && canManageSync && <SyncRolloutTab />}
    </div>
  );
}

function ProfileTab({ user, profile }: { user: any; profile: any }) {
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.full_name) {
      setFullName(profile.full_name);
    }
  }, [profile]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setToast(null);

    try {
      const { error } = await supabase
        .from("user_profiles")
        .update({ full_name: fullName })
        .eq("id", user.id);

      if (error) throw error;
      setToast("Profile updated successfully");
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      console.error("Failed to update profile:", err);
      setToast("Failed to update profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass border border-white/6 rounded-xl p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-industrial-text mb-4">
        Profile Information
      </h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Full Name
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
            placeholder="Enter your full name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Email
          </label>
          <input
            type="text"
            value={user?.email || ""}
            readOnly
            className="w-full px-3 py-2 border border-industrial-border rounded-lg text-sm bg-industrial-black text-slate-400 cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Role
          </label>
          <input
            type="text"
            value={profile?.role || "N/A"}
            readOnly
            className="w-full px-3 py-2 border border-industrial-border rounded-lg text-sm bg-industrial-black text-slate-400 cursor-not-allowed capitalize"
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-signal-gold text-overlook-void rounded-lg hover:bg-signal-gold-soft disabled:opacity-50 text-sm font-medium"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            Save Changes
          </button>

          {toast && (
            <div
              className={`flex items-center gap-1.5 text-sm ${toast.includes("Failed") ? "text-red-600" : "text-green-600"}`}
            >
              <Check size={16} />
              {toast}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OrganizationTab({ profile }: { profile: any }) {
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrganization();
  }, [profile]);

  const loadOrganization = async () => {
    if (!profile?.organization_id) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", profile.organization_id)
        .single();

      if (error) throw error;
      setOrg(data);
    } catch (err) {
      console.error("Failed to load organization:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="animate-spin text-signal-cyan" size={24} />
        <span className="ml-2 text-slate-400 text-sm">
          Loading organization...
        </span>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="glass border border-white/6 rounded-xl p-6 max-w-2xl text-center">
        <Building2 className="mx-auto text-slate-300 mb-3" size={40} />
        <p className="text-sm text-slate-400">No organization found.</p>
      </div>
    );
  }

  const isAdmin = isSyncAdmin(profile?.role);

  return (
    <div className="glass border border-white/6 rounded-xl p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-industrial-text mb-4">
        Organization Details
      </h2>
      {!isAdmin && (
        <p className="text-xs text-slate-400 mb-4">
          Contact an admin to update organization settings.
        </p>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Organization Name
          </label>
          <input
            type="text"
            value={org.name || ""}
            readOnly
            className="w-full px-3 py-2 border border-industrial-border rounded-lg text-sm bg-industrial-black text-slate-400 cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Industry
          </label>
          <input
            type="text"
            value={org.industry || "Not specified"}
            readOnly
            className="w-full px-3 py-2 border border-industrial-border rounded-lg text-sm bg-industrial-black text-slate-400 cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Timezone
          </label>
          <input
            type="text"
            value={org.timezone || "Not specified"}
            readOnly
            className="w-full px-3 py-2 border border-industrial-border rounded-lg text-sm bg-industrial-black text-slate-400 cursor-not-allowed"
          />
        </div>
      </div>
    </div>
  );
}

function SyncRolloutTab() {
  const [flags, setFlags] = useState<Record<SyncFeatureFlag, SyncFlagRow>>(
    () =>
      Object.fromEntries(
        SYNC_FEATURE_FLAGS.map((key) => [
          key,
          { flag_key: key, enabled: false, description: null },
        ]),
      ) as Record<SyncFeatureFlag, SyncFlagRow>,
  );
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState<SyncFeatureFlag | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadFlags = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("feature_flags")
        .select("flag_key, enabled, description")
        .in("flag_key", [...SYNC_FEATURE_FLAGS]);
      if (error) throw error;
      setFlags((current) => {
        const next = { ...current };
        for (const row of data ?? []) {
          if (
            SYNC_FEATURE_FLAGS.includes(row.flag_key as SyncFeatureFlag)
          ) {
            const key = row.flag_key as SyncFeatureFlag;
            next[key] = {
              flag_key: key,
              enabled: row.enabled === true,
              description: row.description ?? null,
            };
          }
        }
        return next;
      });
    } catch (error) {
      console.error("Failed to load Sync rollout flags", error);
      setNotice("Could not load Sync rollout state.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFlags();
  }, []);

  const setFlag = async (key: SyncFeatureFlag, enabled: boolean) => {
    setChanging(key);
    setNotice(null);
    try {
      const { data, error } = await supabase.rpc("set_sync_feature_flag", {
        p_flag_key: key,
        p_enabled: enabled,
      });
      if (error) throw error;
      if (data && typeof data === "object" && "error" in data) {
        throw new Error(String((data as { error: unknown }).error));
      }
      setFlags((current) => ({
        ...current,
        [key]: { ...current[key], enabled },
      }));
      announceSyncFeatureFlagsChanged();
      setNotice(`${SYNC_FLAG_LABELS[key]} ${enabled ? "enabled" : "disabled"}.`);
    } catch (error) {
      console.error("Failed to change Sync rollout flag", error);
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not change the Sync rollout flag.",
      );
    } finally {
      setChanging(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Sync rollout controls…
      </div>
    );
  }

  const globalEnabled = flags.sync_global_shell.enabled;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="glass border border-white/6 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-teal-500/10 p-2 text-teal-300">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-industrial-text">
              Sync rollout
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Enable Sync per organization in controlled stages. Every change is
              authorized in the database and written to the audit log.
            </p>
          </div>
        </div>

        {!globalEnabled && (
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
            The global shell is the master gate. Other enabled capabilities stay
            inert until it is turned on.
          </div>
        )}

        <div className="mt-4 divide-y divide-white/6">
          {SYNC_FEATURE_FLAGS.map((key) => {
            const row = flags[key];
            const isChanging = changing === key;
            return (
              <div
                key={key}
                className="flex items-start justify-between gap-5 py-4"
              >
                <div>
                  <div className="text-sm font-medium text-industrial-text">
                    {SYNC_FLAG_LABELS[key]}
                  </div>
                  <div className="mt-1 max-w-xl text-xs leading-5 text-slate-400">
                    {row.description || SYNC_FLAG_FALLBACKS[key]}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.enabled}
                  aria-label={`${row.enabled ? "Disable" : "Enable"} ${SYNC_FLAG_LABELS[key]}`}
                  disabled={changing !== null}
                  onClick={() => void setFlag(key, !row.enabled)}
                  className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    row.enabled ? "bg-teal-500" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      row.enabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                  {isChanging && (
                    <Loader2 className="absolute -left-6 h-3.5 w-3.5 animate-spin text-slate-400" />
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {notice && (
          <div className="mt-3 text-xs text-slate-300" role="status">
            {notice}
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationsTab({ user, profile }: { user: any; profile: any }) {
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    profile?.preferences?.notifications || DEFAULT_PREFERENCES,
  );
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.preferences?.notifications) {
      setPreferences({
        ...DEFAULT_PREFERENCES,
        ...profile.preferences.notifications,
      });
    }
  }, [profile]);

  const handleToggle = (key: keyof NotificationPreferences) => {
    setPreferences((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setToast(null);

    try {
      const existingPrefs = profile?.preferences || {};
      const { error } = await supabase
        .from("user_profiles")
        .update({
          preferences: {
            ...existingPrefs,
            notifications: preferences,
          },
        })
        .eq("id", user.id);

      if (error) throw error;
      setToast("Notification preferences saved");
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      console.error("Failed to save preferences:", err);
      setToast("Failed to save preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const toggleItems: {
    key: keyof NotificationPreferences;
    label: string;
    description: string;
  }[] = [
    {
      key: "email_alerts",
      label: "Email Alerts",
      description: "Receive important alerts and notifications via email",
    },
    {
      key: "work_order_updates",
      label: "Work Order Updates",
      description:
        "Get notified when work orders are created, updated, or completed",
    },
    {
      key: "health_alerts",
      label: "Health Alerts",
      description:
        "Receive alerts when asset health scores drop below thresholds",
    },
    {
      key: "governance_notifications",
      label: "Governance Notifications",
      description:
        "Get notified about compliance and governance policy changes",
    },
  ];

  return (
    <div className="glass border border-white/6 rounded-xl p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-industrial-text mb-4">
        Notification Preferences
      </h2>

      <div className="space-y-4">
        {toggleItems.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between py-3 border-b border-[#1A2030] last:border-0"
          >
            <div>
              <div className="text-sm font-medium text-industrial-text">
                {item.label}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {item.description}
              </div>
            </div>
            <button
              onClick={() => handleToggle(item.key)}
              className={`
                relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                ${preferences[item.key] ? "bg-signal-gold" : "bg-slate-300"}
              `}
            >
              <span
                className={`
                  inline-block h-4 w-4 transform rounded-full bg-industrial-graphite transition-transform
                  ${preferences[item.key] ? "translate-x-6" : "translate-x-1"}
                `}
              />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-signal-gold text-overlook-void rounded-lg hover:bg-signal-gold-soft disabled:opacity-50 text-sm font-medium"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          Save Preferences
        </button>

        {toast && (
          <div
            className={`flex items-center gap-1.5 text-sm ${toast.includes("Failed") ? "text-red-600" : "text-green-600"}`}
          >
            <Check size={16} />
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
