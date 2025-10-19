import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Bot, TrendingUp, Clock, Zap } from 'lucide-react';

interface AIAgentLog {
  id: string;
  agent_type: string;
  industry: string;
  processing_time_ms: number;
  created_at: string;
}

interface AgentStats {
  agentType: string;
  count: number;
  avgProcessingTime: number;
  lastUsed: string;
}

export const AIAnalyticsDashboard = () => {
  const [logs, setLogs] = useState<AIAgentLog[]>([]);
  const [stats, setStats] = useState<AgentStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalRequests, setTotalRequests] = useState(0);
  const [avgResponseTime, setAvgResponseTime] = useState(0);

  useEffect(() => {
    fetchLogs();
    const subscription = supabase
      .channel('ai_agent_logs_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'ai_agent_logs' },
        () => {
          fetchLogs();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const fetchLogs = async () => {
    setIsLoading(true);

    const { data, error } = await supabase
      .from('ai_agent_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!error && data) {
      setLogs(data);
      calculateStats(data);
    }
    setIsLoading(false);
  };

  const calculateStats = (logData: AIAgentLog[]) => {
    setTotalRequests(logData.length);

    const totalTime = logData.reduce((sum, log) => sum + (log.processing_time_ms || 0), 0);
    setAvgResponseTime(logData.length > 0 ? Math.round(totalTime / logData.length) : 0);

    const agentMap = new Map<string, { count: number; totalTime: number; lastUsed: string }>();

    logData.forEach(log => {
      const existing = agentMap.get(log.agent_type) || { count: 0, totalTime: 0, lastUsed: log.created_at };
      agentMap.set(log.agent_type, {
        count: existing.count + 1,
        totalTime: existing.totalTime + (log.processing_time_ms || 0),
        lastUsed: log.created_at > existing.lastUsed ? log.created_at : existing.lastUsed
      });
    });

    const agentStats: AgentStats[] = Array.from(agentMap.entries()).map(([agentType, data]) => ({
      agentType: agentType.replace('Agent', ''),
      count: data.count,
      avgProcessingTime: Math.round(data.totalTime / data.count),
      lastUsed: data.lastUsed
    }));

    agentStats.sort((a, b) => b.count - a.count);
    setStats(agentStats.slice(0, 10));
  };

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">AI Agent Analytics</h2>
        <p className="text-gray-600">Real-time insights into AI agent performance and usage</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Requests</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{totalRequests}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Bot className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm">
            <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
            <span className="text-green-600">Live tracking</span>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Response Time</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{avgResponseTime}ms</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <Zap className="w-6 h-6 text-green-600" />
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm">
            <Clock className="w-4 h-4 text-blue-500 mr-1" />
            <span className="text-blue-600">Real-time</span>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Agents</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{stats.length}</p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <Bot className="w-6 h-6 text-purple-600" />
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm">
            <span className="text-purple-600">Out of 15 total</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Top AI Agents by Usage</h3>
          <div className="space-y-3">
            {stats.map((stat, index) => (
              <div key={stat.agentType} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-sm font-bold text-blue-600">{index + 1}</span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{stat.agentType}</p>
                    <p className="text-xs text-gray-500">Last used: {getTimeAgo(stat.lastUsed)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900">{stat.count}</p>
                  <p className="text-xs text-gray-500">{stat.avgProcessingTime}ms avg</p>
                </div>
              </div>
            ))}

            {stats.length === 0 && !isLoading && (
              <div className="text-center py-8 text-gray-500">
                No agent activity yet. Try running some AI agents!
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Recent Activity</h3>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {logs.slice(0, 20).map((log) => (
              <div key={log.id} className="flex items-start justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <p className="font-medium text-gray-900 text-sm">
                    {log.agent_type.replace('Agent', '')}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {log.industry} • {getTimeAgo(log.created_at)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-medium text-blue-600">
                    {log.processing_time_ms}ms
                  </span>
                </div>
              </div>
            ))}

            {logs.length === 0 && !isLoading && (
              <div className="text-center py-8 text-gray-500">
                No recent activity
              </div>
            )}
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading analytics...</p>
        </div>
      )}
    </div>
  );
};
