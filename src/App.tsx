import { useState, useEffect, useRef } from 'react';
import { supabase } from './lib/supabase';
import { AssetManagement } from './components/AssetManagement';
import { WorkOrderManagement } from './components/WorkOrderManagement';
import { AIAnalyticsDashboard } from './components/AIAnalyticsDashboard';
import {
  Home,
  Globe,
  Layers,
  User,
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
  Zap,
  MessageSquare,
  Clock,
  Lightbulb,
  ExternalLink,
  TrendingUp,
  X,
  File,
  MicOff,
  Loader2
} from 'lucide-react';

interface ChatMessage {
  role: string;
  content: string;
  agentType?: string;
  processingTime?: number;
  modelUsed?: string;
  followUpQuestions?: string[];
  sources?: Array<{ title: string; type: string }>;
  attachments?: Array<{ name: string; type: string; url: string }>;
}

interface UploadedFile {
  name: string;
  type: string;
  url: string;
  size: number;
}

function App() {
  const [activeView, setActiveView] = useState('home');
  const [selectedSpace, setSelectedSpace] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [conversationThreads, setConversationThreads] = useState<Array<{ id: string; title: string; timestamp: Date }>>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [workflowMode, setWorkflowMode] = useState<'standard' | 'deep-analysis'>('standard');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
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
    loadConversationThreads();
  }, []);

  const loadConversationThreads = async () => {
    const { data, error } = await supabase
      .from('ai_agent_logs')
      .select('id, query, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    if (data && !error) {
      setConversationThreads(data.map(item => ({
        id: item.id,
        title: item.query.substring(0, 50) + '...',
        timestamp: new Date(item.created_at)
      })));
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setUploadProgress(0);

    try {
      const file = files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `documents/${fileName}`;

      setUploadProgress(30);

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      setUploadProgress(60);

      const { data: urlData } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath);

      const uploadedFile: UploadedFile = {
        name: file.name,
        type: file.type,
        url: urlData.publicUrl,
        size: file.size
      };

      setUploadedFiles(prev => [...prev, uploadedFile]);
      setUploadProgress(100);

      setChatMessages(prev => [...prev, {
        role: 'system',
        content: `📎 Document uploaded: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`
      }]);

      setTimeout(() => setUploadProgress(0), 1000);
    } catch (error) {
      console.error('Error uploading file:', error);
      setChatMessages(prev => [...prev, {
        role: 'system',
        content: `❌ Error uploading file: ${error instanceof Error ? error.message : 'Unknown error'}`
      }]);
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setUploadProgress(0);

    try {
      const file = files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `images/${fileName}`;

      setUploadProgress(30);

      const { error: uploadError } = await supabase.storage
        .from('images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      setUploadProgress(60);

      const { data: urlData } = supabase.storage
        .from('images')
        .getPublicUrl(filePath);

      const uploadedFile: UploadedFile = {
        name: file.name,
        type: file.type,
        url: urlData.publicUrl,
        size: file.size
      };

      setUploadedFiles(prev => [...prev, uploadedFile]);
      setUploadProgress(100);

      setChatMessages(prev => [...prev, {
        role: 'system',
        content: `🖼️ Image uploaded: ${file.name}`,
        attachments: [uploadedFile]
      }]);

      setTimeout(() => setUploadProgress(0), 1000);
    } catch (error) {
      console.error('Error uploading image:', error);
      setChatMessages(prev => [...prev, {
        role: 'system',
        content: `❌ Error uploading image: ${error instanceof Error ? error.message : 'Unknown error'}`
      }]);
    } finally {
      setIsProcessing(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleVoiceInput = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      const audioChunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        new Blob(audioChunks, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());

        setChatMessages(prev => [...prev, {
          role: 'system',
          content: '🎤 Voice input recorded. Transcription feature coming soon...'
        }]);
      };

      mediaRecorder.start();
      setIsRecording(true);

      setChatMessages(prev => [...prev, {
        role: 'system',
        content: '🎤 Recording... Click the microphone again to stop.'
      }]);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setChatMessages(prev => [...prev, {
        role: 'system',
        content: '❌ Microphone access denied. Please enable microphone permissions.'
      }]);
    }
  };

  const removeUploadedFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const spaces = [
    { id: 'oil-gas', name: 'Oil & Gas', icon: Zap },
    { id: 'mining', name: 'Mining', icon: Layers },
    { id: 'utilities', name: 'Power & Utilities', icon: Zap },
    { id: 'manufacturing', name: 'Manufacturing', icon: Wrench },
    { id: 'aerospace', name: 'Aerospace', icon: Globe2 }
  ];

  const quickActions = [
    { id: 'compare', label: 'Compare', icon: BarChart3, action: 'PerformanceAnalysisAgent' },
    { id: 'troubleshoot', label: 'Troubleshoot', icon: Wrench, action: 'ReliabilityAgent' },
    { id: 'health', label: 'Health', icon: Activity, action: 'AssetHealthAgent' },
    { id: 'learn', label: 'Learn', icon: GraduationCap, action: 'SafetyAgent' },
    { id: 'fact-check', label: 'Fact Check', icon: FileCheck, action: 'ComplianceAgent' }
  ];

  const generateFollowUpQuestions = (agentType: string): string[] => {
    const followUps: Record<string, string[]> = {
      'PreventiveMaintenanceAgent': [
        'What are the top 3 PM tasks causing delays?',
        'How can we optimize PM scheduling?',
        'Show me PM compliance trends'
      ],
      'PredictiveAnalyticsAgent': [
        'Which assets have the highest failure risk?',
        'What is the predicted RUL for critical equipment?',
        'Show me trending degradation patterns'
      ],
      'AssetHealthAgent': [
        'Which assets need immediate attention?',
        'Show me the health trend for the past 30 days',
        'Compare health scores by asset type'
      ],
      'ReliabilityAgent': [
        'Identify the top bad actors',
        'What reliability improvements will have the most impact?',
        'Show me MTBF vs MTTR trends'
      ],
      'CostOptimizationAgent': [
        'Where are the biggest cost savings opportunities?',
        'Compare maintenance costs year over year',
        'What is the TCO for our critical assets?'
      ],
      'SafetyAgent': [
        'Show me recent safety incidents',
        'What are the top safety risks?',
        'How is our safety training compliance?'
      ],
      'CentralCoordinationAgent': [
        'What requires urgent attention across all systems?',
        'Show me the overall operational health',
        'What decisions need approval today?'
      ]
    };

    return followUps[agentType] || [
      'Tell me more about this',
      'What are the next steps?',
      'Show me related insights'
    ];
  };

  const generateMockSources = (): Array<{ title: string; type: string }> => {
    return [
      { title: 'CMMS Database - Work Order History', type: 'Database' },
      { title: 'Asset Performance Metrics', type: 'Analytics' },
      { title: 'ISO 55000 Standards', type: 'Reference' }
    ];
  };

  const processDocumentWithAI = async (file: UploadedFile, query: string) => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const openaiKey = import.meta.env.VITE_OPENAI_API_KEY;

      const apiUrl = `${supabaseUrl}/functions/v1/document-processor`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileUrl: file.url,
          fileName: file.name,
          fileType: file.type,
          query: query,
          openaiKey: openaiKey
        })
      });

      if (!response.ok) {
        throw new Error(`Document processing failed: ${response.status}`);
      }

      const result = await response.json();
      return result.analysis;
    } catch (error) {
      console.error('Error processing document:', error);
      return `Error analyzing document: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  };

  const executeAgent = async (agentId: string, industry?: string, userQuery?: string) => {
    setIsProcessing(true);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase configuration missing. Please check your .env file.');
      }

      let finalQuery = userQuery || '';

      if (uploadedFiles.length > 0) {
        const fileAnalyses = await Promise.all(
          uploadedFiles.map(file => processDocumentWithAI(file, userQuery || 'Analyze this document'))
        );

        finalQuery = `${userQuery || 'Analyze the uploaded documents'}\n\nDocument Analysis:\n${fileAnalyses.join('\n\n')}`;
      }

      const apiUrl = `${supabaseUrl}/functions/v1/ai-agent-processor`;
      const openaiKey = import.meta.env.VITE_OPENAI_API_KEY;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentType: agentId,
          industry: industry || selectedSpace || 'general',
          openaiKey: openaiKey,
          query: finalQuery
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      const aiMessage: ChatMessage = {
        role: 'assistant',
        content: result.response,
        agentType: result.agentType,
        processingTime: result.processingTime,
        modelUsed: result.modelUsed,
        followUpQuestions: generateFollowUpQuestions(result.agentType),
        sources: generateMockSources(),
        attachments: uploadedFiles.length > 0 ? uploadedFiles : undefined
      };

      setChatMessages(prev => [...prev, aiMessage]);
      setUploadedFiles([]);
      await loadConversationThreads();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${errorMessage}. Please check your API configuration.`
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChatSubmit = async () => {
    if ((!chatInput.trim() && uploadedFiles.length === 0) || isProcessing) return;

    setChatMessages(prev => [...prev,
      {
        role: 'user',
        content: chatInput || 'Analyze uploaded files',
        attachments: uploadedFiles.length > 0 ? uploadedFiles : undefined
      }
    ]);

    const input = chatInput.toLowerCase();
    let agentToCall = 'CentralCoordinationAgent';

    if (input.includes('preventive') || input.includes('pm ') || input.includes('scheduled maintenance')) {
      agentToCall = 'PreventiveMaintenanceAgent';
    } else if (input.includes('predict') || input.includes('forecast') || input.includes('rul')) {
      agentToCall = 'PredictiveAnalyticsAgent';
    } else if (input.includes('asset health') || input.includes('ahi') || input.includes('condition')) {
      agentToCall = 'AssetHealthAgent';
    } else if (input.includes('work order') || input.includes('wo ')) {
      agentToCall = 'WorkOrderAgent';
    } else if (input.includes('root cause') || input.includes('rca') || input.includes('why')) {
      agentToCall = 'RootCauseAnalysisAgent';
    } else if (input.includes('spare') || input.includes('parts') || input.includes('inventory')) {
      agentToCall = 'SparePartsAgent';
    } else if (input.includes('performance') || input.includes('kpi') || input.includes('mtbf') || input.includes('mttr')) {
      agentToCall = 'PerformanceAnalysisAgent';
    } else if (input.includes('failure mode') || input.includes('fmea') || input.includes('rcm')) {
      agentToCall = 'FailureModeAgent';
    } else if (input.includes('cost') || input.includes('budget') || input.includes('savings')) {
      agentToCall = 'CostOptimizationAgent';
    } else if (input.includes('compliance') || input.includes('audit') || input.includes('regulation')) {
      agentToCall = 'ComplianceAgent';
    } else if (input.includes('risk') || input.includes('hazard')) {
      agentToCall = 'RiskAssessmentAgent';
    } else if (input.includes('energy') || input.includes('power') || input.includes('efficiency')) {
      agentToCall = 'EnergyEfficiencyAgent';
    } else if (input.includes('environment') || input.includes('emission') || input.includes('waste')) {
      agentToCall = 'EnvironmentalAgent';
    } else if (input.includes('safety') || input.includes('incident') || input.includes('injury')) {
      agentToCall = 'SafetyAgent';
    } else if (input.includes('reliability') || input.includes('failure') || input.includes('uptime')) {
      agentToCall = 'ReliabilityAgent';
    }

    const userQuery = chatInput;
    setChatInput('');
    await executeAgent(agentToCall, undefined, userQuery);
  };

  const handleFollowUpClick = (question: string) => {
    setChatInput(question);
    setTimeout(() => handleChatSubmit(), 100);
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
          {uploadProgress > 0 && (
            <div className="absolute -top-8 left-0 right-0">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-teal-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            </div>
          )}

          {uploadedFiles.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {uploadedFiles.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
                  <File className="w-4 h-4 text-teal-600" />
                  <span className="text-sm text-gray-700">{file.name}</span>
                  <button
                    onClick={() => removeUploadedFile(idx)}
                    className="ml-2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

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
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileUpload}
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.csv,.xls,.xlsx"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <Paperclip className="w-5 h-5 text-gray-400" />
            </button>

            <input
              ref={imageInputRef}
              type="file"
              onChange={handleImageUpload}
              className="hidden"
              accept="image/*"
            />
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={isProcessing}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <Image className="w-5 h-5 text-gray-400" />
            </button>

            <button
              onClick={handleVoiceInput}
              disabled={isProcessing}
              className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                isRecording ? 'bg-red-100 hover:bg-red-200' : 'hover:bg-gray-100'
              }`}
            >
              {isRecording ? (
                <MicOff className="w-5 h-5 text-red-600" />
              ) : (
                <Mic className="w-5 h-5 text-gray-400" />
              )}
            </button>

            <button
              onClick={handleChatSubmit}
              disabled={(!chatInput.trim() && uploadedFiles.length === 0) || isProcessing}
              className="p-2 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-300 rounded-lg transition-colors flex items-center justify-center"
            >
              {isProcessing ? (
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              ) : (
                <ArrowUpCircle className="w-5 h-5 text-white" />
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => setWorkflowMode('standard')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              workflowMode === 'standard'
                ? 'bg-teal-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Standard
          </button>
          <button
            onClick={() => setWorkflowMode('deep-analysis')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              workflowMode === 'deep-analysis'
                ? 'bg-teal-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            Deep Analysis
          </button>
        </div>

        {chatMessages.length > 0 && (
          <div className="space-y-6 mb-8">
            {chatMessages.map((msg, idx) => (
              <div key={idx} className={`${msg.role === 'user' ? 'text-right' : msg.role === 'system' ? 'text-center' : ''}`}>
                {msg.role === 'user' ? (
                  <div className="inline-block">
                    <div className="bg-teal-600 text-white px-6 py-3 rounded-2xl max-w-2xl text-left">
                      {msg.content}
                    </div>
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2 justify-end">
                        {msg.attachments.map((file, i) => (
                          <div key={i} className="flex items-center gap-2 bg-teal-700 text-white text-xs rounded-lg px-3 py-1.5">
                            {file.type.includes('image') ? (
                              <Image className="w-3 h-3" />
                            ) : (
                              <File className="w-3 h-3" />
                            )}
                            <span>{file.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : msg.role === 'system' ? (
                  <div className="inline-block bg-gray-100 text-gray-600 px-4 py-2 rounded-lg text-sm">
                    {msg.content}
                  </div>
                ) : (
                  <div className="bg-white border border-gray-200 rounded-2xl p-6 max-w-3xl shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
                        <Lightbulb className="w-4 h-4 text-teal-600" />
                      </div>
                      <span className="text-sm font-medium text-gray-700">
                        {msg.agentType?.replace('Agent', '') || 'AI Assistant'}
                      </span>
                      {msg.processingTime && (
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {(msg.processingTime / 1000).toFixed(1)}s
                        </span>
                      )}
                      {msg.modelUsed && (
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                          {msg.modelUsed}
                        </span>
                      )}
                    </div>

                    <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed mb-4">
                      {msg.content}
                    </div>

                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="border-t border-gray-100 pt-4 mb-4">
                        <p className="text-xs font-medium text-gray-500 mb-2">Analyzed Documents</p>
                        <div className="flex flex-wrap gap-2">
                          {msg.attachments.map((file, i) => (
                            <div key={i} className="flex items-center gap-2 bg-gray-50 text-gray-600 text-xs rounded-lg px-3 py-1.5 border border-gray-200">
                              <File className="w-3 h-3" />
                              <span>{file.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {msg.sources && msg.sources.length > 0 && (
                      <div className="border-t border-gray-100 pt-4 mb-4">
                        <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" />
                          Sources
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {msg.sources.map((source, i) => (
                            <div
                              key={i}
                              className="text-xs bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200"
                            >
                              {source.title} <span className="text-gray-400">({source.type})</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {msg.followUpQuestions && msg.followUpQuestions.length > 0 && (
                      <div className="border-t border-gray-100 pt-4">
                        <p className="text-xs font-medium text-gray-500 mb-2">Ask a follow-up...</p>
                        <div className="flex flex-wrap gap-2">
                          {msg.followUpQuestions.map((q, i) => (
                            <button
                              key={i}
                              onClick={() => handleFollowUpClick(q)}
                              className="text-sm text-teal-600 hover:text-teal-700 hover:bg-teal-50 px-3 py-1.5 rounded-lg border border-teal-200 transition-colors"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-5 gap-4 mb-8">
          {quickActions.map((action) => (
            <button
              key={action.id}
              onClick={() => executeAgent(action.action)}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:border-teal-300 hover:bg-teal-50 transition-colors"
            >
              <action.icon className="w-6 h-6 text-teal-600" />
              <span className="text-sm font-medium text-gray-700">{action.label}</span>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-500">Industry Spaces</p>
          <div className="grid grid-cols-5 gap-3">
            {spaces.map((space) => (
              <button
                key={space.id}
                onClick={() => setSelectedSpace(space.id)}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors ${
                  selectedSpace === space.id
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <space.icon className="w-5 h-5 text-gray-600" />
                <span className="text-xs text-gray-700">{space.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
      <nav className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
                <Globe className="w-5 h-5 text-white" />
              </div>
              <span className="font-semibold text-gray-900">SyncAI Pro</span>
            </div>

            <div className="flex items-center gap-6">
              <button
                onClick={() => setActiveView('home')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                  activeView === 'home'
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Home className="w-4 h-4" />
                <span className="text-sm font-medium">Home</span>
              </button>
              <button
                onClick={() => setActiveView('threads')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                  activeView === 'threads'
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                <span className="text-sm font-medium">Threads</span>
              </button>
              <button
                onClick={() => setActiveView('assets')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                  activeView === 'assets'
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span className="text-sm font-medium">Assets</span>
              </button>
              <button
                onClick={() => setActiveView('workorders')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                  activeView === 'workorders'
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <FileCheck className="w-4 h-4" />
                <span className="text-sm font-medium">Work Orders</span>
              </button>
              <button
                onClick={() => setActiveView('analytics')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                  activeView === 'analytics'
                    ? 'bg-teal-50 text-teal-700'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span className="text-sm font-medium">Analytics</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Search className="w-5 h-5 text-gray-600" />
            </button>
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <Download className="w-5 h-5 text-gray-600" />
            </button>
            <button className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg transition-colors">
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">New</span>
            </button>
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <User className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>
      </nav>

      <div className="flex-1 overflow-auto">
        {activeView === 'home' && renderHomeView()}
        {activeView === 'threads' && (
          <div className="max-w-4xl mx-auto py-8 px-4">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Recent Conversations</h2>
            <div className="space-y-3">
              {conversationThreads.map((thread) => (
                <div
                  key={thread.id}
                  className="bg-white border border-gray-200 rounded-xl p-4 hover:border-teal-300 hover:shadow-sm transition-all cursor-pointer"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-gray-900 font-medium mb-1">{thread.title}</p>
                      <p className="text-sm text-gray-500">
                        {thread.timestamp.toLocaleDateString()} at {thread.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                    <MessageSquare className="w-5 h-5 text-gray-400" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeView === 'assets' && <AssetManagement />}
        {activeView === 'workorders' && <WorkOrderManagement />}
        {activeView === 'analytics' && <AIAnalyticsDashboard />}
      </div>

      <footer className="bg-white border-t border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center gap-6">
            <span>{metrics.totalAssets.toLocaleString()} Assets Monitored</span>
            <span>{metrics.activeWorkOrders} Active Work Orders</span>
            <span>ESG Score: {metrics.esgScore}%</span>
          </div>
          <div className="flex items-center gap-4">
            <span>Uptime: {metrics.uptime}%</span>
            <span className="text-teal-600 font-medium">${metrics.costSavings} saved</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
