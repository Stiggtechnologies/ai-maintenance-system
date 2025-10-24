# 🎯 Access Guide - Microsoft Copilot-Style Features

## How to Use All the New Features

All Microsoft Copilot-style RAG and training features are accessible through:
1. **Supabase Database** (direct SQL/API access)
2. **Edge Functions** (serverless endpoints)
3. **React Components** (UI integration)

---

## 📋 Quick Reference

### **Core Features Available:**
✅ Document Upload & Processing (RAG)
✅ Hybrid Search (Vector + BM25)  
✅ Data Connectors (SharePoint, SAP, etc.)
✅ GraphRAG (Entity extraction)
✅ Tool Calling (with approval)
✅ Safety Checks (RAI)
✅ Canary Deployments
✅ Cost Budgets
✅ Fine-Tuning Workflows

---

## 1️⃣ **Upload & Process Documents**

### **Via JavaScript/TypeScript:**
```typescript
import { supabase } from './lib/supabase';

// Step 1: Upload document
const { data: doc } = await supabase
  .from('knowledge_base_documents')
  .insert({
    tenant_id: 'your-tenant-uuid',
    document_type: 'manual',
    title: 'Pump Maintenance Manual',
    content: 'Your document text here...',
    category: 'Maintenance'
  })
  .select()
  .single();

// Step 2: Process (chunk + embed)
const response = await fetch(
  `${SUPABASE_URL}/functions/v1/rag-document-processor/process`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      document_id: doc.id,
      tenant_id: 'your-tenant-uuid'
    })
  }
);

const result = await response.json();
console.log(`Created ${result.chunks_created} chunks`);
```

### **Via SQL (Direct):**
```sql
-- Insert document
INSERT INTO knowledge_base_documents (
  tenant_id, document_type, title, content
) VALUES (
  'tenant-uuid',
  'manual',
  'Pump Maintenance Manual',
  'Document content...'
);

-- Check processing status
SELECT id, title, processing_status, chunk_count
FROM knowledge_base_documents
WHERE tenant_id = 'your-tenant-uuid';
```

---

## 2️⃣ **Search Knowledge Base**

### **Hybrid Search (Vector + BM25):**
```typescript
// Semantic search via Edge Function
const response = await fetch(
  `${SUPABASE_URL}/functions/v1/rag-semantic-search`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: 'How often should I lubricate bearings?',
      tenant_id: 'your-tenant-uuid',
      match_threshold: 0.7,
      match_count: 5
    })
  }
);

const { results } = await response.json();
results.forEach(r => {
  console.log(`${r.document_title}: ${r.content}`);
  console.log(`Similarity: ${(r.similarity * 100).toFixed(1)}%`);
});
```

### **Direct SQL (Hybrid Function):**
```sql
-- Use hybrid search function
SELECT * FROM hybrid_search(
  query_text := 'pump bearing lubrication',
  query_embedding := '[...]'::vector(1536),
  target_tenant_id := 'your-tenant-uuid',
  match_count := 10
);
```

---

## 3️⃣ **Data Connectors**

### **Add SharePoint Connector:**
```typescript
const { data: source } = await supabase
  .from('data_sources')
  .insert({
    tenant_id: 'your-tenant-uuid',
    source_type: 'sharepoint',
    name: 'Engineering Docs',
    config: {
      site_url: 'https://company.sharepoint.com/sites/eng',
      library: 'Documents'
    },
    enabled: true
  })
  .select()
  .single();
```

### **Trigger Sync:**
```typescript
const { data: job } = await supabase
  .from('sync_jobs')
  .insert({
    source_id: source.id,
    tenant_id: 'your-tenant-uuid',
    job_type: 'delta'
  })
  .select()
  .single();

// Monitor progress
const { data: status } = await supabase
  .from('sync_jobs')
  .select('status, new_items, updated_items')
  .eq('id', job.id)
  .single();
```

---

## 4️⃣ **GraphRAG Entities**

