import { useState, useEffect, useRef } from 'react';
import { MessageCircle, Mic, MicOff, Volume2, VolumeX, X, Minimize2, Maximize2, Check, XCircle, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: any[];
  pending_actions?: any[];
  citations?: any[];
  timestamp: Date;
}

interface PendingAction {
  id: string;
  action_type: string;
  action_description: string;
  action_payload: any;
  expires_at: string;
}

export function JavisDockInteractive() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [greeting, setGreeting] = useState<string>('');
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && !ws) {
      connectWebSocket();
    }

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [isOpen]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const connectWebSocket = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('tenant_id, display_name')
        .eq('id', user.id)
        .single();

      const wsUrl = `${import.meta.env.VITE_SUPABASE_URL.replace('https://', 'wss://')}/functions/v1/javis-websocket`;

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        console.log('WebSocket connected');
        setWsConnected(true);

        // Initialize session
        websocket.send(JSON.stringify({
          type: 'init',
          user_id: user.id,
          tenant_id: profile?.tenant_id
        }));

        setGreeting(`Good ${getTimeOfDay()}, ${profile?.display_name || 'there'}!`);
      };

      websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setWsConnected(false);
      };

      websocket.onclose = () => {
        console.log('WebSocket disconnected');
        setWsConnected(false);
        setWs(null);
      };

      setWs(websocket);

      // Start ping interval
      const pingInterval = setInterval(() => {
        if (websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);

      return () => clearInterval(pingInterval);
    } catch (error) {
      console.error('Error connecting WebSocket:', error);
    }
  };

  const handleWebSocketMessage = (data: any) => {
    switch (data.type) {
      case 'connected':
      case 'initialized':
        console.log('Session initialized:', data.session_id);
        break;

      case 'response':
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.content,
          tool_calls: data.tool_calls,
          pending_actions: data.pending_actions,
          citations: data.citations,
          timestamp: new Date()
        };

        setMessages(prev => [...prev, assistantMessage]);

        if (data.pending_actions && data.pending_actions.length > 0) {
          setPendingActions(data.pending_actions);
        }

        if (data.conversation_id) {
          setConversationId(data.conversation_id);
        }

        if (voiceEnabled) {
          speak(data.content);
        }

        setIsLoading(false);
        break;

      case 'tool_executed':
        const resultMessage: Message = {
          id: crypto.randomUUID(),
          role: 'system',
          content: data.message,
          timestamp: new Date()
        };

        setMessages(prev => [...prev, resultMessage]);
        setPendingActions(prev => prev.filter(a => a.id !== data.action_id));
        break;

      case 'action_cancelled':
        setPendingActions(prev => prev.filter(a => a.id !== data.action_id));
        break;

      case 'event':
        // Proactive update from system
        const eventMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `🔔 ${data.message}`,
          pending_actions: data.pending_action_id ? [{
            id: data.pending_action_id,
            action_type: data.event_type,
            action_description: data.message,
            action_payload: {}
          }] : undefined,
          timestamp: new Date()
        };

        setMessages(prev => [...prev, eventMessage]);
        if (data.pending_action_id) {
          setPendingActions(prev => [...prev, {
            id: data.pending_action_id,
            action_type: data.event_type,
            action_description: data.message,
            action_payload: {},
            expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
          }]);
        }
        break;

      case 'error':
        console.error('WebSocket error:', data.message);
        break;

      case 'pong':
        // Heartbeat response
        break;
    }
  };

  const getTimeOfDay = (): 'morning' | 'afternoon' | 'evening' => {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !ws || ws.readyState !== WebSocket.OPEN) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Send via WebSocket
    ws.send(JSON.stringify({
      type: 'message',
      content: input,
      conversation_id: conversationId
    }));
  };

  const handleConfirmAction = (actionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: 'confirm',
      action_id: actionId
    }));

    setPendingActions(prev => prev.filter(a => a.id !== actionId));
  };

  const handleRejectAction = (actionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: 'reject',
      action_id: actionId
    }));

    setPendingActions(prev => prev.filter(a => a.id !== actionId));
  };

  const toggleListening = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition not supported in this browser');
      return;
    }

    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-CA';

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setIsListening(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const stopListening = () => {
    setIsListening(false);
  };

  const speak = (text: string) => {
    if (!('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-16 h-16 bg-gradient-to-r from-teal-500 to-cyan-600 rounded-full shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center text-white z-50"
        aria-label="Open J.A.V.I.S"
      >
        <MessageCircle className="w-7 h-7" />
        {pendingActions.length > 0 && (
          <span className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold">
            {pendingActions.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className={`fixed bottom-6 right-6 bg-white rounded-lg shadow-2xl border border-gray-200 z-50 transition-all ${
        isMinimized ? 'w-80 h-16' : 'w-96 h-[600px]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-teal-50 to-cyan-50">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full animate-pulse ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="font-semibold text-gray-800">J.A.V.I.S</span>
          {!wsConnected && <span className="text-xs text-red-500">(reconnecting...)</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label={voiceEnabled ? 'Disable voice' : 'Enable voice'}
          >
            {voiceEnabled ? (
              <Volume2 className="w-4 h-4 text-gray-600" />
            ) : (
              <VolumeX className="w-4 h-4 text-gray-400" />
            )}
          </button>
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {isMinimized ? (
              <Maximize2 className="w-4 h-4 text-gray-600" />
            ) : (
              <Minimize2 className="w-4 h-4 text-gray-600" />
            )}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 h-[calc(600px-140px)]">
            {greeting && (
              <div className="text-sm text-gray-500 italic mb-2">
                {greeting}
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-3 ${
                    message.role === 'user'
                      ? 'bg-teal-500 text-white'
                      : message.role === 'system'
                      ? 'bg-yellow-50 text-gray-800 border border-yellow-200'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  <div className="text-sm whitespace-pre-wrap">{message.content}</div>

                  {/* Pending Actions */}
                  {message.pending_actions && message.pending_actions.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {message.pending_actions.map((action: any) => (
                        <div key={action.id} className="bg-white rounded-lg p-3 border border-gray-200">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex-1">
                              <div className="text-xs font-semibold text-gray-700 mb-1">
                                {action.action_type.replace(/_/g, ' ').toUpperCase()}
                              </div>
                              <div className="text-xs text-gray-600">
                                {JSON.stringify(action.action_payload, null, 2)}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleConfirmAction(action.id)}
                              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded text-xs font-medium hover:bg-green-600 transition-colors"
                            >
                              <Check className="w-3 h-3" />
                              Confirm
                            </button>
                            <button
                              onClick={() => handleRejectAction(action.id)}
                              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600 transition-colors"
                            >
                              <XCircle className="w-3 h-3" />
                              Cancel
                            </button>
                          </div>
                          <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                            <Clock className="w-3 h-3" />
                            Expires in 5 minutes
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-lg p-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask J.A.V.I.S..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
                disabled={isLoading || !wsConnected}
              />
              <button
                onClick={toggleListening}
                className={`p-2 rounded-lg transition-colors ${
                  isListening
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                disabled={!wsConnected}
                aria-label={isListening ? 'Stop listening' : 'Start listening'}
              >
                {isListening ? (
                  <MicOff className="w-5 h-5" />
                ) : (
                  <Mic className="w-5 h-5" />
                )}
              </button>
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading || !wsConnected}
                className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
