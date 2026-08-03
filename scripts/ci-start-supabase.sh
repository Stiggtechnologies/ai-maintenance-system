#!/usr/bin/env bash
set -uo pipefail

log_file="${1:-/tmp/supabase-start.log}"

set +e
supabase start --debug 2>&1 | tee "$log_file"
start_status=${PIPESTATUS[0]}
set -e

if [ "$start_status" -eq 0 ]; then
  exit 0
fi

echo "::error title=Supabase local startup failed::supabase start exited with status ${start_status}"

echo "::group::Supabase debug output (last 500 lines)"
tail -n 500 "$log_file" || true
echo "::endgroup::"

echo "::group::Relevant Supabase startup errors"
grep -E -i 'postgres|error|failed|not found|container|image|health|exec|exit' "$log_file" | tail -n 500 || true
echo "::endgroup::"

echo "::group::Supabase status"
supabase status || true
echo "::endgroup::"

echo "::group::Supabase containers"
docker ps -a --filter "name=supabase" \
  --format "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}" || true
echo "::endgroup::"

for id in $(docker ps -aq --filter "name=supabase"); do
  name=$(docker inspect "$id" --format '{{.Name}}' 2>/dev/null | sed 's#^/##')
  echo "::group::Docker inspect ${name:-$id}"
  docker inspect "$id" --format \
    'image={{json .Config.Image}} entrypoint={{json .Config.Entrypoint}} cmd={{json .Config.Cmd}} state={{json .State}}' || true
  echo "::endgroup::"

  echo "::group::Docker logs ${name:-$id}"
  docker logs "$id" 2>&1 | tail -n 500 || true
  echo "::endgroup::"
done

exit "$start_status"
