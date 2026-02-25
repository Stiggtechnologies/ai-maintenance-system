# Setting Up Alerts

**Last Updated:** February 23, 2026  
**Reading Time:** 5 minutes  
**Difficulty:** Beginner

---

## Overview

Alerts keep you informed about critical events, AI predictions, and maintenance needs. This guide shows you how to configure alerts so you never miss important issues.

---

## Alert Types

### 1. AI Prediction Alerts
When AI agents detect potential failures or issues.

**Examples:**
- Bearing failure predicted in Pump P-101 (68% confidence)
- Abnormal vibration detected on Compressor C-201
- Asset health score dropped below 70%

### 2. Work Order Alerts
Notifications about work order status changes.

**Examples:**
- New work order assigned to you
- Work order overdue
- Work order requires approval
- Work order completed

### 3. Maintenance Schedule Alerts
Reminders for upcoming preventive maintenance.

**Examples:**
- Preventive maintenance due in 7 days
- Maintenance window opening
- Inspection overdue

### 4. Compliance & Safety Alerts
Critical regulatory or safety issues.

**Examples:**
- Certification expiring in 30 days
- Safety inspection required
- Regulatory deadline approaching

### 5. System Alerts
Platform status and performance issues.

**Examples:**
- Data sync issues
- Integration failures
- System maintenance scheduled

---

## Setting Up Alerts

### Step 1: Access Notification Settings

1. Click your **profile icon** (top right)
2. Select **"Notification Settings"**

Or navigate to: **Settings → Notifications**

### Step 2: Configure Alert Preferences

![Alert Settings](placeholder-alert-settings.png)

#### Choose Alert Types

Toggle which alerts you want to receive:

**AI & Predictions:**
- [ ] Critical failure predictions (90%+ confidence)
- [ ] High-risk predictions (70-89% confidence)
- [ ] Moderate predictions (50-69% confidence)
- [ ] Asset health score changes
- [ ] Anomaly detections

**Work Orders:**
- [ ] Work orders assigned to me
- [ ] Work order status changes
- [ ] Overdue work orders
- [ ] Work orders awaiting approval
- [ ] Comments on my work orders

**Maintenance:**
- [ ] Preventive maintenance due (7 days)
- [ ] Preventive maintenance due (1 day)
- [ ] Maintenance overdue
- [ ] Schedule conflicts

**Compliance:**
- [ ] Certifications expiring (30 days)
- [ ] Inspections due
- [ ] Regulatory deadlines
- [ ] Audit alerts

**System:**
- [ ] Data sync issues
- [ ] Integration errors
- [ ] System maintenance notifications
- [ ] Feature announcements

### Step 3: Choose Delivery Methods

For each alert type, select how you want to be notified:

**Available Channels:**
- ✉️ **Email** - Sent to your registered email
- 📱 **SMS** - Text messages (Pro/Enterprise only)
- 🔔 **In-App** - Notification bell in SyncAI
- 📲 **Push** - Mobile app notifications (coming soon)
- 💬 **Slack** - Slack channel integration (Enterprise)
- 📞 **Phone Call** - For critical alerts (Enterprise only)

**Recommended Settings:**

| Alert Priority | Email | SMS | In-App | Push |
|----------------|-------|-----|--------|------|
| Critical | ✓ | ✓ | ✓ | ✓ |
| High | ✓ | | ✓ | ✓ |
| Medium | | | ✓ | ✓ |
| Low | | | ✓ | |

### Step 4: Set Quiet Hours

Prevent non-critical alerts during off-hours:

