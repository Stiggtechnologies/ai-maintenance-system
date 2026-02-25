# Security & Compliance

**Last Updated:** February 23, 2026  
**Reading Time:** 7 minutes  
**Difficulty:** Intermediate

---

## Overview

SyncAI is built with enterprise-grade security and compliance in mind. This document outlines our security practices, certifications, and compliance standards.

---

## Data Security

### Encryption

**Data in Transit:**
- **TLS 1.3** encryption for all connections
- 256-bit AES encryption
- HTTPS only (HTTP automatically redirects)
- Certificate pinning on mobile apps

**Data at Rest:**
- **AES-256** encryption for all stored data
- Encrypted database backups
- Encrypted file storage (attachments, photos)
- Encryption keys managed by AWS KMS

**End-to-End Encryption:**
- Available for Enterprise customers
- Customer-managed encryption keys (CMEK)
- Zero-knowledge architecture option

### Infrastructure Security

**Hosting:**
- **AWS** (Amazon Web Services)
- Multi-region redundancy (US, EU available)
- SOC 2 Type II certified data centers
- ISO 27001 certified infrastructure

**Network Security:**
- Web Application Firewall (WAF)
- DDoS protection (AWS Shield)
- Rate limiting
- Intrusion detection systems (IDS)
- 24/7 security monitoring

**Database Security:**
- **Supabase** managed PostgreSQL
- Row-level security (RLS)
- Encrypted connections only
- Automated backups (retained 90 days)
- Point-in-time recovery

### Access Controls

**Authentication:**
- Secure password hashing (bcrypt, 12 rounds)
- Multi-factor authentication (MFA) available
- Single Sign-On (SSO) - Enterprise
  - SAML 2.0
  - OAuth 2.0 (Google, Microsoft)
  - LDAP/Active Directory integration
- Session management (24-hour timeout)
- Device tracking and management

**Authorization:**
- Role-based access control (RBAC)
- Granular permissions
- Audit logs for all access
- IP whitelisting (Enterprise)
- API key permissions

**User Roles:**
1. **Admin:** Full system access
2. **Manager:** View all, edit assigned
3. **Technician:** Execute work orders, update status
4. **Viewer:** Read-only access
5. **API Manager:** API key management
6. **Custom Roles:** Enterprise only

---

## Compliance & Certifications

### Current Certifications