### **Create Entities:**
```typescript
await supabase.from('graph_entities').insert({
  tenant_id: 'your-tenant-uuid',
  entity_type: 'asset',
  entity_name: 'Pump-101',
  properties: { model: 'XYZ-500', location: 'Plant-A' }
});
```

### **Create Relationships:**
```typescript
await supabase.from('graph_relationships').insert({
  tenant_id: 'your-tenant-uuid',
  from_entity_id: pump_id,
  to_entity_id: failure_mode_id,
  relationship_type: 'susceptible_to',
  confidence_score: 0.85
});
```

### **Query Graph:**
```sql
SELECT
  e1.entity_name as asset,
  r.relationship_type,
  e2.entity_name as related
FROM graph_relationships r
JOIN graph_entities e1 ON e1.id = r.from_entity_id
JOIN graph_entities e2 ON e2.id = r.to_entity_id
WHERE e1.tenant_id = 'your-tenant-uuid';
```

---

## 5️⃣ **Tool Calling**

### **Define a Tool:**
```typescript
await supabase.from('tool_definitions').insert({
  tool_name: 'create_work_order',
  tool_type: 'write',
  description: 'Create work order in CMMS',
  parameters_schema: {
    type: 'object',
    properties: {
      asset_id: { type: 'string' },
      priority: { type: 'string' }
    }
  },
  risk_level: 'high',
  requires_approval: true,
  handler_function: 'create-wo-handler'
});
```

### **Execute Tool:**
```typescript
const { data: exec } = await supabase
  .from('tool_executions')
  .insert({
    tenant_id: 'your-tenant-uuid',
    tool_id: tool_id,
    user_id: user_id,
    input_params: { asset_id: 'a123', priority: 'high' },
    status: 'pending_approval'
  })
  .select()
  .single();
```

---

## 6️⃣ **Safety Checks**

### **Run Safety Check:**
```typescript
await supabase.from('safety_checks').insert({
  tenant_id: 'your-tenant-uuid',
  conversation_id: conv_id,
  check_type: 'pii_detection',
  passed: true,
  action: 'allow'
});
```

### **View Safety Metrics:**
```sql
SELECT
  check_type,
  COUNT(*) as total,
  COUNT(CASE WHEN passed THEN 1 END) as passed,
  (COUNT(CASE WHEN passed THEN 1 END)::FLOAT / COUNT(*) * 100) as pass_rate
FROM safety_checks
WHERE tenant_id = 'your-tenant-uuid'
GROUP BY check_type;
```

---

## 7️⃣ **Canary Deployments**

### **Deploy Model at 10%:**
```typescript
await supabase.from('model_deployments').insert({
  tenant_id: 'your-tenant-uuid',
  model_id: ft_model_id,
  deployment_type: 'canary',
  traffic_percentage: 10,
  status: 'active'
});
```

### **Monitor & Scale:**
```typescript
const { data: metrics } = await supabase
  .from('model_deployments')
  .select('avg_rating, total_requests')
  .eq('id', deployment_id)
  .single();

if (metrics.avg_rating > 4.0) {
  // Scale to 50%
  await supabase
    .from('model_deployments')
    .update({ traffic_percentage: 50 })
    .eq('id', deployment_id);
}
```

---

## 8️⃣ **Cost Budgets**

### **Set Budget:**
```typescript
await supabase.from('cost_budgets').insert({
  tenant_id: 'your-tenant-uuid',
  period_type: 'monthly',
  period_start: '2025-11-01',
  period_end: '2025-11-30',
  max_total_tokens: 10000000,
  max_cost_usd: 500.00,
  enforce_hard_limit: true
});
```

### **Check Budget:**
```sql
SELECT
  used_total_tokens,
  max_total_tokens,
  (used_total_tokens::FLOAT / max_total_tokens * 100) as pct_used,
  status
FROM cost_budgets
WHERE tenant_id = 'your-tenant-uuid'
  AND status = 'active';
```

---

## 9️⃣ **Fine-Tuning**

### **Collect Training Data:**
```sql
-- Get high-quality conversations
SELECT * FROM get_fine_tuning_pairs(
  min_rating := 4,
  limit_count := 1000
);
```

