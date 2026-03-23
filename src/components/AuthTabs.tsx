interface AuthTabsProps {
  activeTab: string;
  onTabChange: (tab: 'signin' | 'signup' | 'enterprise' | 'privacy' | 'terms' | 'security') => void;
}

export function AuthTabs({ activeTab, onTabChange }: AuthTabsProps) {
  const currentTab = activeTab as 'signin' | 'signup' | 'enterprise';
  return (
    <div className="flex gap-2 mb-6">
      <button
        onClick={() => onTabChange('signin')}
        className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
          currentTab === 'signin'
            ? 'bg-blue-600 text-white'
            : 'bg-slate-700/50 text-slate-400 hover:text-white'
        }`}
      >
        Sign In
      </button>
      <button
        onClick={() => onTabChange('signup')}
        className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
          currentTab === 'signup'
            ? 'bg-blue-600 text-white'
            : 'bg-slate-700/50 text-slate-400 hover:text-white'
        }`}
      >
        Sign Up
      </button>
      <button
        onClick={() => onTabChange('enterprise')}
        className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
          currentTab === 'enterprise'
            ? 'bg-blue-600 text-white'
            : 'bg-slate-700/50 text-slate-400 hover:text-white'
        }`}
      >
        Enterprise
      </button>
    </div>
  );
}
