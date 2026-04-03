# SyncAI Platform - Quick Start Guide

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Create `.env` file with your Supabase credentials:
```bash
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Run Development Server
```bash
npm run dev
```
Visit: http://localhost:5173

### 4. Build for Production
```bash
npm run build
```
Output: `dist/` folder ready to deploy

---

## 📁 Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── AppShell.tsx    # Main app layout with navigation
│   ├── CommandCenter.tsx
│   └── ...
├── pages/              # Route-level pages
│   ├── OverviewDashboard.tsx      # Executive overview
│   ├── PerformanceDashboard.tsx   # OEE & KPIs
│   ├── WorkDashboard.tsx          # Work management
│   ├── GovernanceDashboard.tsx    # Approvals & audit
│   └── ...
├── services/           # Business logic & API calls
│   ├── platform.ts     # User context, auth
│   ├── performance.ts  # OEE, KPIs
│   ├── work.ts         # Work orders, notifications
│   └── governance.ts   # Approvals, audit
├── lib/
│   └── supabase.ts     # Supabase client config
└── App.tsx             # Main app component
```

---

## 🎯 Key Features

### Overview Dashboard (`/overview`)
- Enterprise Risk Index
- Downtime Cost Exposure
- AI Confidence Score
- Governance Compliance
- Work Backlog Summary
- OEE Summary
- Recent AI Actions

### Performance Dashboard (`/performance`)
- OEE calculation (Availability × Performance × Quality)
- Operational KPIs
- Reliability Metrics (MTBF, MTTR)
- Trend visualization

### Work Dashboard (`/work`)
- Notifications feed
- Work orders list
- Priority tracking
- Status management

### Governance Dashboard (`/governance`)
- Pending approvals queue
- Approve/Reject actions
- Audit trail timeline
- Event logging

---

## 🔧 Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |

---

## 🗄️ Database Functions (RPCs)

The app uses Postgres RPCs for business logic:

```typescript
// Get user context
const context = await platformService.getCurrentUserContext();

// Calculate OEE
const oee = await performanceService.calculateSiteOEE(siteId, startTime, endTime);

// Get KPIs
const kpis = await performanceService.getLatestKPIValues(orgId, siteId);

// Get work backlog
const backlog = await workService.getBacklogSummary(orgId, siteId);

// Approve recommendation
const result = await governanceService.approveRecommendation(recId, comments);
```

---

## 🎨 UI Components

### AppShell
- Collapsible sidebar
- System status indicators
- User profile menu
- Role-based navigation

### Dashboards
- Responsive grid layouts
- Real-time data loading
- Loading states
- Error boundaries
- Stat cards with trends

---

## 🔐 Authentication Flow

1. User visits app → redirected to `/signin`
2. User logs in → Supabase Auth validates
3. Session created → app loads user context
4. Protected routes accessible → AppShell renders
5. User signs out → session cleared → back to `/signin`

---

## 📊 Data Flow

```
User Action
    ↓
React Component
    ↓
Service Layer (src/services/)
    ↓
Supabase Client (RPC call)
    ↓
Postgres Function (server-side)
    ↓
Database Query (with RLS)
    ↓
Data returned
    ↓
Component updates
    ↓
UI renders
```

---

## 🚢 Deployment

### Vercel (Recommended)
```bash
npm run build
vercel --prod
```

### Netlify
```bash
npm run build
netlify deploy --prod --dir=dist
```

### Manual
```bash
npm run build
# Upload dist/ folder to any static hosting
```

---

## 📝 Environment Variables

Required for production:
```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

---

## 🐛 Troubleshooting

### Build Fails
```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Types Error
```bash
# Regenerate Supabase types
npx supabase gen types typescript --project-id your-project-id > src/lib/database.types.ts
```

### Auth Not Working
- Check `.env` has correct Supabase URL and anon key
- Verify Supabase project is active
- Check browser console for errors

---

## 📚 Learn More

- [React Documentation](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Vite Guide](https://vitejs.dev/guide/)

---

## ✅ Checklist for First Deploy

- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] RLS policies active
- [ ] Edge Functions deployed
- [ ] Production build successful
- [ ] Static files deployed
- [ ] DNS configured (if custom domain)
- [ ] SSL certificate active
- [ ] First user can sign up
- [ ] Dashboards load data

---

**Ready to deploy!** 🚀
