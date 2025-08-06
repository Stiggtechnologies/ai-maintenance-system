import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  BarChart3, 
  Bot, 
  Building2, 
  CheckCircle, 
  Clock, 
  DollarSign, 
  Factory, 
  Gauge, 
  Globe, 
  Leaf, 
  Monitor, 
  Settings, 
  Shield, 
  Smartphone, 
  TrendingUp, 
  Users, 
  Wrench,
  AlertTriangle,
  Zap,
  Database,
  Cloud
} from 'lucide-react';

function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedAgent, setSelectedAgent] = useState('');
  const [agentResponse, setAgentResponse] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [metrics, setMetrics] = useState({
    totalAssets: 2847,
    activeWorkOrders: 156,
    esgScore: 87.3,
    costSavings: '2.4M',
    uptime: 98.7,
    efficiency: 94.2
  });

  const industries = [
    { name: 'Oil & Gas', icon: Factory, integrations: ['SAP PM', 'OSIsoft PI', 'Emerson AMS'] },
    { name: 'Mining', icon: Building2, integrations: ['Maximo', 'UpKeep', 'Maintenance Connection'] },
    { name: 'Power & Utilities', icon: Zap, integrations: ['GE Predix', 'OSIsoft PI', 'Schneider EcoStruxure'] },
    { name: 'Chemical/Manufacturing', icon: Settings, integrations: ['SAP PM', 'Emerson AMS', 'Honeywell Forge'] },
    { name: 'Aerospace & Transportation', icon: Globe, integrations: ['Honeywell APM', 'Maximo', 'IFS Maintenix'] }
  ];

  const aiAgents = [
    { id: 'MaintenanceStrategyDevelopmentAgent', name: 'Maintenance Strategy Development', description: 'Develops comprehensive maintenance strategies' },
    { id: 'AssetManagementAgent', name: 'Asset Management', description: 'Manages asset lifecycle and criticality' },
    { id: 'ReliabilityEngineeringAgent', name: 'Reliability Engineering', description: 'Predicts failures and optimizes reliability' },
    { id: 'PlanningSchedulingAgent', name: 'Planning & Scheduling', description: 'Optimizes maintenance schedules' },
    { id: 'WorkOrderManagementAgent', name: 'Work Order Management', description: 'Automates work order creation and tracking' },
    { id: 'ConditionMonitoringAgent', name: 'Condition Monitoring', description: 'Analyzes sensor data for anomalies' },
    { id: 'InventoryManagementAgent', name: 'Inventory Management', description: 'Optimizes spare parts inventory' },
    { id: 'MaintenanceOperationsAgent', name: 'Maintenance Operations', description: 'Oversees maintenance execution' },
    { id: 'QualityAssuranceAgent', name: 'Quality Assurance', description: 'Validates maintenance outcomes' },
    { id: 'ComplianceAuditingAgent', name: 'Compliance & Auditing', description: 'Ensures regulatory compliance' },
    { id: 'SustainabilityESGAgent', name: 'Sustainability & ESG', description: 'Tracks environmental metrics' },
    { id: 'DataAnalyticsAgent', name: 'Data Analytics', description: 'Generates insights and reports' },
    { id: 'ContinuousImprovementAgent', name: 'Continuous Improvement', description: 'Identifies improvement opportunities' },
    { id: 'TrainingWorkforceAgent', name: 'Training & Workforce', description: 'Manages training programs' },
    { id: 'FinancialContractAgent', name: 'Financial & Contract', description: 'Optimizes budgets and contracts' }
  ];

  const executeAgent = async (agentId: string, industry: string) => {
    setIsProcessing(true);
    setSelectedAgent(agentId);
    
    // Simulate AI processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const responses = {
      'MaintenanceStrategyDevelopmentAgent': `✅ Maintenance Strategy Analysis Complete for ${industry}:\n\n• Recommended shift to condition-based maintenance\n• Projected 25% reduction in unplanned downtime\n• Annual cost savings: $450K\n• Implementation timeline: 6 months\n• ROI: 340% within 18 months`,
      'ReliabilityEngineeringAgent': `🔧 Reliability Analysis Complete for ${industry}:\n\n• Analyzed 847 assets using predictive models\n• Identified 23 assets requiring attention\n• Failure prediction accuracy: 94.2%\n• Recommended maintenance windows scheduled\n• Expected reliability improvement: 15%`,
      'SustainabilityESGAgent': `🌱 ESG Metrics Analysis for ${industry}:\n\n• Environmental Score: 85% (↑3% from last month)\n• Social Score: 92% (industry leading)\n• Governance Score: 88%\n• Carbon footprint reduced by 12%\n• Compliance rating: 98.5%`,
      'ComplianceAuditingAgent': `📋 Compliance Report Generated for ${industry}:\n\n• ISO 55000 compliance: 98.5%\n• Regulatory requirements: 100% met\n• Audit findings: 2 minor observations\n• Corrective actions: Auto-scheduled\n• Next audit: Recommended in 6 months`
    };
    
    setAgentResponse(responses[agentId as keyof typeof responses] || `✅ ${agentId.replace('Agent', '')} analysis completed successfully for ${industry} industry with actionable insights and recommendations.`);
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">StiggSync AI</h1>
                <p className="text-sm text-gray-600">AI-Powered Maintenance & Reliability System</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">Enterprise Demo</p>
                <p className="text-xs text-gray-500">15 AI Agents • Multi-Industry</p>
              </div>
              <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            {[
              { id: 'overview', name: 'Executive Overview', icon: BarChart3 },
              { id: 'agents', name: '15 AI Agents', icon: Bot },
              { id: 'industries', name: 'Multi-Industry', icon: Factory },
              { id: 'integrations', name: 'Enterprise Integration', icon: Database },
              { id: 'mobile', name: 'Mobile & Field', icon: Smartphone },
              { id: 'esg', name: 'ESG & Compliance', icon: Leaf }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span>{tab.name}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Hero Section */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-8 text-white">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                <div>
                  <h2 className="text-3xl font-bold mb-4">Enterprise AI Maintenance & Reliability</h2>
                  <p className="text-xl mb-6 text-blue-100">
                    15 specialized AI agents delivering $700K-$3M annual savings per 100 assets
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <span className="bg-white/20 px-3 py-1 rounded-full text-sm">Azure AI Foundry</span>
                    <span className="bg-white/20 px-3 py-1 rounded-full text-sm">GPT-4 Turbo</span>
                    <span className="bg-white/20 px-3 py-1 rounded-full text-sm">Computer Vision</span>
                    <span className="bg-white/20 px-3 py-1 rounded-full text-sm">Blockchain Audit</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/10 p-4 rounded-lg">
                    <div className="text-2xl font-bold">{metrics.totalAssets.toLocaleString()}</div>
                    <div className="text-sm text-blue-100">Assets Monitored</div>
                  </div>
                  <div className="bg-white/10 p-4 rounded-lg">
                    <div className="text-2xl font-bold">{metrics.uptime}%</div>
                    <div className="text-sm text-blue-100">System Uptime</div>
                  </div>
                  <div className="bg-white/10 p-4 rounded-lg">
                    <div className="text-2xl font-bold">${metrics.costSavings}</div>
                    <div className="text-sm text-blue-100">Annual Savings</div>
                  </div>
                  <div className="bg-white/10 p-4 rounded-lg">
                    <div className="text-2xl font-bold">{metrics.esgScore}%</div>
                    <div className="text-sm text-blue-100">ESG Score</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Active Work Orders</p>
                    <p className="text-2xl font-bold text-gray-900">{metrics.activeWorkOrders}</p>
                  </div>
                  <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                    <Wrench className="w-6 h-6 text-orange-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                  <span className="text-green-600">12% reduction</span>
                  <span className="text-gray-500 ml-1">vs last month</span>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">System Efficiency</p>
                    <p className="text-2xl font-bold text-gray-900">{metrics.efficiency}%</p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <Gauge className="w-6 h-6 text-green-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                  <span className="text-green-600">8% improvement</span>
                  <span className="text-gray-500 ml-1">this quarter</span>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Predictive Accuracy</p>
                    <p className="text-2xl font-bold text-gray-900">94.2%</p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Activity className="w-6 h-6 text-purple-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <CheckCircle className="w-4 h-4 text-green-500 mr-1" />
                  <span className="text-green-600">Industry leading</span>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">ROI Achievement</p>
                    <p className="text-2xl font-bold text-gray-900">340%</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <DollarSign className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
                <div className="mt-4 flex items-center text-sm">
                  <Clock className="w-4 h-4 text-blue-500 mr-1" />
                  <span className="text-blue-600">18 months</span>
                  <span className="text-gray-500 ml-1">payback</span>
                </div>
              </div>
            </div>

            {/* Value Proposition */}
            <div className="bg-white rounded-xl shadow-sm border p-8">
              <h3 className="text-xl font-bold text-gray-900 mb-6">Enterprise Value Delivered</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="text-center">
                  <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="w-8 h-8 text-red-600" />
                  </div>
                  <h4 className="font-semibold text-gray-900 mb-2">Unplanned Downtime</h4>
                  <p className="text-3xl font-bold text-red-600 mb-2">-40%</p>
                  <p className="text-sm text-gray-600">Reduced through predictive maintenance</p>
                </div>
                <div className="text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <TrendingUp className="w-8 h-8 text-green-600" />
                  </div>
                  <h4 className="font-semibold text-gray-900 mb-2">Maintenance Efficiency</h4>
                  <p className="text-3xl font-bold text-green-600 mb-2">+50%</p>
                  <p className="text-sm text-gray-600">Improved through AI optimization</p>
                </div>
                <div className="text-center">
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <DollarSign className="w-8 h-8 text-blue-600" />
                  </div>
                  <h4 className="font-semibold text-gray-900 mb-2">Cost Reduction</h4>
                  <p className="text-3xl font-bold text-blue-600 mb-2">30%</p>
                  <p className="text-sm text-gray-600">Lower maintenance costs overall</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'agents' && (
          <div className="space-y-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">15 Specialized AI Agents</h2>
              <p className="text-xl text-gray-600 mb-8">Each agent powered by Azure AI Foundry with GPT-4 Turbo</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {aiAgents.map((agent, index) => (
                <div key={agent.id} className="bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold">
                      {index + 1}
                    </div>
                    <button
                      onClick={() => executeAgent(agent.id, 'Oil & Gas')}
                      disabled={isProcessing}
                      className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium hover:bg-blue-200 transition-colors disabled:opacity-50"
                    >
                      {isProcessing && selectedAgent === agent.id ? 'Processing...' : 'Demo'}
                    </button>
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">{agent.name}</h3>
                  <p className="text-sm text-gray-600">{agent.description}</p>
                </div>
              ))}
            </div>

            {agentResponse && (
              <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-6 border border-green-200">
                <h4 className="font-semibold text-gray-900 mb-3">AI Agent Response:</h4>
                <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono bg-white p-4 rounded-lg">
                  {agentResponse}
                </pre>
              </div>
            )}
          </div>
        )}

        {activeTab === 'industries' && (
          <div className="space-y-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Multi-Industry Coverage</h2>
              <p className="text-xl text-gray-600 mb-8">Specialized AI agents for every industrial sector</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {industries.map((industry) => (
                <div key={industry.name} className="bg-white rounded-xl shadow-sm border p-8">
                  <div className="flex items-center mb-6">
                    <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center mr-4">
                      <industry.icon className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">{industry.name}</h3>
                  </div>
                  
                  <div className="mb-6">
                    <h4 className="font-semibold text-gray-900 mb-3">Enterprise Integrations:</h4>
                    <div className="flex flex-wrap gap-2">
                      {industry.integrations.map((integration) => (
                        <span key={integration} className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
                          {integration}
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => executeAgent('ReliabilityEngineeringAgent', industry.name)}
                    disabled={isProcessing}
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-6 rounded-lg font-medium hover:from-blue-700 hover:to-purple-700 transition-all disabled:opacity-50"
                  >
                    {isProcessing ? 'Processing AI Analysis...' : `Demo ${industry.name} AI Analysis`}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'integrations' && (
          <div className="space-y-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Enterprise Integration Ecosystem</h2>
              <p className="text-xl text-gray-600 mb-8">Seamless connectivity with your existing systems</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { name: 'SAP PM', description: 'Plant Maintenance integration', status: 'Connected', color: 'green' },
                { name: 'IBM Maximo', description: 'Asset management sync', status: 'Connected', color: 'green' },
                { name: 'OSIsoft PI', description: 'Historian data integration', status: 'Connected', color: 'green' },
                { name: 'GE Predix', description: 'Industrial IoT platform', status: 'Connected', color: 'green' },
                { name: 'Emerson AMS', description: 'Asset monitoring suite', status: 'Connected', color: 'green' },
                { name: 'Honeywell APM', description: 'Asset performance mgmt', status: 'Connected', color: 'green' }
              ].map((integration) => (
                <div key={integration.name} className="bg-white rounded-xl shadow-sm border p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Database className="w-5 h-5 text-blue-600" />
                    </div>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      integration.color === 'green' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {integration.status}
                    </span>
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">{integration.name}</h3>
                  <p className="text-sm text-gray-600">{integration.description}</p>
                </div>
              ))}
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-8 border">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Integration Benefits</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Real-time Data Sync</h4>
                  <p className="text-gray-600">Bidirectional synchronization with existing systems</p>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Zero Disruption</h4>
                  <p className="text-gray-600">Seamless integration without workflow changes</p>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Enhanced Analytics</h4>
                  <p className="text-gray-600">AI-powered insights across all connected systems</p>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Unified Dashboard</h4>
                  <p className="text-gray-600">Single pane of glass for all maintenance data</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'mobile' && (
          <div className="space-y-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Mobile & Field Operations</h2>
              <p className="text-xl text-gray-600 mb-8">Empowering field technicians with AI-powered mobile tools</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-white rounded-xl shadow-sm border p-8">
                <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl flex items-center justify-center mb-6">
                  <Smartphone className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-4">Mobile App Features</h3>
                <ul className="space-y-3">
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>QR code asset scanning</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Offline work order management</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Real-time status updates</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Digital maintenance manuals</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Parts request automation</span>
                  </li>
                </ul>
              </div>

              <div className="bg-white rounded-xl shadow-sm border p-8">
                <div className="w-16 h-16 bg-gradient-to-r from-green-500 to-blue-500 rounded-xl flex items-center justify-center mb-6">
                  <Cloud className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-4">Offline Capabilities</h3>
                <ul className="space-y-3">
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Work without internet connection</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Automatic sync when online</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Cached maintenance procedures</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Local data storage</span>
                  </li>
                  <li className="flex items-center">
                    <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                    <span>Conflict resolution</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-xl p-8 text-white">
              <h3 className="text-xl font-bold mb-6">Mobile Demo Interface</h3>
              <div className="bg-gray-800 rounded-lg p-6 max-w-sm mx-auto">
                <div className="bg-blue-600 text-white p-3 rounded-t-lg text-center font-semibold">
                  StiggSync Mobile
                </div>
                <div className="bg-white text-gray-900 p-4 space-y-3">
                  <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <span className="text-sm">WO-2024-001</span>
                    <span className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">High</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <span className="text-sm">WO-2024-002</span>
                    <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Low</span>
                  </div>
                  <button className="w-full bg-blue-600 text-white py-2 rounded text-sm">
                    📷 Scan Asset QR Code
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'esg' && (
          <div className="space-y-8">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">ESG & Compliance</h2>
              <p className="text-xl text-gray-600 mb-8">Comprehensive sustainability and governance tracking</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-6 text-white">
                <div className="flex items-center justify-between mb-4">
                  <Leaf className="w-8 h-8" />
                  <span className="text-2xl font-bold">85%</span>
                </div>
                <h3 className="font-semibold mb-2">Environmental</h3>
                <p className="text-sm text-green-100">Carbon footprint reduction, energy efficiency, waste management</p>
              </div>

              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white">
                <div className="flex items-center justify-between mb-4">
                  <Users className="w-8 h-8" />
                  <span className="text-2xl font-bold">92%</span>
                </div>
                <h3 className="font-semibold mb-2">Social</h3>
                <p className="text-sm text-blue-100">Safety metrics, training programs, workforce development</p>
              </div>

              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-6 text-white">
                <div className="flex items-center justify-between mb-4">
                  <Shield className="w-8 h-8" />
                  <span className="text-2xl font-bold">88%</span>
                </div>
                <h3 className="font-semibold mb-2">Governance</h3>
                <p className="text-sm text-purple-100">Compliance tracking, audit trails, risk management</p>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-8">
              <h3 className="text-xl font-bold text-gray-900 mb-6">Compliance Standards</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { name: 'ISO 55000', score: '98.5%', status: 'Compliant' },
                  { name: 'SOC 2 Type II', score: '100%', status: 'Certified' },
                  { name: 'GDPR', score: '100%', status: 'Compliant' },
                  { name: 'HIPAA', score: '97.2%', status: 'Compliant' }
                ].map((standard) => (
                  <div key={standard.name} className="text-center p-4 bg-gray-50 rounded-lg">
                    <h4 className="font-semibold text-gray-900">{standard.name}</h4>
                    <p className="text-2xl font-bold text-green-600 my-2">{standard.score}</p>
                    <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                      {standard.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-8 border">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Blockchain Audit Trail</h3>
              <p className="text-gray-600 mb-6">
                Immutable maintenance records with cryptographic verification for complete audit transparency.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Security Features</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Cryptographic hash verification</li>
                    <li>• Tamper-proof maintenance logs</li>
                    <li>• Distributed ledger technology</li>
                    <li>• Real-time integrity checking</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Compliance Benefits</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Regulatory audit readiness</li>
                    <li>• Immutable evidence trail</li>
                    <li>• Automated compliance reporting</li>
                    <li>• Risk mitigation</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                  <Bot className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold">StiggSync AI</span>
              </div>
              <p className="text-gray-400 text-sm">
                Enterprise AI-powered maintenance and reliability system with 15 specialized agents.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Industries</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>Oil & Gas</li>
                <li>Mining</li>
                <li>Power & Utilities</li>
                <li>Chemical/Manufacturing</li>
                <li>Aerospace & Transportation</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Features</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>15 AI Agents</li>
                <li>Predictive Analytics</li>
                <li>Mobile App</li>
                <li>ESG Tracking</li>
                <li>Blockchain Audit</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Technology</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>Azure AI Foundry</li>
                <li>GPT-4 Turbo</li>
                <li>Computer Vision</li>
                <li>Kubernetes</li>
                <li>Enterprise Security</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
            <p>&copy; 2024 Stigg Technologies. Built with ❤️ for industrial excellence.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;