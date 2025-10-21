# Production Readiness Checklist

## ✅ Already Complete

### Authentication & Security
- [x] Supabase Auth configured with email/password
- [x] Row Level Security (RLS) enabled on all tables
- [x] Role-based access control (admin, manager, operator, viewer)
- [x] User profiles with preferences
- [x] Secure session management

### Database
- [x] PostgreSQL database with proper schema
- [x] Foreign key constraints
- [x] Indexes on frequently queried columns
- [x] Database migrations in version control
- [x] Triggers for auto-approval logic

### Core Features
- [x] Autonomous monitoring system
- [x] AI-powered decision making
- [x] Human-in-the-loop approval workflow
- [x] Work order generation
- [x] Alert system
- [x] Audit logging

## 🔧 Critical Production Tasks

### 1. Environment Variables & Secrets ⚠️ HIGH PRIORITY

**Current Issue**: OpenAI API key is exposed in `.env` file

**Actions Required**:
```bash
# Remove API key from .env
# Add to .gitignore
echo "*.env" >> .gitignore
echo ".env.local" >> .gitignore
```

**Set secrets in Supabase Dashboard**:
1. Go to Project Settings → Edge Functions → Secrets
2. Add `OPENAI_API_KEY` as a secret
3. Remove from client-side code

**Update Edge Functions**:
```typescript
// In edge functions, use Deno.env.get() which reads from secrets
const openaiKey = Deno.env.get('OPENAI_API_KEY');
```

**Client-side changes**:
- Remove OpenAI key from client code
- All AI calls should go through edge functions only
- Edge functions act as secure proxy

### 2. Error Handling & Monitoring

**Add Global Error Boundary**:
```tsx
// src/components/ErrorBoundary.tsx
import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('Error caught by boundary:', error, errorInfo);
    // Log to monitoring service (e.g., Sentry)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              Something went wrong
            </h1>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

**Add Sentry or LogRocket** (Optional but recommended):
```bash
npm install @sentry/react
```

### 3. Rate Limiting

**Add rate limiting to Edge Functions**:
```typescript
// Create rate limiter helper
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string, maxRequests = 100, windowMs = 60000): boolean {
  const now = Date.now();
  const userLimit = rateLimits.get(userId);

  if (!userLimit || now > userLimit.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (userLimit.count >= maxRequests) {
    return false;
  }

  userLimit.count++;
  return true;
}
```

**Add to Supabase Edge Functions**:
```typescript
// In autonomous-orchestrator/index.ts
const userId = req.headers.get('x-user-id') || 'anonymous';

if (!checkRateLimit(userId, 50, 60000)) {
  return new Response(
    JSON.stringify({ error: 'Rate limit exceeded' }),
    { status: 429, headers: corsHeaders }
  );
}
```

### 4. Database Optimization

**Add connection pooling** (Already handled by Supabase):
- Default connection pooler is enabled
- Use connection string with `:6543` port for pooling

**Additional indexes needed**:
```sql
-- Add composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_decisions_status_created
  ON autonomous_decisions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_resolved_severity
  ON system_alerts(resolved, severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_asset_recorded
  ON asset_health_monitoring(asset_id, recorded_at DESC);
```

**Query optimization**:
- Use `.select('*')` sparingly - select only needed columns
- Add pagination for large result sets
- Use `.limit()` on all queries

### 5. Caching Strategy

**Add Redis/Upstash for caching** (Optional):
```typescript
// Cache frequently accessed data
const CACHE_TTL = 300; // 5 minutes

async function getCachedMetrics() {
  // Check cache first
  const cached = await redis.get('metrics:latest');
  if (cached) return JSON.parse(cached);

  // Fetch from DB
  const { data } = await supabase
    .from('maintenance_metrics')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single();

  // Store in cache
  await redis.setex('metrics:latest', CACHE_TTL, JSON.stringify(data));

  return data;
}
```

### 6. Security Headers

**Add to `vite.config.ts`**:
```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
    }
  }
});
```

**Add `_headers` file for Netlify/Vercel**:
```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  X-XSS-Protection: 1; mode=block
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://dguwgnxjdivsrekjarlp.supabase.co https://api.openai.com;
```

### 7. Performance Optimization

**Code splitting**:
```typescript
// Lazy load heavy components
import { lazy, Suspense } from 'react';

const AutonomousDashboard = lazy(() => import('./components/AutonomousDashboard'));
const AIAnalyticsDashboard = lazy(() => import('./components/AIAnalyticsDashboard'));

// Wrap with Suspense
<Suspense fallback={<LoadingSpinner />}>
  <AutonomousDashboard />
