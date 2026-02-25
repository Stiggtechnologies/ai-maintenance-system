# Work Order Management

**Last Updated:** February 23, 2026  
**Reading Time:** 6 minutes  
**Difficulty:** Beginner

---

## Overview

Work orders are the core of maintenance execution in SyncAI. This guide covers creating, managing, and completing work orders efficiently.

---

## Work Order Lifecycle

```
[Pending] → [In Progress] → [Completed]
            ↓
        [Blocked] → [In Progress]
```

---

## Creating Work Orders

### Method 1: From AI Recommendation (Fastest)

1. Go to **AI Analytics** tab
2. Find an AI recommendation
3. Click **"Create Work Order"**
4. SyncAI auto-fills all fields:
   - Title (from AI insight)
   - Asset (linked automatically)
   - Priority (based on AI risk assessment)
   - Description (AI analysis + recommendations)
   - Estimated cost (AI calculation)
5. Review and adjust if needed
6. Click **"Create"**

✅ **Advantage:** All context preserved, no manual data entry

### Method 2: Manual Creation

1. **Work Orders → "+ New Work Order"**

2. **Fill Required Fields:**

   **Title** *
   - Brief, descriptive
   - Good: "Replace bearing on Pump P-101"
   - Bad: "Fix pump"

   **Asset** *
   - Select from dropdown
   - Start typing asset name for quick search

   **Type** *
   - **Corrective:** Fixing a problem
   - **Preventive:** Scheduled maintenance
   - **Predictive:** Based on AI prediction

   **Priority** *
   - **Critical:** Immediate, production impact
   - **High:** Within 24 hours
   - **Medium:** Within 1 week
   - **Low:** When convenient

3. **Optional Fields:**

   **Assigned To**
   - Select technician/team
   - Leave blank for "Unassigned" (planning decides later)

   **Due Date**
   - When work must be completed
   - System suggests dates based on priority

   **Estimated Hours**
   - Time estimate for planning
   - AI suggests based on similar past work

   **Estimated Cost**
   - Labor + parts + equipment
   - Helps with budget tracking

   **Description**
   - Detailed instructions
   - Problem symptoms
   - Safety considerations

   **Parts Required**
   - List parts needed
   - Links to inventory system

   **Attachments**
   - Photos of problem
   - Diagrams, manuals, procedures

4. **Click "Create Work Order"**

### Method 3: From Asset Page

1. Open **Asset Details**
2. Click **"Create Work Order"** button
3. Asset auto-linked
4. Fill in other details
5. Submit

### Method 4: Quick Create (Keyboard)

1. Press `Ctrl/Cmd + W` (from anywhere)
2. Quick create modal opens
3. Fill minimal fields
4. Press `Enter` to save

---

## Work Order Fields Explained

| Field | Required | Description | Example |
|-------|----------|-------------|---------|
| **Title** | Yes | Brief description | "Replace Pump P-101 Bearing" |
| **Asset** | Yes | Linked equipment | Pump P-101 |
| **Type** | Yes | Work category | Corrective / Preventive / Predictive |
| **Priority** | Yes | Urgency level | Critical / High / Medium / Low |
| **Status** | Auto | Current state | Pending / In Progress / Completed / Blocked |
| **Assigned To** | No | Technician name | Mike Patterson |
| **Due Date** | No | Completion deadline | 2026-02-28 |
| **Est. Hours** | No | Time estimate | 8 hours |
| **Actual Hours** | Auto | Tracked time | Filled on completion |
| **Est. Cost** | No | Budget estimate | $5,000 |
| **Actual Cost** | Manual | Real cost | Filled after |
| **Description** | No | Detailed notes | Full instructions |
| **Parts Required** | No | Spare parts list | Bearing P/N FSV-BRG-500 |
| **Created By** | Auto | Who created it | System / User name |
| **Created At** | Auto | Timestamp | 2026-02-23 09:45 |
| **Completed At** | Auto | Finish timestamp | Filled on completion |

---

## Managing Work Orders

### Viewing Work Orders

**Work Orders Tab:**
- Shows all work orders
- Default view: Active (Pending + In Progress)

