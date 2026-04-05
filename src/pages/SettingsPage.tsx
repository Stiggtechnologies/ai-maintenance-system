import { useState, useEffect } from 'react';
import { User, Building2, Bell, Save, Check, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../components/AuthProvider';

type Tab = 'profile' | 'organization' | 'notifications';

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

const DEFAULT_PREFERENCES: NotificationPreferences = {
  email_alerts: true,
  work_order_updates: true,
  health_alerts: true,
  governance_notifications: false,
};

export function SettingsPage() {
  const { user, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('profile');

  const tabs: { id: Tab; label: string; icon: typeof User }[] = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'organization', label: 'Organization', icon: Building2 },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your profile, organization, and notification preferences</p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-6">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors
                  ${isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}
                `}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'profile' && <ProfileTab user={user} profile={profile} />}
      {activeTab === 'organization' && <OrganizationTab profile={profile} />}
      {activeTab === 'notifications' && <NotificationsTab user={user} profile={profile} />}
    </div>
  );
}

// ==================== Profile Tab ====================

function ProfileTab({ user, profile }: { user: any; profile: any }) {
  const [fullName, setFullName] = useState(profile?.full_name || '');
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
        .from('user_profiles')
        .update({ full_name: fullName })
        .eq('id', user.id);

      if (error) throw error;
      setToast('Profile updated successfully');
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      console.error('Failed to update profile:', err);
      setToast('Failed to update profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Profile Information</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter your full name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input
            type="text"
            value={user?.email || ''}
            readOnly
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-500 cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
          <input
            type="text"
            value={profile?.role || 'N/A'}
            readOnly
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-500 cursor-not-allowed capitalize"
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Save size={16} />
            )}
            Save Changes
          </button>

          {toast && (
            <div className={`flex items-center gap-1.5 text-sm ${toast.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>
              <Check size={16} />
              {toast}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== Organization Tab ====================

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
        .from('organizations')
        .select('*')
        .eq('id', profile.organization_id)
        .single();

      if (error) throw error;
      setOrg(data);
    } catch (err) {
      console.error('Failed to load organization:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="animate-spin text-blue-500" size={24} />
        <span className="ml-2 text-slate-500 text-sm">Loading organization...</span>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-2xl text-center">
        <Building2 className="mx-auto text-slate-300 mb-3" size={40} />
        <p className="text-sm text-slate-500">No organization found.</p>
      </div>
    );
  }

  const isAdmin = profile?.role === 'admin';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Organization Details</h2>
      {!isAdmin && (
        <p className="text-xs text-slate-400 mb-4">
          Contact an admin to update organization settings.
        </p>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Organization Name</label>
          <input
            type="text"
            value={org.name || ''}
            readOnly
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-500 cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Industry</label>
          <input
            type="text"
            value={org.industry || 'Not specified'}
            readOnly
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-500 cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Timezone</label>
          <input
            type="text"
            value={org.timezone || 'Not specified'}
            readOnly
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-500 cursor-not-allowed"
          />
        </div>
      </div>
    </div>
  );
}

// ==================== Notifications Tab ====================

function NotificationsTab({ user, profile }: { user: any; profile: any }) {
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    profile?.preferences?.notifications || DEFAULT_PREFERENCES
  );
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.preferences?.notifications) {
      setPreferences({ ...DEFAULT_PREFERENCES, ...profile.preferences.notifications });
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
        .from('user_profiles')
        .update({
          preferences: {
            ...existingPrefs,
            notifications: preferences,
          },
        })
        .eq('id', user.id);

      if (error) throw error;
      setToast('Notification preferences saved');
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      console.error('Failed to save preferences:', err);
      setToast('Failed to save preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleItems: { key: keyof NotificationPreferences; label: string; description: string }[] = [
    {
      key: 'email_alerts',
      label: 'Email Alerts',
      description: 'Receive important alerts and notifications via email',
    },
    {
      key: 'work_order_updates',
      label: 'Work Order Updates',
      description: 'Get notified when work orders are created, updated, or completed',
    },
    {
      key: 'health_alerts',
      label: 'Health Alerts',
      description: 'Receive alerts when asset health scores drop below thresholds',
    },
    {
      key: 'governance_notifications',
      label: 'Governance Notifications',
      description: 'Get notified about compliance and governance policy changes',
    },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Notification Preferences</h2>

      <div className="space-y-4">
        {toggleItems.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0"
          >
            <div>
              <div className="text-sm font-medium text-slate-900">{item.label}</div>
              <div className="text-xs text-slate-500 mt-0.5">{item.description}</div>
            </div>
            <button
              onClick={() => handleToggle(item.key)}
              className={`
                relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                ${preferences[item.key] ? 'bg-blue-600' : 'bg-slate-300'}
              `}
            >
              <span
                className={`
                  inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                  ${preferences[item.key] ? 'translate-x-6' : 'translate-x-1'}
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
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          Save Preferences
        </button>

        {toast && (
          <div className={`flex items-center gap-1.5 text-sm ${toast.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>
            <Check size={16} />
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
