import { useState, useEffect } from 'react';
import { MessageCircle, Mic, MicOff, Volume2, VolumeX, X, Minimize2, Maximize2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: any[];
  timestamp: Date;
}

export function JavisDock() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [greeting, setGreeting] = useState<string>('');

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      loadMorningBrief();
    }
  }, [isOpen]);

  const loadMorningBrief = async () => {
    try {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('tenant_id')
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

      const briefMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: formatBrief(data.brief),
        citations: data.citations,
        timestamp: new Date()
      };

      setMessages([briefMessage]);

      if (voiceEnabled && data.audio_url) {
        playAudio(data.audio_url);
      } else if (voiceEnabled) {
        speak(data.greeting + ' ' + briefMessage.content);
      }
    } catch (error) {
      console.error('Error loading brief:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatBrief = (brief: any): string => {
    let formatted = brief.summary + '\n\n';

    brief.sections?.forEach((section: any) => {
      formatted += `**${section.title}**\n`;
      section.items.forEach((item: string) => {
        formatted += `• ${item}\n`;
      });
      formatted += '\n';
    });

    return formatted;
  };

  const getTimeOfDay = (): 'morning' | 'afternoon' | 'evening' => {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/javis-orchestrator/ask`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tenant_id: profile?.tenant_id,
            user_id: user.id,
            query: input,
            conversation_id: conversationId
          })
        }
      );

      const data = await response.json();

      if (data.conversation_id) {
        setConversationId(data.conversation_id);
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.answer,
        citations: data.citations,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);

      if (voiceEnabled) {
        speak(data.answer);
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsLoading(false);
    }
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

  const playAudio = (url: string) => {
    const audio = new Audio(url);
    audio.play();
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-16 h-16 bg-gradient-to-r from-teal-500 to-cyan-600 rounded-full shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center text-white z-50"
        aria-label="Open J.A.V.I.S"
      >
        <MessageCircle className="w-7 h-7" />
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
          <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
          <span className="font-semibold text-gray-800">J.A.V.I.S</span>
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
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                  {message.citations && message.citations.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-300 text-xs opacity-70">
                      {message.citations.length} citation(s)
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
                disabled={isLoading}
              />
              <button
                onClick={toggleListening}
                className={`p-2 rounded-lg transition-colors ${
                  isListening
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
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
                disabled={!input.trim() || isLoading}
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
