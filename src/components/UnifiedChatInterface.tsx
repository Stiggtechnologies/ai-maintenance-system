import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthProvider';
import { Send, Mic, MicOff, Loader2, Sparkles } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export function UnifiedChatInterface() {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [orgLevel, setOrgLevel] = useState<string>('');

  useEffect(() => {
    loadOrgLevel();
    setMessages([{
      role: 'assistant',
      content: getWelcomeMessage(),
      timestamp: new Date()
    }]);
  }, [profile]);

  const loadOrgLevel = async () => {
    if (!user) return;

    try {
      const { data } = await supabase
        .from('user_profiles')
        .select(`
          organizational_levels (level_name, level_code)
        `)
        .eq('id', user.id)
        .maybeSingle();

      if (data?.organizational_levels && typeof data.organizational_levels === 'object' && 'level_name' in data.organizational_levels) {
        setOrgLevel((data.organizational_levels as any).level_name);
      }
    } catch (error) {
      console.error('Error loading org level:', error);
    }
  };

  const getWelcomeMessage = () => {
    const level = orgLevel || 'User';
    return `Hello! I'm your AI assistant, tailored for ${level} level users. I can help you with:

**Quick Actions:**
- "Show my KPIs"
- "What needs attention?"
- "Show my work orders"
- "What alerts are active?"
- "Analyze asset health"

Ask me anything about your operations, and I'll provide insights based on your role and access level.`;
  };

  const getRoleContext = () => {
    const levelCode = orgLevel.toLowerCase();

    if (levelCode.includes('executive')) {
      return 'strategic KOI performance, stakeholder value, asset management maturity, and board-level insights';
    } else if (levelCode.includes('strategic')) {
      return 'departmental KPIs, resource allocation, planning support, and decision traceability';
    } else if (levelCode.includes('tactical')) {
      return 'work order management, team performance, approvals, and operational KPIs';
    } else if (levelCode.includes('operational') || levelCode.includes('field')) {
      return 'assigned tasks, procedures, safety protocols, and field execution';
    }
    return 'general operations and performance metrics';
  };

  const handleSend = async () => {
    if (!input.trim() || isProcessing) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsProcessing(true);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const openaiKey = import.meta.env.VITE_OPENAI_API_KEY;

      const query = input.toLowerCase();
      let agentType = 'CentralCoordinationAgent';

      if (query.includes('kpi') || query.includes('performance') || query.includes('metric')) {
        agentType = 'PerformanceAnalysisAgent';
      } else if (query.includes('work order') || query.includes('task') || query.includes('maintenance')) {
        agentType = 'WorkOrderAgent';
      } else if (query.includes('asset') || query.includes('equipment') || query.includes('health')) {
        agentType = 'AssetHealthAgent';
      } else if (query.includes('alert') || query.includes('alarm') || query.includes('warning')) {
        agentType = 'CentralCoordinationAgent';
      }

      const contextualQuery = `[User Role: ${orgLevel}. Focus on ${getRoleContext()}]\n\n${input}`;

      const response = await fetch(`${supabaseUrl}/functions/v1/ai-agent-processor`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentType,
          industry: 'general',
          openaiKey,
          query: contextualQuery
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const result = await response.json();

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: result.response,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);

      const errorMessage: ChatMessage = {
        role: 'system',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
    }
  };

  const quickActions = [
    { label: 'Show my KPIs', query: 'Show my current KPIs and performance metrics' },
    { label: 'What needs attention?', query: 'What items need my attention based on my role?' },
    { label: 'Show work orders', query: 'Show my work orders and their status' },
    { label: 'Active alerts', query: 'What alerts are currently active?' }
  ];

  const handleQuickAction = (query: string) => {
    setInput(query);
    setTimeout(() => handleSend(), 100);
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="bg-white border-b border-gray-200 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-teal-600 rounded-full flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">AI Assistant</h1>
              <p className="text-sm text-gray-600">Role-specific guidance for {orgLevel || 'your role'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((msg, idx) => (
            <div key={idx} className={`${msg.role === 'user' ? 'flex justify-end' : ''}`}>
              {msg.role === 'user' ? (
                <div className="bg-teal-600 text-white px-6 py-3 rounded-2xl max-w-2xl">
                  {msg.content}
                </div>
              ) : msg.role === 'system' ? (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg text-sm">
                  {msg.content}
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-2xl p-6 max-w-3xl shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-teal-100 to-teal-200 rounded-full flex items-center justify-center">
                      <Sparkles className="w-4 h-4 text-teal-600" />
                    </div>
                    <span className="text-sm font-medium text-gray-700">AI Assistant</span>
                  </div>
                  <div className="prose prose-sm max-w-none">
                    <MarkdownRenderer content={msg.content} />
                  </div>
                </div>
              )}
            </div>
          ))}

          {isProcessing && (
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Thinking...</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border-t border-gray-200 p-6">
        <div className="max-w-4xl mx-auto">
          {messages.length === 1 && (
            <div className="mb-4">
              <div className="text-sm text-gray-600 mb-2">Quick Actions:</div>
              <div className="flex flex-wrap gap-2">
                {quickActions.map((action, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleQuickAction(action.query)}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition-colors"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder={`Ask anything about ${getRoleContext()}...`}
              className="w-full px-6 py-4 pr-24 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              disabled={isProcessing}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <button
                onClick={() => setIsRecording(!isRecording)}
                disabled={isProcessing}
                className={`p-2 rounded-lg transition-colors ${
                  isRecording ? 'bg-red-100 text-red-600' : 'hover:bg-gray-100 text-gray-400'
                }`}
              >
                {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <button
                onClick={handleSend}
                disabled={!input.trim() || isProcessing}
                className="p-2 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-300 rounded-lg transition-colors"
              >
                {isProcessing ? (
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                ) : (
                  <Send className="w-5 h-5 text-white" />
                )}
              </button>
            </div>
          </div>

          <div className="mt-3 text-xs text-gray-500 text-center">
            AI responses are tailored to your organizational level and access permissions
          </div>
        </div>
      </div>
    </div>
  );
}
