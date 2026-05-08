# 🗺️ Feature Access Map

## Where to Find Everything

---

## 📊 **Database Tables (Supabase Studio)**

Access via: `https://supabase.com/dashboard` → Your Project → Table Editor

### **RAG & Documents**
| Table | What It Does | Access Method |
|-------|--------------|---------------|
| `knowledge_base_documents` | Source documents | Insert/Select |
| `knowledge_base_chunks` | Chunked text + embeddings | Auto-created by processor |
| `embeddings` | Vector embeddings | Auto-created |
| `rag_search_logs` | Search analytics | Auto-logged |

### **Conversations & Feedback**
| Table | What It Does | Access Method |
|-------|--------------|---------------|
| `agent_conversations` | All AI chats | Auto-logged |
| `agent_feedback` | User ratings | Insert ratings |

### **Connectors (NEW)**
| Table | What It Does | Access Method |
|-------|--------------|---------------|
| `data_sources` | Connector configs | Insert connectors |
| `sync_jobs` | Sync status | Trigger syncs |

### **GraphRAG (NEW)**
| Table | What It Does | Access Method |
|-------|--------------|---------------|
| `graph_entities` | Entities | Insert/query entities |
| `graph_relationships` | Entity links | Create relationships |

### **Tools (NEW)**
| Table | What It Does | Access Method |
|-------|--------------|---------------|
| `tool_definitions` | Available tools | Define tools |
| `tool_executions` | Tool calls | Execute with approval |

### **Safety (NEW)**
| Table | What It Does | Access Method |
|-------|--------------|---------------|
| `safety_checks` | RAI audits | Auto-logged |

### **Deployments (NEW)**
| Table | What It Does | Access Method |
|-------|--------------|---------------|
| `model_deployments` | Canary deploys | Deploy models |
| `ft_models` | Fine-tuned models | Register models |

### **Governance (NEW)**
| Table | What It Does | Access Method |
|-------|--------------|---------------|
| `cost_budgets` | Token limits | Set budgets |

---

## 🔌 **Edge Functions (API Endpoints)**

Access via: `https://your-project.supabase.co/functions/v1/FUNCTION_NAME`

### **RAG Functions**
```bash
# Process document
POST /rag-document-processor/process
Body: { document_id, tenant_id }

# Semantic search
POST /rag-semantic-search
Body: { query, tenant_id, match_count }

# Check status
GET /rag-document-processor/status/:document_id
```

### **AI Functions**
```bash
# Get AI response
POST /ai-agent-processor
Body: { agentType, query, openaiKey }
```

### **Other Functions**
```bash
POST /billing-api
POST /stripe-checkout
POST /autonomous-orchestrator
```

---

## 💻 **SQL Functions (Database)**

Access via: Supabase SQL Editor or `supabase.rpc()`

### **Search Functions**
```sql
-- Hybrid search (Vector + BM25)
SELECT * FROM hybrid_search(
  query_text := 'your search',
  query_embedding := '[...]'::vector,
  target_tenant_id := 'uuid',
  match_count := 10
);

-- Pure vector search
SELECT * FROM search_knowledge_base(
  query_embedding := '[...]'::vector,
  query_text := 'search',
  match_threshold := 0.7,
  match_count := 10,
  target_tenant_id := 'uuid'
);
```

### **Training Functions**
```sql
-- Get fine-tuning data
SELECT * FROM get_fine_tuning_pairs(
  min_rating := 4,
  limit_count := 1000
);
```

### **Governance Functions**
```sql
-- Check budget
SELECT check_cost_budget(
  target_tenant_id := 'uuid',
  prompt_tokens := 500,
  completion_tokens := 200,
  estimated_cost := 0.05
);
```

---

## 🎨 **React Components (Frontend)**

Located in: `src/components/`

### **Existing Dashboards**
- `ExecutiveDashboard.tsx` - 29 KOIs
- `StrategicDashboard.tsx` - Strategic KPIs
- `TacticalDashboard.tsx` - Tactical metrics
- `OperationalDashboard.tsx` - Operations
- `AutonomousDashboard.tsx` - Autonomous monitoring

### **Billing Components**
- `billing/BillingOverview.tsx`
- `billing/PlansAndPricing.tsx`
- `billing/UsageDashboard.tsx`
- `billing/InvoiceList.tsx`
- `billing/GainShareConsole.tsx`

### **AI Components**
- `UnifiedChatInterface.tsx` - AI assistant
- `AIAnalyticsDashboard.tsx` - AI metrics

### **Core Components**
- `AssetManagement.tsx` - Asset tracking
- `WorkOrderManagement.tsx` - Work orders
- `AuthForm.tsx` - Authentication

---

## 📝 **How to Access Each Feature**

### **1. Upload & Search Documents**

**Step 1: Go to Supabase Studio**
- Open Table Editor
- Select `knowledge_base_documents`
- Click "Insert row"
- Fill: `tenant_id`, `title`, `content`, `document_type`
- Save

**Step 2: Process Document**
```bash
curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/rag-document-processor/process \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"document_id":"YOUR-DOC-ID","tenant_id":"YOUR-TENANT-ID"}'
```

**Step 3: Search**
```bash
curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/rag-semantic-search \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"How to maintain pumps?","tenant_id":"YOUR-TENANT-ID"}'
```

---

### **2. Set Up Data Connector**

**In Supabase Table Editor:**
1. Go to `data_sources` table
2. Insert row:
   - `tenant_id`: your UUID
   - `source_type`: 'sharepoint'
   - `name`: 'My SharePoint'
   - `config`: `{"site_url":"https://...","library":"Documents"}`
   - `enabled`: true
3. Save

