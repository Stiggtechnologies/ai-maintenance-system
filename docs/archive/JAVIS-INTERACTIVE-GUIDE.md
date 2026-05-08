# 🎙️ J.A.V.I.S Interactive Features Guide

## Complete Implementation of Conversational AI Assistant

---

## 📋 **Overview**

J.A.V.I.S now features **full interactive capabilities** including:
- ✅ Real-time WebSocket conversation
- ✅ Tool calling with confirmation/undo
- ✅ Proactive event-driven updates
- ✅ Back-and-forth reasoning with context
- ✅ Role-aware responses (ISO 55000/RACI)
- ✅ Voice input/output (TTS/STT)
- ✅ Action buttons in chat (Approve/Snooze/Why)

---

## 🏗️ **Architecture**

### **System Components:**

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interface                            │
│  JavisDockInteractive (React + WebSocket)                    │
└────────────────┬────────────────────────────────────────────┘
                 │ WebSocket Connection
┌────────────────▼────────────────────────────────────────────┐
│           javis-websocket (Supabase Edge Function)           │
│  • Real-time messaging                                       │
│  • Tool call orchestration                                   │
│  • Context management                                        │
└────────┬────────────────────────┬─────────────────────────┘
         │                        │
         │                        │
┌────────▼────────┐    ┌─────────▼──────────┐
│  OpenAI GPT-4   │    │  Supabase Database │
│  Function Call  │    │  • Conversation     │
│  Processing     │    │  • Tool Executions  │
└─────────────────┘    │  • Pending Actions  │
                       │  • Event Queue      │
                       └────────┬────────────┘
                                │
                     ┌──────────▼────────────┐
                     │ javis-event-listener  │
                     │ (Background Service)  │
                     │ • Process events      │
                     │ • Generate messages   │
                     │ • Push notifications  │
                     └───────────────────────┘
```

---

## 📊 **Database Schema (New Tables)**

### **1. javis_conversation_state**
Stores conversation history with context:
```sql
- conversation_id: Link to main conversation
- turn_number: Sequential turn counter
- user_message: What user said
- assistant_message: J.A.V.I.S response
- tool_calls: Any tools called this turn
- context_summary: Short summary for context
```

### **2. javis_tool_definitions**
Available tools per tenant:
```sql
- tool_name: e.g., 'create_work_order'
- tool_description: Natural language description
- parameters: JSON schema of parameters
- required_role: Which roles can use this
- requires_confirmation: TRUE = ask before executing
```

**Pre-seeded tools:**
- `create_work_order` - Create maintenance work orders
- `schedule_inspection` - Schedule asset inspections
- `order_parts` - Request parts from procurement
- `update_asset_status` - Change asset status
- `notify_user` - Send user notifications
- `approve_action` - Approve pending decisions
- `defer_action` - Snooze/defer actions

### **3. javis_tool_executions**
Tool execution history:
```sql
- tool_name: Which tool
- parameters: Input parameters
- status: pending → confirmed → executed/failed
- result: Execution result
- confirmed_at: When user confirmed
- executed_at: When actually ran
```

### **4. javis_pending_actions**
Actions awaiting user confirmation:
```sql
- action_type: Type of action
- action_description: Natural language summary
- action_payload: Full action data
- expires_at: Auto-expire after 5 minutes
```

### **5. javis_event_queue**
Proactive system events:
```sql
- event_type: e.g., 'asset_status_changed'
- event_data: Event details
- priority: low/medium/high/critical
- target_users: Specific user IDs
- target_roles: Role codes (EXEC, OPS_MGR, etc.)
- processed: FALSE until delivered
```

### **6. javis_websocket_sessions**
Active WebSocket connections:
```sql
- session_id: Unique session ID
- user_id: Connected user
- conversation_id: Current conversation
- connected_at: Connection time
- last_activity: Heartbeat timestamp
- disconnected_at: NULL while active
```

---

## 🔧 **Edge Functions**

### **1. javis-websocket** (New!)

**Purpose:** Real-time bidirectional communication

**Endpoints:**
```
wss://YOUR-PROJECT.supabase.co/functions/v1/javis-websocket
```

**Message Types (Client → Server):**

```typescript
// Initialize session
{
  type: 'init',
  user_id: 'uuid',
  tenant_id: 'uuid'
}

