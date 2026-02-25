import { useState } from 'react';
import { HelpCircle, Search, BookOpen, X, ExternalLink, ChevronRight } from 'lucide-react';

interface HelpArticle {
  id: string;
  title: string;
  category: string;
  summary: string;
  content: string;
}

const helpArticles: HelpArticle[] = [
  {
    id: '01',
    title: 'Getting Started with SyncAI',
    category: 'Quick Start',
    summary: 'Learn the basics and set up your account',
    content: `# Getting Started

Welcome to SyncAI! This guide will help you get up and running.

## Step 1: Complete Your Profile
Add your organization details and configure your preferences.

## Step 2: Add Assets
Import your assets via CSV or add them manually.

## Step 3: Activate AI Agents
Enable the AI agents relevant to your industry.

## Step 4: Start Monitoring
View real-time insights and alerts in your dashboard.`
  },
  {
    id: '02',
    title: 'Adding and Managing Assets',
    category: 'Assets',
    summary: 'Import, organize, and monitor your equipment',
    content: `# Asset Management

## Adding Assets Manually
1. Navigate to Assets in the sidebar
2. Click "Add Asset"
3. Fill in the required fields: Name, Type, Location
4. Set criticality level
5. Click "Create"

## Bulk Import via CSV
1. Download the CSV template
2. Fill in your asset data
3. Upload the file
4. Review and confirm import

## Asset Organization
- Use tags for easy filtering
- Set criticality levels (Low, Medium, High, Critical)
- Group by location or type`
  },
  {
    id: '03',
    title: 'Understanding AI Agents',
    category: 'AI Features',
    summary: 'How AI agents monitor and optimize your operations',
    content: `# AI Agents Explained

SyncAI uses 15 specialized AI agents to monitor your operations.

## Core Agents:
- **Predictive Analytics**: Forecasts equipment failures
- **Asset Health**: Monitors equipment condition
- **Work Order**: Automates maintenance scheduling

## How They Work:
1. Agents analyze real-time and historical data
2. Machine learning models detect patterns
3. Alerts generated for anomalies
4. Recommendations provided for action

## Customization:
Adjust sensitivity thresholds in Settings → AI Agents`
  },
  {
    id: '04',
    title: 'Work Order Management',
    category: 'Operations',
    summary: 'Create, assign, and track maintenance tasks',
    content: `# Work Order Management

## Creating Work Orders
1. Go to Work Orders
2. Click "Create Work Order"
3. Fill in details: Title, Description, Priority
4. Assign to technician
5. Set due date

## Priority Levels:
- Critical: Immediate attention required
- High: Within 24 hours
- Medium: Within 1 week
- Low: Scheduled maintenance

## Status Tracking:
- Pending: Not yet started
- In Progress: Currently being worked on
- Completed: Work finished
- Blocked: Waiting on parts/approval`
  },
  {
    id: '05',
    title: 'Billing and Subscriptions',
    category: 'Billing',
    summary: 'Manage your plan, usage, and payments',
    content: `# Billing Overview

## Subscription Plans:
- Starter: $4,000/month (200 assets)
- Pro: $9,000/month (1,000 assets)
- Enterprise: $18,000/month (3,000+ assets)

## Usage Tracking:
View your credit consumption in Billing → Usage Dashboard

## Invoices:
Access all invoices in Billing → Invoices

## Upgrade/Downgrade:
1. Go to Billing → Plans
2. Select new plan
3. Confirm change
4. Takes effect next billing cycle`
  },
  {
    id: '06',
    title: 'Security and Compliance',
    category: 'Security',
    summary: 'How we protect your data',
    content: `# Security & Compliance

## Data Protection:
- SOC 2 Type II certified
- End-to-end encryption
- Role-based access control
- Regular security audits

## Compliance:
- ISO 27001 certified
- GDPR compliant
- HIPAA ready
- Industry-specific standards supported

## Data Ownership:
Your data is yours. We never sell or share it.

## Backup & Recovery:
- Daily automated backups
- 30-day retention
- Disaster recovery plan in place`
  },
  {
    id: '07',
    title: 'API Access and Integrations',
    category: 'Developers',
    summary: 'Connect SyncAI to your existing systems',
    content: `# API & Integrations

## REST API:
Full API documentation available at docs.syncai.ca/api

## Supported Integrations:
- SAP PM
- IBM Maximo
- OSIsoft PI
- GE Predix
- Emerson AMS

## API Keys:
Generate API keys in Settings → API Access

## Webhooks:
Configure webhooks to receive real-time updates`
  }
];

