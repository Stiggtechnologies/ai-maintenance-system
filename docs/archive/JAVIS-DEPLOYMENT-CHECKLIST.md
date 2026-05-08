# ✅ J.A.V.I.S Interactive Features - Deployment Checklist

## Pre-Deployment Verification

### **Database Setup**
- [ ] Run migration `20251025000000_create_javis_system.sql`
- [ ] Run migration `20251025120000_add_javis_interactive_features.sql`
- [ ] Verify 8 RACI roles seeded in `roles_raci` table
- [ ] Verify 7 tools seeded in `javis_tool_definitions` table
- [ ] Check all tables created successfully
- [ ] Verify RLS policies enabled on all tables

### **Edge Functions**
- [ ] Deploy `javis-orchestrator` function
- [ ] Deploy `javis-websocket` function
- [ ] Deploy `javis-event-listener` function
- [ ] Test each function with curl/Postman
- [ ] Verify environment variables set (OPENAI_API_KEY)

### **React Components**
- [ ] `JavisDockInteractive.tsx` integrated into App.tsx
- [ ] `JavisBriefing.tsx` accessible via menu
- [ ] `JavisPreferences.tsx` accessible via menu
- [ ] WebSocket connection logic tested
- [ ] Voice features tested (mic button, TTS toggle)

---

## Post-Deployment Testing

### **Test 1: Basic Conversation**
```
1. Open J.A.V.I.S dock (click floating button)
2. Type: "Hello J.A.V.I.S"
3. ✅ Expect: Greeting response
4. ✅ Check: Green connection indicator
5. ✅ Check: Message appears in chat
```

### **Test 2: Tool Calling**
```
1. Type: "Create a work order for pump maintenance"
2. ✅ Expect: Confirmation UI with action details
3. Click "Confirm" button
4. ✅ Expect: Success message with WO ID
5. ✅ Check: Work order created in database
```

### **Test 3: Voice Input**
```
1. Click microphone button
2. Speak: "Show me active alerts"
3. ✅ Expect: Red recording indicator
4. ✅ Expect: Transcription appears in input
5. Press Enter
6. ✅ Expect: Response received
```

### **Test 4: Role-Based Access**
```
1. Login as EXEC role
2. Ask: "Create a work order"
3. ✅ Expect: Tool NOT available (EXEC can't create WOs)
4. Login as PLANNER role
5. Ask: "Create a work order"
6. ✅ Expect: Confirmation UI appears
```

### **Test 5: Proactive Events**
```
1. Trigger event via API:
   POST /javis-event-listener/ingest
   {
     "event_type": "asset_status_changed",
     "priority": "high",
     ...
   }
2. ✅ Expect: Alert appears in J.A.V.I.S dock
3. ✅ Expect: Action buttons present
4. Click "Approve"
5. ✅ Expect: Tool executed successfully
```

### **Test 6: Context Retention**
```
1. Ask: "What's the status of Site A?"
2. ✅ Expect: Response with Site A info
3. Follow-up: "And Site B?"
4. ✅ Expect: Response maintains conversation context
5. Follow-up: "Compare them"
6. ✅ Expect: Comparison referencing previous turns
```

### **Test 7: Morning Briefing**
```
1. Navigate to: J.A.V.I.S → Briefing
2. ✅ Expect: Greeting with name
3. ✅ Expect: Role-appropriate sections (KPIs, alerts, WOs)
4. ✅ Expect: Citations shown
5. Click "Refresh"
6. ✅ Expect: Updated briefing
```

### **Test 8: Preferences**
```
1. Navigate to: J.A.V.I.S → Preferences
2. Enable "Voice responses"
3. Set morning brief time: 08:00
4. Click "Test Voice"
5. ✅ Expect: Voice plays
6. Click "Save"
7. ✅ Expect: Success message
```

---

## Monitoring Setup

### **Database Queries to Monitor:**

```sql
-- Active WebSocket sessions
SELECT COUNT(*) as active_sessions
FROM javis_websocket_sessions
WHERE disconnected_at IS NULL;

-- Pending actions (should expire after 5 min)
SELECT COUNT(*) as pending_actions
FROM javis_pending_actions
WHERE expires_at > now();

-- Unprocessed events
SELECT COUNT(*) as queued_events
FROM javis_event_queue
WHERE NOT processed;

-- Tool execution success rate (last 24h)
SELECT
  tool_name,
  COUNT(*) as total,
  COUNT(CASE WHEN status = 'executed' THEN 1 END) as successful,
  ROUND(100.0 * COUNT(CASE WHEN status = 'executed' THEN 1 END) / COUNT(*), 1) as success_pct
FROM javis_tool_executions
WHERE created_at > now() - interval '24 hours'
GROUP BY tool_name;
```

