# StiggSync AI - AI-Powered Maintenance & Reliability System

[![Production Ready](https://img.shields.io/badge/Status-Production%20Ready-green.svg)](https://github.com/Stiggtechnologies/ai-maintenance-system)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-18.2-blue.svg)](https://reactjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Ready-green.svg)](https://supabase.com)

## 🎯 Overview

StiggSync AI is a comprehensive, production-ready AI-powered maintenance and reliability system featuring **15 specialized AI agents** designed to optimize industrial maintenance operations. Built with modern cloud-native architecture using React, TypeScript, and Supabase, it provides enterprise-grade functionality with simplified deployment.

## 🤖 AI Agents Architecture

The system implements **15 specialized M&R (Maintenance & Reliability) AI agents**:

### Strategic Planning Agents
1. **Maintenance Strategy Development** - Develops comprehensive maintenance strategies and policies
2. **Asset Management** - Manages asset lifecycle, criticality analysis, and optimization
3. **Reliability Engineering** - Predicts failures and optimizes system reliability

### Operational Agents
4. **Planning & Scheduling** - Optimizes maintenance schedules and resource allocation
5. **Work Order Management** - Automates work order creation, tracking, and completion
6. **Condition Monitoring** - Analyzes real-time sensor data for anomaly detection
7. **Inventory Management** - Optimizes spare parts inventory and procurement
8. **Maintenance Operations** - Oversees day-to-day maintenance execution

### Quality & Compliance Agents
9. **Quality Assurance** - Validates maintenance outcomes and quality standards
10. **Compliance & Auditing** - Ensures regulatory compliance with audit trails

### Strategic Intelligence Agents
11. **Sustainability & ESG** - Tracks environmental, social, and governance metrics
12. **Data Analytics** - Generates insights and comprehensive reports
13. **Continuous Improvement** - Identifies process improvement opportunities
14. **Training & Workforce** - Manages training programs and workforce development
15. **Financial & Contract** - Optimizes budgets, costs, and contract management

## 🏗️ Architecture

### Technology Stack
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Backend**: Supabase Edge Functions (Deno runtime)
- **Database**: Supabase PostgreSQL with Row Level Security
- **Real-time**: Supabase Realtime subscriptions
- **AI Processing**: Supabase Edge Functions for agent orchestration
- **Authentication**: Supabase Auth (ready for implementation)
- **Hosting**: Static hosting with Supabase backend
- **Icons**: Lucide React

### Production-Ready Features
- ✅ **15 Specialized AI Agents** with real-time processing
- ✅ **Asset Management** - Full CRUD operations with real-time updates
- ✅ **Work Order System** - Complete lifecycle management with status tracking
- ✅ **AI Analytics Dashboard** - Real-time agent performance monitoring
- ✅ **Live Data Subscriptions** - Instant updates across all components
- ✅ **ESG Tracking & Reporting** - Comprehensive sustainability metrics
- ✅ **Mobile-Responsive Design** - Works on all devices
- ✅ **Row Level Security** - Production-grade data protection
- ✅ **Real-time Analytics** - Live dashboards and reporting
- ✅ **Multi-Industry Support** - Oil & Gas, Mining, Power, Manufacturing, Aerospace

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Supabase account (database already configured)

### Local Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Stiggtechnologies/ai-maintenance-system.git
   cd ai-maintenance-system
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   The `.env` file is already configured with Supabase credentials:
   ```bash
   VITE_SUPABASE_URL=your-supabase-url
   VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Build for production**
   ```bash
   npm run build
   ```

### Deployment Options

#### Option 1: Vercel (Recommended)
```bash
npm install -g vercel
vercel
```

#### Option 2: Netlify
```bash
npm install -g netlify-cli
netlify deploy --prod
```

#### Option 3: Supabase Static Hosting
```bash
# Deploy directly to Supabase
npm run build
# Upload dist/ folder to Supabase Storage
```

## 📊 System Capabilities

### Asset Management
- **Create, Read, Update, Delete** - Full CRUD operations for industrial assets
- **Asset Tracking** - Monitor asset status, location, and criticality
- **Real-time Updates** - Live synchronization across all users
- **Categorization** - Organize by type, status, criticality, and location
- **Search & Filter** - Quick asset lookup and filtering

### Work Order Management
- **Lifecycle Tracking** - From creation to completion
- **Priority Management** - Critical, high, medium, low prioritization
- **Status Tracking** - Pending, in-progress, completed, blocked
- **Asset Linking** - Connect work orders to specific assets
- **Assignment Management** - Assign to technicians and teams
- **Time Tracking** - Creation, update, and completion timestamps

### AI Agent Processing
- **Real-time Execution** - Instant agent processing via Edge Functions
- **Multi-Industry Support** - Specialized responses for different industries
- **Performance Tracking** - Monitor processing times and success rates
- **Usage Analytics** - Track which agents are most utilized
- **Response Logging** - Complete audit trail of all AI interactions

### AI Analytics Dashboard
- **Live Metrics** - Real-time request counts and response times
- **Agent Performance** - Track individual agent usage and efficiency
- **Activity Feed** - Recent agent executions and results
- **Processing Insights** - Average response times and trends
- **Real-time Subscriptions** - Auto-updating dashboard

### Data & Analytics
- **Maintenance Metrics** - Total assets, work orders, efficiency scores
- **ESG Reporting** - Environmental, social, and governance tracking
- **Cost Analytics** - Maintenance cost tracking and savings
- **Uptime Monitoring** - System and asset uptime percentages
- **Performance KPIs** - Industry-standard maintenance metrics

## 🔧 Configuration

### Environment Variables
```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Database Schema
The system includes the following tables:
- `assets` - Industrial asset records
- `work_orders` - Maintenance work orders
- `ai_agent_logs` - AI agent execution history
- `maintenance_metrics` - System-wide metrics

### Edge Functions
- `ai-agent-processor` - Processes all 15 AI agent requests

## 📱 API Reference

### AI Agent Processing
```typescript
// Execute an AI agent
const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-agent-processor`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    agentType: 'ReliabilityEngineeringAgent',
    industry: 'Oil & Gas'
  })
});
```

### Asset Management
```typescript
// Get all assets
const { data, error } = await supabase
  .from('assets')
  .select('*');

