# 🎙️ J.A.V.I.S Quick Reference Card

## **30-Second Overview**

J.A.V.I.S is your conversational AI assistant for maintenance & reliability. Talk to it naturally, ask it to do things, and it'll confirm before executing. Available 24/7 via the floating dock (bottom-right).

---

## 🚀 **Quick Start (Users)**

### **Open J.A.V.I.S:**
1. Click floating teal button (bottom-right corner)
2. Green dot = connected, red dot = reconnecting

### **Chat:**
- Type or speak your question
- Hit Enter or click Send
- Get natural-language responses

### **Execute Actions:**
- J.A.V.I.S suggests actions
- Review details in confirmation UI
- Click ✓ Confirm or ✗ Cancel
- See result immediately

### **Voice:**
- Click mic button to speak
- Click again to stop
- Toggle speaker icon for voice responses

---

## 💬 **Example Commands**

### **Information Queries:**
```
"What's the status of Site A?"
"Show me active critical alerts"
"Why did MTBF drop last week?"
"Which assets need attention?"
"What's my schedule today?"
```

### **Action Commands:**
```
"Create a work order for pump P-204 tomorrow at 9 AM"
"Schedule an inspection for conveyor C-14"
"Order 5 bearing kits for next week"
"Update asset P-204 status to maintenance"
"Notify the operations manager about this"
```

### **Follow-ups:**
```
"Tell me more"
"Why did that happen?"
"What should I do?"
"Show me the trend"
"Compare to last month"
```

---

## 🎯 **Available Tools (By Role)**

| Tool | EXEC | OPS_MGR | REL_ENG | PLANNER | TECH | HSE | PROC |
|------|:----:|:-------:|:-------:|:-------:|:----:|:---:|:----:|
| Create Work Order | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Schedule Inspection | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Order Parts | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |
| Update Asset Status | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Notify User | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approve Action | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Defer Action | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |

---

## 🎨 **UI Elements**

### **Floating Dock:**
- **Teal button** - Open/close
- **Red badge** - Pending actions count
- **Green/red dot** - Connection status
- **Speaker icon** - Toggle voice
- **Minimize icon** - Collapse
- **X icon** - Close

### **Message Types:**
- **User messages** - Teal, right-aligned
- **J.A.V.I.S messages** - Gray, left-aligned
- **System messages** - Yellow, centered

### **Confirmation UI:**
```
┌──────────────────────────────┐
│ ACTION_NAME                  │
│ { parameters }               │
│ [✓ Confirm] [✗ Cancel]      │
│ ⏱ Expires in X minutes       │
└──────────────────────────────┘
```

---

## ⚙️ **Preferences**

### **Access:** Menu → J.A.V.I.S → Preferences

### **Settings:**
- **Display Name** - How J.A.V.I.S addresses you
- **Voice Responses** - On/off toggle
- **Voice Locale** - EN-CA, EN-US, EN-GB, FR-CA
- **Voice Speed** - 0.5x to 2.0x
- **Morning Brief Time** - Daily briefing schedule
- **Timezone** - Your local timezone
- **Notifications** - In-app, push, email, SMS

### **Test Voice:**
Click "Test Voice" to hear sample

---

## 📅 **Morning Briefing**

### **Access:** Menu → J.A.V.I.S → Briefing

### **Content (Role-Aware):**

**Executive:**
- Strategic KPIs
- Decisions needed
- High-severity alerts
- Financial impact

**Operations Manager:**
- Site status
- Resource conflicts
- Backlog trends
- Vendor issues

**Reliability Engineer:**
- Bad actors
- MTBF/MTTR deltas
- PdM alerts
- Root causes

**Planner:**
- Schedule risks
- Material gates
- Critical path
- Constraints

**Technician:**
- Assigned work orders
- Safety notes
- Tools/parts ready
- Procedures

---

## 🔔 **Proactive Alerts**

