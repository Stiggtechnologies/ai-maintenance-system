// SyncAI Autonomy Control Panel
// Configure AI agent autonomy levels

import { useState } from 'react';
import { 
  Zap, AlertTriangle, CheckCircle, 
  Settings, Save, RotateCcw, Lock, Unlock
} from 'lucide-react';

interface AutonomyConfig {
  agent: string;
  autonomyLevel: 'manual' | 'advisory' | 'autonomous';
  financialLimit: number;
  safetyOverride: boolean;
  approvalRequired: string[];
}

const initialConfig: AutonomyConfig[] = [
  { agent: 'Maintenance Strategy Agent', autonomyLevel: 'autonomous', financialLimit: 50000, safetyOverride: true, approvalRequired: [] },
  { agent: 'Asset Management Agent', autonomyLevel: 'autonomous', financialLimit: 100000, safetyOverride: true, approvalRequired: [] },
  { agent: 'Reliability Engineering Agent', autonomyLevel: 'advisory', financialLimit: 0, safetyOverride: false, approvalRequired: ['Maintenance Manager'] },
  { agent: 'Planning & Scheduling Agent', autonomyLevel: 'autonomous', financialLimit: 25000, safetyOverride: true, approvalRequired: [] },
  { agent: 'Work Order Agent', autonomyLevel: 'autonomous', financialLimit: 15000, safetyOverride: true, approvalRequired: [] },
  { agent: 'Condition Monitoring Agent', autonomyLevel: 'advisory', financialLimit: 0, safetyOverride: false, approvalRequired: ['Reliability Engineer'] },
  { agent: 'Inventory Agent', autonomyLevel: 'autonomous', financialLimit: 50000, safetyOverride: false, approvalRequired: [] },
  { agent: 'Operations Agent', autonomyLevel: 'autonomous', financialLimit: 75000, safetyOverride: true, approvalRequired: [] },
  { agent: 'Quality Assurance Agent', autonomyLevel: 'advisory', financialLimit: 0, safetyOverride: false, approvalRequired: ['Quality Manager'] },
  { agent: 'Sustainability Agent', autonomyLevel: 'advisory', financialLimit: 10000, safetyOverride: false, approvalRequired: ['Operations Executive'] },
  { agent: 'Financial Intelligence Agent', autonomyLevel: 'advisory', financialLimit: 5000, safetyOverride: false, approvalRequired: ['Finance Director'] },
  { agent: 'Safety Agent', autonomyLevel: 'autonomous', financialLimit: 0, safetyOverride: true, approvalRequired: [] },
  { agent: 'Procurement Agent', autonomyLevel: 'advisory', financialLimit: 25000, safetyOverride: false, approvalRequired: ['Procurement Manager'] },
  { agent: 'Training Agent', autonomyLevel: 'autonomous', financialLimit: 5000, safetyOverride: false, approvalRequired: [] },
  { agent: 'Central Coordination Agent', autonomyLevel: 'autonomous', financialLimit: 100000, safetyOverride: true, approvalRequired: [] },
];

