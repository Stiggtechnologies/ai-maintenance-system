# 🚀 How to Access Everything - Quick Guide

## ✅ Your System is Ready!

**Status**:
- ✅ Database configured and populated with sample data
- ✅ All components built and tested
- ✅ Production bundle ready (369KB)
- ✅ Environment variables configured
- ✅ 29 ISO 55000 KPIs ready to view

---

## 🌐 Option 1: Run Locally (Recommended for Development)

### **Start the Development Server**:
```bash
cd /tmp/cc-agent/53222566/project
npm run dev
```

**Then open**: http://localhost:5173

**What you'll see**:
- Login/signup screen
- Once logged in: Full application with all dashboards

---

## 🚀 Option 2: Deploy to Production (Recommended for Sharing)

### **Deploy to Vercel** (Easiest - 2 minutes):
```bash
# Install Vercel CLI (if not installed)
npm install -g vercel

# Deploy
cd /tmp/cc-agent/53222566/project
vercel deploy --prod
```

**Vercel will**:
1. Detect it's a Vite project
2. Build automatically
3. Give you a live URL like: `https://your-project.vercel.app`

**Set environment variables in Vercel**:
```
VITE_SUPABASE_URL=https://dguwgnxjdivsrekjarlp.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
VITE_OPENAI_API_KEY=sk-proj-7nvW...
```

### **Deploy to Netlify** (Alternative):
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
cd /tmp/cc-agent/53222566/project
netlify deploy --prod
```

---

## 🔐 How to Log In

### **Option A: Create New Account**
```
1. Open the app (local or deployed URL)
2. Click "Sign Up"
3. Enter email and password
4. Click "Create Account"
5. You're in!
```

### **Option B: Use Test Account** (if you've already created one)
```
Email: Your email
Password: Your password
```

---

## 📊 Once Logged In - Where to Go

### **Navigation Bar (Left Sidebar)**:

```
🏠 Home
   - AI-powered query interface
   - Upload documents
   - Ask questions

💬 AI Assistant
   - Role-specific conversational AI
   - Quick actions
   - Voice input support

🤖 Autonomous
   - View autonomous decisions
   - See system actions
   - Monitor health checks

📊 Dashboards ⭐ START HERE!
   ├─ Executive       - For C-Suite (strategic KOIs)
   ├─ Strategic       - For Directors/VPs (all KPIs)
   ├─ Tactical        - For Managers (work orders)
   └─ Operational     - For Technicians (field tasks)

🏢 Spaces
   ├─ Oil & Gas
   ├─ Mining
   ├─ Power & Utilities
   ├─ Manufacturing
   └─ Aerospace

💬 Conversations
   - View chat history
   - Resume conversations

📁 Data
   ├─ Assets          - View all assets
   ├─ Work Orders     - Manage work orders
   └─ Analytics       - Advanced analytics
```

---

## 🎯 Quick Access to Key Features

### **See the ISO 55000 KPIs** ⭐ RECOMMENDED FIRST STEP:

**Path 1: Executive View**
```
1. Click "Dashboards" in sidebar
2. Select "Executive"
3. See 10 category cards with status indicators
4. Click any category to drill down
```

**Path 2: Strategic View** (Most Detailed)
```
1. Click "Dashboards" in sidebar
2. Select "Strategic"
3. See all 29 KPIs in detailed cards
4. Filter by category or status
5. View actual vs target values
```

**Path 3: Tactical View** (For Managers)
```
1. Click "Dashboards" in sidebar
2. Select "Tactical"
3. Three tabs:
   - Overview (summary + approvals)
   - Work Orders (task management)
   - Performance KPIs (key metrics)
```

**Path 4: Operational View** (For Technicians)
```
1. Click "Dashboards" in sidebar
2. Select "Operational"
3. See:
   - My work orders
   - Active alerts
   - Quick stats
   - Task execution interface
```

---

## 🤖 Try the AI Chat

```
1. Click "AI Assistant" in sidebar
2. Try these queries:

   "Show my KPIs"
   "What needs attention?"
   "Show me asset availability"
   "What is our MTBF?"
   "Show pending work orders"
   "What alerts are active?"
   "Recommend priority actions"
```

---

## 📊 Sample Data Available

Your system already has **30 days of sample data** including:

✅ **Assets**: Multiple operational assets
✅ **Work Orders**: Mix of preventive and corrective
✅ **KPI Measurements**: 30 days of historical data for all 29 KPIs
✅ **Organizational Units**: 5 business units (HQ, plants, refinery, mine)
✅ **Alerts**: Active and resolved system alerts
✅ **Decisions**: Autonomous decisions (some pending approval)

**All dashboards will show real data immediately!**

---

## 🔧 Assign Your Organizational Level

By default, new users get the "Field Operations" level. To access higher-level dashboards, update your profile:

### **Option 1: Use Supabase Dashboard**:
```
1. Go to: https://dguwgnxjdivsrekjarlp.supabase.co
2. Log in to Supabase
3. Navigate to: Table Editor → user_profiles
4. Find your user
5. Edit org_level_id:
   - Executive: Select "Executive Leadership"
   - Strategic: Select "Strategic Management"
   - Tactical: Select "Tactical Management"
   - Operational: Select "Operational Execution"
