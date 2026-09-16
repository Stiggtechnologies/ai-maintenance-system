#!/usr/bin/env bash
# Start local Supabase for CI. One retry after leftover container/port cleanup.
#
# Main push CI on 61f7cf1 (run 35039799431) applied the full migration chain,
# then failed while starting the remaining containers:
#   failed to bind host port 0.0.0.0:54324 for supabase_inbucket
#   address already in use
# The sibling "Migration chain + seeded auth smoke" job on that SHA passed, so
# this is start hygiene, not a schema regression. After the bind failure the
# CLI rolls back and prunes supabase_db_*, which is why later steps report
# "No such container: supabase_db_ai-maintenance-system".
set -uo pipefail

log_file="${1:-/tmp/supabase-start.log}"
diagnostic_file="${2:-/tmp/supabase-diagnostics.txt}"
max_attempts="${CI_SUPABASE_START_ATTEMPTS:-2}"

# Host ports published by supabase/config.toml for this project. Used only to
# diagnose and free leftovers between attempts; keep in sync with that file.
SUPABASE_HOST_PORTS=(54320 54321 54322 54323 54324 54327 54329)

is_transient_start_failure() {
  local log="$1"
  grep -Eiq 'address already in use|failed to start docker container|failed to bind host port' "$log"
}

emit_port_holders() {
  echo "===== Host listeners on Supabase ports ====="
  if command -v ss >/dev/null 2>&1; then
    ss -lptn | grep -E '5432[0-479]|54329' || true
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP -sTCP:LISTEN | grep -E '5432[0-479]|54329' || true
  fi
}

clean_leftover_supabase() {
  echo "Cleaning leftover local Supabase containers and published ports"
  supabase stop --all --no-backup || true

  local ids
  ids="$(docker ps -aq --filter name=supabase 2>/dev/null || true)"
  if [ -n "$ids" ]; then
    # shellcheck disable=SC2086
    docker rm -f $ids || true
  fi

  local port published
  for port in "${SUPABASE_HOST_PORTS[@]}"; do
    published="$(docker ps -aq --filter "publish=${port}" 2>/dev/null || true)"
    if [ -n "$published" ]; then
      # shellcheck disable=SC2086
      docker rm -f $published || true
    fi
  done

  if command -v fuser >/dev/null 2>&1; then
    for port in "${SUPABASE_HOST_PORTS[@]}"; do
      fuser -k "${port}/tcp" >/dev/null 2>&1 || true
    done
  fi
}

write_diagnostics() {
  local start_status="$1"
  {
    echo "Supabase local startup failed with status ${start_status}"
    echo
    echo "===== Supabase debug output (last 500 lines) ====="
    tail -n 500 "$log_file" || true
    echo
    echo "===== Relevant Supabase startup errors ====="
    grep -E -i 'postgres|error|failed|not found|container|image|health|exec|exit|already in use|bind host port' "$log_file" | tail -n 500 || true
    echo
    echo "===== Supabase status ====="
    supabase status || true
    echo
    echo "===== Supabase containers ====="
    docker ps -a --filter "name=supabase" \
      --format "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}" || true
    echo
    emit_port_holders

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
}

: > "$log_file"
attempt=1
start_status=1
while [ "$attempt" -le "$max_attempts" ]; do
  echo "=== supabase start attempt ${attempt}/${max_attempts} ===" | tee -a "$log_file"
  set +e
  supabase start --debug 2>&1 | tee -a "$log_file"
  start_status=${PIPESTATUS[0]}
  set -e
  if [ "$start_status" -eq 0 ]; then
    exit 0
  fi
  if [ "$attempt" -lt "$max_attempts" ] && is_transient_start_failure "$log_file"; then
    echo "supabase start hit a leftover container/port collision; retrying once after cleanup" | tee -a "$log_file"
    clean_leftover_supabase | tee -a "$log_file"
    attempt=$((attempt + 1))
    continue
  fi
  break
done

write_diagnostics "$start_status"
exit "$start_status"