**SOC 2 Type II** 🏆
- **Audit Period:** Annual
- **Last Audit:** December 2025
- **Next Audit:** December 2026
- **Scope:** Security, Availability, Confidentiality
- [View SOC 2 Report](#) (requires NDA)

**ISO 27001:2022** 🏆
- **Certification:** Information Security Management
- **Certified:** January 2026
- **Next Audit:** January 2027
- [View Certificate](#)

**ISO 55000** 🏆
- **Certification:** Asset Management
- **Aligned:** System designed to ISO 55000 standards
- Helps customers achieve their own ISO 55000 compliance

**GDPR Compliant** 🇪🇺
- **EU Data Protection Regulation**
- Data Processing Agreements (DPA) available
- EU data residency option (Frankfurt region)
- Right to erasure ("right to be forgotten")
- Data portability

**CCPA Compliant** 🇺🇸
- **California Consumer Privacy Act**
- "Do Not Sell My Personal Information" honored
- Consumer data request process
- Privacy policy compliant

**HIPAA Ready** 🏥 *(Enterprise)*
- Business Associate Agreement (BAA) available
- PHI-compliant hosting
- Audit logging
- Access controls

### Industry Standards

**Supported Compliance Frameworks:**

**Oil & Gas:**
- API (American Petroleum Institute)
- OSHA Process Safety Management
- EPA regulations

**Manufacturing:**
- OSHA safety standards
- ISO 9001 (Quality Management)
- ISO 14001 (Environmental)

**Power & Utilities:**
- NERC CIP (Critical Infrastructure Protection)
- FERC regulations
- Nuclear Regulatory Commission (NRC)

**Aerospace:**
- FAA regulations
- AS9100 (Aviation Quality)

**General:**
- NIST Cybersecurity Framework
- CIS Controls
- PCI DSS (if processing payments via integrations)

---

## Data Privacy

### What Data We Collect

**Account Information:**
- Email address
- Full name
- Company name
- Phone number (optional)
- Billing information

**Usage Data:**
- Login times and IP addresses
- Feature usage analytics
- Performance metrics
- Error logs

**Asset & Maintenance Data:**
- Equipment details
- Work orders
- Sensor data (if integrated)
- Photos and attachments
- AI predictions

**We DO NOT Collect:**
- Payment card numbers (handled by Stripe)
- Personally identifiable information beyond what's needed
- Data from outside our platform (no third-party tracking)

### How We Use Your Data

✅ **We Use Data To:**
- Provide the SyncAI service
- Generate AI predictions
- Improve product features
- Provide customer support
- Send service notifications
- Comply with legal requirements

❌ **We DO NOT:**
- Sell your data to third parties
- Use your data to train AI for other customers
- Share data with advertisers
- Access your data without permission (except support cases)

### Data Ownership

**You Own Your Data:**
- All asset, work order, and maintenance data is yours
- You can export anytime
- You can delete anytime
- We're only the processor, you're the controller

### Data Retention

**Active Accounts:**
- Data retained indefinitely while account active
- Backups retained 90 days

**Cancelled Accounts:**
- Data retained 90 days after cancellation
- Soft delete (can be recovered)
- Hard delete after 90 days (permanent)

**Legal Holds:**
- Data may be retained longer if required by law
- Customer notification provided

**Data Deletion Requests:**
- Email privacy@syncai.com
- Completed within 30 days
- Confirmation email sent

---

## Security Features

### Multi-Factor Authentication (MFA)

**Enable MFA:**
1. Settings → Security → Two-Factor Authentication
2. Scan QR code with authenticator app:
   - Google Authenticator
   - Authy
   - 1Password
   - Microsoft Authenticator
3. Enter 6-digit code to verify
4. Save backup codes (for account recovery)

**Enforce MFA (Admins):**
- Settings → Team → Security Policies
- Toggle "Require MFA for all users"
- Grace period: 7 days

### Single Sign-On (SSO) *(Enterprise)*

**Supported Providers:**
- Google Workspace
- Microsoft Azure AD / Entra ID
- Okta
- OneLogin
- Auth0
- Custom SAML 2.0

**Setup:**
1. Settings → Security → SSO
2. Choose provider
3. Enter SSO configuration
4. Test connection
5. Enable for organization

**Just-in-Time (JIT) Provisioning:**
- Automatically create user accounts on first SSO login
- Sync role assignments from IdP

### Audit Logs

**All actions logged:**
- User logins/logouts
- Data changes (create, update, delete)
- Permission changes
- Settings modifications
- API calls
- Failed login attempts

**View Audit Logs:**
- Settings → Security → Audit Logs
- Filter by user, date, action type
- Export to CSV

**Retention:**
- 2 years (Professional)
- 7 years (Enterprise)

### IP Whitelisting *(Enterprise)*

**Restrict access to specific IPs:**
1. Settings → Security → IP Whitelist
2. Add allowed IP addresses or ranges
3. Example: `203.0.113.0/24`
4. Save

**Bypass for Specific Users:**
- Allow CEO to login from anywhere
- Configure per-user in Team settings

### Session Management

**Session Controls:**
- **Timeout:** 24 hours of inactivity
- **Concurrent Sessions:** Max 3 devices
- **Session Hijacking Protection:** Fingerprinting and anomaly detection

**Force Logout All Sessions:**
- Settings → Security → "Logout All Devices"
- Useful if device stolen or suspicious activity

---

## Vulnerability Management

### Security Testing

**Internal Testing:**
- Automated vulnerability scanning (daily)
- Penetration testing (quarterly)
- Code security reviews
- Dependency scanning

**External Testing:**
- Third-party penetration tests (annual)
- Bug bounty program (launching Q2 2026)

### Responsible Disclosure

**Found a Security Issue?**

**DO:**
- Email security@syncai.com immediately
- Include detailed report with reproduction steps
- Allow 90 days for fix before public disclosure

**DON'T:**
- Publicly disclose before we've fixed
- Access customer data
- Attempt denial-of-service

**Rewards:**
- Bug bounty program (launching soon)
- Hall of fame recognition
- Swag for critical findings

### Incident Response

**In Case of Security Breach:**
1. **Immediate:** Contain and mitigate (within 1 hour)
2. **Within 24 hours:** Notify affected customers
3. **Within 72 hours:** Notify regulators (if required by law)
4. **Within 7 days:** Public disclosure with mitigation steps
5. **Within 30 days:** Post-mortem report

**Past Incidents:**
- No security breaches to date (as of Feb 2026)

---

## Data Backup & Recovery

### Backup Strategy

**Automated Backups:**
- **Frequency:** Every 6 hours
- **Retention:** 90 days
- **Encryption:** AES-256
- **Location:** Multi-region (US-East, US-West)
- **Testing:** Monthly restore tests

**Point-in-Time Recovery:**
- Restore to any point in last 90 days
- Granular recovery (specific assets, work orders)
- Enterprise: 1-year retention

### Disaster Recovery

**RPO (Recovery Point Objective):** 6 hours  
**RTO (Recovery Time Objective):** 4 hours

**Disaster Scenarios:**
- Data center failure → Automatic failover to backup region
- Database corruption → Restore from backup
- Ransomware → Immutable backups prevent encryption
- Accidental deletion → Point-in-time restore

**Annual DR Testing:**
- Full failover simulation
- Results shared with Enterprise customers

---

## Third-Party Security

### Subprocessors

We use trusted third-party services:

| Service | Purpose | Location | Compliance |
|---------|---------|----------|------------|
| **AWS** | Hosting | US / EU | SOC 2, ISO 27001, GDPR |
| **Supabase** | Database | US / EU | SOC 2, GDPR |
| **Stripe** | Payments | US | PCI DSS Level 1 |
| **SendGrid** | Email | US | SOC 2, GDPR |
| **Intercom** | Support Chat | US / EU | GDPR, ISO 27001 |

[View full subprocessor list →](#)

### Vendor Risk Management

**Before adding vendor:**
- Security questionnaire
- SOC 2 / ISO 27001 verification
- Data Processing Agreement (DPA)
- Regular audits

---

## Customer Security Best Practices

### ✅ Recommended Practices

**Account Security:**
- [ ] Enable MFA for all users
- [ ] Use strong, unique passwords (password manager recommended)
- [ ] Review team access quarterly
- [ ] Remove inactive users
- [ ] Monitor audit logs monthly

**Data Protection:**
- [ ] Limit data access to need-to-know basis
- [ ] Don't share login credentials
- [ ] Use API keys (not passwords) for integrations
- [ ] Rotate API keys every 90 days
- [ ] Encrypt backups if you export data

**Operational:**
- [ ] Train team on phishing awareness
- [ ] Use company email addresses (not personal)
- [ ] Enable email verification for new users
- [ ] Set up SSO if available (Enterprise)
- [ ] Regular security awareness training

### 🔴 Security Red Flags

Contact security@syncai.com immediately if:
- Unauthorized login attempts
- Unknown devices in session list
- Unexplained data changes
- Suspicious emails claiming to be from SyncAI
- Request for password via email (we never ask)

---

## Regulatory Compliance Support

### GDPR Compliance

**Data Subject Rights:**
- **Right to access:** Export your data anytime
- **Right to rectification:** Edit your data
- **Right to erasure:** Delete your account
- **Right to data portability:** Export in machine-readable format
- **Right to object:** Opt-out of marketing emails

**Exercise Rights:**
- Email privacy@syncai.com
- Response within 30 days

**Data Processing Agreement (DPA):**
- Available for all EU customers
- Request: legal@syncai.com

### CCPA Compliance

**California Consumer Rights:**
- **Know:** What personal data we collect
- **Delete:** Request deletion of data
- **Opt-out:** "Do Not Sell My Info" (we don't sell data)
- **Non-discrimination:** Equal service regardless of privacy choices

**Exercise Rights:**
- Email privacy@syncai.com
- Verify identity for security

---

## Security Questionnaires

### Enterprise Customer Security Review

**Documents Available:**
- SOC 2 Type II report
- ISO 27001 certificate
- Penetration test summary
- Security architecture diagram
- Disaster recovery plan
- Incident response plan
- Data Processing Agreement (DPA)
- Business Associate Agreement (BAA)

**Request:** security@syncai.com

**Custom Questionnaires:**
- We respond to security questionnaires within 5 business days
- Enterprise customers: dedicated security contact

---

## Frequently Asked Questions

**Q: Where is my data stored?**  
A: Default: US (AWS us-east-1). EU option available (Frankfurt, de-central-1).

**Q: Can SyncAI employees access my data?**  
A: Only for support purposes with your consent. Access is logged and audited.

**Q: What happens if SyncAI gets acquired?**  
A: Data remains yours. We'll notify 90 days before any ownership change. You can export and leave.

**Q: How do I export all my data?**  
A: Settings → Account → Export Data. Delivered as JSON files within 24 hours.

**Q: Is SyncAI HIPAA compliant?**  
A: Yes, with Business Associate Agreement (BAA). Enterprise only. Contact sales.

**Q: Do you have a bug bounty program?**  
A: Launching Q2 2026. Email security@syncai.com to join early access.

**Q: What if I suspect a security issue?**  
A: Email security@syncai.com immediately. Do not post publicly.

---

## Contact Security Team

**General Questions:** security@syncai.com  
**Privacy Requests:** privacy@syncai.com  
**Incident Reporting:** security@syncai.com (24/7)  
**Legal/Compliance:** legal@syncai.com  

**Response Time:**
- Security incidents: Immediate (24/7)
- Security questions: 1 business day
- Privacy requests: 30 days (as required by law)

---

**Related Articles:**
- [Getting Started](01-getting-started.md)
- [Account Settings](#)
- [Team Management](#)
- [API Security](07-api-access.md)

**Tags:** security, compliance, gdpr, privacy, encryption, soc2, iso27001, hipaa, audit, mfa
