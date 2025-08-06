import React, { useState } from 'react';
import { 
  BarChart3, 
  Bot, 
  Building2, 
  CheckCircle, 
  DollarSign, 
  Factory, 
  Globe, 
  Leaf, 
  Monitor, 
  Smartphone, 
  TrendingUp, 
  Users, 
  Wrench,
  Zap,
  Database,
  Shield,
  Activity
} from 'lucide-react';

interface StakeholderPresentationProps {
  onClose: () => void;
}

export const StakeholderPresentation: React.FC<StakeholderPresentationProps> = ({ onClose }) => {
  const [currentSlide, setCurrentSlide] = useState(0);

  const slides = [
    {
      title: "StiggSync AI: Enterprise Maintenance & Reliability",
      subtitle: "15 Specialized AI Agents • Multi-Industry • Production Ready",
      content: (
        <div className="grid grid-cols-2 gap-8 items-center">
          <div>
            <h3 className="text-2xl font-bold mb-4">Value Proposition</h3>
            <ul className="space-y-3 text-lg">
              <li className="flex items-center"><CheckCircle className="w-6 h-6 text-green-500 mr-3" />$700K-$3M annual savings per 100 assets</li>
              <li className="flex items-center"><CheckCircle className="w-6 h-6 text-green-500 mr-3" />40% reduction in unplanned downtime</li>
              <li className="flex items-center"><CheckCircle className="w-6 h-6 text-green-500 mr-3" />50% improvement in maintenance efficiency</li>
              <li className="flex items-center"><CheckCircle className="w-6 h-6 text-green-500 mr-3" />340% ROI within 18 months</li>
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-100 p-6 rounded-lg text-center">
              <div className="text-3xl font-bold text-blue-600">2,847</div>
              <div className="text-sm text-blue-800">Assets Monitored</div>
            </div>
            <div className="bg-green-100 p-6 rounded-lg text-center">
              <div className="text-3xl font-bold text-green-600">98.7%</div>
              <div className="text-sm text-green-800">System Uptime</div>
            </div>
            <div className="bg-purple-100 p-6 rounded-lg text-center">
              <div className="text-3xl font-bold text-purple-600">94.2%</div>
              <div className="text-sm text-purple-800">AI Accuracy</div>
            </div>
            <div className="bg-orange-100 p-6 rounded-lg text-center">
              <div className="text-3xl font-bold text-orange-600">87.3%</div>
              <div className="text-sm text-orange-800">ESG Score</div>
            </div>
          </div>
        </div>
      )
    },
    {
      title: "15 Specialized AI Agents",
      subtitle: "Powered by Azure AI Foundry with GPT-4 Turbo",
      content: (
        <div className="grid grid-cols-3 gap-4">
          {[
            "Maintenance Strategy Development", "Asset Management", "Reliability Engineering",
            "Planning & Scheduling", "Work Order Management", "Condition Monitoring",
            "Inventory Management", "Maintenance Operations", "Quality Assurance",
            "Compliance & Auditing", "Sustainability & ESG", "Data Analytics",
            "Continuous Improvement", "Training & Workforce", "Financial & Contract"
          ].map((agent, index) => (
            <div key={agent} className="bg-white p-4 rounded-lg shadow border">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-sm mb-2">
                {index + 1}
              </div>
              <h4 className="font-semibold text-sm mb-1">{agent}</h4>
              <div className="text-xs text-gray-600">AI-powered automation</div>
            </div>
          ))}
        </div>
      )
    },
    {
      title: "Multi-Industry Coverage",
      subtitle: "Specialized solutions for every industrial sector",
      content: (
        <div className="grid grid-cols-1 gap-6">
          {[
            { name: 'Oil & Gas', icon: Factory, integrations: ['SAP PM', 'OSIsoft PI', 'Emerson AMS'], savings: '$1.2M' },
            { name: 'Mining', icon: Building2, integrations: ['Maximo', 'UpKeep', 'Maintenance Connection'], savings: '$950K' },
            { name: 'Power & Utilities', icon: Zap, integrations: ['GE Predix', 'OSIsoft PI', 'Schneider EcoStruxure'], savings: '$1.8M' },
            { name: 'Chemical/Manufacturing', icon: Monitor, integrations: ['SAP PM', 'Emerson AMS', 'Honeywell Forge'], savings: '$1.1M' },
            { name: 'Aerospace & Transportation', icon: Globe, integrations: ['Honeywell APM', 'Maximo', 'IFS Maintenix'], savings: '$2.3M' }
          ].map((industry) => (
            <div key={industry.name} className="flex items-center justify-between bg-white p-4 rounded-lg shadow border">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center mr-4">
                  <industry.icon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h4 className="font-semibold">{industry.name}</h4>
                  <div className="flex space-x-2 mt-1">
                    {industry.integrations.map((integration) => (
                      <span key={integration} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
                        {integration}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-green-600">{industry.savings}</div>
                <div className="text-xs text-gray-600">Annual Savings</div>
              </div>
            </div>
          ))}
        </div>
      )
    },
    {
      title: "Enterprise Integration Ecosystem",
      subtitle: "Seamless connectivity with existing systems",
      content: (
        <div className="grid grid-cols-2 gap-8">
          <div>
            <h3 className="text-xl font-bold mb-4">Connected Systems</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                'SAP PM', 'IBM Maximo', 'OSIsoft PI', 'GE Predix',
                'Emerson AMS', 'Honeywell APM', 'Schneider Electric', 'Rockwell'
              ].map((system) => (
                <div key={system} className="bg-green-50 border border-green-200 p-3 rounded-lg text-center">
                  <Database className="w-6 h-6 text-green-600 mx-auto mb-1" />
                  <div className="text-sm font-medium">{system}</div>
                  <div className="text-xs text-green-600">Connected</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xl font-bold mb-4">Integration Benefits</h3>
            <ul className="space-y-3">
              <li className="flex items-center">
                <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                <span>Real-time bidirectional data sync</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                <span>Zero disruption deployment</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                <span>Enhanced AI-powered analytics</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                <span>Unified maintenance dashboard</span>
              </li>
              <li className="flex items-center">
                <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                <span>Automated workflow orchestration</span>
              </li>
            </ul>
          </div>
        </div>
      )
    },
    {
      title: "Technology Architecture",
      subtitle: "Enterprise-grade, cloud-native, AI-first platform",
      content: (
        <div className="grid grid-cols-2 gap-8">
          <div>
            <h3 className="text-xl font-bold mb-4">AI & Machine Learning</h3>
            <ul className="space-y-2">
              <li className="flex items-center"><Bot className="w-5 h-5 text-blue-500 mr-2" />Azure AI Foundry</li>
              <li className="flex items-center"><Bot className="w-5 h-5 text-blue-500 mr-2" />GPT-4 Turbo</li>
              <li className="flex items-center"><Bot className="w-5 h-5 text-blue-500 mr-2" />Computer Vision</li>
              <li className="flex items-center"><Bot className="w-5 h-5 text-blue-500 mr-2" />Content Safety</li>
              <li className="flex items-center"><Bot className="w-5 h-5 text-blue-500 mr-2" />Predictive Analytics</li>
            </ul>
            
            <h3 className="text-xl font-bold mb-4 mt-6">Infrastructure</h3>
            <ul className="space-y-2">
              <li className="flex items-center"><Database className="w-5 h-5 text-green-500 mr-2" />Azure Kubernetes Service</li>
              <li className="flex items-center"><Database className="w-5 h-5 text-green-500 mr-2" />Azure SQL Database</li>
              <li className="flex items-center"><Database className="w-5 h-5 text-green-500 mr-2" />Redis Cache</li>
              <li className="flex items-center"><Database className="w-5 h-5 text-green-500 mr-2" />Application Insights</li>
              <li className="flex items-center"><Database className="w-5 h-5 text-green-500 mr-2" />Auto-scaling</li>
            </ul>
          </div>
          <div>
            <h3 className="text-xl font-bold mb-4">Security & Compliance</h3>
            <ul className="space-y-2">
              <li className="flex items-center"><Shield className="w-5 h-5 text-red-500 mr-2" />Azure Entra ID</li>
              <li className="flex items-center"><Shield className="w-5 h-5 text-red-500 mr-2" />Key Vault</li>
              <li className="flex items-center"><Shield className="w-5 h-5 text-red-500 mr-2" />TLS 1.3 Encryption</li>
              <li className="flex items-center"><Shield className="w-5 h-5 text-red-500 mr-2" />SOC 2 Type II</li>
              <li className="flex items-center"><Shield className="w-5 h-5 text-red-500 mr-2" />Blockchain Audit</li>
            </ul>
            
            <h3 className="text-xl font-bold mb-4 mt-6">Mobile & Field</h3>
            <ul className="space-y-2">
              <li className="flex items-center"><Smartphone className="w-5 h-5 text-purple-500 mr-2" />Native Mobile App</li>
              <li className="flex items-center"><Smartphone className="w-5 h-5 text-purple-500 mr-2" />Offline Capability</li>
              <li className="flex items-center"><Smartphone className="w-5 h-5 text-purple-500 mr-2" />QR Code Scanning</li>
              <li className="flex items-center"><Smartphone className="w-5 h-5 text-purple-500 mr-2" />Real-time Sync</li>
              <li className="flex items-center"><Smartphone className="w-5 h-5 text-purple-500 mr-2" />Digital Manuals</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      title: "Financial Impact & ROI",
      subtitle: "Proven results across enterprise deployments",
      content: (
        <div className="grid grid-cols-2 gap-8">
          <div>
            <h3 className="text-xl font-bold mb-4">Cost Savings Breakdown</h3>
            <div className="space-y-4">
              <div className="bg-red-50 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Unplanned Downtime Reduction</span>
                  <span className="text-xl font-bold text-red-600">-40%</span>
                </div>
                <div className="text-sm text-gray-600">$1.2M annual savings</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Maintenance Efficiency</span>
                  <span className="text-xl font-bold text-green-600">+50%</span>
                </div>
                <div className="text-sm text-gray-600">$800K annual savings</div>
              </div>
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Inventory Optimization</span>
                  <span className="text-xl font-bold text-blue-600">-25%</span>
                </div>
                <div className="text-sm text-gray-600">$400K annual savings</div>
              </div>
            </div>
          </div>
          <div>
            <h3 className="text-xl font-bold mb-4">Investment & Payback</h3>
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-lg">
              <div className="text-center mb-4">
                <div className="text-4xl font-bold text-blue-600">340%</div>
                <div className="text-lg text-gray-700">ROI within 18 months</div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Initial Investment:</span>
                  <span className="font-semibold">$500K - $1.2M</span>
                </div>
                <div className="flex justify-between">
                  <span>Annual Savings:</span>
                  <span className="font-semibold text-green-600">$700K - $3M</span>
                </div>
                <div className="flex justify-between">
                  <span>Payback Period:</span>
                  <span className="font-semibold text-blue-600">8-15 months</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-bold">Net 5-Year Value:</span>
                  <span className="font-bold text-green-600">$8M - $18M</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      title: "Implementation Roadmap",
      subtitle: "Phased deployment approach for minimal disruption",
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {[
              { phase: "Phase 1", title: "Foundation", duration: "Month 1-2", items: ["Infrastructure setup", "Core AI agents", "Basic integrations"] },
              { phase: "Phase 2", title: "Integration", duration: "Month 3-4", items: ["ERP connectivity", "Mobile deployment", "User training"] },
              { phase: "Phase 3", title: "Optimization", duration: "Month 5-6", items: ["Advanced analytics", "ESG tracking", "Full automation"] },
              { phase: "Phase 4", title: "Scale", duration: "Month 7+", items: ["Multi-site rollout", "Advanced AI", "Continuous improvement"] }
            ].map((phase, index) => (
              <div key={phase.phase} className="bg-white p-4 rounded-lg shadow border">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm mb-3">
                  {index + 1}
                </div>
                <h4 className="font-bold text-gray-900">{phase.title}</h4>
                <p className="text-sm text-gray-600 mb-2">{phase.duration}</p>
                <ul className="text-xs text-gray-700 space-y-1">
                  {phase.items.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          
          <div className="bg-gradient-to-r from-green-50 to-blue-50 p-6 rounded-lg">
            <h3 className="text-lg font-bold mb-3">Success Metrics & KPIs</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">98%</div>
                <div className="text-sm text-gray-600">Implementation Success Rate</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">6 months</div>
                <div className="text-sm text-gray-600">Average Deployment Time</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">24/7</div>
                <div className="text-sm text-gray-600">Support & Monitoring</div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      title: "Next Steps & Call to Action",
      subtitle: "Ready to transform your maintenance operations?",
      content: (
        <div className="grid grid-cols-2 gap-8">
          <div>
            <h3 className="text-xl font-bold mb-4">Immediate Actions</h3>
            <div className="space-y-4">
              <div className="flex items-start">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3 mt-1">
                  <span className="text-blue-600 font-bold text-sm">1</span>
                </div>
                <div>
                  <h4 className="font-semibold">Pilot Program</h4>
                  <p className="text-sm text-gray-600">30-day proof of concept with 3-5 critical assets</p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3 mt-1">
                  <span className="text-blue-600 font-bold text-sm">2</span>
                </div>
                <div>
                  <h4 className="font-semibold">Technical Assessment</h4>
                  <p className="text-sm text-gray-600">Integration analysis with existing systems</p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3 mt-1">
                  <span className="text-blue-600 font-bold text-sm">3</span>
                </div>
                <div>
                  <h4 className="font-semibold">Business Case Development</h4>
                  <p className="text-sm text-gray-600">ROI analysis and implementation planning</p>
                </div>
              </div>
            </div>
          </div>
          <div>
            <h3 className="text-xl font-bold mb-4">Contact Information</h3>
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6 rounded-lg text-white">
              <h4 className="font-bold mb-3">Ready to Get Started?</h4>
              <div className="space-y-2 text-sm">
                <p>📧 enterprise@stiggtechnologies.com</p>
                <p>📞 +1 (555) 123-4567</p>
                <p>🌐 www.stiggtechnologies.com</p>
                <p>📍 Enterprise Solutions Division</p>
              </div>
              <div className="mt-4 pt-4 border-t border-white/20">
                <p className="text-xs">
                  Schedule a personalized demo and see how StiggSync AI can transform your maintenance operations.
                </p>
              </div>
            </div>
          </div>
        </div>
      )
    }
  ];

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl h-5/6 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{slides[currentSlide].title}</h2>
            <p className="text-gray-600">{slides[currentSlide].subtitle}</p>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-500">
              {currentSlide + 1} of {slides.length}
            </span>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-8 overflow-y-auto">
          {slides[currentSlide].content}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between p-6 border-t bg-gray-50">
          <button
            onClick={prevSlide}
            disabled={currentSlide === 0}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          
          <div className="flex space-x-2">
            {slides.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentSlide(index)}
                className={`w-3 h-3 rounded-full ${
                  index === currentSlide ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              />
            ))}
          </div>
          
          <button
            onClick={nextSlide}
            disabled={currentSlide === slides.length - 1}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};