// Create new asset
const { data, error } = await supabase
  .from('assets')
  .insert([{
    name: 'Pump Unit A1',
    type: 'Centrifugal Pump',
    status: 'operational',
    location: 'Sector 1',
    criticality: 'high'
  }]);
```

### Work Order Management
```typescript
// Get active work orders
const { data, error } = await supabase
  .from('work_orders')
  .select('*')
  .eq('status', 'in-progress');

// Update work order status
const { data, error } = await supabase
  .from('work_orders')
  .update({ status: 'completed', completed_at: new Date() })
  .eq('id', workOrderId);
```

## 🔒 Security

### Data Protection
- **Row Level Security (RLS)** - Enabled on all tables
- **Secure Policies** - Granular access control per table
- **API Key Protection** - Environment variables for credentials
- **HTTPS Only** - All communications encrypted
- **Audit Trail** - Complete logging of all AI agent executions

### Authentication (Ready to Enable)
The system is prepared for Supabase Auth integration:
- Email/Password authentication
- OAuth providers (Google, GitHub, etc.)
- JWT token management
- Session handling
- User roles and permissions

## 📈 Monitoring & Observability

### Real-time Monitoring
- **AI Agent Analytics** - Live dashboard tracking all agent activity
- **Performance Metrics** - Response times, success rates, error counts
- **Usage Patterns** - Most used agents and industries
- **System Health** - Database connections, API response times

### Business Metrics
- **Assets Monitored** - Total asset count and health
- **Work Orders** - Active, completed, and pending counts
- **Cost Savings** - Tracked maintenance cost reductions
- **System Uptime** - Overall system availability
- **Efficiency Scores** - Maintenance efficiency percentages

## 🧪 Testing

### Build & Test
```bash
# Install dependencies
npm install

# Run TypeScript checks
npm run build

# Check for errors
npm run lint
```

### Production Build
```bash
# Create optimized production build
npm run build

# Preview production build
npm run preview
```

## 📦 Production Deployment

### Pre-Deployment Checklist
- ✅ Database schema deployed
- ✅ Edge functions deployed
- ✅ Environment variables configured
- ✅ Production build tested
- ✅ Row Level Security enabled
- ✅ API endpoints verified

### Build Output
```bash
dist/
├── index.html
├── assets/
│   ├── index-[hash].css
│   └── index-[hash].js
└── _redirects
```

### Performance Optimization
- Code splitting for faster loads
- Lazy loading for components
- Optimized bundle size (< 100KB gzipped)
- CDN-ready static assets
- Tree-shaking for unused code

## 🎯 Industry Applications

### Oil & Gas
- SAP PM, OSIsoft PI, Emerson AMS integration ready
- Predictive maintenance for critical equipment
- Compliance tracking for safety regulations

### Mining
- Maximo, UpKeep integration support
- Asset criticality management
- Environmental impact tracking

### Power & Utilities
- GE Predix, Schneider EcoStruxure compatibility
- Grid reliability optimization
- Energy efficiency monitoring

### Chemical/Manufacturing
- Process equipment monitoring
- Quality assurance automation
- Inventory optimization

### Aerospace & Transportation
- Aircraft maintenance scheduling
- Safety compliance tracking
- Performance analytics

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙋‍♂️ Support

### Getting Help
- **GitHub Issues**: For bugs and feature requests
- **Email Support**: support@stiggtechnologies.com
- **Documentation**: Comprehensive inline documentation

### Enterprise Support
For enterprise customers, we offer:
- Custom AI agent development
- Industry-specific integrations
- Dedicated support and training
- White-label solutions
- On-premise deployment options

## 🎖️ Acknowledgments

- **Supabase**: Modern backend infrastructure
- **React Community**: Frontend framework and ecosystem
- **Open Source**: Various libraries and tools
- **Industrial Partners**: Domain expertise and validation

---

**Built with ❤️ by [Stigg Technologies](https://stiggtechnologies.com)**

For more information, visit our [website](https://stiggtechnologies.com) or contact us at [info@stiggtechnologies.com](mailto:info@stiggtechnologies.com).
