# API Access

**Last Updated:** February 23, 2026  
**Reading Time:** 10 minutes  
**Difficulty:** Advanced (Developers)

---

## Overview

SyncAI provides a comprehensive REST API for programmatic access to assets, work orders, AI predictions, and analytics. Available on Professional and Enterprise plans.

---

## Getting Started

### Prerequisites

- **Plan:** Professional or Enterprise
- **Role:** Admin or API Manager
- **Tools:** API client (Postman, curl, or code)

### Generate API Key

1. **Settings → API → Create New Key**
2. **Name your key:** e.g., "Production Integration"
3. **Set permissions:**
   - Read Assets
   - Write Assets
   - Read Work Orders
   - Write Work Orders
   - Read AI Predictions
   - Read Analytics
4. **Click "Generate"**
5. **Copy API key immediately** (shown only once)

```
API Key: sk_live_abc123def456ghi789jkl012mno345
```

⚠️ **Important:** Store securely. Cannot be retrieved later.

### Test API Connection

```bash
curl https://api.syncai.com/v1/assets \
  -H "Authorization: Bearer sk_live_abc123..." \
  -H "Content-Type: application/json"
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [...],
  "meta": {
    "total": 47,
    "page": 1,
    "per_page": 25
  }
}
```

---

## API Reference

### Base URL

```
https://api.syncai.com/v1
```

### Authentication

Include API key in Authorization header:

```
Authorization: Bearer YOUR_API_KEY
```

### Rate Limits

| Plan | Requests/Hour | Burst |
|------|---------------|-------|
| **Professional** | 1,000 | 50/min |
| **Enterprise** | 10,000 | 200/min |

**Headers:**
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1709000400
```

---

## Endpoints

### Assets

#### List Assets

```http
GET /v1/assets
```

**Query Parameters:**
- `page` (int): Page number (default: 1)
- `per_page` (int): Results per page (max: 100)
- `status` (string): Filter by status (operational, maintenance, standby, decommissioned)
- `criticality` (string): Filter by criticality (critical, high, medium, low)
- `location` (string): Filter by location
- `search` (string): Search asset names

**Example:**
```bash
curl "https://api.syncai.com/v1/assets?status=operational&criticality=critical&per_page=10" \
  -H "Authorization: Bearer sk_live_abc123..."
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "ast_1a2b3c4d",
      "name": "Crude Oil Pump P-101",
      "type": "Centrifugal Pump",
      "status": "operational",
      "criticality": "critical",
      "location": "Offshore Platform Alpha - Sector A",
      "manufacturer": "Flowserve",
      "model": "HPX-500",
      "serial_number": "FSV-2019-4521",
      "installation_date": "2019-03-15",
      "health_score": 78,
      "operating_hours": 42150,
      "ai_monitoring_enabled": true,
      "created_at": "2026-01-10T08:30:00Z",
      "updated_at": "2026-02-23T14:22:00Z"
    }
  ],
  "meta": {
    "total": 47,
    "page": 1,
    "per_page": 10,
    "total_pages": 5
  }
}
```

#### Get Asset

```http
GET /v1/assets/{asset_id}
```

**Example:**
```bash
curl "https://api.syncai.com/v1/assets/ast_1a2b3c4d" \
  -H "Authorization: Bearer sk_live_abc123..."