</Suspense>
```

**Image optimization**:
- Use WebP format
- Add lazy loading
- Implement responsive images

**Bundle size**:
```bash
# Analyze bundle
npm run build
npx vite-bundle-visualizer
```

### 8. Monitoring & Observability

**Add health check endpoint**:
```typescript
// Create health-check edge function
Deno.serve(async (req) => {
  try {
    // Check database connection
    const { error } = await supabase
      .from('assets')
      .select('id')
      .limit(1);

    if (error) throw error;

    return new Response(
      JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          database: 'up',
          auth: 'up',
          functions: 'up'
        }
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: 'unhealthy',
        error: error.message
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
```

**Add uptime monitoring**:
- Use UptimeRobot (free)
- Ping health check every 5 minutes
- Set up alerts for downtime

**Application monitoring**:
- Supabase has built-in logs
- View in Dashboard → Logs → Edge Function Logs
- Set up log alerts for errors

### 9. Backup Strategy

**Database backups** (Automatic in Supabase Pro):
- Daily automated backups
- 7-day retention on Free plan
- 30-day retention on Pro plan

**Manual backup**:
```bash
# Export database
npx supabase db dump > backup.sql

# Export specific table
npx supabase db dump --data-only -t autonomous_decisions > decisions_backup.sql
```

**Backup strategy**:
1. Automated daily backups (Supabase handles)
2. Weekly manual exports to S3/cloud storage
3. Point-in-time recovery (Pro plan)

### 10. User Onboarding

**Add first-time user experience**:
```typescript
// Check if first login
const isFirstLogin = !profile?.preferences?.onboarding_complete;

if (isFirstLogin) {
  // Show onboarding modal
  setShowOnboarding(true);
}
```

**Create onboarding component**:
- Welcome message
- Quick tour of features
- Role explanation
- Autonomous system overview

### 11. Documentation

**User documentation**:
- Create user guide in app
- Add tooltips and help icons
- Create video tutorials

**Admin documentation**:
- Deployment guide
- Environment setup
- Troubleshooting guide

### 12. Testing

**Add basic tests**:
```bash
npm install --save-dev vitest @testing-library/react
```

**Test critical flows**:
- Authentication
- Autonomous decision approval
- Alert creation
- Work order generation

### 13. Compliance & Legal

**Privacy Policy**:
- Add privacy policy page
- GDPR compliance (if EU users)
- Data retention policy

**Terms of Service**:
- Define usage terms
- Liability disclaimers

**Data handling**:
- User data export
- Account deletion
- Data anonymization

## 📋 Pre-Launch Checklist

### Week Before Launch

- [ ] Remove all console.logs from production code
- [ ] Test all user flows (happy path + error cases)
- [ ] Verify all environment variables
- [ ] Test on multiple browsers (Chrome, Firefox, Safari, Edge)
- [ ] Test on mobile devices
- [ ] Run security audit
- [ ] Test database backups and restore
- [ ] Load test the autonomous system
- [ ] Verify email notifications work
- [ ] Set up monitoring and alerts

### Launch Day

- [ ] Final database backup
- [ ] Deploy to production
- [ ] Verify all edge functions deployed
- [ ] Test production environment
- [ ] Monitor error logs
- [ ] Check performance metrics
- [ ] Verify autonomous monitoring is running

### Post-Launch (First Week)

- [ ] Daily health checks
- [ ] Monitor user feedback
- [ ] Track error rates
- [ ] Review autonomous system performance
- [ ] Check database growth rate
- [ ] Optimize based on real usage

## 🚀 Deployment Options

### Option 1: Vercel (Recommended)
```bash
npm install -g vercel
vercel --prod
```

**Pros**:
- Zero config
- Automatic HTTPS
- Edge functions support
- Free for small projects

### Option 2: Netlify
```bash
npm install -g netlify-cli
netlify deploy --prod
```

**Pros**:
- Great DX
- Split testing
- Forms and functions

### Option 3: Self-hosted (Docker)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "preview"]
```

## 🔒 Security Audit Checklist

- [ ] No secrets in code or .env files in git
- [ ] RLS policies tested and verified
- [ ] SQL injection prevention (using parameterized queries)
- [ ] XSS prevention (React handles by default)
- [ ] CSRF protection (Supabase handles)
- [ ] Rate limiting on all endpoints
- [ ] Input validation on all forms
- [ ] File upload validation (type, size)
- [ ] Authentication token expiration
- [ ] Secure password requirements (min 6 chars)

## 📊 Performance Targets

- **First Contentful Paint**: < 1.5s
- **Time to Interactive**: < 3.5s
- **Lighthouse Score**: > 90
- **Database query time**: < 100ms (p95)
- **Edge function cold start**: < 500ms
- **Autonomous monitoring cycle**: 5 minutes
- **API response time**: < 200ms (p95)

## 💰 Cost Estimation (Monthly)

### Supabase
- **Free Tier**: $0 (Up to 500MB database, 2GB bandwidth)
- **Pro**: $25 (8GB database, 50GB bandwidth, daily backups)

### Vercel/Netlify
- **Free**: $0 (100GB bandwidth)
- **Pro**: $20 (1TB bandwidth)

### OpenAI API
- **Estimated**: $20-50/month (depends on usage)
- GPT-4: $0.03/1K tokens
- Whisper: $0.006/minute

### Total: $0-100/month depending on tier and usage

## 🎯 Success Metrics

Track these KPIs:
- User adoption rate
- Autonomous decision accuracy
- Human approval rate
- System uptime (target: 99.9%)
- Average response time
- Error rate (target: < 0.1%)
- User satisfaction score

---

**Next Steps**: Start with security tasks (remove API keys), then add monitoring, then optimize performance.
