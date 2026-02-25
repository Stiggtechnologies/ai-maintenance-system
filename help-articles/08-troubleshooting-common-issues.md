# Troubleshooting Common Issues

**Last Updated:** February 23, 2026  
**Reading Time:** 8 minutes  
**Difficulty:** Beginner to Intermediate

---

## Quick Diagnostic Checklist

Before diving into specific issues, try these quick fixes:

- [ ] **Refresh your browser** (Ctrl/Cmd + R)
- [ ] **Clear cache and cookies** (Ctrl/Cmd + Shift + Delete)
- [ ] **Try incognito/private mode** (Ctrl/Cmd + Shift + N)
- [ ] **Check internet connection**
- [ ] **Verify you're logged in**
- [ ] **Check [status.syncai.com](https://status.syncai.com)** for outages
- [ ] **Try a different browser** (Chrome, Firefox, Edge, Safari)
- [ ] **Disable browser extensions** (ad blockers can interfere)

---

## Login & Authentication Issues

### Can't Log In - "Invalid Credentials"

**Symptoms:**
- "Email or password incorrect" error
- Can't access account

**Solutions:**

1. **Reset Password**
   - Click "Forgot Password" on login page
   - Enter email address
   - Check email for reset link (check spam folder)
   - Create new password (8+ chars, 1 uppercase, 1 number, 1 special)

2. **Verify Email Address**
   - Check for typos in email
   - Try alternate email if you have multiple

3. **Account Not Verified**
   - Check inbox for verification email from SyncAI
   - Click verification link
   - Request new verification: support@syncai.com

4. **Account Suspended**
   - Contact billing: billing@syncai.com
   - May be due to failed payment

### Stuck on "Loading..." After Login

**Symptoms:**
- Login successful but dashboard won't load
- Infinite loading spinner

**Solutions:**

1. **Clear Browser Cache**
   ```
   Chrome: Settings → Privacy → Clear browsing data
   Firefox: Settings → Privacy → Clear Data
   Safari: Preferences → Privacy → Manage Website Data
   ```

2. **Disable Browser Extensions**
   - Ad blockers (uBlock, Adblock Plus)
   - Privacy extensions (Privacy Badger, Ghostery)
   - Try incognito mode to test

3. **Check Browser Console**
   - Press F12 (Windows) or Cmd+Option+I (Mac)
   - Look for red errors
   - Send screenshot to support

4. **Try Different Browser**
   - Download Chrome, Firefox, or Edge
   - Test if issue persists

### "Session Expired" Messages

**Symptoms:**
- Logged out unexpectedly
- "Your session has expired" message

**Causes & Solutions:**

- **Inactive for 24+ hours:** Log back in
- **Multiple devices:** Sessions limited to 3 concurrent. Log out old devices.
- **Password changed:** Re-login with new password
- **Account security issue:** Contact support immediately

---

## Asset Management Issues

### Can't Add Assets - CSV Import Fails

**Common CSV Import Errors:**

#### Error: "Invalid asset type"

**Solution:**
- Use exact values from template: `Centrifugal Pump`, not `centrifugal pump` or `Pump`
- Download fresh template: Assets → Import → Download Template
- Check spelling and capitalization

#### Error: "Missing required field"

**Solution:**
- Ensure these columns have values in every row:
  - `name`
  - `type`
  - `location`
  - `criticality`
- Check for empty rows at bottom of CSV

#### Error: "Invalid date format"

**Solution:**
- Use ISO format: `YYYY-MM-DD`
- Correct: `2026-02-23`
- Wrong: `02/23/2026`, `23-Feb-2026`, `2/23/26`
- Delete dates if unsure (optional field)

#### Error: "File too large"

**Solution:**
- CSV limit: 10 MB or 10,000 rows
- Split into smaller files
- Remove unnecessary columns

**Still having issues?**
- Email your CSV to support@syncai.com
- We'll fix and send back within 24 hours

### Assets Not Syncing / Real-time Updates Not Working

**Symptoms:**
- Changes don't appear immediately
- Other users see different data

**Solutions:**

1. **Refresh Page**
   - Press F5 or Ctrl/Cmd + R
   - Should sync within 5 seconds

2. **Check Internet Connection**
   - Open another website to test
   - Try mobile hotspot if office network is flaky

3. **Disable Firewall/VPN**
   - Corporate firewalls may block WebSockets
   - Whitelist: `*.supabase.co` and `*.syncai.com`
   - Contact IT department

4. **Check Status Page**
   - Visit [status.syncai.com](https://status.syncai.com)
   - If "Real-time Syncing" shows degraded, wait for fix

### Health Scores Not Updating

**Symptoms:**
- Asset health score stuck at same number
- No health score displayed

**Causes & Solutions:**

1. **AI Monitoring Not Enabled**
   - Open asset details
   - Toggle "AI Monitoring" to ON
   - Scores appear within 1 hour

2. **Insufficient Data**
   - New assets need 24-48 hours for baseline
   - Add maintenance history to speed up

3. **No Sensor Data**
   - Manual-only assets get basic scoring
   - Connect IoT sensors for real-time scoring

---

## Work Order Issues

### Can't Create Work Order - "Validation Error"

**Common Validation Errors:**

| Error Message | Solution |
|---------------|----------|
| "Title is required" | Add descriptive title |
| "Asset not found" | Select valid asset from dropdown |
| "Invalid priority" | Choose: critical, high, medium, or low |
| "Due date must be future" | Set due date to today or later |
| "Assigned user not found" | Select user from team list or leave blank |

### Work Orders Not Appearing

**Checklist:**

- [ ] Check filters (Status, Priority, Assigned To)
- [ ] Click "Clear Filters" to reset
- [ ] Verify you have correct permissions (Viewer role can't see all work orders)
- [ ] Check if work order was created in different tenant (if multi-tenant)

### Can't Complete Work Order

**Symptoms:**
- "Complete" button greyed out
- Error when marking complete

**Possible Causes:**

1. **Insufficient Permissions**
   - Need: Admin, Manager, or assigned Technician role
   - Solution: Ask admin to adjust permissions

2. **Required Fields Missing**
   - Must fill: Actual hours, Work completed notes
   - Solution: Fill all required completion fields

3. **Status Not "In Progress"**
   - Can only complete from "In Progress" status
   - Solution: Change to "In Progress" first

---

## AI & Predictions Issues

### Not Getting AI Predictions

**Symptoms:**
- AI Analytics dashboard empty
- No AI recommendations

**Solutions:**

1. **Enable AI Monitoring**
   - Go to Assets
   - Open each critical asset
   - Toggle "AI Monitoring" to ON

2. **Wait for Baseline Period**
   - New assets: 24-48 hours for initial analysis
   - Full predictions: 7-14 days

3. **Add More Data**
   - Complete work orders
   - Add maintenance history
   - Connect sensors if available

4. **Check Alert Settings**
   - Settings → Notifications
   - Ensure AI alerts are enabled

### AI Predictions Seem Inaccurate

**If AI is consistently wrong:**

1. **Report Incorrect Predictions**
   - Open prediction
   - Click "Not Helpful" feedback
   - Explain what actually happened
   - Improves AI over time

2. **Verify Asset Data**
   - Ensure asset type is correct
   - Installation date accurate
   - Maintenance history complete

3. **Check For Unique Conditions**
   - Non-standard operating conditions
   - Recent modifications
   - Add notes to asset explaining uniqueness

4. **Contact Support**
   - If accuracy < 60% after 60 days
   - May need custom AI tuning (Enterprise feature)

---

## Performance Issues

### Slow Loading Times

**Symptoms:**
- Pages take > 10 seconds to load
- Laggy interface

**Solutions:**

1. **Check Internet Speed**
   - Visit [fast.com](https://fast.com)
   - Need minimum 5 Mbps
   - Close bandwidth-heavy apps (video streaming, downloads)

2. **Reduce Data**
   - Use pagination (show 25 items vs. 100)
   - Narrow date ranges
   - Apply filters to reduce results

3. **Browser Optimization**
   - Close unused tabs (50+ tabs can slow down)
   - Clear cache (see instructions above)
   - Restart browser

4. **Hardware Issues**
   - Check RAM usage (Task Manager / Activity Monitor)
   - Close other apps
   - Restart computer if RAM > 90% used

5. **Contact Support**
   - If consistently slow from multiple devices
   - Might be account-specific issue

---

## Notification & Alert Issues

### Not Receiving Email Notifications

**Checklist:**

1. **Verify Email Settings**
   - Settings → Notifications → Email
   - Ensure email address is correct
   - Verify alert types are enabled

2. **Check Spam/Junk Folder**
   - Search for "alerts@syncai.com"
   - Mark as "Not Spam"
   - Whitelist domain: `@syncai.com`

3. **Email Delivery Issues**
   - Test by triggering manual alert
   - If not received in 5 minutes, contact support

4. **Quiet Hours Active**
   - Settings → Notifications → Quiet Hours
   - Disable or adjust time window

5. **Email Quota Exceeded**
   - Some corporate email systems have limits
   - Contact IT to whitelist SyncAI

### Not Receiving SMS Alerts (Pro/Enterprise)

**Checklist:**

1. **Verify Phone Number**
   - Settings → Notifications → SMS
   - Ensure number is correct (+1 format for US)
   - Re-verify with code

2. **Check SMS Plan**
   - Pro/Enterprise plans only
   - Verify subscription active

3. **Carrier Delays**
   - SMS can take 1-5 minutes
   - International SMS can take longer

4. **Opt-Out by Mistake**
   - If you replied "STOP" to an SMS, re-enable
   - Contact support to re-activate

---

## Integration Issues

### CMMS Integration Not Syncing

**Common Issues:**

1. **API Key Expired**
   - Re-generate in your CMMS
   - Update in SyncAI: Settings → Integrations

2. **Permission Issues**
   - Verify API key has read/write permissions
   - Check CMMS user role

3. **Rate Limits**
   - Too many API calls
   - Reduce sync frequency
   - Upgrade CMMS API plan

4. **Data Format Mismatch**
   - Field mappings incorrect
   - Re-configure mapping: Settings → Integrations → Edit Mapping

### IoT Sensor Data Not Appearing

**Troubleshooting:**

1. **Verify Connection**
   - Settings → Integrations → IoT Platform
   - Status should be "Connected"

2. **Check Sensor Status**
   - Sensors must be online
   - Check IoT platform directly

3. **Data Format Issues**
   - Ensure sensor sends JSON format
   - Check API documentation

4. **Firewall Blocking**
   - Whitelist SyncAI IP addresses
   - Contact network admin

---

## Mobile & Browser Compatibility

### Mobile Browser Issues

**Symptoms:**
- Layout broken on phone
- Buttons not clickable
- Can't scroll

**Solutions:**

1. **Update Browser**
   - Install latest Chrome, Safari, or Firefox
   - Older browsers not fully supported

2. **Rotate Device**
   - Some features work better in landscape

3. **Use Recommended Browsers**
   - iOS: Safari or Chrome
   - Android: Chrome or Firefox

4. **Clear Mobile Cache**
   - iOS Safari: Settings → Safari → Clear History
   - Android Chrome: Settings → Privacy → Clear Data

5. **Wait for Mobile App**
   - Native iOS/Android app in development
   - [Join beta waitlist →](#)

### Unsupported Browser

**Supported Browsers:**
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Edge 90+
- ✅ Safari 14+

**Not Supported:**
- ❌ Internet Explorer (any version)
- ❌ Older versions of supported browsers

**Solution:**
- Download/update to supported browser

---

## Data & Sync Issues

### Data Disappeared / Lost Data

**Don't Panic - Data is Safe!**

**Common Causes:**

1. **Filters Active**
   - Click "Clear All Filters"
   - Check if data reappears

2. **Wrong Tenant/Account**
   - If multi-tenant: switch tenant (top right)
   - If multiple accounts: verify logged in to correct one

3. **Permissions Changed**
   - Ask admin if permissions were modified
   - You may have lost access to certain data

4. **Accidental Archive**
   - Check "Archived" view
   - Can restore archived items

5. **Actual Data Loss (Rare)**
   - Contact support IMMEDIATELY: support@syncai.com
   - We have backups for 90 days

### Changes Not Saving

**Symptoms:**
- Edit asset, but changes don't stick
- Form resets after saving

**Solutions:**

1. **Check Internet During Save**
   - Must be connected when clicking "Save"
   - Yellow "Offline" badge = changes won't save

2. **Validation Errors**
   - Look for red error messages
   - Fix errors before saving

3. **Permission Issues**
   - Viewer role can't edit
   - Ask admin for write permissions

4. **Browser Console Errors**
   - Press F12, check for errors
   - Screenshot and send to support

---

## Billing & Payment Issues

### Payment Failed / Card Declined

**Immediate Steps:**

1. **Update Payment Method**
   - Settings → Billing → Payment Methods
   - Add new card
   - Set as default

2. **Common Reasons Cards Fail:**
   - Expired card
   - Insufficient funds
   - Card issuer blocking international charges (SyncAI processes in US)
   - Wrong CVV or billing ZIP

3. **Contact Bank**
   - Authorize charge from "SyncAI" or "Stripe"
   - Some banks block recurring charges

4. **Alternative Payment**
   - Try different card
   - ACH/Wire transfer (Enterprise)

5. **Grace Period**
   - 14 days to fix before suspension
   - Update payment ASAP

### Charged Wrong Amount

**Steps:**

1. **Review Invoice**
   - Settings → Billing → Invoice History
   - Check for add-ons, overages, prorated charges

2. **Understand Charges:**
   - Mid-cycle upgrade = prorated charges
   - User overage = $50/user/month
   - API overages = $0.01/call over limit

3. **Still Wrong?**
   - Email billing@syncai.com with:
     - Invoice number
     - Expected amount
     - Actual amount
   - Response within 24 hours

---

## Error Messages & Codes

### Common Error Messages

| Error Code | Meaning | Solution |
|------------|---------|----------|
| `AUTH_001` | Authentication failed | Re-login |
| `PERM_002` | Permission denied | Contact admin for access |
| `VAL_003` | Validation error | Check form fields |
| `NOT_FOUND_404` | Resource not found | Check ID/URL |
| `RATE_LIMIT_429` | Too many requests | Wait 1 minute, try again |
| `SERVER_500` | Server error | Retry in 5 minutes or contact support |
| `SYNC_ERROR` | Realtime sync issue | Refresh page |

### "Something Went Wrong" Generic Error

**Steps:**

1. **Refresh Page** (Ctrl/Cmd + R)
2. **Try again in 5 minutes**
3. **Clear cache**
4. **If persists:**
   - Screenshot error
   - Note what you were doing
   - Contact support with details

---

## Still Need Help?

### Before Contacting Support

**Gather This Info:**

- [ ] What were you trying to do?
- [ ] What happened instead?
- [ ] Error messages (screenshot)
- [ ] Browser & version (e.g., Chrome 121)
- [ ] Operating system (Windows 11, macOS, etc.)
- [ ] When did it start?
- [ ] Does it happen every time or intermittently?

### Contact Support

**Email:** support@syncai.com  
**Live Chat:** Click chat icon (bottom right)  
**Phone:** 1-800-SYNCAI-1 (Pro/Enterprise, Mon-Fri 9 AM - 5 PM ET)

**Response Times:**
- Free: 48 hours
- Professional: 4 hours
- Enterprise: 1 hour (critical issues: 15 minutes)

---

**Related Articles:**
- [Getting Started](01-getting-started.md)
- [Account Settings](#)
- [Browser Requirements](#)
- [API Error Codes](07-api-access.md)

**Tags:** troubleshooting, errors, issues, problems, help, support, bugs, fixes