### **Register Model:**
```typescript
await supabase.from('ft_models').insert({
  tenant_id: 'your-tenant-uuid',
  model_name: 'Maintenance QA v1',
  model_ref: 'ft:gpt-4o-mini:org:model:id',
  base_model: 'gpt-4o-mini',
  fine_tuning_method: 'lora'
});
```

---

## 🔟 **Dashboard Queries**

### **RAG Performance:**
```sql
-- Avg retrieval time
SELECT AVG(retrieval_time_ms) FROM rag_search_logs
WHERE created_at > now() - interval '7 days';

-- Most retrieved docs
SELECT d.title, COUNT(*) as count
FROM knowledge_base_chunks c
JOIN knowledge_base_documents d ON d.id = c.document_id
WHERE c.retrieval_count > 0
GROUP BY d.title
ORDER BY count DESC
LIMIT 10;
```

### **Cost Analysis:**
```sql
SELECT
  agent_type,
  SUM(total_tokens) as tokens,
  SUM(total_tokens * 0.00001) as cost_usd
FROM agent_conversations
WHERE created_at > now() - interval '30 days'
GROUP BY agent_type;
```

---

## 📱 **Edge Function Endpoints**

| Endpoint | Purpose |
|----------|---------|
| `/rag-document-processor/process` | Process document |
| `/rag-semantic-search` | Search knowledge base |
| `/ai-agent-processor` | AI responses |

### **Usage:**
```bash
# Process document
curl -X POST https://your-project.supabase.co/functions/v1/rag-document-processor/process \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"document_id":"doc-uuid","tenant_id":"tenant-uuid"}'

# Search
curl -X POST https://your-project.supabase.co/functions/v1/rag-semantic-search \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{"query":"pump maintenance","tenant_id":"tenant-uuid"}'
```

---

## 🎨 **React Component Example**

```typescript
// src/components/RAGSearch.tsx
import { useState } from 'react';

export function RAGSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  const search = async () => {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rag-semantic-search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query,
          tenant_id: 'your-tenant-uuid',
          match_count: 5
        })
      }
    );
    const data = await res.json();
    setResults(data.results);
  };

  return (
    <div>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <button onClick={search}>Search</button>
      {results.map(r => (
        <div key={r.chunk_id}>
          <h3>{r.document_title}</h3>
          <p>{r.content}</p>
        </div>
      ))}
    </div>
  );
}
```

---

## 🔑 **Authentication Context**

All features require authentication. Get tenant_id from user profile:

```typescript
// Get current user's tenant
const { data: { user } } = await supabase.auth.getUser();
const { data: profile } = await supabase
  .from('user_profiles')
  .select('tenant_id')
  .eq('id', user.id)
  .single();

const tenant_id = profile.tenant_id;
```

---

## 🎯 **Quick Start Checklist**

1. ✅ Upload first document → `knowledge_base_documents` table
2. ✅ Process document → Call `/rag-document-processor/process`
3. ✅ Test search → Call `/rag-semantic-search`
4. ✅ Set budget → Insert into `cost_budgets`
5. ✅ Add connector → Insert into `data_sources`
6. ✅ Define tools → Insert into `tool_definitions`
7. ✅ Enable safety → Insert into `safety_checks`
8. ✅ Deploy model → Insert into `model_deployments`

---

## 📚 **Full Documentation**

- **RAG Training Guide:** `RAG-TRAINING-GUIDE.md`
- **Microsoft Features:** `MICROSOFT-COPILOT-FEATURES.md`
- **Billing:** `BILLING-IMPLEMENTATION.md`

---

## 🆘 **Troubleshooting**

**No search results?**
- Check `processing_status = 'completed'`
- Verify embeddings exist
- Lower `match_threshold`

**Budget exceeded?**
- Check `cost_budgets` table
- Increase limits or disable `enforce_hard_limit`

**Processing failed?**
- Check Edge Function logs in Supabase
- Verify OpenAI API key

---

**All features are accessible via Supabase database, Edge Functions, or direct SQL!** 🚀
