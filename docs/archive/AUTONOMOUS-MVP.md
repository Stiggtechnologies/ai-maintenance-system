# SyncAI Pro - Autonomous Asset Management MVP

## Overview

SyncAI Pro is a fully autonomous AI-powered asset performance management system with human-in-the-loop capabilities. The system continuously monitors assets, makes intelligent decisions, and can either execute actions automatically or request human approval based on confidence levels and criticality.

## Key Features

### 1. Autonomous Monitoring System
- **Real-time Asset Health Monitoring**: Continuously monitors all assets for anomalies
- **Predictive Analysis**: Calculates health scores and predicts potential failures
- **Automatic Data Collection**: Simulates IoT sensor data (temperature, vibration, pressure)
- **Runs every 5 minutes**: Background monitoring starts automatically when user logs in

### 2. Intelligent Decision Making
- **Confidence-Based Automation**: High-confidence decisions (>90%) are auto-executed
- **Risk Assessment**: Critical assets always require human approval
- **Decision Types**:
  - Work order creation
  - Asset shutdown recommendations
  - Maintenance scheduling
  - Resource allocation

### 3. Human-in-the-Loop Workflow
- **Approval System**: Managers and admins can approve/reject decisions
- **Deadline Management**: Decisions have 2-hour approval deadlines
- **Role-Based Access**: 4 user roles (admin, manager, operator, viewer)
- **Real-time Notifications**: Alerts sent to appropriate personnel

### 4. Autonomous Work Order Generation
- **Automatic Creation**: System creates work orders when health scores drop below 50%
- **Priority Assignment**: Based on health score severity (critical < 30%, high < 50%)
- **Auto-Assignment**: Work orders automatically assigned to maintenance teams
- **Audit Trail**: All autonomous actions are logged

### 5. Alerting & Escalation
- **Severity Levels**: Critical, High, Medium, Low
- **Targeted Notifications**: Alerts sent to specific user roles
- **Acknowledgment System**: Users can acknowledge and resolve alerts
- **Dashboard Integration**: Live alert feed in autonomous dashboard

## System Architecture

### Database Tables

1. **user_profiles**: User authentication and roles
2. **autonomous_decisions**: AI decisions requiring approval/execution
3. **asset_health_monitoring**: Real-time health data and predictions
4. **autonomous_actions**: Audit log of all automated actions
5. **approval_workflows**: Human approval tracking
6. **system_alerts**: Critical notifications
7. **assets**: Equipment and infrastructure data
8. **work_orders**: Maintenance tasks and assignments

### Edge Functions

**autonomous-orchestrator**: Main autonomous system controller
- `monitor_assets`: Scans all assets and creates health records
- `process_decision`: Handles human approvals
- `execute_autonomous_action`: Executes approved actions
- `generate_health_report`: Creates system-wide health reports

### Frontend Components

1. **AuthProvider**: User authentication and session management
2. **AuthForm**: Login/signup interface
3. **AutonomousDashboard**: Central command center showing:
   - Pending decisions
   - Auto-executed actions
   - Critical alerts
   - System metrics
4. **AssetManagement**: Asset inventory and health
5. **WorkOrderManagement**: Maintenance task tracking
6. **AIAnalyticsDashboard**: Performance analytics

## User Roles & Permissions

### Admin
- Full system access
- Can approve all decisions
- View all data across organization
- Manage users and settings

### Manager
- Approve autonomous decisions
- View team performance
- Access analytics and reports
- Manage work orders

### Operator
- View assigned work orders
- Update task status
- Access asset information
- View relevant alerts

### Viewer
- Read-only access
- View dashboards and reports
- Monitor system status
- No approval or edit rights

## Autonomous Decision Flow

1. **Monitoring Phase**
   - System runs health checks every 5 minutes
   - Calculates health scores (0-100)
   - Detects anomalies (health < 60%)

2. **Decision Phase**
   - Health < 50% triggers decision creation
   - System calculates confidence score
   - Determines if approval required:
     - Auto-execute: Confidence ≥90% AND not critical asset
     - Require approval: Confidence <80% OR critical asset