```

#### Create Asset

```http
POST /v1/assets
```

**Body:**
```json
{
  "name": "New Pump P-105",
  "type": "Centrifugal Pump",
  "location": "Platform Alpha - Sector C",
  "criticality": "high",
  "status": "operational",
  "manufacturer": "Sulzer",
  "model": "CPT-350",
  "serial_number": "SLZ-2026-9876",
  "installation_date": "2026-02-20",
  "ai_monitoring_enabled": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ast_9z8y7x6w",
    "name": "New Pump P-105",
    ...
  }
}
```

#### Update Asset

```http
PATCH /v1/assets/{asset_id}
```

**Body:**
```json
{
  "status": "maintenance",
  "health_score": 65,
  "notes": "Scheduled for bearing replacement"
}
```

#### Delete Asset

```http
DELETE /v1/assets/{asset_id}
```

⚠️ **Warning:** Deletes asset and all related work orders. Consider archiving instead.

---

### Work Orders

#### List Work Orders

```http
GET /v1/work-orders
```

**Query Parameters:**
- `status` (string): pending, in_progress, completed, blocked
- `priority` (string): critical, high, medium, low
- `asset_id` (string): Filter by asset
- `assigned_to` (string): Filter by technician
- `due_before` (date): Due before date (ISO 8601)
- `created_after` (date): Created after date

**Example:**
```bash
curl "https://api.syncai.com/v1/work-orders?status=in_progress&priority=critical" \
  -H "Authorization: Bearer sk_live_abc123..."
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "wo_5e4d3c2b",
      "number": "WO-2026-001",
      "title": "Replace Compressor C-201 Valves",
      "asset_id": "ast_2b3c4d5e",
      "asset_name": "Gas Compressor C-201",
      "status": "in_progress",
      "priority": "critical",
      "type": "corrective",
      "assigned_to": "Mike Patterson",
      "assigned_to_email": "mike@acmeoil.com",
      "due_date": "2026-02-25",
      "estimated_hours": 32,
      "actual_hours": 18,
      "estimated_cost": 45000,
      "completion_percentage": 55,
      "created_by": "AI Agent - Reliability Engineering",
      "created_at": "2026-02-18T09:15:00Z",
      "updated_at": "2026-02-23T10:30:00Z"
    }
  ],
  "meta": {...}
}
```

#### Create Work Order

```http
POST /v1/work-orders
```

**Body:**
```json
{
  "title": "Inspect Heat Exchanger HX-601",
  "asset_id": "ast_3c4d5e6f",
  "priority": "medium",
  "type": "preventive",
  "assigned_to_email": "sarah@acmeoil.com",
  "due_date": "2026-03-15",
  "estimated_hours": 16,
  "estimated_cost": 8500,
  "description": "Routine inspection per maintenance schedule",
  "parts_required": [
    "Gasket set (P/N: ALV-G-2200)"
  ]
}
```

#### Update Work Order

```http
PATCH /v1/work-orders/{work_order_id}
```

**Example: Update Status**
```json
{
  "status": "completed",
  "actual_hours": 15.5,
  "actual_cost": 7800,
  "completion_notes": "Inspection complete. No issues found. Next inspection in 6 months."
}
```

---

### AI Predictions

#### List AI Predictions

```http
GET /v1/ai/predictions
```

**Query Parameters:**
- `asset_id` (string): Filter by asset
- `agent` (string): Filter by agent type
- `confidence_min` (float): Minimum confidence (0-1)
- `impact` (string): critical, high, medium, low
- `created_after` (date): Predictions after date

**Example:**
```bash
curl "https://api.syncai.com/v1/ai/predictions?confidence_min=0.8&impact=high" \
  -H "Authorization: Bearer sk_live_abc123..."
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "pred_7f8g9h0i",
      "agent": "Reliability Engineering Agent",
      "asset_id": "ast_1a2b3c4d",
      "asset_name": "Crude Oil Pump P-101",
      "prediction_type": "failure_risk",
      "confidence": 0.92,
      "impact": "critical",
      "risk_percentage": 68,
      "timeframe_days": 30,
      "recommendation": "Schedule bearing inspection within 2 weeks",
      "reasoning": "Vibration analysis shows bearing wear pattern...",
      "supporting_data": {
        "vibration_rms": 5.8,
        "vibration_baseline": 2.1,
        "temperature_c": 78,
        "operating_hours": 42150,
        "similar_failures": 3
      },
      "work_order_id": "wo_9i0j1k2l",
      "acknowledged": false,
      "created_at": "2026-02-23T09:15:00Z"
    }
  ],
  "meta": {...}
}
```

#### Get Prediction Details

```http
GET /v1/ai/predictions/{prediction_id}
```

#### Acknowledge Prediction

```http
POST /v1/ai/predictions/{prediction_id}/acknowledge
```

---

### Analytics

#### Get Dashboard Metrics

```http
GET /v1/analytics/dashboard
```

**Response:**
```json
{
  "success": true,
  "data": {
    "kpis": {
      "total_assets": 47,
      "operational_assets": 45,
      "active_work_orders": 15,
      "critical_alerts": 3,
      "overall_equipment_effectiveness": 87.3,
      "mean_time_between_failures": 2340,
      "mean_time_to_repair": 6.8,
      "maintenance_cost_mtd": 287500,
      "ai_prediction_accuracy": 84.2
    },
    "trends": {
      "asset_health_trend": "improving",
      "work_order_completion_rate": 0.92,
      "cost_trend": "under_budget"
    },
    "period": "2026-02",
    "generated_at": "2026-02-23T15:00:00Z"
  }
}
```

#### Get Asset Health Report

```http
GET /v1/analytics/asset-health
```

**Query Parameters:**
- `asset_id` (string): Specific asset
- `period` (string): day, week, month, year

---

## SDKs & Libraries

### Official SDKs

**Python:**
```bash
pip install syncai-python
```

```python
from syncai import SyncAI

