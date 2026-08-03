#!/usr/bin/env bash
set -uo pipefail

log_file="${1:-/tmp/supabase-start.log}"
diagnostic_file="${2:-/tmp/supabase-diagnostics.txt}"

set +e
supabase start --debug 2>&1 | tee "$log_file"
start_status=${PIPESTATUS[0]}
set -e

if [ "$start_status" -eq 0 ]; then
  exit 0
fi

{
  echo "Supabase local startup failed with status ${start_status}"
  echo
  echo "===== Supabase debug output (last 500 lines) ====="
  tail -n 500 "$log_file" || true
  echo
  echo "===== Relevant Supabase startup errors ====="
  grep -E -i 'postgres|error|failed|not found|container|image|health|exec|exit' "$log_file" | tail -n 500 || true
  echo
  echo "===== Supabase status ====="
  supabase status || true
  echo
  echo "===== Supabase containers ====="
  docker ps -a --filter "name=supabase" \
    --format "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}" || true

  for id in $(docker ps -aq --filter "name=supabase"); do
    name=$(docker inspect "$id" --format '{{.Name}}' 2>/dev/null | sed 's#^/##')
    echo
    echo "===== Docker inspect ${name:-$id} ====="
    docker inspect "$id" --format \
      'image={{json .Config.Image}} entrypoint={{json .Config.Entrypoint}} cmd={{json .Config.Cmd}} state={{json .State}}' || true
    echo
    echo "===== Docker logs ${name:-$id} ====="
    docker logs "$id" 2>&1 | tail -n 500 || true
  done
} | tee "$diagnostic_file"

echo "::error title=Supabase local startup failed::supabase start exited with status ${start_status}; diagnostics saved to ${diagnostic_file}"
exit "$start_status"