3. **Execution Phase**
   - Auto-executed decisions: Immediate work order creation
   - Pending decisions: Sent to approval workflow
   - Managers receive alerts for pending approvals
   - 2-hour deadline for approval

4. **Audit Phase**
   - All actions logged in autonomous_actions table
   - Timestamps and success/failure recorded
   - Full traceability for compliance

## Getting Started

### Prerequisites
- Node.js 18+ installed
- Supabase account with project created
- OpenAI API key (for AI agents)

### Environment Setup

Create `.env` file:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_OPENAI_API_KEY=your_openai_key
```

### Installation

```bash
npm install
npm run build
npm run dev
```

### First User Setup

1. Open the application
2. Click "Sign up"
3. Create account (first user gets operator role)
4. System starts autonomous monitoring automatically

### Database Migrations

Migrations are automatically applied via Supabase. The system creates:
- All required tables
- Row Level Security (RLS) policies
- Indexes for performance
- Triggers for auto-approval
- Sample data for demo

## Key Workflows

### 1. Automatic Work Order Creation

```
Asset Health Drops → AI Detects Anomaly → Creates Decision →
High Confidence? → Yes → Auto-Create Work Order → Log Action
                 → No → Request Approval → Manager Approves → Create Work Order
```

### 2. Human Approval Process

```
Decision Created → Approval Workflow Created → Manager Notified →
Manager Reviews → Approves/Rejects → System Executes/Cancels →
Action Logged → Dashboard Updated
```

### 3. Alert Escalation

```
Critical Condition → Alert Created → Targeted Users Notified →
User Acknowledges → Takes Action → Resolves Alert → System Updated
```

## Monitoring & Observability

### Dashboard Metrics
- **Pending Decisions**: Awaiting human approval
- **Auto-Executed**: Autonomous actions taken
- **Critical Alerts**: High-priority notifications
- **Assets Monitored**: Total assets under management

### Real-time Updates
- Dashboard refreshes every 30 seconds
- Background monitoring runs every 5 minutes
- Alerts appear immediately in UI
- Decision status updates in real-time

### Audit Trail
- Complete log of all autonomous actions
- Timestamps for every decision
- Success/failure tracking
- User approval history

## Security

### Authentication
- Supabase Auth with email/password
- Secure session management
- JWT token verification
- Automatic session refresh

### Authorization
- Row Level Security (RLS) on all tables
- Role-based access control
- Users can only access authorized data
- Autonomous system has elevated privileges

### Data Protection
- All sensitive data encrypted at rest
- HTTPS for all communications
- API keys never exposed to client
- Audit logs for compliance

## Production Considerations

### Scaling
- Autonomous orchestrator runs on Supabase Edge Functions (Deno)
- Automatically scales with load
- Database indexes optimized for queries
- Real-time subscriptions for live updates

### Reliability
- Error handling in all autonomous functions
- Failed actions logged with error messages
- Retry logic for transient failures
- Graceful degradation if AI services unavailable

### Monitoring
- Check autonomous_actions table for system health
- Monitor decision approval rates
- Track auto-execution success rates
- Alert on unusual patterns

## Future Enhancements

1. **IoT Integration**: Connect real sensor data instead of simulation
2. **ML Models**: Train custom models on historical data
3. **Mobile App**: Native iOS/Android with push notifications
4. **Advanced Analytics**: Predictive maintenance analytics
5. **Multi-tenancy**: Support for multiple organizations
6. **API Gateway**: External system integrations
7. **Reporting Engine**: Automated compliance reports

## Support & Documentation

- **Technical Docs**: See README.md for technical setup
- **User Guide**: See README-STAKEHOLDER.md for business overview
- **API Reference**: Edge function documentation in `/supabase/functions/`
- **Database Schema**: See migration files in `/supabase/migrations/`

## License

Proprietary - SyncAI Pro

---

**Version**: 1.0.0 (MVP)
**Last Updated**: October 2025
**Status**: Production Ready
