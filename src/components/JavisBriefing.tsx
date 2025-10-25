import { useState, useEffect } from 'react';
import { Calendar, Clock, TrendingUp, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface BriefSection {
  title: string;
  items: string[];
  priority: number;
}

interface Brief {
  summary: string;
  sections: BriefSection[];
  citations: any[];
  metadata: {
    role: string;
    timestamp: string;
  };
}

export function JavisBriefing() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [greeting, setGreeting] = useState('');
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    loadBrief();
  }, []);

  const loadBrief = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('tenant_id, display_name')
        .eq('id', user.id)
        .single();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/javis-orchestrator/brief`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tenant_id: profile?.tenant_id,
            user_id: user.id,
            time_of_day: getTimeOfDay()
          })
        }
      );

      const data = await response.json();

      setGreeting(data.greeting);
      setBrief(data.brief);
      setRole(data.role);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error loading brief:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTimeOfDay = (): 'morning' | 'afternoon' | 'evening' => {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  };

  const getSectionIcon = (title: string) => {
    if (title.toLowerCase().includes('kpi') || title.toLowerCase().includes('performance')) {
      return <TrendingUp className="w-5 h-5 text-teal-600" />;
    }
    if (title.toLowerCase().includes('alert')) {
      return <AlertTriangle className="w-5 h-5 text-amber-600" />;
    }
    if (title.toLowerCase().includes('work order')) {
      return <CheckCircle className="w-5 h-5 text-blue-600" />;
    }
    return <Calendar className="w-5 h-5 text-gray-600" />;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-teal-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading your briefing...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-50 to-blue-50 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-lg p-8 mb-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {greeting}
              </h1>
              <p className="text-gray-600">
                Your {role} briefing is ready
              </p>
            </div>
            <button
              onClick={loadBrief}
              className="flex items-center gap-2 px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>

          {lastUpdated && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Clock className="w-4 h-4" />
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
          )}
        </div>

        {/* Summary */}
        {brief && (
          <div className="bg-white rounded-2xl shadow-lg p-8 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Summary</h2>
            <p className="text-gray-700 leading-relaxed">
              {brief.summary}
            </p>
          </div>
        )}

        {/* Sections */}
        {brief?.sections && brief.sections.length > 0 && (
          <div className="space-y-6">
            {brief.sections
              .sort((a, b) => a.priority - b.priority)
              .map((section, idx) => (
                <div
                  key={idx}
                  className="bg-white rounded-2xl shadow-lg p-6 hover:shadow-xl transition-shadow"
                >
                  <div className="flex items-center gap-3 mb-4">
                    {getSectionIcon(section.title)}
                    <h3 className="text-lg font-semibold text-gray-900">
                      {section.title}
                    </h3>
                  </div>

                  <div className="space-y-3">
                    {section.items.map((item, itemIdx) => (
                      <div
                        key={itemIdx}
                        className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="w-6 h-6 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-xs font-semibold text-teal-600">
                            {itemIdx + 1}
                          </span>
                        </div>
                        <p className="text-gray-700 flex-1">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Citations */}
        {brief?.citations && brief.citations.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-6 mt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Sources</h3>
            <div className="space-y-2">
              {brief.citations.map((citation, idx) => (
                <div
                  key={idx}
                  className="text-sm text-gray-600 flex items-center gap-2"
                >
                  <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-xs font-semibold">
                    {idx + 1}
                  </span>
                  <span>{citation.document_title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {brief?.sections && brief.sections.length === 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              All Systems Operational
            </h3>
            <p className="text-gray-600">
              No action items at this time. Enjoy your day!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
