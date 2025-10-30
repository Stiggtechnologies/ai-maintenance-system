import { useState, useEffect } from 'react';
import { Volume2, Clock, Bell, Save, TestTube } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function JavisPreferences() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferences, setPreferences] = useState({
    display_name: '',
    prefers_voice: false,
    voice_locale: 'en-CA',
    voice_gender: 'neutral',
    voice_speed: 1.0,
    morning_brief_time: '07:30',
    javis_enabled: true,
    timezone: 'America/Toronto',
    notify_channels: {
      in_app: true,
      email: false,
      sms: false,
      push: true
    }
  });

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('tenant_id, display_name')
        .eq('id', user.id)
        .single();

      if (!profile) return;

      const { data: prefs } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      if (prefs) {
        setPreferences({
          display_name: prefs.display_name || profile.display_name || '',
          prefers_voice: prefs.prefers_voice || false,
          voice_locale: prefs.voice_locale || 'en-CA',
          voice_gender: prefs.voice_gender || 'neutral',
          voice_speed: prefs.voice_speed || 1.0,
          morning_brief_time: prefs.morning_brief_time || '07:30',
          javis_enabled: prefs.javis_enabled ?? true,
          timezone: prefs.timezone || 'America/Toronto',
          notify_channels: prefs.notify_channels || {
            in_app: true,
            email: false,
            sms: false,
            push: true
          }
        });
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async () => {
    try {
      setSaving(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/javis-orchestrator/preferences`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tenant_id: profile?.tenant_id,
            user_id: user.id,
            ...preferences
          })
        }
      );

      if (!response.ok) throw new Error('Failed to save preferences');

      alert('Preferences saved successfully!');
    } catch (error) {
      console.error('Error saving preferences:', error);
      alert('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const testVoice = () => {
    if (!('speechSynthesis' in window)) {
      alert('Speech synthesis not supported in this browser');
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      `Good morning. This is a test of J.A.V.I.S voice output at ${preferences.voice_speed} speed.`
    );
    utterance.rate = preferences.voice_speed;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Loading preferences...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">
            J.A.V.I.S Preferences
          </h1>

          {/* General Settings */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">General</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Display Name
                </label>
                <input
                  type="text"
                  value={preferences.display_name}
                  onChange={(e) => setPreferences({ ...preferences, display_name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  placeholder="How J.A.V.I.S should address you"
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="javis-enabled"
                  checked={preferences.javis_enabled}
                  onChange={(e) => setPreferences({ ...preferences, javis_enabled: e.target.checked })}
                  className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                />
                <label htmlFor="javis-enabled" className="text-sm font-medium text-gray-700">
                  Enable J.A.V.I.S Assistant
                </label>
              </div>
            </div>
          </div>

          {/* Voice Settings */}
          <div className="mb-8 pb-8 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Volume2 className="w-5 h-5" />
              Voice Settings
            </h2>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="prefers-voice"
                  checked={preferences.prefers_voice}
                  onChange={(e) => setPreferences({ ...preferences, prefers_voice: e.target.checked })}
                  className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                />
                <label htmlFor="prefers-voice" className="text-sm font-medium text-gray-700">
                  Enable voice responses
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Voice Locale
                </label>
                <select
                  value={preferences.voice_locale}
                  onChange={(e) => setPreferences({ ...preferences, voice_locale: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  disabled={!preferences.prefers_voice}
                >
                  <option value="en-CA">English (Canada)</option>
                  <option value="en-US">English (United States)</option>
                  <option value="en-GB">English (United Kingdom)</option>
                  <option value="fr-CA">French (Canada)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Voice Speed: {preferences.voice_speed.toFixed(1)}x
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={preferences.voice_speed}
                  onChange={(e) => setPreferences({ ...preferences, voice_speed: parseFloat(e.target.value) })}
                  className="w-full"
                  disabled={!preferences.prefers_voice}
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Slow</span>
                  <span>Normal</span>
                  <span>Fast</span>
                </div>
              </div>

              <button
                onClick={testVoice}
                disabled={!preferences.prefers_voice}
                className="flex items-center gap-2 px-4 py-2 bg-teal-100 text-teal-700 rounded-lg hover:bg-teal-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <TestTube className="w-4 h-4" />
                Test Voice
              </button>
            </div>
          </div>

          {/* Briefing Schedule */}
          <div className="mb-8 pb-8 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Briefing Schedule
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Morning Brief Time
                </label>
                <input
                  type="time"
                  value={preferences.morning_brief_time}
                  onChange={(e) => setPreferences({ ...preferences, morning_brief_time: e.target.value })}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  When J.A.V.I.S should prepare your daily briefing
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Timezone
                </label>
                <select
                  value={preferences.timezone}
                  onChange={(e) => setPreferences({ ...preferences, timezone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                >
                  <option value="America/Toronto">Eastern Time</option>
                  <option value="America/Chicago">Central Time</option>
                  <option value="America/Denver">Mountain Time</option>
                  <option value="America/Los_Angeles">Pacific Time</option>
                  <option value="America/Vancouver">Pacific Time (Vancouver)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Notification Channels */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notification Channels
            </h2>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="notify-in-app"
                  checked={preferences.notify_channels.in_app}
                  onChange={(e) => setPreferences({
                    ...preferences,
                    notify_channels: { ...preferences.notify_channels, in_app: e.target.checked }
                  })}
                  className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                />
                <label htmlFor="notify-in-app" className="text-sm font-medium text-gray-700">
                  In-app notifications
                </label>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="notify-push"
                  checked={preferences.notify_channels.push}
                  onChange={(e) => setPreferences({
                    ...preferences,
                    notify_channels: { ...preferences.notify_channels, push: e.target.checked }
                  })}
                  className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                />
                <label htmlFor="notify-push" className="text-sm font-medium text-gray-700">
                  Push notifications
                </label>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="notify-email"
                  checked={preferences.notify_channels.email}
                  onChange={(e) => setPreferences({
                    ...preferences,
                    notify_channels: { ...preferences.notify_channels, email: e.target.checked }
                  })}
                  className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                />
                <label htmlFor="notify-email" className="text-sm font-medium text-gray-700">
                  Email notifications
                </label>
              </div>

              <div className="flex items-center gap-3 opacity-50">
                <input
                  type="checkbox"
                  id="notify-sms"
                  checked={preferences.notify_channels.sms}
                  onChange={(e) => setPreferences({
                    ...preferences,
                    notify_channels: { ...preferences.notify_channels, sms: e.target.checked }
                  })}
                  className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500"
                  disabled
                />
                <label htmlFor="notify-sms" className="text-sm font-medium text-gray-700">
                  SMS notifications (coming soon)
                </label>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => window.history.back()}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={savePreferences}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
