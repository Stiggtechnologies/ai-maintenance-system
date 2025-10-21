# Deployment Guide - SyncAI Pro

## Pre-Deployment Checklist

- [ ] All tests passing
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] Edge functions deployed
- [ ] Health check endpoint verified
- [ ] Security headers configured
- [ ] Build process tested locally

## Environment Variables

### Required Variables

```bash
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key

# OpenAI (set in Supabase Edge Function secrets, NOT in frontend env)
OPENAI_API_KEY=your_openai_key
```

## Deployment Options

### Option 1: Vercel (Recommended) ⚡

**Why Vercel:**
- Zero configuration
- Automatic HTTPS
- Edge network globally
- Free for most use cases
- Great DX

**Steps:**

1. **Install Vercel CLI**
```bash
npm install -g vercel
```

2. **Login**
```bash
vercel login
```

3. **Deploy**
```bash
vercel --prod
```

4. **Set Environment Variables**
```bash
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
```

5. **Redeploy**
```bash
vercel --prod
```

**Cost:** Free for hobby projects, $20/month for Pro

---

### Option 2: Netlify 🌐

**Why Netlify:**
- Simple deployment
- Great for static sites
- Built-in forms
- Free tier generous

**Steps:**

1. **Install Netlify CLI**
```bash
npm install -g netlify-cli
```

2. **Login**
```bash
netlify login
```

3. **Initialize**
```bash
netlify init
```

4. **Deploy**
```bash
netlify deploy --prod
```

5. **Set Environment Variables**
- Go to Site Settings → Environment Variables
- Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

**Cost:** Free for most projects, $19/month for Pro

---

### Option 3: Docker (Self-Hosted) 🐳

**Why Docker:**
- Full control
- Run anywhere
- Cost-effective at scale
- Custom infrastructure

**Steps:**

1. **Build Image**
```bash
docker build -t syncai-pro .
```

2. **Run Container**
```bash
docker run -d \
  -p 80:80 \
  -e VITE_SUPABASE_URL=your_url \
  -e VITE_SUPABASE_ANON_KEY=your_key \
  --name syncai-pro \
  syncai-pro
```

3. **With Docker Compose**

Create `docker-compose.yml`:
```yaml
version: '3.8'
services:
  web:
    build: .
    ports:
      - "80:80"
    environment:
      - VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
      - VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
    restart: unless-stopped
```

Deploy:
```bash
docker-compose up -d
```

**Cost:** Infrastructure costs (e.g., DigitalOcean: $5-20/month)

---

### Option 4: AWS (Enterprise) ☁️

**Why AWS:**
- Enterprise-grade
- Highly scalable
- Advanced features
- Compliance certifications

**Steps:**

1. **S3 + CloudFront**
```bash
# Build
npm run build

# Upload to S3
aws s3 sync dist/ s3://your-bucket --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id YOUR_ID --paths "/*"
```

2. **Or use Amplify**
```bash
npm install -g @aws-amplify/cli
amplify init
amplify publish
```

**Cost:** Pay-as-you-go (typically $10-50/month for small apps)

---

## Post-Deployment Steps

### 1. Configure Supabase Edge Function Secrets

**CRITICAL:** Move OpenAI API key from frontend to backend

1. Go to Supabase Dashboard
2. Navigate to: Project Settings → Edge Functions → Secrets
3. Add secret:
   - Key: `OPENAI_API_KEY`
   - Value: Your OpenAI API key

4. Remove `VITE_OPENAI_API_KEY` from frontend environment variables

### 2. Verify Health Check

```bash
curl https://your-domain.com/health

# Or for edge function
curl https://your-project.supabase.co/functions/v1/health-check
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-21T19:00:00.000Z",
  "checks": {
    "database": { "status": "healthy", "responseTime": 45 },
    "auth": { "status": "healthy", "responseTime": 32 },
    "autonomous_system": { "status": "healthy", "responseTime": 67 }
  }
}
```

### 3. Set Up Monitoring

**UptimeRobot (Free):**
1. Go to uptimerobot.com
2. Add new monitor
3. Monitor Type: HTTP(s)
4. URL: `https://your-domain.com/health` or edge function health check
5. Monitoring Interval: 5 minutes
6. Alert contacts: Your email

**Sentry (Optional - Error Tracking):**
```bash
npm install @sentry/react @sentry/vite-plugin
```

Add to `main.tsx`:
```typescript
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "your_sentry_dsn",
  environment: "production",
  tracesSampleRate: 0.1,
});
```

### 4. Configure Custom Domain

**Vercel:**
```bash
vercel domains add yourdomain.com
```

