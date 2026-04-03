import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Toast } from './Toast';
import { useTrialStore } from '../store/trialStore';
import { useUIStore } from '../store/uiStore';
import { Send, Menu, LogOut, Sparkles, AlertCircle, BarChart3, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { createTypewriterEffect } from '../utils/typewriter';

// Existing dashboards
import { ExecutiveDashboard } from './ExecutiveDashboard';
import { StrategicDashboard } from './StrategicDashboard';
import { TacticalDashboard } from './TacticalDashboard';
import { OperationalDashboard } from './OperationalDashboard';
import { AutonomousDashboard } from './AutonomousDashboard';
import { AIAnalyticsDashboard } from './AIAnalyticsDashboard';
import { AssetManagement } from './AssetManagement';
import { OpenClawControlPanel } from './OpenClawControlPanel';
import { OpenClawEnterprisePanel } from './OpenClawEnterprisePanel';

// Newly integrated components
import { BillingOverview } from './billing/BillingOverview';
import { ApprovalQueue } from './ApprovalQueue';
import { MetricsDashboard } from './MetricsDashboard';
import { WarRoomDashboard } from './WarRoomDashboard';
import { JavisPreferences } from './JavisPreferences';
import { JavisDockInteractive } from './JavisDockInteractive';

// NEW: Command Center Dashboard & Agent Control
import { CommandCenterDashboard } from './CommandCenterDashboard';
import { AgentControlCenter } from './AgentControlCenter';
import { AutonomyControlPanel } from './AutonomyControlPanel';
import { SustainabilityDashboard } from './SustainabilityDashboard';
import { IntegrationsDashboard } from './IntegrationsDashboard';
import { DecisionLogs } from './DecisionLogs';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  insights?: {
    summary?: string;
    risk?: string;
    financial?: string;
    actions?: string[];
    confidence?: string;
  };
}

type ActiveView =
  | 'command'
  | 'dashboard'
  | 'assets'
  | 'work-orders'
  | 'maintenance-planning'
  | 'reliability'
  | 'condition-monitoring'
  | 'inventory'
  | 'sustainability'
  | 'financial'
  | 'agents'
  | 'agent-control'
  | 'decision-engine'
  | 'autonomy-settings'
  | 'decision-logs'
  | 'analytics'
  | 'integrations'
  | 'risk'
  | 'reports'
  | 'settings'
  | 'admin'
  | 'executive'
  | 'strategic'
  | 'tactical'
  | 'operational'
  | 'autonomous'
  | 'openclaw'
  | 'openclaw-enterprise'
  | 'billing'
  | 'approvals'
  | 'metrics'
  | 'war-room';

