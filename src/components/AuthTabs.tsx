interface AuthTabsProps {
  activeTab: string;
  onTabChange: (
    tab: "signin" | "signup" | "enterprise" | "privacy" | "terms" | "security",
  ) => void;
}

export function AuthTabs({ activeTab, onTabChange }: AuthTabsProps) {
  const currentTab = activeTab as "signin" | "signup" | "enterprise";
  return (
    <div className="flex gap-2 mb-6">
      <button
        onClick={() => onTabChange("signin")}
        className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
          currentTab === "signin"
            ? "bg-signal-cyan/15 text-signal-cyan border border-signal-cyan/40"
            : "bg-white/[0.03] text-overlook-haze border border-transparent hover:text-overlook-mist"
        }`}
      >
        Sign In
      </button>
      <button
        onClick={() => onTabChange("signup")}
        className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
          currentTab === "signup"
            ? "bg-signal-cyan/15 text-signal-cyan border border-signal-cyan/40"
            : "bg-white/[0.03] text-overlook-haze border border-transparent hover:text-overlook-mist"
        }`}
      >
        Sign Up
      </button>
      <button
        onClick={() => onTabChange("enterprise")}
        className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
          currentTab === "enterprise"
            ? "bg-signal-cyan/15 text-signal-cyan border border-signal-cyan/40"
            : "bg-white/[0.03] text-overlook-haze border border-transparent hover:text-overlook-mist"
        }`}
      >
        Enterprise
      </button>
    </div>
  );
}