**Netlify:**
- Go to Domain Settings
- Add custom domain
- Update DNS records

### 5. Enable HTTPS

Most platforms handle this automatically:
- Vercel: Automatic
- Netlify: Automatic
- AWS CloudFront: Configure ACM certificate
- Docker: Use Let's Encrypt with nginx

### 6. Database Backups

**Automatic (Supabase):**
- Free tier: Daily backups, 7-day retention
- Pro tier: Daily backups, 30-day retention
- Point-in-time recovery (Pro only)

**Manual Backups:**
```bash
# Export entire database
npx supabase db dump > backup-$(date +%Y%m%d).sql

# Export specific tables
npx supabase db dump --data-only -t autonomous_decisions > decisions-backup.sql

# Schedule with cron (Linux/Mac)
0 2 * * * /path/to/backup-script.sh
```

## Performance Optimization

### 1. CDN Configuration

- Vercel/Netlify: Automatic edge caching
- CloudFront: Configure cache behaviors
- Custom: Use Cloudflare (free tier available)

### 2. Image Optimization

```bash
# Install optimization tools
npm install sharp

# Optimize images before upload
npx sharp input.png -o output.webp --webp
```

### 3. Database Query Optimization

Run this in Supabase SQL Editor:
```sql
-- Check slow queries
SELECT * FROM get_table_stats();

-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM autonomous_decisions WHERE status = 'pending';
```

### 4. Edge Function Cold Starts

Keep functions warm with scheduled pings:
```bash
# Add to cron or GitHub Actions
*/5 * * * * curl https://your-project.supabase.co/functions/v1/autonomous-orchestrator
```

## Security Checklist

- [ ] HTTPS enabled
- [ ] Security headers configured
- [ ] API keys not in frontend code
- [ ] RLS policies tested
- [ ] Rate limiting configured (if needed)
- [ ] CORS properly configured
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention verified
- [ ] Authentication working correctly
- [ ] File upload restrictions in place

## Monitoring Metrics

Track these in your monitoring dashboard:

- **Uptime:** Target 99.9%
- **Response Time:** P95 < 500ms
- **Error Rate:** < 0.1%
- **Database Connections:** < 80% of limit
- **Edge Function Executions:** Monitor quota
- **Storage Usage:** Monitor growth rate

## Rollback Plan

### Vercel
```bash
vercel rollback
```

### Netlify
- Go to Deploys
- Click "Published" on previous deploy

### Docker
```bash
docker tag syncai-pro:latest syncai-pro:backup
# Deploy new version
# If issues:
docker stop syncai-pro
docker run -d --name syncai-pro syncai-pro:backup
```

### Database
```bash
# Restore from backup
psql -h db.your-project.supabase.co -U postgres -d postgres < backup.sql
```

## Scaling Considerations

### Traffic Growth

**< 1000 users:**
- Free/Hobby tier sufficient
- Supabase Free tier
- Single region deployment

**1000-10,000 users:**
- Pro tier hosting ($20-50/month)
- Supabase Pro ($25/month)
- CDN for static assets
- Database connection pooling

**10,000+ users:**
- Enterprise solutions
- Multi-region deployment
- Redis caching layer
- Read replicas
- Load balancing

### Database Scaling

1. **Vertical Scaling (Supabase):**
   - Upgrade to larger instance
   - More CPU/RAM

2. **Horizontal Scaling:**
   - Read replicas for queries
   - Separate analytics database
   - Archive old data

3. **Query Optimization:**
   - Use indexed queries
   - Implement pagination
   - Cache frequent queries

## Troubleshooting

### Build Fails

```bash
# Clear cache
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Environment Variables Not Working

- Verify variable names start with `VITE_`
- Check platform-specific env var format
- Rebuild after changing env vars
- Check browser console for undefined variables

### Database Connection Issues

- Verify Supabase URL and key
- Check RLS policies
- Verify user permissions
- Check connection limits

### Edge Functions Not Working

- Check function logs in Supabase
- Verify CORS headers
- Check rate limits
- Verify secrets are set

## Support

- **Documentation:** See README.md and PRODUCTION-CHECKLIST.md
- **Supabase Support:** support.supabase.com
- **Hosting Support:** Check your platform's docs
- **Database Issues:** Check Supabase logs

## Success Metrics

After 1 week in production:

- [ ] Zero critical errors
- [ ] > 99% uptime
- [ ] Average response time < 500ms
- [ ] User feedback positive
- [ ] Autonomous system functioning
- [ ] No security incidents
- [ ] Database performance good

---

**Last Updated:** October 2025
**Version:** 1.0.0
