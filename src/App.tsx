import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { AssetManagement } from './components/AssetManagement';
import { WorkOrderManagement } from './components/WorkOrderManagement';
import { AIAnalyticsDashboard } from './components/AIAnalyticsDashboard';
import {
  Home,
  Globe,
  Layers,
  User,
  ArrowUp,
  Download,
  Plus,
  Search,
  Image,
  Paperclip,
  Globe2,
  Mic,
  ArrowUpCircle,
  BarChart3,
  Wrench,
  Activity,
  GraduationCap,
  FileCheck,
  Zap
} from 'lucide-react';

function App() {
  const [activeView, setActiveView] = useState('home');
  const [selectedSpace, setSelectedSpace] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{role: string, content: string}>>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [metrics, setMetrics] = useState({
    totalAssets: 2847,
    activeWorkOrders: 156,
    esgScore: 87.3,
    costSavings: '2.4M',
    uptime: 98.7,
    efficiency: 94.2
  });

  useEffect(() => {
    const fetchMetrics = async () => {
      const { data, error } = await supabase
        .from('maintenance_metrics')
        .select('*')
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data && !error) {
        setMetrics({
          totalAssets: data.total_assets,
          activeWorkOrders: data.active_work_orders,
          esgScore: data.esg_score,
          costSavings: (data.cost_savings / 1000000).toFixed(1) + 'M',
          uptime: data.uptime,
          efficiency: data.efficiency
        });
      }
    };

    fetchMetrics();
  }, []);

  const spaces = [
    { id: 'oil-gas', name: 'Oil & Gas', icon: Zap },
    { id: 'mining', name: 'Mining', icon: Layers },
    { id: 'utilities', name: 'Power & Utilities', icon: Zap },
    { id: 'manufacturing', name: 'Manufacturing', icon: Wrench },
    { id: 'aerospace', name: 'Aerospace', icon: Globe2 }
  ];

  const quickActions = [
    { id: 'compare', label: 'Compare', icon: BarChart3, action: 'DataAnalyticsAgent' },
    { id: 'troubleshoot', label: 'Troubleshoot', icon: Wrench, action: 'ReliabilityEngineeringAgent' },
    { id: 'health', label: 'Health', icon: Activity, action: 'ConditionMonitoringAgent' },
    { id: 'learn', label: 'Learn', icon: GraduationCap, action: 'TrainingWorkforceAgent' },
    { id: 'fact-check', label: 'Fact Check', icon: FileCheck, action: 'ComplianceAuditingAgent' }
  ];

  const executeAgent = async (agentId: string, industry?: string) => {
    setIsProcessing(true);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase configuration missing. Please check your .env file.');
      }

      const apiUrl = `${supabaseUrl}/functions/v1/ai-agent-processor`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentType: agentId,
          industry: industry || selectedSpace || 'general'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      if (data.success) {
        setChatMessages(prev => [...prev,
          { role: 'assistant', content: data.response }
        ]);
      } else {
        setChatMessages(prev => [...prev,
          { role: 'assistant', content: `Error: ${data.error || 'Failed to process request'}` }
        ]);
      }
    } catch (error) {
      console.error('Error executing agent:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setChatMessages(prev => [...prev,
        { role: 'assistant', content: `Error: ${errorMessage}` }
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuickAction = (actionId: string) => {
    const action = quickActions.find(a => a.id === actionId);
    if (action) {
      setChatMessages(prev => [...prev,
        { role: 'user', content: `Analyze using ${action.label}` }
      ]);
      executeAgent(action.action);
    }
  };

  const handleChatSubmit = async () => {
    if (!chatInput.trim() || isProcessing) return;

    setChatMessages(prev => [...prev,
      { role: 'user', content: chatInput }
    ]);

    const input = chatInput.toLowerCase();
    let agentToCall = 'MaintenanceStrategyDevelopmentAgent';

    if (input.includes('reliability') || input.includes('failure')) {
      agentToCall = 'ReliabilityEngineeringAgent';
    } else if (input.includes('work order')) {
      agentToCall = 'WorkOrderManagementAgent';
    } else if (input.includes('asset')) {
      agentToCall = 'AssetManagementAgent';
    } else if (input.includes('schedule') || input.includes('planning')) {
      agentToCall = 'PlanningSchedulingAgent';
    } else if (input.includes('compliance') || input.includes('audit')) {
      agentToCall = 'ComplianceAuditingAgent';
    } else if (input.includes('esg') || input.includes('sustainability')) {
      agentToCall = 'SustainabilityESGAgent';
    } else if (input.includes('training') || input.includes('workforce')) {
      agentToCall = 'TrainingWorkforceAgent';
    } else if (input.includes('inventory') || input.includes('spare')) {
      agentToCall = 'InventoryManagementAgent';
    } else if (input.includes('cost') || input.includes('budget')) {
      agentToCall = 'FinancialContractAgent';
    } else if (input.includes('quality')) {
      agentToCall = 'QualityAssuranceAgent';
    } else if (input.includes('data') || input.includes('analytics')) {
      agentToCall = 'DataAnalyticsAgent';
    }

    setChatInput('');
    await executeAgent(agentToCall);
  };

  const renderHomeView = () => (
    <div className="flex-1 flex flex-col items-center justify-center px-4">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold text-gray-900 mb-2">
          SyncAI<span className="inline-block bg-teal-600 text-white text-sm px-2 py-1 rounded ml-2 align-middle">pro</span>
        </h1>
        <p className="text-gray-500 mt-4">AI-Powered Asset Performance Management</p>
      </div>

      <div className="w-full max-w-4xl">
        <div className="relative mb-8">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleChatSubmit()}
            placeholder="Ask anything or @mention a Space"
            className="w-full px-6 py-4 pr-48 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-base"
            disabled={isProcessing}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Search className="w-5 h-5 text-gray-400" />
            </button>
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Image className="w-5 h-5 text-gray-400" />
            </button>
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Paperclip className="w-5 h-5 text-gray-400" />
            </button>
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Globe2 className="w-5 h-5 text-gray-400" />
            </button>
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Mic className="w-5 h-5 text-gray-400" />
            </button>
            <button
              onClick={handleChatSubmit}
              disabled={!chatInput.trim() || isProcessing}
              className="p-2 bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowUpCircle className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-3 mb-8">
          {quickActions.map((action) => (
            <button
              key={action.id}
              onClick={() => handleQuickAction(action.id)}
              disabled={isProcessing}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <action.icon className="w-4 h-4 text-gray-600" />
              <span className="text-sm text-gray-700">{action.label}</span>
            </button>
          ))}
        </div>

        {chatMessages.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 max-h-96 overflow-y-auto space-y-4">
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-3xl px-4 py-3 rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-teal-600 text-white'
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  <pre className="whitespace-pre-wrap font-sans text-sm">{msg.content}</pre>
                </div>
              </div>
            ))}
            {isProcessing && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-800 px-4 py-3 rounded-2xl">
                  <div className="flex gap-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-4xl">
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">{metrics.totalAssets.toLocaleString()}</div>
          <div className="text-sm text-gray-500">Assets Monitored</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">{metrics.uptime}%</div>
          <div className="text-sm text-gray-500">System Uptime</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">${metrics.costSavings}</div>
          <div className="text-sm text-gray-500">Annual Savings</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <div className="text-2xl font-bold text-gray-900">{metrics.esgScore}%</div>
          <div className="text-sm text-gray-500">ESG Score</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50">
      <div className="w-20 bg-white border-r border-gray-200 flex flex-col items-center py-4">
        <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center mb-8">
          <Zap className="w-6 h-6 text-white" />
        </div>

        <button className="w-10 h-10 mb-8 flex items-center justify-center hover:bg-gray-100 rounded-lg transition-colors">
          <Plus className="w-5 h-5 text-gray-600" />
        </button>

        <div className="flex-1 flex flex-col gap-6">
          <button
            onClick={() => setActiveView('home')}
            className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg transition-colors ${
              activeView === 'home' ? 'bg-gray-100' : 'hover:bg-gray-50'
            }`}
          >
            <Home className="w-5 h-5 text-gray-600" />
            <span className="text-xs text-gray-600">Home</span>
          </button>

          <button
            onClick={() => setActiveView('discover')}
            className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg transition-colors ${
              activeView === 'discover' ? 'bg-gray-100' : 'hover:bg-gray-50'
            }`}
          >
            <Globe className="w-5 h-5 text-gray-600" />
            <span className="text-xs text-gray-600">Discover</span>
          </button>

          <button
            onClick={() => setActiveView('spaces')}
            className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg transition-colors ${
              activeView === 'spaces' ? 'bg-gray-100' : 'hover:bg-gray-50'
            }`}
          >
            <Layers className="w-5 h-5 text-gray-600" />
            <span className="text-xs text-gray-600">Spaces</span>
          </button>
        </div>

        <div className="flex flex-col gap-4 mt-auto">
          <button className="flex flex-col items-center gap-1 px-2 py-2 hover:bg-gray-50 rounded-lg transition-colors">
            <User className="w-5 h-5 text-gray-600" />
            <span className="text-xs text-gray-600">Account</span>
          </button>

          <button className="flex flex-col items-center gap-1 px-2 py-2 hover:bg-gray-50 rounded-lg transition-colors">
            <ArrowUp className="w-5 h-5 text-gray-600" />
            <span className="text-xs text-gray-600">Upgrade</span>
          </button>

          <button className="flex flex-col items-center gap-1 px-2 py-2 hover:bg-gray-50 rounded-lg transition-colors relative">
            <Download className="w-5 h-5 text-gray-600" />
            <span className="text-xs text-gray-600">Install</span>
            <div className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></div>
          </button>
        </div>
      </div>

      {activeView === 'home' && renderHomeView()}

      {activeView === 'discover' && (
        <div className="flex-1 overflow-y-auto p-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-8">Discover AI Agents</h2>
          <AIAnalyticsDashboard />
        </div>
      )}

      {activeView === 'spaces' && (
        <div className="flex-1 overflow-y-auto p-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-8">Industry Spaces</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {spaces.map((space) => (
              <button
                key={space.id}
                onClick={() => {
                  setSelectedSpace(space.name);
                  setActiveView('home');
                }}
                className="bg-white p-6 rounded-2xl border border-gray-200 hover:border-teal-500 hover:shadow-lg transition-all text-left"
              >
                <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center mb-4">
                  <space.icon className="w-6 h-6 text-teal-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{space.name}</h3>
                <p className="text-sm text-gray-500">Specialized AI agents for {space.name.toLowerCase()} operations</p>
              </button>
            ))}
          </div>

          <div className="mt-12">
            <h3 className="text-2xl font-bold text-gray-900 mb-6">Asset Management</h3>
            <AssetManagement />
          </div>

          <div className="mt-12">
            <h3 className="text-2xl font-bold text-gray-900 mb-6">Work Orders</h3>
            <WorkOrderManagement />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