6. Save
7. Refresh your app
```

### **Option 2: Use SQL**:
```sql
-- Find your user ID
SELECT id, email, role FROM user_profiles;

-- Set to Executive level
UPDATE user_profiles
SET org_level_id = (
  SELECT id FROM organizational_levels
  WHERE level_code = 'EXECUTIVE'
)
WHERE email = 'your-email@example.com';
```

---

## 📱 Access on Mobile

The app is **fully responsive**! Just:
1. Open the URL on your phone/tablet
2. Log in with same credentials
3. Navigate using bottom nav or hamburger menu
4. Use voice input in AI chat
5. Upload photos for work orders

---

## 🎛️ Database Access (For Admins)

### **Supabase Dashboard**:
```
URL: https://dguwgnxjdivsrekjarlp.supabase.co
Login: Use your Supabase credentials

You can:
- View all tables
- Run SQL queries
- Check edge functions
- Monitor usage
- View logs
```

### **Key Tables to Explore**:
```
📊 kpis_kois              - Master list of 29 KPIs
📈 kpi_measurements       - Time-series KPI data (30 days)
👥 organizational_levels  - 5 hierarchy levels
🏢 organizational_units   - Business units
👤 user_profiles          - User accounts with org levels
🔧 assets                 - Equipment and assets
📋 work_orders            - Maintenance tasks
🚨 system_alerts          - Active alerts
```

---

## ⚙️ Run KPI Calculator Manually

To generate fresh KPI data:

```bash
curl -X POST \
  https://dguwgnxjdivsrekjarlp.supabase.co/functions/v1/kpi-calculator \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRndXdnbnhqZGl2c3Jla2phcmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA4MjQ3NjQsImV4cCI6MjA3NjQwMDc2NH0.bO4TidmfpHl7Vzus7vooBzmJGvVIUGq_-5_uD3zH7OQ"
```

**What it does**:
- Calculates 7 KPIs from current operational data
- Determines red/yellow/green status
- Stores new measurements in database
- Updates dashboards with fresh data

---

## 🐛 Troubleshooting

### **Issue: Can't see dashboards**
**Solution**: Make sure you're logged in and have `org_level_id` set

### **Issue: No KPI data showing**
**Solution**:
1. Sample data should already be loaded
2. If not, run the KPI calculator (see above)
3. Refresh the page

### **Issue: "Not authenticated" error**
**Solution**:
1. Log out and log back in
2. Check your email is verified in Supabase
3. Clear browser cache

### **Issue: Build errors**
**Solution**:
```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

## 📚 Documentation Files Available

All in `/tmp/cc-agent/53222566/project/`:

```
📖 ACCESS-GUIDE.md                          ⭐ This file
📖 QUICK-START-GUIDE.md                     ⭐ 5-minute walkthrough
📖 ISO-55000-SYSTEM-COMPLETE.md             - Full system overview
📖 ISO-55000-IMPLEMENTATION-SUMMARY.md      - Technical details
📖 PRODUCTION-READY.md                      - Deployment guide
📖 DEPLOYMENT.md                            - Platform specifics
📖 PRODUCTION-CHECKLIST.md                  - Pre-launch checklist
📖 AUTONOMOUS-MVP.md                        - Autonomous architecture
📖 README.md                                - Technical documentation
```

---

## 🎯 Recommended Path to Explore

### **5-Minute Tour**:
```
1. Run app locally (npm run dev)
2. Create account / log in
3. Go to: Dashboards → Strategic
4. View all 29 KPIs with sample data
5. Go to: AI Assistant
6. Ask: "Show my KPIs"
7. Explore other dashboards
```

### **10-Minute Deep Dive**:
```
1. Complete 5-minute tour above
2. Go to: Dashboards → Executive
3. Click different categories
4. Go to: Dashboards → Tactical
5. View work orders tab
6. Go to: Dashboards → Operational
7. Try "Start Task" on a work order
8. Upload a test photo
9. Ask AI: "What needs attention?"
10. Explore autonomous decisions
```

---

## 🚀 You're Ready!

### **Start Now**:
```bash
# Run locally
cd /tmp/cc-agent/53222566/project
npm run dev
```

**Then open**: http://localhost:5173

### **Or Deploy**:
```bash
# Deploy to Vercel
vercel deploy --prod
```

---

## 📞 Quick Reference

**Supabase URL**: https://dguwgnxjdivsrekjarlp.supabase.co
**Local Dev**: http://localhost:5173
**Build Command**: `npm run build`
**Start Command**: `npm run dev`

**Database Tables**: 7 new + 1 updated
**React Components**: 9 (5 new dashboards/chat)
**Edge Functions**: 4 deployed
**KPIs Tracked**: 29 ISO 55000 metrics
**Sample Data**: 30 days loaded

---

## ✅ Everything You Need to Know

1. **Run the app**: `npm run dev` → http://localhost:5173
2. **Log in**: Create account or use existing
3. **See KPIs**: Dashboards → Strategic (best overview)
4. **Try AI**: AI Assistant → "Show my KPIs"
5. **Explore**: All dashboards have sample data ready

**The system is fully operational and ready to use!** 🎉

---

**Questions?** Open `QUICK-START-GUIDE.md` or ask the AI assistant in the app!