export function HelpCenterWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);

  const filteredArticles = helpArticles.filter(article =>
    article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    article.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
    article.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const categories = Array.from(new Set(helpArticles.map(a => a.category)));

  return (
    <>
      {/* Floating Help Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-teal-600 to-blue-600 text-white rounded-full shadow-2xl hover:scale-110 transition-transform duration-200 flex items-center justify-center z-40 group"
      >
        <HelpCircle className="w-6 h-6" />
        <span className="absolute right-full mr-3 bg-gray-900 text-white px-3 py-2 rounded-lg text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          Need Help?
        </span>
      </button>

      {/* Help Center Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
            {/* Header */}
            <div className="bg-gradient-to-r from-teal-600 to-blue-600 p-6 text-white">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold">Help Center</h2>
                    <p className="text-teal-100">Find answers and learn how to use SyncAI</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIsOpen(false);
                    setSelectedArticle(null);
                    setSearchQuery('');
                  }}
                  className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 transition-colors flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-teal-200" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search help articles..."
                  className="w-full pl-11 pr-4 py-3 rounded-lg bg-white/20 backdrop-blur-sm border border-white/30 text-white placeholder-teal-200 focus:outline-none focus:ring-2 focus:ring-white/50"
                />
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex">
              {selectedArticle ? (
                /* Article View */
                <div className="flex-1 overflow-y-auto p-8">
                  <button
                    onClick={() => setSelectedArticle(null)}
                    className="text-teal-600 hover:text-teal-700 mb-6 flex items-center space-x-2 text-sm font-medium"
                  >
                    <ChevronRight className="w-4 h-4 rotate-180" />
                    <span>Back to articles</span>
                  </button>

                  <span className="inline-block px-3 py-1 bg-teal-100 text-teal-800 rounded-full text-sm font-medium mb-4">
                    {selectedArticle.category}
                  </span>
                  <h2 className="text-3xl font-bold text-gray-900 mb-4">
                    {selectedArticle.title}
                  </h2>
                  <div className="prose prose-teal max-w-none">
                    <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                      {selectedArticle.content}
                    </div>
                  </div>

                  <div className="mt-8 pt-8 border-t border-gray-200">
                    <p className="text-sm text-gray-600 mb-4">Was this article helpful?</p>
                    <div className="flex space-x-3">
                      <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium">
                        👍 Yes
                      </button>
                      <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium">
                        👎 No
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Article List */
                <div className="flex-1 overflow-y-auto p-8">
                  {searchQuery && (
                    <p className="text-sm text-gray-600 mb-6">
                      Found {filteredArticles.length} article{filteredArticles.length !== 1 ? 's' : ''}
                    </p>
                  )}

                  {categories.map(category => {
                    const categoryArticles = filteredArticles.filter(a => a.category === category);
                    if (categoryArticles.length === 0) return null;

                    return (
                      <div key={category} className="mb-8">
                        <h3 className="text-lg font-bold text-gray-900 mb-4">{category}</h3>
                        <div className="space-y-3">
                          {categoryArticles.map(article => (
                            <button
                              key={article.id}
                              onClick={() => setSelectedArticle(article)}
                              className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-teal-300 hover:bg-teal-50 transition-all group"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <h4 className="font-semibold text-gray-900 mb-1 group-hover:text-teal-600 transition-colors">
                                    {article.title}
                                  </h4>
                                  <p className="text-sm text-gray-600">{article.summary}</p>
                                </div>
                                <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-teal-600 transition-colors flex-shrink-0 ml-4" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {filteredArticles.length === 0 && (
                    <div className="text-center py-12">
                      <p className="text-gray-600 mb-4">No articles found matching "{searchQuery}"</p>
                      <button
                        onClick={() => setSearchQuery('')}
                        className="text-teal-600 hover:text-teal-700 font-medium"
                      >
                        Clear search
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-8 py-4 border-t bg-gray-50">
              <div className="flex items-center justify-between text-sm">
                <div className="text-gray-600">
                  Can't find what you're looking for?
                </div>
                <div className="flex space-x-4">
                  <a
                    href="mailto:support@syncai.ca"
                    className="text-teal-600 hover:text-teal-700 font-medium flex items-center space-x-1"
                  >
                    <span>Contact Support</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  <span className="text-gray-300">•</span>
                  <a
                    href="#"
                    className="text-teal-600 hover:text-teal-700 font-medium flex items-center space-x-1"
                  >
                    <span>Schedule Demo</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