**Filter Options:**
- **Status:** Pending / In Progress / Completed / Blocked
- **Priority:** Critical / High / Medium / Low
- **Assigned To:** Specific technician
- **Asset:** Specific equipment
- **Date Range:** Custom date range
- **Type:** Corrective / Preventive / Predictive

**Search:**
- Search by title, asset name, work order number

**Sort By:**
- Priority (default)
- Due date
- Created date
- Asset name

### Work Order Views

**List View** (default)
```
┌────────────────────────────────────────────────┐
│ WO-2026-001 🔴 Critical                        │
│ Replace Compressor C-201 Valves                │
│ Asset: Gas Compressor C-201                    │
│ Assigned: Mike Patterson | Due: Feb 25         │
│ Status: In Progress (55% complete)             │
└────────────────────────────────────────────────┘
```

**Kanban Board**
```
┌──────────┬──────────┬──────────┬──────────┐
│ Pending  │ In Prog. │ Blocked  │ Complete │
├──────────┼──────────┼──────────┼──────────┤
│ WO-003   │ WO-001   │ WO-005   │ WO-010   │
│ WO-004   │ WO-002   │          │ WO-011   │
│ WO-006   │          │          │ WO-012   │
└──────────┴──────────┴──────────┴──────────┘
```

**Calendar View**
Shows work orders on timeline by due date.

Switch views: Top right corner of Work Orders page.

---

## Updating Work Order Status

### Changing Status

1. Open work order
2. Click current status badge
3. Select new status:
   - **Pending** → Not started
   - **In Progress** → Currently working
   - **Blocked** → Cannot proceed (waiting for parts, approval, etc.)
   - **Completed** → Finished

### When to Use "Blocked"

Mark as blocked when:
- Waiting for parts delivery
- Requires special equipment not available
- Needs additional approval
- Asset inaccessible (shutdown required)

**Add block reason:**
```
Blocked Reason: Waiting for OEM valve delivery (ETA: 3 days)
```

System tracks blocked time separately from active work time.

---

## Completing Work Orders

### Completion Checklist

1. **Update Status to "In Progress"** when you start
2. **Track Time** (manual or timer)
3. **Add Work Notes** as you go
4. **Attach Photos** of before/after
5. **Record Parts Used** (links to inventory)
6. **Note Actual Cost** (labor + parts)
7. **Mark Status "Completed"**
8. **Fill Completion Form**

### Completion Form

Required fields when marking complete:

```
┌────────────────────────────────────────────┐
│ Complete Work Order WO-2026-001            │
├────────────────────────────────────────────┤
│                                            │
│ Actual Hours Worked: [8.5] hours          │
│                                            │
│ Actual Cost: [$4,250]                      │
│                                            │
│ Work Completed: *                          │
│ [Replaced inlet and discharge valves.     │
│  Performed compression test. All readings  │
│  within spec. Updated vibration baseline.] │
│                                            │
│ Parts Used:                                │
│ • Inlet valve assy (P/N: ARL-V-4401) x1    │
│ • Discharge valve assy (P/N: ARL-V-4402) x1│
│ • Gasket kit (P/N: ARL-G-1100) x1          │
│                                            │
│ Issue Resolved: Yes [v] No [ ]             │
│                                            │
│ Follow-up Required: Yes [ ] No [v]         │
│                                            │
│ Photos: [3 attached]                       │
│                                            │
│ [Mark as Complete] [Save Draft]            │
└────────────────────────────────────────────┘
```

### Post-Completion

After marking complete:
1. **System Actions:**
   - Calculates actual vs. estimated time/cost
   - Updates asset maintenance history
   - Trains AI on work outcome
   - Sends completion notification to creator

2. **Quality Check (optional):**
   - Supervisor can verify work
   - Mark as "Verified" or "Needs Rework"

---

## Work Order Best Practices

### ✅ DO:

**Be Specific in Titles**
- ✅ "Replace bearing on Crude Oil Pump P-101"
- ❌ "Fix pump"

**Link to Assets**
- Always connect work order to specific asset
- Enables AI learning and history tracking

