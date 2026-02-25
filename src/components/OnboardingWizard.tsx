import { useState, useEffect } from 'react';
import { CheckCircle2, Circle, Sparkles, Upload, Bot, TrendingUp, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthProvider';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: any;
  completed: boolean;
}

export function OnboardingWizard() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<OnboardingStep[]>([
    {
      id: 'profile',
      title: 'Complete Your Profile',
      description: 'Tell us about your organization',
      icon: Circle,
      completed: false
    },
    {
      id: 'assets',
      title: 'Add Your First Assets',
      description: 'Import or create assets to monitor',
      icon: Upload,
      completed: false
    },
    {
      id: 'agents',
      title: 'Activate AI Agents',
      description: 'Enable intelligent monitoring',
      icon: Bot,
      completed: false
    },
    {
      id: 'insights',
      title: 'Review First Insights',
      description: 'See what AI discovered',
      icon: TrendingUp,
      completed: false
    }
  ]);

  useEffect(() => {
    checkOnboardingStatus();
  }, [user]);

  const checkOnboardingStatus = async () => {
    if (!user) return;

    // Check if user has completed onboarding
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('onboarding_completed, onboarding_progress')
      .eq('id', user.id)
      .single();

    if (!profile?.onboarding_completed) {
      setShow(true);
      
      // Update steps based on progress
      if (profile?.onboarding_progress) {
        const progress = profile.onboarding_progress as any;
        setSteps(prev => prev.map(step => ({
          ...step,
          completed: progress[step.id] || false
        })));
      }
    }
  };

  const completeStep = async (stepId: string) => {
    if (!user) return;

    const updatedSteps = steps.map(step =>
      step.id === stepId ? { ...step, completed: true } : step
    );
    setSteps(updatedSteps);

    // Save progress
    const progress = updatedSteps.reduce((acc, step) => ({
      ...acc,
      [step.id]: step.completed
    }), {});

    await supabase
      .from('user_profiles')
      .upsert({
        id: user.id,
        onboarding_progress: progress,
        onboarding_completed: updatedSteps.every(s => s.completed)
      });

    // Auto-advance to next incomplete step
    const nextIncomplete = updatedSteps.findIndex(s => !s.completed);
    if (nextIncomplete !== -1) {
      setCurrentStep(nextIncomplete);
    }
  };

  const dismissOnboarding = async () => {
    if (!user) return;
    
    await supabase
      .from('user_profiles')
      .upsert({
        id: user.id,
        onboarding_completed: true
      });
    
    setShow(false);
  };

  if (!show) return null;

  const progress = (steps.filter(s => s.completed).length / steps.length) * 100;
  const allComplete = steps.every(s => s.completed);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="bg-gradient-to-r from-teal-600 via-blue-600 to-purple-600 p-8 text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-black/10"></div>
          <div className="relative">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                  <Sparkles className="w-7 h-7" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">Welcome to SyncAI</h2>
                  <p className="text-teal-100">Let's get you started in 4 simple steps</p>
                </div>
              </div>
              <button
                onClick={dismissOnboarding}
                className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 transition-colors flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Progress Bar */}
            <div className="mt-6">
              <div className="flex justify-between text-sm mb-2">
                <span>Progress</span>
                <span className="font-semibold">{Math.round(progress)}% Complete</span>
              </div>
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="p-8">
          <div className="space-y-4">
            {steps.map((step, index) => (
              <button
                key={step.id}
                onClick={() => setCurrentStep(index)}
                className={`w-full text-left p-6 rounded-xl border-2 transition-all duration-200 ${
                  currentStep === index
                    ? 'border-teal-500 bg-teal-50 shadow-lg shadow-teal-100'
                    : step.completed
                    ? 'border-green-200 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start space-x-4">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      step.completed
                        ? 'bg-green-500 text-white'
                        : currentStep === index
                        ? 'bg-teal-600 text-white'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {step.completed ? (
                      <CheckCircle2 className="w-6 h-6" />
                    ) : (
                      <step.icon className="w-6 h-6" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className={`font-semibold mb-1 ${
                      currentStep === index ? 'text-teal-900' : 'text-gray-900'
                    }`}>
                      {step.title}
                    </h3>
                    <p className={`text-sm ${
                      currentStep === index ? 'text-teal-700' : 'text-gray-600'
                    }`}>
                      {step.description}
                    </p>
                  </div>
                  {currentStep === index && !step.completed && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        completeStep(step.id);
                      }}
                      className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors text-sm font-medium"
                    >
                      Complete
                    </button>
                  )}
                </div>
              </button>
            ))}
          </div>

          {allComplete && (
            <div className="mt-6 p-6 bg-gradient-to-r from-green-50 to-teal-50 border-2 border-green-200 rounded-xl">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-green-900 mb-1">
                    🎉 Onboarding Complete!
                  </h3>
                  <p className="text-sm text-green-700">
                    You're all set. Start exploring your AI-powered maintenance platform.
                  </p>
                </div>
                <button
                  onClick={dismissOnboarding}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                >
                  Get Started
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="px-8 pb-8 pt-4 border-t">
          <p className="text-sm text-gray-600 mb-3">Need help getting started?</p>
          <div className="flex space-x-3">
            <a
              href="#"
              className="text-sm text-teal-600 hover:text-teal-700 font-medium"
            >
              Watch Tutorial Video
            </a>
            <span className="text-gray-300">•</span>
            <a
              href="#"
              className="text-sm text-teal-600 hover:text-teal-700 font-medium"
            >
              Browse Help Center
            </a>
            <span className="text-gray-300">•</span>
            <a
              href="mailto:support@syncai.ca"
              className="text-sm text-teal-600 hover:text-teal-700 font-medium"
            >
              Contact Support
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