1. Enable **"Quiet Hours"**
2. Set hours: **10:00 PM - 7:00 AM**
3. Choose timezone
4. Critical alerts still come through (can't be silenced)

### Step 5: Configure Frequency

Prevent alert fatigue:

**Digest Options:**
- **Real-time:** Immediate notification (default for critical)
- **Hourly Digest:** Batch alerts every hour
- **Daily Digest:** Summary once per day (8:00 AM)
- **Weekly Digest:** Summary every Monday morning

💡 **Recommended:** Real-time for critical, daily digest for medium/low priority.

### Step 6: Save Settings

Click **"Save Preferences"** at the bottom.

---

## Asset-Specific Alerts

### Per-Asset Alert Rules

Set custom alerts for specific critical equipment:

1. **Open Asset Details**
   - Navigate to asset page
   - Click on specific asset

2. **Click "Alert Rules"** tab

3. **Create Custom Rule**
   - **Condition:** Health score < 70
   - **Notify:** Email + SMS
   - **Recipients:** Maintenance Manager, On-call Tech
   - **Frequency:** Immediate

4. **Save Rule**

### Example Custom Rules

**Pump P-101 (Critical Asset):**
```
Rule 1: Health Score < 75
→ Email: maintenance-manager@company.com
→ Frequency: Immediate

Rule 2: Vibration > 5 mm/s
→ SMS: +1-555-0123 (On-call tech)
→ Email: team-lead@company.com
→ Frequency: Immediate

Rule 3: Temperature > 85°C
→ Phone Call: +1-555-0199 (Emergency)
→ Frequency: Immediate
```

**Heat Exchanger HX-601 (High Priority):**
```
Rule 1: Fouling rate > 15%
→ Email: process-engineer@company.com
→ Frequency: Daily digest

Rule 2: Differential pressure > 3 bar
→ Email: maintenance-team@company.com
→ Frequency: Immediate
```

---

## Team Alert Rules

### Setting Up Team Notifications

For team leads and managers:

1. **Settings → Team Alerts**
2. **Configure Team Rules:**

**Example: Maintenance Team Lead**
```
Notify me when:
- Any critical asset triggers alert
- Any work order overdue > 3 days
- Any technician needs help (flagged work order)
- Weekly summary of team performance
```

**Example: Operations Manager**
```
Notify me when:
- Any critical failure prediction (90%+ confidence)
- Any compliance violation risk
- Monthly summary of maintenance metrics
- Quarterly business review data ready
```

### Role-Based Alerts

Different roles receive different default alerts:

**Admin:**
- All system alerts
- Billing & subscription changes
- User management changes

**Manager:**
- Team work order summaries
- High-priority asset alerts
- Compliance deadlines

**Technician:**
- Work orders assigned to them
- Asset alerts for their zone
- Safety notifications

**Viewer:**
- Read-only summary digests
- No actionable alerts

---

## Alert Priority Levels

### Understanding Priority

| Priority | Icon | Color | Response Time | Examples |
|----------|------|-------|---------------|----------|
| **Critical** | 🔴 | Red | Immediate | Imminent failure, safety risk, system down |
| **High** | 🟠 | Orange | 1-4 hours | High-risk prediction, overdue work, compliance deadline |
| **Medium** | 🟡 | Yellow | 1-24 hours | Moderate prediction, upcoming maintenance |
| **Low** | 🟢 | Green | 1-7 days | Optimization opportunities, info updates |

### Alert Actions

Every alert includes action buttons:

```
🔴 CRITICAL ALERT
Pump P-101 - Bearing Failure Predicted
Confidence: 92% | Within: 48 hours

AI Recommendation: Immediate inspection and bearing replacement

[Create Work Order] [View Asset] [Acknowledge] [Dismiss]
```

**Action Options:**
- **Create Work Order:** Auto-generate work order from alert
- **View Asset:** Open asset details page
- **Acknowledge:** Mark as seen (stops repeat notifications)
- **Dismiss:** Remove from feed (not recommended for critical)
- **Snooze:** Remind me in X hours

---

## Email Alert Settings

### Configure Email Notifications

**Settings → Notifications → Email Preferences:**

1. **Email Address**
   - Primary: your-email@company.com
   - Add backup: backup@company.com

2. **Email Format**
   - [ ] HTML (rich formatting, images)
   - [x] Plain text (simple, fast)

3. **Include in Emails:**
   - [x] Quick action links
   - [x] Asset images
   - [x] Historical context
   - [ ] Full AI analysis (verbose)

### Example Email Alert

```
Subject: 🔴 Critical Alert: Pump P-101 Bearing Failure Predicted

From: SyncAI Alerts <alerts@syncai.com>
To: mike.patterson@acmeoil.com

────────────────────────────────────────

CRITICAL ALERT - Immediate Action Required

Asset: Crude Oil Pump P-101
Location: Offshore Platform Alpha - Sector A
Criticality: Critical

🤖 Reliability Engineering Agent
Confidence: 92%
Impact: Critical

⚠️ Bearing failure predicted within 48 hours

Supporting Data:
• Vibration levels increased 40% over 7 days
• Temperature trending upward (now 78°C)
• Similar pumps failed after this pattern

💡 Recommended Action:
1. Perform immediate vibration analysis
2. Schedule bearing replacement within 24 hours
3. Order OEM bearings (P/N: FSV-BRG-500)

📊 If Not Addressed:
• Production downtime: 8-12 hours
• Emergency repair cost: $45,000
• Lost production: $120,000

Quick Actions:
[Create Work Order] [View Asset Details] [Acknowledge Alert]

────────────────────────────────────────

Questions? Reply to this email or chat with us: app.syncai.com

Unsubscribe from critical alerts | Manage notification settings
```

---

## SMS Alert Settings (Pro/Enterprise)

### Configure SMS

**Settings → Notifications → SMS:**

1. **Add Phone Number**
   - Enter number: +1 (555) 123-4567
   - Verify via code

2. **SMS Alert Types**
   - [x] Critical alerts only
   - [ ] High-priority alerts
   - [ ] Compliance deadlines

3. **SMS Frequency Limit**
   - Max 5 SMS per day (prevent alert fatigue)
   - Critical alerts always sent (no limit)

### Example SMS Alert

```
🔴 SyncAI CRITICAL: Pump P-101 bearing failure predicted (92% confidence, 48h). Create work order: syncai.com/wo/new?asset=P101
```

---

## Slack Integration (Enterprise)

### Connect Slack Workspace

1. **Settings → Integrations → Slack**
2. **Click "Connect Slack"**
3. **Authorize SyncAI** in your Slack workspace
4. **Configure Channels:**

```
#maintenance-critical → Critical alerts
#maintenance-alerts → High/medium alerts
#compliance → Compliance deadlines
#your-name → Personal work orders
```

### Example Slack Alert

```
🤖 SyncAI Alert Bot [9:42 AM]

🔴 CRITICAL ALERT

*Pump P-101 - Bearing Failure Predicted*

Confidence: 92% | Impact: Critical | Timeline: 48 hours

📍 Location: Offshore Platform Alpha - Sector A
🤖 Agent: Reliability Engineering

💡 Recommendation: Immediate bearing inspection and replacement

[Create Work Order] [View Asset] [Acknowledge]

────────────────────────────────────────
Generated by SyncAI | Settings
```

---

## Managing Alert Overload

### If You're Getting Too Many Alerts

1. **Review Alert Rules**
   - Increase confidence thresholds
   - Disable low-priority alerts
   - Use digest mode for non-critical

2. **Focus on Critical Assets**
   - Only monitor top 20% critical equipment
   - Disable alerts for low-criticality assets

3. **Use Smart Filtering**
   - Settings → Smart Filtering → ON
   - AI learns which alerts you act on
   - Automatically reduces noise

4. **Delegate Alerts**
   - Assign alerts to specific team members
   - Use role-based routing

---

## Troubleshooting Alerts

### Not Receiving Alerts?

**Check these:**

1. **Email:**
   - Check spam folder
   - Verify email address in settings
   - Whitelist alerts@syncai.com

2. **SMS:**
   - Verify phone number is correct
   - Check SMS plan limits
   - Carrier delays (can be 1-5 minutes)

3. **In-App:**
   - Check browser notification permissions
   - Refresh page
   - Clear cache

4. **Settings:**
   - Verify alerts are enabled
   - Check quiet hours settings
   - Ensure asset AI monitoring is ON

### Getting Duplicate Alerts?

- Check if you're in multiple notification groups
- Review team alert settings
- Contact support to audit your alert rules

---

## Best Practices

### ✅ DO:
- Enable critical alerts across all channels
- Use digest mode for low-priority items
- Set asset-specific rules for critical equipment
- Review alert settings quarterly
- Acknowledge alerts promptly

### ❌ DON'T:
- Disable critical alerts (ever)
- Ignore alerts for critical assets
- Set all alerts to real-time (causes fatigue)
- Use only one notification channel
- Let alerts pile up unacknowledged

---

## Frequently Asked Questions

**Q: Can I mute all alerts temporarily?**  
A: Yes. Settings → "Snooze All Notifications" (max 24 hours). Critical safety alerts still come through.

**Q: How do I share alerts with my team?**  
A: Settings → Team Alerts → Add team members to alert rules.

**Q: What happens if I miss a critical alert?**  
A: System escalates to backup contacts after 30 minutes of no acknowledgment.

**Q: Can I get alerts for specific AI agents only?**  
A: Yes. Settings → AI Alerts → Toggle specific agents on/off.

**Q: Do alerts cost extra?**  
A: Email and in-app alerts are free. SMS is Pro/Enterprise only (included in plan).

---

## Next Steps

- ✅ [Work Order Management](05-work-order-management.md)
- ✅ [Understanding AI Agents](03-understanding-ai-agents.md)
- ✅ [Mobile App Setup](#) (coming soon)

---

**Related Articles:**
- [Getting Started](01-getting-started.md)
- [Understanding AI Agents](03-understanding-ai-agents.md)
- [Notification Settings Reference](#)
- [Slack Integration Guide](#)

**Tags:** alerts, notifications, email, sms, monitoring, real-time