**Add Photos**
- Before photos (document problem)
- During photos (work in progress)
- After photos (completed work)

**Estimate Accurately**
- Helps with planning
- Improves future AI estimates

**Update Status Regularly**
- Don't leave in "Pending" if you're working
- Mark "Blocked" immediately when issues arise

**Document Parts Used**
- Links to inventory
- Enables cost tracking
- Improves parts forecasting

**Write Detailed Completion Notes**
- What was done
- What was found
- Any recommendations
- Trains AI for future similar issues

### ❌ DON'T:

**Create Duplicate Work Orders**
- Search first before creating
- Check if work order already exists

**Leave Work Orders Open Indefinitely**
- Complete or close when done
- Archive if no longer relevant

**Skip Required Fields**
- Missing info = poor planning
- Incomplete data = bad AI predictions

**Ignore AI Recommendations**
- AI suggestions based on data
- Review before dismissing

---

## Advanced Features

### Recurring Work Orders

For preventive maintenance:

1. Create work order as usual
2. Enable **"Recurring"** toggle
3. Set frequency:
   - Every X days/weeks/months
   - Based on operating hours
   - Based on calendar (first Monday of month)
4. Set end date (or ongoing)

System auto-creates work orders per schedule.

### Work Order Templates

Save common work orders as templates:

1. Create detailed work order
2. Click **"Save as Template"**
3. Name template (e.g., "Pump Bearing Replacement")
4. Use later: **"+ New from Template"**

Templates include:
- Title format
- Description
- Checklist
- Parts list
- Time/cost estimates
- Safety notes

### Work Order Checklists

Add step-by-step checklists:

```
[ ] Isolate and lockout equipment
[ ] Verify zero energy (LOTO)
[ ] Drain fluids
[ ] Remove coupling
[ ] Extract old bearing
[ ] Clean bearing housing
[ ] Install new bearing
[ ] Reassemble coupling
[ ] Fill fluids
[ ] Remove lockout
[ ] Test run
[ ] Update maintenance log
```

Technicians check off as they go.

### Mobile Work Orders (Coming Soon)

Field technicians will be able to:
- View assigned work orders on phone
- Update status from field
- Take photos and attach instantly
- Clock in/out for time tracking
- Scan asset QR codes

---

## Work Order Reports

### Available Reports

**Settings → Reports → Work Orders:**

1. **Work Order Summary**
   - Total completed this month
   - Average completion time
   - Cost summary

2. **Backlog Report**
   - Overdue work orders
   - Aging analysis

3. **Technician Performance**
   - Completion rates by person
   - Average time per work order

4. **Cost Analysis**
   - Actual vs. estimated costs
   - Cost trends over time

5. **Predictive vs. Reactive**
   - Percentage of predictive work
   - Cost comparison

---

## Frequently Asked Questions

**Q: Can I assign a work order to multiple people?**  
A: Yes. Use "Assigned Team" field or assign to a team name.

**Q: How do I delete a work order?**  
A: You can't delete (audit trail). Archive instead: Status → "Cancelled" → Archive.

**Q: Can AI create work orders automatically?**  
A: Yes (optional). Enable in Settings → AI → "Auto-create work orders for high-confidence predictions".

**Q: What if I don't know estimated hours?**  
A: Leave blank. AI will suggest based on similar past work.

**Q: Can I copy a work order?**  
A: Yes. Open work order → Actions → "Duplicate".

**Q: How do I bulk-assign work orders?**  
A: Select multiple (checkboxes) → Actions → "Bulk Assign".

---

## Next Steps

- ✅ [Adding Your First Asset](02-adding-your-first-asset.md)
- ✅ [Understanding AI Agents](03-understanding-ai-agents.md)
- ✅ [Setting Up Alerts](04-setting-up-alerts.md)
- ✅ [Billing & Subscription](06-billing-and-subscription.md)

---

**Related Articles:**
- [Getting Started](01-getting-started.md)
- [Work Order Templates](#)
- [Mobile App Guide](#) (coming soon)
- [Technician Portal](#)

**Tags:** work-orders, maintenance, corrective, preventive, predictive, technicians