// Send message
{
  type: 'message',
  content: 'Create a work order for pump P-204',
  conversation_id: 'uuid' // optional
}

// Confirm tool execution
{
  type: 'confirm',
  action_id: 'uuid'
}

// Reject/cancel action
{
  type: 'reject',
  action_id: 'uuid'
}

// Heartbeat
{
  type: 'ping'
}
```

**Message Types (Server → Client):**

```typescript
// Connection established
{
  type: 'connected',
  session_id: 'uuid',
  message: 'J.A.V.I.S connected...'
}

// Response to user message
{
  type: 'response',
  content: 'I\'ll create that work order...',
  tool_calls: [...],
  pending_actions: [...],
  citations: [...],
  conversation_id: 'uuid'
}

// Tool execution result
{
  type: 'tool_executed',
  result: {...},
  message: '✓ Work order created...'
}

// Proactive system event
{
  type: 'event',
  event_type: 'asset_status_changed',
  message: 'P-204 tripped ALARM...',
  priority: 'high',
  pending_action_id: 'uuid'
}

// Heartbeat response
{
  type: 'pong'
}
```

---

### **2. javis-event-listener** (New!)

**Purpose:** Process system events and generate proactive updates

**Endpoints:**

**POST `/ingest`** - Queue a new event
```json
{
  "event_type": "asset_status_changed",
  "tenant_id": "uuid",
  "event_data": {
    "asset_id": "uuid",
    "asset_name": "Pump P-204",
    "old_status": "operational",
    "new_status": "alarm",
    "metric": "seal_temperature",
    "change_pct": 18
  },
  "priority": "high",
  "target_roles": ["REL_ENG", "OPS_MGR"]
}
```

**POST `/process`** - Process queued events (called by cron/scheduler)

**Event Types Supported:**
- `asset_status_changed` - Asset state transitions
- `kpi_threshold_breached` - KPI exceeds threshold
- `report_updated` - Report regenerated
- `workorder_blocked` - WO blocked/delayed
- `inventory_stockout` - Parts running low
- `safety_incident` - Safety event occurred
- `approval_required` - Decision needs approval

---

## 💬 **Interactive Conversation Examples**

### **Example 1: Creating a Work Order**

```
User: "Morning J.A.V.I.S—what changed overnight at Site B?"

J.A.V.I.S: "Good morning! Two items:

1) Pump P-204 seal temperature +18% vs baseline.
   Likely seal degradation. Recommend 2-hour inspection.

2) Stockout risk on 6205 bearings in 4 days.

Want me to open a work order and place a rush PO?"

User: "Open the WO for 7 AM tomorrow, assign to Miguel,
       and place the rush PO."

[J.A.V.I.S shows confirmation UI with action details]

[Confirm Button] [Cancel Button]

User: [Clicks Confirm]

J.A.V.I.S: "✓ Done. WO-18423 scheduled for 7 AM tomorrow.
            Miguel notified via SMS.
            Rush PO raised with Vendor A, ETA 48h.

            Do you want a backup vendor queued?"
```

---

### **Example 2: Proactive Alert with Actions**

```
[J.A.V.I.S pushes alert via WebSocket]

J.A.V.I.S: "🔔 ALERT: Conveyor C-14 at Site A just failed.
            Production line halted. Estimated downtime: 4 hours.

            Suggested actions ready for approval:"

[Action Card]
┌─────────────────────────────────────────┐
│ CREATE_WORK_ORDER                       │
│ {                                       │
│   "asset": "C-14",                      │
│   "priority": "critical",               │
│   "due_date": "2025-10-25 15:00",      │
│   "assigned_to": "Emergency Crew"       │
│ }                                       │
│ [✓ Approve] [✗ Cancel]                 │
│ Expires in 5 minutes                    │
└─────────────────────────────────────────┘

User: [Clicks Approve]

J.A.V.I.S: "✓ Emergency WO created. Crew dispatched.
            Parts pre-staged from local inventory.
            Tracking ETA...will update you."