client = SyncAI(api_key="sk_live_abc123...")

# List assets
assets = client.assets.list(status="operational")

# Create work order
work_order = client.work_orders.create(
    title="Inspect Pump P-101",
    asset_id="ast_1a2b3c4d",
    priority="high"
)

# Get AI predictions
predictions = client.ai.predictions.list(confidence_min=0.8)
```

**JavaScript/TypeScript:**
```bash
npm install @syncai/sdk
```

```javascript
import { SyncAI } from '@syncai/sdk';

const client = new SyncAI({
  apiKey: 'sk_live_abc123...'
});

// List assets
const assets = await client.assets.list({
  status: 'operational'
});

// Create work order
const workOrder = await client.workOrders.create({
  title: 'Inspect Pump P-101',
  assetId: 'ast_1a2b3c4d',
  priority: 'high'
});
```

**More SDKs:**
- Ruby: `gem install syncai`
- PHP: `composer require syncai/syncai-php`
- Go: `go get github.com/syncai/syncai-go`
- Java: Maven/Gradle available

[View SDK Documentation →](#)

---

## Webhooks

### Setting Up Webhooks

Receive real-time notifications when events occur.

**Settings → API → Webhooks → Add Endpoint**

**Endpoint URL:** `https://your-app.com/webhooks/syncai`

**Events to Subscribe:**
- `asset.created`
- `asset.updated`
- `asset.deleted`
- `work_order.created`
- `work_order.status_changed`
- `work_order.completed`
- `ai.prediction_created`
- `ai.critical_alert`

### Webhook Payload

```json
{
  "id": "evt_1a2b3c4d",
  "type": "ai.prediction_created",
  "created_at": "2026-02-23T09:15:00Z",
  "data": {
    "object": "prediction",
    "id": "pred_7f8g9h0i",
    "agent": "Reliability Engineering Agent",
    "asset_id": "ast_1a2b3c4d",
    "confidence": 0.92,
    "impact": "critical",
    ...
  }
}
```

### Webhook Security

Verify webhook signatures:

```python
import hmac
import hashlib

def verify_webhook(payload, signature, secret):
    computed = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(computed, signature)

# In your webhook handler:
signature = request.headers['X-SyncAI-Signature']
is_valid = verify_webhook(request.body, signature, webhook_secret)
```

---

## Error Handling

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (invalid API key) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 429 | Rate Limit Exceeded |
| 500 | Internal Server Error |
| 503 | Service Unavailable (maintenance) |

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Asset name is required",
    "details": {
      "field": "name",
      "issue": "missing_required_field"
    }
  }
}
```

### Common Error Codes

- `authentication_failed` - Invalid API key
- `permission_denied` - Insufficient permissions
- `validation_error` - Invalid request data
- `not_found` - Resource doesn't exist
- `rate_limit_exceeded` - Too many requests
- `server_error` - Internal error (contact support)

---

## Best Practices

### Security

✅ **DO:**
- Store API keys securely (environment variables, secret managers)
- Use different keys for dev/staging/production
- Rotate keys regularly (every 90 days)
- Use minimum required permissions
- Verify webhook signatures

❌ **DON'T:**
- Commit API keys to version control
- Share API keys via email or chat
- Use same key across multiple apps
- Give full permissions when read-only needed

### Performance

✅ **DO:**
- Use pagination for large datasets
- Implement exponential backoff for retries
- Cache responses when appropriate
- Use webhooks instead of polling
- Compress requests (gzip)

❌ **DON'T:**
- Fetch all records without pagination
- Retry immediately on rate limit
- Poll API every second
- Make unnecessary duplicate requests

### Error Handling

```python
import time
import requests