export function AutonomyControlPanel() {
  const [config, setConfig] = useState<AutonomyConfig[]>(initialConfig);
  const [systemMode, setSystemMode] = useState<'human-directed' | 'human-in-loop' | 'autonomous'>('human-in-loop');
  const [hasChanges, setHasChanges] = useState(false);

  const updateConfig = (index: number, field: keyof AutonomyConfig, value: any) => {
    setConfig(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
    setHasChanges(true);
  };

  const saveConfig = () => {
    // In production, save to Supabase
    console.log('Saving config:', config);
    setHasChanges(false);
  };

  const resetConfig = () => {
    setConfig(initialConfig);
    setHasChanges(false);
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'autonomous': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400';
      case 'advisory': return 'text-amber-400 bg-amber-400/10 border-amber-400';
      case 'manual': return 'text-gray-400 bg-gray-400/10 border-gray-400';
      default: return 'text-gray-400 bg-gray-400/10 border-gray-400';
    }
  };

  return (
    <div className="min-h-screen bg-[#0D1117] text-white p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Zap className="w-8 h-8 text-amber-500" />
            AI Autonomy Control Panel
          </h1>
          <div className="flex gap-2">
            {hasChanges && (
              <>
                <button 
                  onClick={resetConfig}
                  className="px-4 py-2 bg-[#1A1F2E] border border-[#2A3344] rounded-lg text-sm flex items-center gap-2 hover:bg-[#2A3344]"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
                <button 
                  onClick={saveConfig}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Save Changes
                </button>
              </>
            )}
          </div>
        </div>
        <p className="text-gray-400">Configure autonomy levels for each AI agent</p>
      </div>

      {/* System-Wide Mode */}
      <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <Settings className="w-4 h-4" />
          System-Wide Autonomy Mode
        </h3>
        <div className="flex gap-4">
          {([
            { value: 'human-directed', label: 'Human Directed', desc: 'AI provides recommendations, humans decide' },
            { value: 'human-in-loop', label: 'Human in the Loop', desc: 'AI executes, humans approve critical actions' },
            { value: 'autonomous', label: 'Autonomous', desc: 'AI manages operations automatically' },
          ] as const).map(mode => (
            <button
              key={mode.value}
              onClick={() => setSystemMode(mode.value)}
              className={`flex-1 p-4 rounded-lg border text-left transition-all ${
                systemMode === mode.value 
                  ? 'border-blue-500 bg-blue-500/10' 
                  : 'border-[#2A3344] hover:border-[#3A4354]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                {systemMode === mode.value ? (
                  <CheckCircle className="w-5 h-5 text-blue-400" />
                ) : (
                  <div className="w-5 h-5 rounded-full border border-gray-500" />
                )}
                <span className="font-semibold">{mode.label}</span>
              </div>
              <p className="text-xs text-gray-400">{mode.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Agent Autonomy Config */}
      <div className="bg-[#1A1F2E] rounded-lg border border-[#2A3344] overflow-hidden">
        <div className="grid grid-cols-12 gap-4 p-4 bg-[#11161D] border-b border-[#2A3344] text-xs text-gray-400 uppercase">
          <div className="col-span-3">Agent</div>
          <div className="col-span-2">Autonomy Level</div>
          <div className="col-span-2">Financial Limit</div>
          <div className="col-span-2">Safety Override</div>
          <div className="col-span-3">Required Approvals</div>
        </div>

        {config.map((item, index) => (
          <div key={item.agent} className="grid grid-cols-12 gap-4 p-4 border-b border-[#2A3344] hover:bg-[#11161D]">
            <div className="col-span-3 flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-[#2A3344] flex items-center justify-center">
                <Zap className="w-4 h-4 text-blue-400" />
              </div>
              <span className="text-sm">{item.agent}</span>
            </div>
            
            <div className="col-span-2">
              <select
                value={item.autonomyLevel}
                onChange={(e) => updateConfig(index, 'autonomyLevel', e.target.value)}
                className={`w-full bg-[#1A1F2E] border rounded px-2 py-1 text-sm ${getLevelColor(item.autonomyLevel)}`}
              >
                <option value="manual">Manual</option>
                <option value="advisory">Advisory</option>
                <option value="autonomous">Autonomous</option>
              </select>
            </div>

            <div className="col-span-2">
              <div className="flex items-center gap-2">
                <span className="text-gray-500">$</span>
                <input
                  type="number"
                  value={item.financialLimit}
                  onChange={(e) => updateConfig(index, 'financialLimit', parseInt(e.target.value) || 0)}
                  className="w-full bg-[#1A1F2E] border border-[#2A3344] rounded px-2 py-1 text-sm"
                  disabled={item.autonomyLevel === 'manual'}
                />
              </div>
            </div>

            <div className="col-span-2 flex items-center">
              <button
                onClick={() => updateConfig(index, 'safetyOverride', !item.safetyOverride)}
                className={`flex items-center gap-2 px-2 py-1 rounded ${
                  item.safetyOverride 
                    ? 'bg-emerald-500/10 text-emerald-400' 
                    : 'bg-[#2A3344] text-gray-400'
                }`}
              >
                {item.safetyOverride ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                <span className="text-sm">{item.safetyOverride ? 'Enabled' : 'Disabled'}</span>
              </button>
            </div>

            <div className="col-span-3">
              {item.approvalRequired.length === 0 ? (
                <span className="text-xs text-gray-500">None required</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {item.approvalRequired.map(approval => (
                    <span key={approval} className="text-xs px-2 py-0.5 bg-[#2A3344] rounded">
                      {approval}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Financial Approval Threshold */}
      <div className="mt-6 bg-[#1A1F2E] rounded-lg border border-[#2A3344] p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          Global Financial Approval Thresholds
        </h3>
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-[#11161D] rounded p-3">
            <div className="text-xs text-gray-400 mb-1">Technician Level</div>
            <div className="text-lg font-semibold text-white">$500</div>
          </div>
          <div className="bg-[#11161D] rounded p-3">
            <div className="text-xs text-gray-400 mb-1">Supervisor Level</div>
            <div className="text-lg font-semibold text-white">$5,000</div>
          </div>
          <div className="bg-[#11161D] rounded p-3">
            <div className="text-xs text-gray-400 mb-1">Manager Level</div>
            <div className="text-lg font-semibold text-white">$25,000</div>
          </div>
          <div className="bg-[#11161D] rounded p-3">
            <div className="text-xs text-gray-400 mb-1">Executive Level</div>
            <div className="text-lg font-semibold text-white">$100,000+</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AutonomyControlPanel;