J.A.V.I.S monitors systems 24/7 and alerts you when:
- Asset status changes (operational → alarm)
- KPIs breach thresholds
- Reports are updated
- Work orders get blocked
- Inventory runs low
- Safety incidents occur
- Approvals are needed

### **Alert Actions:**
- **Acknowledge** - Mark as seen
- **Approve** - Execute suggested action
- **Cancel** - Dismiss alert
- **Snooze** - Remind later
- **Show Details** - See full context
- **Why?** - Ask for explanation

---

## 🐛 **Troubleshooting**

### **Can't Connect (Red Dot):**
1. Check internet connection
2. Refresh page
3. Wait 30 seconds (auto-reconnect)
4. Contact support if persists

### **Voice Not Working:**
1. Check mic permissions (browser settings)
2. Try different browser (Chrome/Edge recommended)
3. Fall back to typing

### **Tool Not Available:**
- Check your role (Menu → Profile)
- You may not have permission for that action
- Ask your admin to adjust permissions

### **Action Expired:**
- Actions expire after 5 minutes
- Ask J.A.V.I.S to recreate it
- Or create manually via normal UI

---

## 📊 **Tips & Best Practices**

### **Be Conversational:**
✅ "Create a work order for pump maintenance tomorrow"
❌ "CREATE_WO P204 MAINT 2025-10-26"

### **Provide Context:**
✅ "The conveyor at Site A is making noise"
❌ "Fix it"

### **Ask Follow-ups:**
✅ "Why did that happen?"
✅ "Show me the trend"
✅ "Compare to last month"

### **Confirm Actions:**
✅ Always review action details before confirming
✅ Check dates, times, and assignees
✅ Cancel if something looks wrong

### **Use Voice When Hands-Free:**
✅ On the plant floor
✅ Reviewing reports
✅ Walking between sites

---

## 🔐 **Privacy & Security**

- **Your data is private** - Only you see your conversations
- **Role-based access** - You only see what you're allowed to
- **Audit trail** - All actions logged for compliance
- **Encrypted** - All communication secured (HTTPS/WSS)
- **Tenant isolated** - You can't see other companies' data

---

## 📞 **Get Help**

### **Within J.A.V.I.S:**
```
"Help"
"What can you do?"
"Show me examples"
"How do I create a work order?"
```

### **Documentation:**
- `JAVIS-INTERACTIVE-GUIDE.md` - Full technical guide
- `JAVIS-DEPLOYMENT-CHECKLIST.md` - Admin guide
- `AI-AGENT-TRAINING-GUIDE.md` - Training guide

### **Support:**
- Contact your system administrator
- Check company wiki/docs
- Email: support@yourcompany.com

---

## 🎯 **Common Use Cases**

### **1. Morning Routine:**
```
1. Login
2. Check morning briefing (Menu → J.A.V.I.S → Briefing)
3. Review alerts in J.A.V.I.S dock
4. Approve/defer actions as needed
```

### **2. Plant Floor:**
```
1. Spot an issue
2. Open J.A.V.I.S (voice mode)
3. Describe problem verbally
4. J.A.V.I.S suggests action
5. Confirm via voice or button
```

### **3. Investigation:**
```
1. Notice unusual metric
2. Ask J.A.V.I.S "Why did X change?"
3. Follow up with deeper questions
4. Get root cause analysis
5. Ask for suggested fix
6. Approve recommended action
```

### **4. Planning:**
```
1. Ask "What needs attention this week?"
2. Review list
3. Prioritize with J.A.V.I.S
4. Schedule inspections
5. Order parts proactively
```

---

## ⚡ **Keyboard Shortcuts**

- **Enter** - Send message
- **Esc** - Close dock
- **Ctrl+/** - Open dock (if closed)

---

## 🎉 **You're Ready!**

**Try it now:** Click the teal button and say "Hello J.A.V.I.S"

**Pro tip:** The more you use it, the better it gets at understanding your needs!

---

**Version:** 1.0
**Last Updated:** October 25, 2025
**Print this page for quick reference!**