def api_request_with_retry(url, headers, max_retries=3):
    for attempt in range(max_retries):
        try:
            response = requests.get(url, headers=headers)
            
            if response.status_code == 429:
                # Rate limited - exponential backoff
                wait_time = 2 ** attempt
                time.sleep(wait_time)
                continue
            
            response.raise_for_status()
            return response.json()
            
        except requests.RequestException as e:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)
    
    raise Exception("Max retries exceeded")
```

---

## Code Examples

### Sync Assets from CMMS

```python
import syncai
import requests

# Your existing CMMS API
cmms_assets = requests.get("https://cmms.acmeoil.com/api/assets").json()

# SyncAI client
client = syncai.SyncAI(api_key="sk_live_abc123...")

# Sync assets
for asset in cmms_assets:
    try:
        client.assets.create(
            name=asset['name'],
            type=asset['equipment_type'],
            location=asset['site_location'],
            criticality=asset['criticality_level'].lower(),
            serial_number=asset['serial'],
            manufacturer=asset['vendor']
        )
        print(f"✓ Synced: {asset['name']}")
    except syncai.APIError as e:
        print(f"✗ Failed: {asset['name']} - {e}")
```

### Auto-Create Work Orders from AI

```javascript
const { SyncAI } = require('@syncai/sdk');

const client = new SyncAI({ apiKey: process.env.SYNCAI_API_KEY });

async function createWorkOrdersFromAI() {
  // Get high-confidence predictions
  const predictions = await client.ai.predictions.list({
    confidenceMin: 0.85,
    impact: ['critical', 'high'],
    acknowledged: false
  });

  for (const pred of predictions.data) {
    // Create work order
    const workOrder = await client.workOrders.create({
      title: `${pred.recommendation}`,
      assetId: pred.assetId,
      priority: pred.impact,
      type: 'predictive',
      description: `AI Prediction: ${pred.reasoning}`,
      estimatedCost: pred.estimatedCost || 0
    });

    // Acknowledge prediction
    await client.ai.predictions.acknowledge(pred.id);

    console.log(`Created WO-${workOrder.number} for ${pred.assetName}`);
  }
}

// Run every hour
setInterval(createWorkOrdersFromAI, 3600000);
```

---

## API Limits

### Request Limits

| Plan | Requests/Hour | Burst | Storage |
|------|---------------|-------|---------|
| **Professional** | 1,000 | 50/min | 100 GB |
| **Enterprise** | 10,000 | 200/min | Unlimited |

### Data Limits

- **Max payload size:** 10 MB
- **Max results per page:** 100
- **Webhook timeout:** 30 seconds
- **API key lifetime:** No expiration (rotate manually)

---

## Support & Resources

**API Documentation:**
📚 [https://docs.syncai.com/api](https://docs.syncai.com/api)

**Interactive API Explorer:**
🔧 [https://api.syncai.com/explorer](https://api.syncai.com/explorer)

**Status Page:**
📊 [https://status.syncai.com](https://status.syncai.com)

**Developer Community:**
💬 [https://community.syncai.com/developers](https://community.syncai.com/developers)

**Support:**
- 📧 api-support@syncai.com
- 💬 Live Chat → "API" topic

---

**Related Articles:**
- [Getting Started](01-getting-started.md)
- [Webhooks Guide](#)
- [SDK Documentation](#)
- [API Migration Guide](#)

**Tags:** api, developers, integration, webhooks, rest-api, sdk, automation
