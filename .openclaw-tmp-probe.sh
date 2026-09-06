#!/bin/bash
TOKEN=*** find-generic-password -s "Supabase CLI" -w 2>/dev/null | sed 's/^go-keyring-base64://' | base64 -d)
echo "=== marketplace functions deployed? ==="
curl -s "https://api.supabase.com/v1/projects/pjvoswbwomesuwhygpby/functions" -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys; d=json.load(sys.stdin); print([f['slug'] for f in d if 'market' in f['slug']])"
echo "=== marketplace tables in prod? ==="
curl -s -X POST "https://api.supabase.com/v1/projects/pjvoswbwomesuwhygpby/database/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"query\":\"select table_name from information_schema.tables where table_schema='public' and table_name like 'marketplace%'\"}" | python3 -m json.tool | head -20