```

---

### **Example 3: Back-and-Forth Reasoning**

```
User: "Why did the MTBF drop 12% last week?"

J.A.V.I.S: "I found 3 contributing factors:

1) Haul truck transmissions: +40% failures
2) Conveyor bearings: +15% degradation events
3) Pump seals: +8% overheating incidents

Which would you like me to deep-dive?"

User: "Haul trucks"

J.A.V.I.S: "Analyzing haul truck transmission failures...

Root cause appears to be:
- Overloading (8 of 12 failures)
- Insufficient maintenance intervals
- Operating in high-temp conditions

I can:
A) Adjust load limits in dispatch system
B) Accelerate PM schedule for fleet
C) Both

Which would you prefer?"

User: "Both, and show me the cost impact"

J.A.V.I.S: "Implementing both changes:

Load limits: -10% capacity → +$45k/month slower haul
Accelerated PM: +2 services/month → +$12k/month

Total cost: +$57k/month
Projected MTBF gain: +22%
NPV over 12 months: +$340k savings

Approve?"

User: "Approve"

[Confirmation UI appears]

J.A.V.I.S: "✓ Changes implemented. Dispatch limits updated.
            PM schedule adjusted. Monitoring impact..."
```

---

## 🔐 **Security & RACI Enforcement**

### **Tool Access by Role:**

| Tool | EXEC | OPS_MGR | REL_ENG | PLANNER | TECH | HSE | PROC |
|------|------|---------|---------|---------|------|-----|------|
| create_work_order | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| schedule_inspection | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| order_parts | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ |
| update_asset_status | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| notify_user | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| approve_action | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| defer_action | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |

### **Content Filtering:**

```typescript
// Example: Technician sees only assigned WOs
WHERE assigned_to = user_id

// Example: Executive sees only strategic KPIs
WHERE category IN ('strategic', 'financial', 'risk')
  AND severity >= 'high'

// Example: REL_ENG sees all technical data
WHERE category IN ('reliability', 'failure-analysis', 'predictive')
```

---

## 🎨 **React Component (JavisDockInteractive)**

### **Key Features:**

1. **WebSocket Connection**
   - Auto-connects on mount
   - Reconnects on disconnect
   - 30-second heartbeat ping

2. **Message Rendering**
   - User messages (right-aligned, teal)
   - Assistant messages (left-aligned, gray)
   - System messages (centered, yellow)

3. **Action Confirmation UI**
   - Shows pending action details
   - Confirm/Cancel buttons
   - 5-minute expiration timer
   - Real-time status updates

4. **Voice Features**
   - Speech-to-text input (mic button)
   - Text-to-speech output (toggle)
   - Visual recording indicator

5. **Connection Status**
   - Green dot = connected
   - Red dot = disconnected
   - Reconnection message

---

## 📡 **Event Integration Examples**

### **Trigger Event from Asset Monitor:**

```typescript
// When asset status changes, queue event
await fetch(
  `${SUPABASE_URL}/functions/v1/javis-event-listener/ingest`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'asset_status_changed',
      tenant_id: tenantId,
      event_data: {
        asset_id: 'p-204-uuid',
        asset_name: 'Pump P-204',
        old_status: 'operational',
        new_status: 'alarm',
        metric: 'seal_temperature',
        change_pct: 18
      },
      priority: 'high',
      target_roles: ['REL_ENG', 'OPS_MGR', 'TECH']
    })
  }
);
```

### **Schedule Event Processing (Cron):**

```bash
# Process queued events every minute
*/1 * * * * curl -X POST \
  https://YOUR-PROJECT.supabase.co/functions/v1/javis-event-listener/process \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

---

## 🚀 **Deployment Steps**

### **1. Deploy Database Migrations:**

```bash
# Run both migrations in Supabase SQL Editor:
1. supabase/migrations/20251025000000_create_javis_system.sql
2. supabase/migrations/20251025120000_add_javis_interactive_features.sql
```

### **2. Deploy Edge Functions:**

```bash
# Deploy all J.A.V.I.S functions
supabase functions deploy javis-orchestrator
supabase functions deploy javis-websocket
supabase functions deploy javis-event-listener
```

### **3. Set Environment Variables:**

Already set via Supabase:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