### **Alerts to Set Up:**

- [ ] Alert if unprocessed events > 100
- [ ] Alert if tool execution failure rate > 10%
- [ ] Alert if WebSocket disconnects > 5/minute
- [ ] Alert if conversation turn > 50 (possible loop)

---

## Production Hardening

### **Security:**
- [ ] Review RLS policies (users can only see own data)
- [ ] Audit tool permissions (correct roles assigned)
- [ ] Test with different user roles
- [ ] Verify tenant isolation (users can't see other tenants)
- [ ] Enable rate limiting on edge functions
- [ ] Add input validation for tool parameters

### **Performance:**
- [ ] Set up conversation context caching
- [ ] Add indexes on frequently queried columns
- [ ] Monitor WebSocket connection count
- [ ] Set max message size limit
- [ ] Implement conversation turn limit (prevent infinite loops)

### **Reliability:**
- [ ] Set up WebSocket auto-reconnect
- [ ] Add exponential backoff for retries
- [ ] Implement graceful degradation (fallback to REST if WS fails)
- [ ] Add dead letter queue for failed events
- [ ] Set up function error logging

---

## Cron Jobs to Schedule

### **Event Processing:**
```bash
# Process queued events every minute
*/1 * * * * curl -X POST \
  https://YOUR-PROJECT.supabase.co/functions/v1/javis-event-listener/process \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

### **Cleanup Tasks:**
```sql
-- Run daily at 2 AM: Clean up old conversations
DELETE FROM javis_conversations
WHERE ended_at < now() - interval '90 days';

-- Run daily at 2 AM: Clean up expired pending actions
DELETE FROM javis_pending_actions
WHERE expires_at < now();

-- Run daily at 2 AM: Clean up old WebSocket sessions
DELETE FROM javis_websocket_sessions
WHERE disconnected_at < now() - interval '7 days';
```

---

## User Onboarding

### **Step 1: Assign User Role**
```sql
INSERT INTO user_role_map (tenant_id, user_id, role_code, is_primary)
VALUES ('tenant-uuid', 'user-uuid', 'REL_ENG', TRUE);
```

### **Step 2: Set User Preferences**
```sql
INSERT INTO user_preferences (tenant_id, user_id, display_name, prefers_voice)
VALUES ('tenant-uuid', 'user-uuid', 'Orville', FALSE);
```

### **Step 3: User Test Checklist**
- [ ] User can open J.A.V.I.S dock
- [ ] User receives role-appropriate responses
- [ ] User can see only authorized tools
- [ ] User receives morning briefing
- [ ] User can set preferences

---

## Rollback Plan

### **If WebSocket Issues:**
1. Revert to `JavisDock` (non-WebSocket version)
2. Update App.tsx: `import { JavisDock } from './components/JavisDock'`
3. Users fall back to REST API polling

### **If Tool Execution Issues:**
1. Disable problematic tools:
   ```sql
   UPDATE javis_tool_definitions
   SET enabled = FALSE
   WHERE tool_name = 'problematic_tool';
   ```

### **If Event Processing Issues:**
1. Pause event ingestion
2. Process queue manually
3. Investigate and fix
4. Resume ingestion

---

## Success Metrics

### **Week 1 Targets:**
- [ ] 90%+ WebSocket connection success rate
- [ ] 95%+ tool execution success rate
- [ ] <5 second avg response time
- [ ] 80%+ user adoption (using J.A.V.I.S at least once)

### **Month 1 Targets:**
- [ ] 100+ conversations per day
- [ ] 50+ tool executions per day
- [ ] 85%+ positive user feedback
- [ ] 10+ proactive events handled per day

---

## ✅ **Sign-Off Checklist**

Before marking J.A.V.I.S as production-ready:

- [ ] All database migrations applied
- [ ] All edge functions deployed and tested
- [ ] All React components working
- [ ] All 8 test scenarios passing
- [ ] Monitoring queries set up
- [ ] Cron jobs scheduled
- [ ] Security review completed
- [ ] Performance benchmarks met
- [ ] Documentation reviewed
- [ ] Team trained on J.A.V.I.S features
- [ ] Rollback plan tested

---

## 🎉 **Production Ready!**

Once all items checked, J.A.V.I.S Interactive is ready for production use!

**Next Steps:**
1. Announce to users
2. Monitor metrics daily (first week)
3. Gather user feedback
4. Iterate based on usage patterns

---

**Deployment Date:** ____________

**Deployed By:** ____________

**Verified By:** ____________