export function CommandCenter() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [userName, setUserName] = useState('');
  const [firstLogin, setFirstLogin] = useState(true);
  const [activeView, setActiveView] = useState<ActiveView>('command');

  const { sessionsRemaining, decrementSession } = useTrialStore();
  const { toggleSidebar, executiveMode, toggleExecutiveMode } = useUIStore();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.full_name) {
        setUserName(user.user_metadata.full_name.split(' ')[0]);
      } else if (user?.email) {
        setUserName(user.email.split('@')[0]);
      }
    });
  }, []);

  const showToastNotification = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const suggestedPrompts = [
    'Identify downtime drivers',
    'Simulate PM optimization',
    'Analyze rotating asset risk',
    'Generate ISO 55000 gap assessment',
    'Build 3-year asset strategy',
  ];

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const generateResponse = async (userInput: string): Promise<Message> => {
    const responseMap: Record<string, Message> = {
      default: {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `I've analyzed the operational data for your query: "${userInput}". Based on your asset profile, I've identified key optimization pathways.`,
        insights: {
          summary: `Analysis of "${userInput}" reveals 3 primary intervention points with measurable ROI potential.`,
          risk: 'Medium-high exposure across rotating assets. Two critical failure modes detected in the prediction horizon.',
          financial: 'Estimated savings of $180K–$340K annually through targeted maintenance optimization.',
          actions: [
            'Prioritize vibration analysis on Pump A-12 and Motor B-7',
            'Adjust PM intervals based on condition data (extend by 15%)',
            'Deploy predictive model to compressor assets in Zone 3',
          ],
          confidence: '87%',
        },
      },
    };

    return new Promise((resolve) => {
      setTimeout(() => resolve(responseMap.default), 1500);
    });
  };

  const handleSendMessage = async () => {
    if (!input.trim() || sessionsRemaining === 0) {
      if (sessionsRemaining === 0) setShowUpgradeModal(true);
      return;
    }

    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setIsTyping(true);
    setFirstLogin(false);
    decrementSession();

    const response = await generateResponse(currentInput);
    setIsTyping(false);

    const messageId = response.id;
    const fullContent = response.content;

    setMessages((prev) => [...prev, { ...response, content: '' }]);

    createTypewriterEffect(fullContent, (partial) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, content: partial } : m))
      );
    });
  };

  const renderView = () => {
    switch (activeView) {
      case 'executive': return <ExecutiveDashboard />;
      case 'strategic': return <StrategicDashboard />;
      case 'tactical': return <TacticalDashboard />;
      case 'operational': return <OperationalDashboard />;
      case 'autonomous': return <AutonomousDashboard />;
      case 'analytics': return <AIAnalyticsDashboard />;
      case 'assets': return <AssetManagement />;
      case 'openclaw': return <OpenClawControlPanel />;
      case 'openclaw-enterprise': return <OpenClawEnterprisePanel />;
      case 'billing': return <BillingOverview />;
      case 'approvals': return <ApprovalQueue />;
      case 'metrics': return <MetricsDashboard />;
      case 'war-room': return <WarRoomDashboard />;
      case 'settings': return <JavisPreferences />;
      
      // NEW: Command Center Views
      case 'dashboard': return <CommandCenterDashboard />;
      case 'agent-control': return <AgentControlCenter />;
      case 'autonomy-settings': return <AutonomyControlPanel />;
      case 'maintenance-planning': return <OperationalDashboard />;
      case 'condition-monitoring': return <AIAnalyticsDashboard />;
      case 'sustainability': return <SustainabilityDashboard />;
      case 'financial': return <ExecutiveDashboard />;
      case 'integrations': return <IntegrationsDashboard />;
      case 'admin': return <JavisPreferences />;
      case 'decision-logs': return <DecisionLogs />;
      
      default: return null;
    }
  };

  const nonChatViews: ActiveView[] = ['executive','strategic','tactical','operational','autonomous','analytics','assets','openclaw','openclaw-enterprise','billing','approvals','metrics','war-room','settings'];
  const isNonChat = nonChatViews.includes(activeView);

  return (
    <div className="flex h-screen bg-[#0B0F14] overflow-hidden">
      {/* Sidebar */}
      <Sidebar activeView={activeView} onNavigate={(id) => setActiveView(id as ActiveView)} />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-14 border-b border-[#232A33] flex items-center justify-between px-6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSidebar}
              className="p-2 text-[#9BA7B4] hover:text-[#E6EDF3] hover:bg-[#161C24] rounded-lg transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            {activeView !== 'command' && (
              <span className="text-sm text-[#9BA7B4] capitalize">
                {activeView.replace('-', ' ')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {activeView === 'command' && (
              <button
                onClick={() => {
                  toggleExecutiveMode();
                  showToastNotification(executiveMode ? 'Standard Mode' : 'Executive Intelligence Mode Activated');
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  executiveMode
                    ? 'bg-[#3A8DFF]/10 border-[#3A8DFF]/30 text-[#3A8DFF]'
                    : 'bg-[#161C24] border-[#232A33] text-[#9BA7B4] hover:border-[#3A8DFF]/30 hover:text-[#E6EDF3]'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Executive Mode
              </button>
            )}

            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#161C24] border border-[#232A33] rounded-lg">
              <div className={`w-1.5 h-1.5 rounded-full ${sessionsRemaining > 3 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <span className="text-xs text-[#9BA7B4]">{sessionsRemaining} sessions</span>
            </div>

            <button
              onClick={() => supabase.auth.signOut()}
              className="p-2 text-[#9BA7B4] hover:text-[#E6EDF3] hover:bg-[#161C24] rounded-lg transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {isNonChat ? (
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="flex-1 overflow-auto"
            >
              {renderView()}
            </motion.div>
          ) : (
            <motion.div
              key="command"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              {/* Chat area */}
              <div className="flex-1 overflow-y-auto p-6">
                {firstLogin || messages.length === 0 ? (
                  <div className="max-w-3xl mx-auto mt-12">
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-center mb-12"
                    >
                      <div className="inline-flex items-center justify-center w-16 h-16 bg-[#3A8DFF]/10 rounded-2xl mb-6">
                        <Sparkles className="w-8 h-8 text-[#3A8DFF]" />
                      </div>
                      <h2 className="text-2xl font-semibold text-[#E6EDF3] mb-3">
                        {getGreeting()}{userName ? `, ${userName}` : ''}.
                      </h2>
                      <p className="text-[#9BA7B4] mb-8">
                        Your industrial AI platform is ready.
                        <br />
                        What operational constraint would you like to address?
                      </p>
                      <div className="flex flex-wrap gap-3 justify-center">
                        {suggestedPrompts.map((prompt) => (
                          <button
                            key={prompt}
                            onClick={() => setInput(prompt)}
                            className="px-4 py-2 bg-[#161C24] hover:bg-[#1A222C] border border-[#232A33] hover:border-[#3A8DFF]/30 rounded-lg text-sm text-[#E6EDF3] transition-all duration-150"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>

                      {/* Dashboard shortcuts */}
                      <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl mx-auto">
                        {[
                          { label: 'Executive View', view: 'executive' as ActiveView },
                          { label: 'Asset Health', view: 'assets' as ActiveView },
                          { label: 'AI Analytics', view: 'analytics' as ActiveView },
                          { label: 'Autonomous Ops', view: 'autonomous' as ActiveView },
                        ].map(({ label, view }) => (
                          <button
                            key={view}
                            onClick={() => setActiveView(view)}
                            className="flex items-center gap-2 px-3 py-2.5 bg-[#11161D] hover:bg-[#161C24] border border-[#232A33] hover:border-[#3A8DFF]/20 rounded-lg text-xs text-[#9BA7B4] hover:text-[#E6EDF3] transition-all"
                          >
                            <BarChart3 className="w-3.5 h-3.5 text-[#3A8DFF]" />
                            {label}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  </div>
                ) : (
                  <div className="max-w-3xl mx-auto space-y-6">
                    {messages.map((message) => (
                      <motion.div
                        key={message.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={message.role === 'user' ? 'flex justify-end' : ''}
                      >
                        {message.role === 'user' ? (
                          <div className="bg-[#3A8DFF] text-white px-4 py-3 rounded-lg max-w-[80%] text-sm">
                            {message.content}
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="text-[#E6EDF3] leading-relaxed text-sm">{message.content}</div>
                            {message.insights && (
                              <div className="grid gap-3 mt-4">
                                {message.insights.summary && (
                                  <div className="bg-[#161C24] border border-[#232A33] rounded-lg p-4">
                                    <h3 className="text-xs font-semibold text-[#3A8DFF] uppercase tracking-wide mb-2">Executive Summary</h3>
                                    <p className="text-sm text-[#E6EDF3]">{message.insights.summary}</p>
                                  </div>
                                )}
                                {message.insights.risk && (
                                  <div className="bg-[#161C24] border border-[#232A33] rounded-lg p-4">
                                    <h3 className="text-xs font-semibold text-[#3A8DFF] uppercase tracking-wide mb-2">Risk Exposure</h3>
                                    <p className="text-sm text-[#E6EDF3]">{message.insights.risk}</p>
                                  </div>
                                )}
                                {message.insights.financial && (
                                  <div className="bg-[#161C24] border border-[#232A33] rounded-lg p-4">
                                    <h3 className="text-xs font-semibold text-[#3A8DFF] uppercase tracking-wide mb-2">Financial Impact</h3>
                                    <p className="text-sm text-[#E6EDF3]">{message.insights.financial}</p>
                                  </div>
                                )}
                                {message.insights.actions && (
                                  <div className="bg-[#161C24] border border-[#232A33] rounded-lg p-4">
                                    <h3 className="text-xs font-semibold text-[#3A8DFF] uppercase tracking-wide mb-2">Recommended Actions</h3>
                                    <ul className="space-y-2">
                                      {message.insights.actions.map((action, i) => (
                                        <li key={i} className="text-sm text-[#E6EDF3] flex gap-2">
                                          <span className="text-[#3A8DFF] font-mono">{i + 1}.</span>
                                          {action}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {message.insights.confidence && (
                                  <p className="text-xs text-[#9BA7B4]">Confidence: {message.insights.confidence}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </motion.div>
                    ))}

                    {isTyping && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-1.5 py-2">
                        {[0, 0.15, 0.3].map((delay, i) => (
                          <div
                            key={i}
                            className="w-2 h-2 bg-[#3A8DFF] rounded-full animate-bounce"
                            style={{ animationDelay: `${delay}s` }}
                          />
                        ))}
                      </motion.div>
                    )}
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="border-t border-[#232A33] p-4 flex-shrink-0">
                <div className="max-w-3xl mx-auto flex gap-3">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    disabled={sessionsRemaining === 0}
                    placeholder={
                      sessionsRemaining === 0
                        ? 'Trial limit reached — upgrade to continue'
                        : 'Describe the operational constraint...'
                    }
                    className="flex-1 px-4 py-3 bg-[#161C24] border border-[#232A33] rounded-lg text-[#E6EDF3] placeholder-[#9BA7B4] text-sm focus:outline-none focus:border-[#3A8DFF] focus:ring-1 focus:ring-[#3A8DFF]/50 transition-colors disabled:opacity-50"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!input.trim() || sessionsRemaining === 0}
                    className="px-5 py-3 bg-[#3A8DFF] hover:bg-[#2E7AE6] text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 hover:shadow-lg hover:shadow-[#3A8DFF]/20"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Toast */}
      <AnimatePresence>
        <Toast message={toastMessage} show={showToast} onClose={() => setShowToast(false)} />
      </AnimatePresence>

      {/* Upgrade Modal */}
      <AnimatePresence>
        {showUpgradeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 z-50"
            onClick={() => setShowUpgradeModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#161C24] border border-[#232A33] rounded-xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center">
                    <AlertCircle className="w-5 h-5 text-amber-400" />
                  </div>
                  <h2 className="text-xl font-semibold text-[#E6EDF3]">Exploration Limit Reached</h2>
                </div>
                <button onClick={() => setShowUpgradeModal(false)} className="text-[#9BA7B4] hover:text-[#E6EDF3]">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-[#9BA7B4] mb-6 text-sm leading-relaxed">
                SyncAI has identified measurable operational optimization potential. Upgrade to activate continuous monitoring and multi-agent execution.
              </p>
              <div className="space-y-3">
                <button className="w-full py-3 px-4 bg-[#3A8DFF] hover:bg-[#2E7AE6] text-white font-medium rounded-lg transition-all hover:shadow-lg hover:shadow-[#3A8DFF]/20 text-sm">
                  Upgrade to Professional — $8,500 CAD/mo
                </button>
                <button className="w-full py-3 px-4 bg-[#11161D] hover:bg-[#161C24] border border-[#232A33] hover:border-[#3A8DFF]/30 text-[#E6EDF3] font-medium rounded-lg text-sm transition-all">
                  Speak With Enterprise Team
                </button>
                <button onClick={() => setShowUpgradeModal(false)} className="w-full py-2 text-xs text-[#9BA7B4] hover:text-[#E6EDF3]">
                  Maybe later
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* JAVIS Interactive Dock */}
      <JavisDockInteractive />
    </div>
  );
}