**Trigger Sync:**
1. Go to `sync_jobs` table
2. Insert row:
   - `source_id`: your data source ID
   - `tenant_id`: your UUID
   - `job_type`: 'delta'
   - `status`: 'pending'
3. Save (sync will process automatically)

---

### **3. Query Knowledge Graph**

**In Supabase SQL Editor:**
```sql
-- View all entities
SELECT * FROM graph_entities
WHERE tenant_id = 'YOUR-TENANT-ID'
ORDER BY mention_count DESC;

-- View relationships
SELECT
  e1.entity_name as from_entity,
  r.relationship_type,
  e2.entity_name as to_entity
FROM graph_relationships r
JOIN graph_entities e1 ON e1.id = r.from_entity_id
JOIN graph_entities e2 ON e2.id = r.to_entity_id
WHERE r.tenant_id = 'YOUR-TENANT-ID';
```

---

### **4. View Cost Budgets**

**In Supabase Table Editor:**
1. Open `cost_budgets` table
2. Filter by your `tenant_id`
3. See usage:
   - `used_total_tokens` vs `max_total_tokens`
   - `used_cost_usd` vs `max_cost_usd`
   - `status` (active/exceeded)

**Set New Budget:**
1. Click "Insert row"
2. Fill:
   - `tenant_id`: your UUID
   - `period_type`: 'monthly'
   - `period_start`: '2025-11-01'
   - `period_end`: '2025-11-30'
   - `max_total_tokens`: 10000000
   - `max_cost_usd`: 500.00
3. Save

---

### **5. Monitor Safety Checks**

**In Supabase SQL Editor:**
```sql
-- Safety metrics
SELECT
  check_type,
  COUNT(*) as total_checks,
  COUNT(CASE WHEN passed THEN 1 END) as passed_count,
  ROUND(COUNT(CASE WHEN passed THEN 1 END)::NUMERIC / COUNT(*) * 100, 1) as pass_rate
FROM safety_checks
WHERE tenant_id = 'YOUR-TENANT-ID'
  AND created_at > now() - interval '7 days'
GROUP BY check_type;
```

---

### **6. Deploy Canary Model**

**In Supabase Table Editor:**
1. Open `model_deployments` table
2. Insert row:
   - `tenant_id`: your UUID
   - `model_id`: your fine-tuned model ID
   - `deployment_type`: 'canary'
   - `traffic_percentage`: 10
   - `status`: 'active'
3. Save

**Monitor Performance:**
```sql
SELECT
  deployment_type,
  traffic_percentage,
  total_requests,
  avg_rating,
  status
FROM model_deployments
WHERE tenant_id = 'YOUR-TENANT-ID'
ORDER BY deployed_at DESC;
```

---

### **7. View RAG Analytics**

**In Supabase SQL Editor:**
```sql
-- Search performance
SELECT
  DATE(created_at) as date,
  COUNT(*) as searches,
  AVG(retrieval_time_ms) as avg_time_ms,
  AVG(num_results) as avg_results
FROM rag_search_logs
WHERE tenant_id = 'YOUR-TENANT-ID'
GROUP BY DATE(created_at)
ORDER BY date DESC
LIMIT 30;

-- Most searched topics
SELECT
  query_text,
  COUNT(*) as search_count
FROM rag_search_logs
WHERE tenant_id = 'YOUR-TENANT-ID'
GROUP BY query_text
ORDER BY search_count DESC
LIMIT 20;
```

---

### **8. Export Fine-Tuning Data**

**In Supabase SQL Editor:**
```sql
-- Get training examples
SELECT
  system_prompt,
  user_message,
  assistant_message,
  quality_score
FROM fine_tuning_datasets
WHERE tenant_id = 'YOUR-TENANT-ID'
  AND quality_score >= 0.8
ORDER BY quality_score DESC;
```

**Export to JSONL:**
1. Run query in SQL Editor
2. Click "Export" → CSV
3. Convert to JSONL format for OpenAI

---

## 🔐 **Authentication Required**

All features require:
1. User must be logged in (`auth.users`)
2. User profile in `user_profiles` table
3. `tenant_id` for multi-tenancy

**Get tenant_id:**
```typescript
const { data: { user } } = await supabase.auth.getUser();
const { data: profile } = await supabase
  .from('user_profiles')
  .select('tenant_id')
  .eq('id', user.id)
  .single();

const tenant_id = profile.tenant_id;
```

---

## 🎯 **Quick Access Checklist**

### **Via Supabase Studio:**
- ✅ Insert documents → `knowledge_base_documents`
- ✅ View chunks → `knowledge_base_chunks`
- ✅ Add connectors → `data_sources`
- ✅ Check budgets → `cost_budgets`
- ✅ View entities → `graph_entities`
- ✅ Monitor safety → `safety_checks`
- ✅ Track deployments → `model_deployments`

### **Via Edge Functions:**
- ✅ Process docs → `/rag-document-processor/process`
- ✅ Search → `/rag-semantic-search`
- ✅ AI responses → `/ai-agent-processor`

### **Via SQL Editor:**
- ✅ Hybrid search → `SELECT * FROM hybrid_search(...)`
- ✅ Fine-tuning data → `SELECT * FROM get_fine_tuning_pairs(...)`
- ✅ Analytics queries → Custom SQL

### **Via React App:**
- ✅ View dashboards → Navigate UI
- ✅ Chat with AI → UnifiedChatInterface
- ✅ Manage assets → AssetManagement
- ✅ Billing → Billing components

---

## 📞 **Support Resources**

- **Supabase Docs:** https://supabase.com/docs
- **SQL Reference:** https://www.postgresql.org/docs/
- **OpenAI API:** https://platform.openai.com/docs

---

**Everything is accessible! Choose your preferred method: Database UI, API calls, SQL queries, or React components.** 🚀