### **4. Test WebSocket Connection:**

```javascript
const ws = new WebSocket(
  'wss://YOUR-PROJECT.supabase.co/functions/v1/javis-websocket'
);

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'init',
    user_id: 'your-user-uuid',
    tenant_id: 'your-tenant-uuid'
  }));
};

ws.onmessage = (event) => {
  console.log('Received:', JSON.parse(event.data));
};
```

---

## 📊 **Monitoring & Analytics**

### **Conversation Metrics:**

```sql
-- Average conversation length
SELECT
  AVG(message_count) as avg_turns,
  AVG(EXTRACT(EPOCH FROM (ended_at - started_at))) as avg_duration_sec
FROM javis_conversations
WHERE ended_at IS NOT NULL;

-- Tool usage by type
SELECT
  tool_name,
  COUNT(*) as executions,
  COUNT(CASE WHEN status = 'executed' THEN 1 END) as successful,
  COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled
FROM javis_tool_executions
GROUP BY tool_name
ORDER BY executions DESC;

-- Event response times
SELECT
  event_type,
  AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) as avg_processing_sec
FROM javis_event_queue
WHERE processed = TRUE
GROUP BY event_type;
```

---

## 🎯 **Testing the Interactive Features**

### **Test 1: Simple Conversation**
1. Open J.A.V.I.S dock (bottom-right button)
2. Type: "What's the status of Site A?"
3. Verify: Response appears in chat
4. Verify: Green connection indicator

### **Test 2: Tool Calling**
1. Type: "Create a work order for Pump P-204 seal inspection tomorrow at 9 AM"
2. Verify: Confirmation UI appears with action details
3. Click **Confirm**
4. Verify: Success message with WO ID

### **Test 3: Voice Input**
1. Click microphone button
2. Speak: "Show me active alerts"
3. Verify: Transcription appears in input
4. Press Enter
5. Verify: Response received

### **Test 4: Proactive Event**
1. Trigger event via API (see event integration example)
2. Verify: Alert appears in J.A.V.I.S dock
3. Verify: Action buttons present
4. Click **Approve**
5. Verify: Action executed

---

## 🔧 **Troubleshooting**

### **WebSocket Won't Connect:**
- Check CORS settings in edge function
- Verify WebSocket upgrade headers
- Check browser console for errors
- Ensure Supabase URL uses `wss://` not `https://`

### **Tools Not Showing:**
- Verify user role in `user_role_map`
- Check `javis_tool_definitions` has tools seeded
- Confirm `required_role` includes user's role
- Check `enabled = TRUE` on tool definition

### **Events Not Processing:**
- Verify event listener function deployed
- Check `javis_event_queue` for unprocessed events
- Run `/process` endpoint manually
- Check function logs in Supabase dashboard

### **Actions Expiring Too Fast:**
- Default: 5 minutes
- Adjust in `javis_pending_actions.expires_at`
- Or change default in migration SQL

---

## ✨ **What's Now Possible**

✅ **"Hey J.A.V.I.S, create a PM schedule for all pumps"**
→ Analyzes assets, proposes schedule, asks for confirmation

✅ **"Why did MTBF drop last week?"**
→ Investigates data, asks clarifying questions, deep-dives

✅ **Proactive: "Conveyor C-14 failed. Create emergency WO?"**
→ Pushes alert with pre-filled WO, user approves with one click

✅ **"Order 5 bearing kits for next week"**
→ Creates procurement request, confirms with user, executes

✅ **"Defer this alert for 2 hours"**
→ Snoozes notification, reminds user later

✅ **Voice: "Show me today's work orders"**
→ STT transcribes, processes, TTS reads back results

✅ **Follow-up: "Why is WO-18423 blocked?"**
→ Remembers context, investigates specific WO, explains

---

## 🎉 **Full Interactive J.A.V.I.S Now Live!**

Your maintenance teams can now:
- **Talk naturally** to J.A.V.I.S (voice or text)
- **Execute actions** with confirmation
- **Receive proactive alerts** they can respond to
- **Have back-and-forth conversations** with context
- **Get role-specific information** (RACI-filtered)

**It's like having a well-briefed colleague available 24/7!** 🚀
